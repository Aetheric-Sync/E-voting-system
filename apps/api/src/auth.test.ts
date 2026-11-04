import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, COOKIE_NAME, Public, RateLimit, Roles, readCookie } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { MemoryNotifier } from './auth/notifier';
import { RateLimiter } from './auth/rate-limit';
import { SessionSigner } from './auth/session';
import { InMemoryUserStore } from './auth/users';
import { InMemoryVoteStore } from './domain/store';

const secret = Buffer.from('x'.repeat(40));

async function authSetup() {
  const store = new InMemoryVoteStore();
  await store.upsertVoters([{ id: 'v1', name: 'Ada', email: 'ada@x.com' }]);
  const notifier = new MemoryNotifier();
  const auth = new AuthService(store, new InMemoryUserStore(), notifier);
  return { store, notifier, auth };
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

test('voter OTP: request, verify once, no reuse', async () => {
  const { auth, notifier } = await authSetup();
  assert.deepEqual(await auth.requestOtp(' V1 '), { sent: true });
  const code = notifier.last().code;
  assert.match(code, /^\d{6}$/);
  const who = await auth.verifyOtp('v1', code);
  assert.deepEqual(who, { id: 'v1', name: 'Ada' });
  await assert.rejects(() => auth.verifyOtp('v1', code), /Invalid or expired/);
});

test('unknown voters get the same answer and nothing is sent', async () => {
  const { auth, notifier } = await authSetup();
  assert.deepEqual(await auth.requestOtp('ghost'), { sent: true });
  assert.equal(notifier.sent.length, 0);
});

test('OTP locks after 5 wrong tries, expires, and has a resend cooldown', async () => {
  const { auth, notifier } = await authSetup();
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

test('OTP_ECHO only echoes outside production', async () => {
  const { auth } = await authSetup();
  process.env.OTP_ECHO = 'true';
  try {
    assert.match((await auth.requestOtp('v1', 0)).devCode ?? '', /^\d{6}$/);
    process.env.NODE_ENV = 'production';
    assert.equal((await auth.requestOtp('v1', 100_000)).devCode, undefined);
  } finally {
    process.env.NODE_ENV = 'test';
    delete process.env.OTP_ECHO;
  }
});

test('staff accounts: password rules, login, duplicates', async () => {
  const { auth } = await authSetup();
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

test('seedAdmin uses ADMIN_PASSWORD, and creates nothing in production without one', async () => {
  const a = (await authSetup()).auth;
  await a.seedAdmin({ ADMIN_EMAIL: 'root@x.com', ADMIN_PASSWORD: 'supersecret123' } as never);
  assert.equal((await a.staffLogin('root@x.com', 'supersecret123')).role, 'ADMIN');
  const b = (await authSetup()).auth;
  await b.seedAdmin({ NODE_ENV: 'production' } as never);
  assert.equal((await b.listStaff()).length, 0);
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

test('guard: csrf, sessions, roles, public routes, rate limits', async () => {
  const signer = new SessionSigner(secret);
  const { auth } = await authSetup();
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

test('cookie parsing', () => {
  assert.equal(readCookie('a=1; evote_session=abc%3D; b=2', 'evote_session'), 'abc=');
  assert.equal(readCookie('a=1', 'evote_session'), undefined);
  assert.equal(readCookie(undefined, 'x'), undefined);
});
