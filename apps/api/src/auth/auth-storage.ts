import { PrismaClient } from '@prisma/client';

export interface OtpData {
  hash: string;
  salt: string;
  expiresAt: number;
  sentAt: number;
  attempts: number;
}

export interface AuthStorage {
  revoke(sid: string, expSeconds: number): Promise<void>;
  isRevoked(sid: string): boolean;
  loadRevocations(): Promise<void>;

  getOtp(voterId: string): Promise<OtpData | undefined>;
  saveOtp(voterId: string, otp: { hash: string; salt: string; expiresAt: number; sentAt: number }): Promise<void>;
  incrementOtpAttempts(voterId: string): Promise<number>;
  deleteOtp(voterId: string): Promise<void>;

  cleanupExpired(now?: number): Promise<void>;
  dispose?(): void;
}

export const AUTH_STORAGE = Symbol('AUTH_STORAGE');

export class InMemoryAuthStorage implements AuthStorage {
  private pending = new Map<string, OtpData>();
  private revoked = new Map<string, number>();

  async revoke(sid: string, expSeconds: number): Promise<void> {
    this.revoked.set(sid, expSeconds);
    if (this.revoked.size > 10_000) {
      const now = Date.now() / 1000;
      for (const [k, v] of this.revoked) if (v < now) this.revoked.delete(k);
    }
  }

  isRevoked(sid: string): boolean {
    return this.revoked.has(sid);
  }

  async loadRevocations(): Promise<void> {
    // In-memory has no external state to load
  }

  async getOtp(voterId: string): Promise<OtpData | undefined> {
    return this.pending.get(voterId);
  }

  async saveOtp(voterId: string, otp: { hash: string; salt: string; expiresAt: number; sentAt: number }): Promise<void> {
    this.pending.set(voterId, { ...otp, attempts: 0 });
  }

  async incrementOtpAttempts(voterId: string): Promise<number> {
    const existing = this.pending.get(voterId);
    if (!existing) return 0;
    existing.attempts++;
    return existing.attempts;
  }

  async deleteOtp(voterId: string): Promise<void> {
    this.pending.delete(voterId);
  }

  async cleanupExpired(now = Date.now()): Promise<void> {
    for (const [id, otp] of this.pending) {
      if (otp.expiresAt < now) this.pending.delete(id);
    }
    const sec = now / 1000;
    for (const [sid, exp] of this.revoked) {
      if (exp < sec) this.revoked.delete(sid);
    }
  }

  dispose(): void {}
}

export interface PostgresAuthStorageOptions {
  pollIntervalMs?: number;
  disablePolling?: boolean;
}

export class PostgresAuthStorage implements AuthStorage {
  private localRevoked = new Set<string>();
  private pollTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaClient,
    options?: PostgresAuthStorageOptions,
  ) {
    if (!options?.disablePolling) {
      const intervalMs = options?.pollIntervalMs ?? 5000;
      this.pollTimer = setInterval(() => {
        this.pollRevocations().catch(() => {});
      }, intervalMs);
      this.pollTimer.unref();
    }
  }

  async loadRevocations(): Promise<void> {
    await this.pollRevocations();
  }

  async pollRevocations(): Promise<void> {
    const active = await this.prisma.sessionRevocation.findMany({
      where: {
        expiresAt: { gt: new Date() },
      },
      select: { sid: true },
    });
    const set = new Set<string>();
    for (const row of active) {
      set.add(row.sid);
    }
    this.localRevoked = set;
  }

  stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  dispose(): void {
    this.stopPolling();
  }

  async revoke(sid: string, expSeconds: number): Promise<void> {
    this.localRevoked.add(sid);
    const expiresAt = new Date(expSeconds * 1000);
    await this.prisma.sessionRevocation.upsert({
      where: { sid },
      create: { sid, expiresAt },
      update: { expiresAt },
    });
  }

  isRevoked(sid: string): boolean {
    return this.localRevoked.has(sid);
  }

  async getOtp(voterId: string): Promise<OtpData | undefined> {
    const row = await this.prisma.otpRecord.findUnique({
      where: { voterId },
    });
    if (!row) return undefined;
    return {
      hash: row.codeHash,
      salt: row.salt,
      expiresAt: row.expiresAt.getTime(),
      sentAt: row.sentAt.getTime(),
      attempts: row.attempts,
    };
  }

  async saveOtp(voterId: string, otp: { hash: string; salt: string; expiresAt: number; sentAt: number }): Promise<void> {
    const expiresAt = new Date(otp.expiresAt);
    const sentAt = new Date(otp.sentAt);
    await this.prisma.otpRecord.upsert({
      where: { voterId },
      create: {
        voterId,
        codeHash: otp.hash,
        salt: otp.salt,
        attempts: 0,
        expiresAt,
        sentAt,
      },
      update: {
        codeHash: otp.hash,
        salt: otp.salt,
        attempts: 0,
        expiresAt,
        sentAt,
      },
    });
  }

  async incrementOtpAttempts(voterId: string): Promise<number> {
    const updated = await this.prisma.otpRecord.update({
      where: { voterId },
      data: {
        attempts: { increment: 1 },
      },
    });
    return updated.attempts;
  }

  async deleteOtp(voterId: string): Promise<void> {
    await this.prisma.otpRecord.deleteMany({
      where: { voterId },
    });
  }

  async cleanupExpired(now = Date.now()): Promise<void> {
    const nowDate = new Date(now);
    await this.prisma.sessionRevocation.deleteMany({
      where: { expiresAt: { lt: nowDate } },
    });
    await this.prisma.otpRecord.deleteMany({
      where: { expiresAt: { lt: nowDate } },
    });
    await this.pollRevocations();
  }
}
