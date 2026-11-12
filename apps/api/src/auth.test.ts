import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { AuthGuard, COOKIE_NAME, Public, RateLimit, Roles, readCookie } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { MemoryNotifier } from './auth/notifier';
import { RateLimiter } from './auth/rate-limit';
import { SessionSigner } from './auth/session';
import { InMemoryUserStore, PostgresUserStore, UserStore } from './auth/users';
import { AUTH_STORAGE, AuthStorage, InMemoryAuthStorage, PostgresAuthStorage } from './auth/auth-storage';
import { InMemoryVoteStore, VoteStore } from './domain/store';
import { PostgresVoteStore } from './domain/postgres-store';
import { validateEnvironment } from './validateEnv';

const secret = Buffer.from('x'.repeat(40));

interface AuthSuiteAdapter {
  name: string;
  createAuth: () => Promise<{
    store: VoteStore;
    users: UserStore;
    storage: AuthStorage;
    notifier: MemoryNotifier;
    auth: AuthService;
    prisma?: PrismaClient;
  }>;
}

const adapters: AuthSuiteAdapter[] = [
  {
    name: 'InMemory',
    createAuth: async () => {
      const store = new InMemoryVoteStore();
      await store.upsertVoters([{ id: 'v1', name: 'Ada', email: 'ada@x.com' }]);
      const users = new InMemoryUserStore();
      const storage = new InMemoryAuthStorage();
      const notifier = new MemoryNotifier();
      const auth = new AuthService(store, users, notifier, storage);
      return { store, users, storage, notifier, auth };
    },
  },
];

if (process.env.DATABASE_URL) {
  const prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });
  adapters.push({
    name: 'Postgres',
    createAuth: async () => {
      await prisma.$executeRawUnsafe('TRUNCATE "StaffUser", "SessionRevocation", "OtpRecord", "Voter" CASCADE');
      const store = new PostgresVoteStore(prisma);
      await store.upsertVoters([{ id: 'v1', name: 'Ada', email: 'ada@x.com' }]);
      const users = new PostgresUserStore(prisma);
      const storage = new PostgresAuthStorage(prisma);
      const notifier = new MemoryNotifier();
      const auth = new AuthService(store, users, notifier, storage);
      return { store, users, storage, notifier, auth, prisma };
    },
  });
}

test('sessions are signed, expire, and reject tampering', () => {
  const s = new SessionSigner(secret);
  const { token, payload } = s.sign({ sub: 'v1', role: 'VOTER', name: 'Ada' }, 60, 1_000_000);
  assert.equal(s.verify(token, 1_000_000)?.sub, 'v1');
  assert.equal(s.verify(token, 1_000_000 + 61_000), null);
  const [body, mac] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...payload, role: 'ADMIN' })).toString('base64url');
  assert.equal(s.verify(`${forged}.${mac}`, 1_000_000), null);
  assert.equal(s.verify(`${body}.${mac}x`, 1_000_000), null);
  assert.equal(s.verify(undefined), null);
  assert.equal(s.verify('garbage'), null);
  assert.equal(new SessionSigner(Buffer.from('y'.repeat(40))).verify(token, 1_000_000), null);
  assert.throws(() => new SessionSigner(Buffer.from('short')), /32 bytes/);
});

test('rate limiting still works when the flag is OFF (6 wrong OTP guesses get blocked)', async () => {
  delete process.env.NO_RATE_LIMIT;
  const { auth, notifier } = await adapters[0].createAuth();
  await auth.requestOtp('v1', 0);
  const code = notifier.last().code;
  const wrong = code === '000000' ? '000001' : '000000';

  // 5 wrong guesses fail
  for (let i = 0; i < 5; i++) {
    await assert.rejects(() => auth.verifyOtp('v1', wrong, 1000), /Invalid or expired/);
  }

  // 6th guess is locked out even when providing the correct code
  await assert.rejects(() => auth.verifyOtp('v1', code, 1000), /Invalid or expired/);
});

test('NO_RATE_LIMIT is refused when NODE_ENV=production', () => {
  process.env.NO_RATE_LIMIT = 'true';
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => validateEnvironment(), /NO_RATE_LIMIT must not be enabled in production/);
    assert.throws(() => new RateLimiter(), /NO_RATE_LIMIT must not be enabled in production/);
  } finally {
    delete process.env.NO_RATE_LIMIT;
    process.env.NODE_ENV = 'test';
  }
});

test('STORE=memory is refused when NODE_ENV=production', () => {
  process.env.STORE = 'memory';
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => validateEnvironment(), /STORE=memory is refused in production/);
  } finally {
    delete process.env.STORE;
    process.env.NODE_ENV = 'test';
  }
});

test('INSTANCES > 1 without REDIS_URL is refused when NODE_ENV=production', () => {
  // Provide all other required production fields so the INSTANCES check is reached.
  const prodBase: NodeJS.ProcessEnv = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://dummy:dummy@localhost:5432/evote',
    STORE: 'postgres',
    SESSION_SECRET: 'a-sufficiently-long-secret-for-testing-purposes!!',
    NOTIFIER: 'smtp',
    SMTP_HOST: 'smtp.example.com',
    INSTANCES: '3',
  };
  assert.throws(
    () => validateEnvironment(prodBase),
    /REDIS_URL must be configured in production when INSTANCES > 1/,
  );

  assert.doesNotThrow(() =>
    validateEnvironment({
      ...prodBase,
      REDIS_URL: 'redis://localhost:6379',
    }),
  );
});

test('OTP_ECHO only echoes outside production', async () => {
  const { auth } = await adapters[0].createAuth();
  process.env.OTP_ECHO = 'true';
  try {
    assert.match((await auth.requestOtp('v1', 0)).devCode ?? '', /^\d{6}$/);
    process.env.NODE_ENV = 'production';
    assert.equal((await auth.requestOtp('v1', 100_000)).devCode, undefined);
    assert.throws(() => validateEnvironment(), /OTP_ECHO must not be enabled in production/);
  } finally {
    process.env.NODE_ENV = 'test';
    delete process.env.OTP_ECHO;
  }
});

test('cookie parsing', () => {
  assert.equal(readCookie('a=1; evote_session=abc%3D; b=2', 'evote_session'), 'abc=');
  assert.equal(readCookie('a=1', 'evote_session'), undefined);
  assert.equal(readCookie(undefined, 'x'), undefined);
});

class Routes {
  @Roles('ADMIN') admin() {}
  @Public() open() {}
  @RateLimit(2, 60) limited() {}
  any() {}
}

function ctx(method: string, handler: () => void, headers: Record<string, string> = {}): ExecutionContext {
  const req = { method, headers, ip: '1.2.3.4', path: '/x', route: { path: '/x' } } as Record<string, unknown>;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => Routes,
  } as unknown as ExecutionContext;
}

for (const { name: adapterName, createAuth } of adapters) {
  test(`[${adapterName}] voter OTP: request, verify once, no reuse`, async () => {
    const { auth, notifier } = await createAuth();
    assert.deepEqual(await auth.requestOtp(' V1 '), { sent: true });
    const code = notifier.last().code;
    assert.match(code, /^\d{6}$/);
    const who = await auth.verifyOtp('v1', code);
    assert.deepEqual(who, { id: 'v1', name: 'Ada' });
    await assert.rejects(() => auth.verifyOtp('v1', code), /Invalid or expired/);
  });

  test(`[${adapterName}] unknown voters get the same answer and nothing is sent`, async () => {
    const { auth, notifier } = await createAuth();
    assert.deepEqual(await auth.requestOtp('ghost'), { sent: true });
    assert.equal(notifier.sent.length, 0);
  });

  test(`[${adapterName}] OTP locks after 5 wrong tries, expires, and has a resend cooldown`, async () => {
    const { auth, notifier } = await createAuth();
    await auth.requestOtp('v1', 0);
    const code = notifier.last().code;
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) await assert.rejects(() => auth.verifyOtp('v1', wrong, 1000), /Invalid/);
    await assert.rejects(() => auth.verifyOtp('v1', code, 1000), /Invalid/);

    await auth.requestOtp('v1', 100_000);
    const c2 = notifier.last().code;
    await auth.requestOtp('v1', 105_000);
    assert.equal(notifier.sent.length, 2, 'resend inside 30s is ignored');
    await assert.rejects(() => auth.verifyOtp('v1', c2, 100_000 + 11 * 60_000), /Invalid/);
    await auth.requestOtp('v1', 200_000);
    assert.equal(notifier.sent.length, 3);
  });

  test(`[${adapterName}] staff accounts: password rules, login, duplicates`, async () => {
    const { auth } = await createAuth();
    await assert.rejects(() => auth.createStaff({ email: 'bad', name: 'A', password: 'longenough1', role: 'ADMIN' }), /valid email/);
    await assert.rejects(() => auth.createStaff({ email: 'a@x.com', name: 'A', password: 'short', role: 'ADMIN' }), /at least 10/);
    await assert.rejects(() => auth.createStaff({ email: 'a@x.com', name: 'A', password: 'longenough1', role: 'VOTER' as never }), /Role/);
    const u = await auth.createStaff({ email: 'Obs@x.com', name: 'Obi', password: 'longenough1', role: 'OBSERVER' });
    assert.equal('passwordHash' in u, false);
    await assert.rejects(() => auth.createStaff({ email: 'obs@x.com', name: 'Dup', password: 'longenough1', role: 'OBSERVER' }), /already exists/);
    assert.equal((await auth.staffLogin(' OBS@x.com ', 'longenough1')).role, 'OBSERVER');
    await assert.rejects(() => auth.staffLogin('obs@x.com', 'wrong-password'), /Wrong email or password/);
    await assert.rejects(() => auth.staffLogin('nobody@x.com', 'longenough1'), /Wrong email or password/);
    assert.equal((await auth.listStaff()).some((x) => 'passwordHash' in x), false);
  });

  test(`[${adapterName}] seedAdmin uses ADMIN_PASSWORD, and creates nothing in production without one`, async () => {
    const a = (await createAuth()).auth;
    await a.seedAdmin({ ADMIN_EMAIL: 'root@x.com', ADMIN_PASSWORD: 'supersecret123' } as never);
    assert.equal((await a.staffLogin('root@x.com', 'supersecret123')).role, 'ADMIN');

    const empty = (await createAuth()).auth;
    process.env.NODE_ENV = 'production';
    try {
      await empty.seedAdmin({ ADMIN_EMAIL: 'root@x.com' } as never);
      await assert.rejects(() => empty.staffLogin('root@x.com', 'anything'), /Wrong email/);
    } finally {
      process.env.NODE_ENV = 'test';
    }
  });

  test(`[${adapterName}] guard: csrf, sessions, roles, public routes, rate limits`, async () => {
    delete process.env.NO_RATE_LIMIT;
    const signer = new SessionSigner(secret);
    const { auth } = await createAuth();
    const guard = new AuthGuard(new Reflector(), signer, auth, new RateLimiter());
    const r = new Routes();
    const cookie = (role: 'ADMIN' | 'VOTER') => ({ cookie: `${COOKIE_NAME}=${signer.sign({ sub: 'u', role, name: 'U' }, 60).token}` });

    assert.throws(() => guard.canActivate(ctx('POST', r.any, cookie('ADMIN'))), /CSRF/);
    assert.equal(guard.canActivate(ctx('POST', r.any, { ...cookie('ADMIN'), 'x-evote-csrf': '1' })), true);
    assert.throws(() => guard.canActivate(ctx('GET', r.any)), /sign in/);
    assert.throws(() => guard.canActivate(ctx('GET', r.admin, cookie('VOTER'))), /do not have access/);
    assert.equal(guard.canActivate(ctx('GET', r.admin, cookie('ADMIN'))), true);
    assert.equal(guard.canActivate(ctx('GET', r.open)), true);
    assert.throws(() => guard.canActivate(ctx('POST', r.open)), /CSRF/);

    const { token } = signer.sign({ sub: 'u', role: 'ADMIN', name: 'U' }, 60);
    auth.revoke(signer.verify(token)!.sid, 9_999_999_999);
    assert.throws(() => guard.canActivate(ctx('GET', r.any, { cookie: `${COOKIE_NAME}=${token}` })), /sign in/);

    const g2 = new AuthGuard(new Reflector(), signer, auth, new RateLimiter());
    const h = { ...cookie('ADMIN') };
    assert.equal(g2.canActivate(ctx('GET', r.limited, h)), true);
    assert.equal(g2.canActivate(ctx('GET', r.limited, h)), true);
    assert.throws(() => g2.canActivate(ctx('GET', r.limited, h)), /Too many/);
  });
}

test('Postgres durable auth: OTP table stores hash and salt only, never the plaintext code', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is not set: skipping Postgres auth test');
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  await prisma.$executeRawUnsafe('TRUNCATE "OtpRecord" CASCADE');
  const storage = new PostgresAuthStorage(prisma);
  const now = Date.now();
  await storage.saveOtp('v1', { hash: 'abcd1234abcd1234', salt: 'salt1234', expiresAt: now + 60000, sentAt: now });

  const record = await prisma.otpRecord.findUnique({ where: { voterId: 'v1' } });
  assert.ok(record);
  assert.equal(record.voterId, 'v1');
  assert.equal(record.codeHash, 'abcd1234abcd1234');
  assert.equal(record.salt, 'salt1234');
  assert.equal('code' in record, false, 'Plaintext code must never be a column or stored');
  storage.dispose();
  await prisma.$disconnect();
});

test('Postgres durable auth: cleanupExpired deletes expired session revocations and OTP records', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is not set: skipping Postgres auth test');
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  await prisma.$executeRawUnsafe('TRUNCATE "SessionRevocation", "OtpRecord" CASCADE');
  const storage = new PostgresAuthStorage(prisma);
  const past = new Date(Date.now() - 60_000);
  const future = new Date(Date.now() + 60_000);

  // Insert expired and active session revocations
  await prisma.sessionRevocation.create({ data: { sid: 'expired-session', expiresAt: past } });
  await prisma.sessionRevocation.create({ data: { sid: 'active-session', expiresAt: future } });

  // Insert expired and active OTP records
  await prisma.otpRecord.create({
    data: { voterId: 'expired-voter', codeHash: 'hash', salt: 'salt', expiresAt: past, sentAt: past },
  });
  await prisma.otpRecord.create({
    data: { voterId: 'active-voter', codeHash: 'hash', salt: 'salt', expiresAt: future, sentAt: future },
  });

  await storage.cleanupExpired();

  const remainingSessions = await prisma.sessionRevocation.findMany();
  assert.equal(remainingSessions.length, 1);
  assert.equal(remainingSessions[0].sid, 'active-session');

  const remainingOtps = await prisma.otpRecord.findMany();
  assert.equal(remainingOtps.length, 1);
  assert.equal(remainingOtps[0].voterId, 'active-voter');
  storage.dispose();
  await prisma.$disconnect();
});

test('Multi-instance session revocation: revoke on guard 1, guard 2 rejects within poll interval', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is not set: skipping multi-instance session revocation test');
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  await prisma.$executeRawUnsafe('TRUNCATE "SessionRevocation" CASCADE');

  const signer = new SessionSigner(secret);
  // Two separate storage and guard instances sharing the same database with 5000ms poll interval
  const storage1 = new PostgresAuthStorage(prisma, { pollIntervalMs: 5000 });
  const storage2 = new PostgresAuthStorage(prisma, { pollIntervalMs: 5000 });
  await storage1.loadRevocations();
  await storage2.loadRevocations();

  const store = new InMemoryVoteStore();
  const users = new InMemoryUserStore();
  const notifier = new MemoryNotifier();

  const auth1 = new AuthService(store, users, notifier, storage1);
  const auth2 = new AuthService(store, users, notifier, storage2);

  const guard1 = new AuthGuard(new Reflector(), signer, auth1, new RateLimiter());
  const guard2 = new AuthGuard(new Reflector(), signer, auth2, new RateLimiter());

  const r = new Routes();
  const { token } = signer.sign({ sub: 'admin-multi', role: 'ADMIN', name: 'Admin Multi' }, 60);
  const sid = signer.verify(token)!.sid;
  const h = { cookie: `${COOKIE_NAME}=${token}` };

  // Initially both guards accept the session
  assert.equal(guard1.canActivate(ctx('GET', r.admin, h)), true);
  assert.equal(guard2.canActivate(ctx('GET', r.admin, h)), true);

  // Revoke session on instance 1
  await storage1.revoke(sid, Math.floor(Date.now() / 1000) + 60);

  // Instance 1 rejects immediately (local cache updated synchronously on revoke)
  assert.throws(() => guard1.canActivate(ctx('GET', r.admin, h)), /sign in/);

  // Instance 2 polls SessionRevocation every 5s and updates its local cache
  // Within the poll interval (wait ~5.2s), instance 2 will have polled and rejected
  await new Promise((resolve) => setTimeout(resolve, 5200));

  assert.throws(() => guard2.canActivate(ctx('GET', r.admin, h)), /sign in/);

  storage1.dispose();
  storage2.dispose();
  await prisma.$disconnect();
});
