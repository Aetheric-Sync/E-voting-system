import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard, COOKIE_NAME, RateLimit, Roles } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { MemoryNotifier } from './auth/notifier';
import { InMemoryRateLimitStore, RateLimiter, RedisRateLimitStore } from './auth/rate-limit';
import { SessionSigner } from './auth/session';
import { InMemoryUserStore } from './auth/users';
import { InMemoryAuthStorage } from './auth/auth-storage';
import { InMemoryVoteStore } from './domain/store';
import { CastingService } from './casting/casting.service';
import { ElectionsService } from './elections/elections.service';

const secret = Buffer.from('x'.repeat(40));

test('InMemoryRateLimitStore: rate limiting within window and reset', () => {
  const store = new InMemoryRateLimitStore();
  const key = 'test-client-1';

  // Allow 3 calls in 10-second window
  assert.equal(store.allow(key, 3, 10, 1000), true);
  assert.equal(store.allow(key, 3, 10, 2000), true);
  assert.equal(store.allow(key, 3, 10, 3000), true);
  // 4th call exceeds limit
  assert.equal(store.allow(key, 3, 10, 4000), false);

  // New window after 10s: allowed again
  assert.equal(store.allow(key, 3, 10, 12000), true);
});

test('InMemoryRateLimitStore: idempotency tracking and expiry', () => {
  const store = new InMemoryRateLimitStore();
  const key = 'election1|voter1|idemp1';

  assert.equal(store.hasSeenIdempotency(key, 1000), false);
  store.markIdempotency(key, 60, 1000); // 60s TTL
  assert.equal(store.hasSeenIdempotency(key, 2000), true);

  // Expired after 61 seconds
  assert.equal(store.hasSeenIdempotency(key, 62000), false);
});

test('RedisRateLimitStore: atomic rate limiting, window reset, and multi-instance coordination', async (t) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    t.skip('REDIS_URL is not set: skipping Redis rate limit tests');
    return;
  }

  // Create two instances connected to the same Redis (simulating 2 API servers)
  const store1 = new RedisRateLimitStore(redisUrl);
  const store2 = new RedisRateLimitStore(redisUrl);

  const sharedKey = `shared-test-${Date.now()}`;

  // Limit of 2 requests across a 2-second window
  // Instance 1 takes hit 1
  assert.equal(await store1.allow(sharedKey, 2, 2), true);
  // Instance 2 takes hit 2
  assert.equal(await store2.allow(sharedKey, 2, 2), true);

  // Next hit on either instance is blocked!
  assert.equal(await store1.allow(sharedKey, 2, 2), false);
  assert.equal(await store2.allow(sharedKey, 2, 2), false);

  // Wait 2.2s for Redis key TTL to expire
  await new Promise((r) => setTimeout(r, 2200));

  // Now both instances can proceed again
  assert.equal(await store2.allow(sharedKey, 2, 2), true);

  await store1.close();
  await store2.close();
});

test('RedisRateLimitStore: multi-instance idempotency tracking', async (t) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    t.skip('REDIS_URL is not set: skipping Redis idempotency tests');
    return;
  }

  const store1 = new RedisRateLimitStore(redisUrl);
  const store2 = new RedisRateLimitStore(redisUrl);

  const key = `election-abc|voter-xyz|key-${Date.now()}`;

  // Neither instance has seen the key yet
  assert.equal(await store1.hasSeenIdempotency(key), false);
  assert.equal(await store2.hasSeenIdempotency(key), false);

  // Instance 1 marks the idempotency key
  await store1.markIdempotency(key, 60);

  // Instance 2 immediately sees the idempotency key
  assert.equal(await store2.hasSeenIdempotency(key), true);
  assert.equal(await store1.hasSeenIdempotency(key), true);

  await store1.close();
  await store2.close();
});

test('AuthGuard with RedisRateLimitStore: async rate limiting blocks excessive calls', async (t) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    t.skip('REDIS_URL is not set: skipping AuthGuard Redis test');
    return;
  }

  const redisStore = new RedisRateLimitStore(redisUrl);
  const limiter = new RateLimiter(redisStore);

  const signer = new SessionSigner(secret);
  const auth = new AuthService(new InMemoryVoteStore(), new InMemoryUserStore(), new MemoryNotifier(), new InMemoryAuthStorage());
  const guard = new AuthGuard(new Reflector(), signer, auth, limiter);

  class GuardRoutes {
    @Roles('ADMIN')
    @RateLimit(2, 5)
    limitedRoute() {}
  }

  const r = new GuardRoutes();
  const token = signer.sign({ sub: 'admin-1', role: 'ADMIN', name: 'Admin 1' }, 60).token;
  const uniqueIp = `ip-${Date.now()}`;

  function makeCtx(): ExecutionContext {
    const req = {
      method: 'GET',
      headers: { cookie: `${COOKIE_NAME}=${token}` },
      ip: uniqueIp,
      path: '/limited',
      route: { path: '/limited' },
    };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => r.limitedRoute,
      getClass: () => GuardRoutes,
    } as unknown as ExecutionContext;
  }

  // 1st request allowed
  assert.equal(await guard.canActivate(makeCtx()), true);
  // 2nd request allowed
  assert.equal(await guard.canActivate(makeCtx()), true);
  // 3rd request blocked by RateLimit
  await assert.rejects(async () => await guard.canActivate(makeCtx()), /Too many requests/);

  await redisStore.close();
});

test('CastingService with RedisRateLimitStore: idempotency coordinated across instances', async (t) => {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    t.skip('REDIS_URL is not set: skipping CastingService Redis test');
    return;
  }

  const redisStore1 = new RedisRateLimitStore(redisUrl);
  const redisStore2 = new RedisRateLimitStore(redisUrl);

  const voteStore = new InMemoryVoteStore();
  await voteStore.upsertVoters([{ id: 'voter-multi-1', name: 'Multi Voter', email: 'v@test.local' }]);

  const elections = new ElectionsService(voteStore);
  const election = await elections.create({
    title: 'Multi Instance Election',
    mode: 'ANONYMOUS_AUDIT',
    positions: [{ title: 'President', type: 'SINGLE', seats: 1, candidates: [{ name: 'Candidate 1' }] }],
  });
  await elections.importVoters(election.id, { voters: [{ id: 'voter-multi-1', name: 'Multi Voter', email: 'v@test.local' }] }, 'admin');
  await elections.open(election.id);

  // Two casting services (e.g. running on Instance 1 and Instance 2)
  const casting1 = new CastingService(voteStore, elections, redisStore1);
  const casting2 = new CastingService(voteStore, elections, redisStore2);

  const idempotencyKey = `idemp-key-${Date.now()}`;
  const pos = election.positions[0];

  // Cast on Instance 1
  const result1 = await casting1.cast(election.id, 'voter-multi-1', [{ positionId: pos.id, candidateIds: [pos.candidateIds[0]] }], idempotencyKey);
  assert.ok('receipts' in result1);
  assert.equal(result1.receipts.length, 1);

  // Replay on Instance 2 with the same Idempotency-Key
  const result2 = await casting2.cast(election.id, 'voter-multi-1', [{ positionId: pos.id, candidateIds: [pos.candidateIds[0]] }], idempotencyKey);
  assert.deepEqual(result2, { alreadyRecorded: true });

  await redisStore1.close();
  await redisStore2.close();
});
