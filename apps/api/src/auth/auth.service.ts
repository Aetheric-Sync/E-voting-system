import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger, Optional, UnauthorizedException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { normalizeVoterId } from '@evote/core';
import { VOTE_STORE, VoteStore } from '../domain/store';
import { NOTIFIER, Notifier } from './notifier';
import { StaffRole, StaffUser, USER_STORE, UserStore, hashPassword, verifyPassword } from './users';
import { AUTH_STORAGE, AuthStorage, InMemoryAuthStorage } from './auth-storage';

const OTP_TTL_MS = 10 * 60_000;
const OTP_RESEND_MS = 30_000;
const OTP_MAX_ATTEMPTS = 5;
const MIN_PASSWORD = 10;

export interface VoterIdentity {
  id: string;
  name: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest();

@Injectable()
export class AuthService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Auth');
  private readonly storage: AuthStorage;
  private readonly cleanupTimer: NodeJS.Timeout;
  /** Computed once so a missing account costs as much time as a wrong password. */
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(VOTE_STORE) private readonly store: VoteStore,
    @Inject(USER_STORE) private readonly users: UserStore,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
    @Optional() @Inject(AUTH_STORAGE) storage?: AuthStorage,
  ) {
    this.storage = storage ?? new InMemoryAuthStorage();
    this.cleanupTimer = setInterval(() => {
      this.storage.cleanupExpired().catch((err) => {
        this.log.error(`Periodic auth cleanup failed: ${(err as Error).message}`);
      });
    }, 60_000);
    this.cleanupTimer.unref();
  }

  async onModuleInit() {
    await this.storage.loadRevocations();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.storage.dispose?.();
  }

  /**
   * Always answers the same way, so the endpoint cannot be used to find out who is registered.
   * `devCode` is only filled when OTP_ECHO=true outside production (local demos and tests).
   */
  async requestOtp(rawVoterId: string, now = Date.now()): Promise<{ sent: true; devCode?: string }> {
    const id = normalizeVoterId(rawVoterId);
    const voter = id ? await this.store.getVoter(id) : undefined;
    if (!voter) return { sent: true };

    const prev = await this.storage.getOtp(id);
    if (prev && now - prev.sentAt < OTP_RESEND_MS) return { sent: true };

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const salt = randomBytes(8).toString('hex');
    const hash = sha(salt + code).toString('hex');
    await this.storage.saveOtp(id, { hash, salt, expiresAt: now + OTP_TTL_MS, sentAt: now });

    try {
      await this.notifier.sendOtp({ to: { email: voter.email, phone: voter.phone }, name: voter.name, code, ttlMinutes: OTP_TTL_MS / 60_000 });
    } catch (err) {
      await this.storage.deleteOtp(id);
      this.log.error(`OTP delivery failed for a voter: ${(err as Error).message}`);
    }
    const echo = process.env.OTP_ECHO === 'true' && process.env.NODE_ENV !== 'production';
    return echo ? { sent: true, devCode: code } : { sent: true };
  }

  async verifyOtp(rawVoterId: string, code: string, now = Date.now()): Promise<VoterIdentity> {
    const fail = () => new UnauthorizedException('Invalid or expired code');
    const id = normalizeVoterId(rawVoterId);
    const p = await this.storage.getOtp(id);
    if (!p || p.expiresAt < now || !/^\d{6}$/.test(code)) throw fail();
    if (p.attempts >= OTP_MAX_ATTEMPTS) {
      await this.storage.deleteOtp(id);
      throw fail();
    }
    await this.storage.incrementOtpAttempts(id);
    const ok = timingSafeEqual(sha(p.salt + code), Buffer.from(p.hash, 'hex'));
    if (!ok) throw fail();
    await this.storage.deleteOtp(id);
    const voter = await this.store.getVoter(id);
    if (!voter) throw fail();
    return { id: voter.id, name: voter.name };
  }

  async staffLogin(email: string, password: string): Promise<StaffUser> {
    const user = await this.users.getByEmail((email ?? '').trim().toLowerCase());
    this.dummyHash ??= hashPassword('not-a-real-password');
    const ok = await verifyPassword(password ?? '', user?.passwordHash ?? (await this.dummyHash));
    if (!user || !ok) throw new UnauthorizedException('Wrong email or password');
    return user;
  }

  async createStaff(input: { email: string; name: string; password: string; role: StaffRole }): Promise<Omit<StaffUser, 'passwordHash'>> {
    const email = (input.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('A valid email is required');
    if (!input.name?.trim()) throw new BadRequestException('Name is required');
    if ((input.password ?? '').length < MIN_PASSWORD) throw new BadRequestException(`Password must be at least ${MIN_PASSWORD} characters`);
    if (!['ADMIN', 'OBSERVER'].includes(input.role)) throw new BadRequestException('Role must be ADMIN or OBSERVER');
    try {
      const u = await this.users.create({ email, name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password) });
      const { passwordHash: _omit, ...safe } = u;
      return safe;
    } catch {
      throw new ConflictException('An account with that email already exists');
    }
  }

  async listStaff() {
    return (await this.users.list()).map(({ passwordHash: _omit, ...u }) => u);
  }

  /**
   * First-run admin. ADMIN_PASSWORD wins; otherwise, outside production, a random one is
   * generated and printed once. In production with no ADMIN_PASSWORD nothing is created.
   */
  async seedAdmin(env = process.env) {
    if (await this.users.getByEmail((env.ADMIN_EMAIL ?? 'admin@evote.local').toLowerCase())) return;
    const email = env.ADMIN_EMAIL ?? 'admin@evote.local';
    let password = env.ADMIN_PASSWORD;
    let generated = false;
    if (!password) {
      if (env.NODE_ENV === 'production') {
        this.log.warn('No ADMIN_PASSWORD set in production: no admin account was created');
        return;
      }
      password = randomBytes(12).toString('base64url');
      generated = true;
    }
    await this.createStaff({ email, name: 'Administrator', password, role: 'ADMIN' });
    this.log.log(generated ? `Dev admin created: ${email} / ${password}` : `Admin account ready: ${email}`);
  }

  async revoke(sid: string, expSeconds: number): Promise<void> {
    try {
      await this.storage.revoke(sid, expSeconds);
    } catch (err) {
      this.log.error(`Session revocation failed: ${(err as Error).message}`);
    }
  }

  isRevoked(sid: string) {
    return this.storage.isRevoked(sid);
  }
}
