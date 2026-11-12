import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { AuditChain, StoredBallot, strategyFor } from '@evote/core';
import { InMemoryVoteStore } from './domain/store';
import { PostgresVoteStore } from './domain/postgres-store';
import { ElectionsService } from './elections/elections.service';
import { CastingService } from './casting/casting.service';

const databaseUrl = process.env.DATABASE_URL;
let prisma: PrismaClient | null = null;
if (databaseUrl) {
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
}

test('ballotsFor: byte-identical COLLATE "C" order and identical sealed resultHash between Postgres and InMemory', async (t) => {
  if (!prisma) {
    t.skip('DATABASE_URL is not set: skipping Postgres store tests');
    return;
  }
  try {
    await prisma.$connect();
  } catch (err) {
    t.skip(`Cannot connect to database at ${databaseUrl}: skipping Postgres store tests`);
    return;
  }

  const memStore = new InMemoryVoteStore();
  const pgStore = new PostgresVoteStore(prisma);

  const electionId = `collate-test-${Date.now()}`;
  const posId = `pos-collate-${Date.now()}`;

  const electionData = {
    id: electionId,
    tenantId: 'default',
    title: 'Collation Test Election',
    mode: 'ANONYMOUS_AUDIT' as const,
    state: 'OPEN' as const,
    positions: [
      {
        id: posId,
        type: 'SINGLE' as const,
        seats: 1,
        candidateIds: ['cand-1', 'cand-2', 'cand-3'],
        allowAbstain: false,
      },
    ],
    titles: { [posId]: 'Position 1' },
    candidates: {
      'cand-1': { name: 'Candidate 1' },
      'cand-2': { name: 'Candidate 2' },
      'cand-3': { name: 'Candidate 3' },
    },
  };

  await memStore.saveElection(electionData);
  await pgStore.saveElection(electionData);

  // Generate 60 ballots with varied hex hashes (varying prefixes, letters and numbers)
  const ballots: StoredBallot[] = [];
  const voters = [];
  for (let i = 0; i < 60; i++) {
    const voterId = `voter-collate-${i}-${Date.now()}`;
    voters.push({ id: voterId, name: `Voter ${i}` });
    const cId = `cand-${(i % 3) + 1}`;
    const ballotHash = randomBytes(32).toString('hex');
    const receiptHash = randomBytes(32).toString('hex');
    ballots.push({
      electionId,
      positionId: posId,
      payload: { candidateIds: [cId] },
      ballotHash,
      receiptHash,
    });
  }

  await memStore.upsertVoters(voters);
  await pgStore.upsertVoters(voters);
  await memStore.addEligibleVoters(electionId, voters.map((v) => v.id));
  await pgStore.addEligibleVoters(electionId, voters.map((v) => v.id));

  // Commit each ballot into both stores
  for (let i = 0; i < ballots.length; i++) {
    const voterId = voters[i].id;
    const b = ballots[i];
    const memOk = await memStore.commitVote({ electionId, voterId, ballots: [b] });
    const pgOk = await pgStore.commitVote({ electionId, voterId, ballots: [b] });
    assert.equal(memOk, true);
    assert.equal(pgOk, true);
  }

  // Retrieve ballots from both stores
  const memBallots = await memStore.ballotsFor(electionId, posId);
  const pgBallots = await pgStore.ballotsFor(electionId, posId);

  assert.equal(pgBallots.length, 60);
  assert.equal(memBallots.length, 60);

  // 1. Verify byte-identical order
  const memHashes = memBallots.map((b) => b.ballotHash);
  const pgHashes = pgBallots.map((b) => b.ballotHash);
  assert.deepEqual(pgHashes, memHashes, 'Postgres COLLATE "C" order must be byte-identical to JavaScript sort order');

  // 2. Verify that sealing both produces the exact same result and resultHash
  const memElections = new ElectionsService(memStore);
  const pgElections = new ElectionsService(pgStore);

  await memElections.close(electionId, 'admin');
  await pgElections.close(electionId, 'admin');

  const memSealed = await memElections.seal(electionId, 'admin');
  const pgSealed = await pgElections.seal(electionId, 'admin');

  assert.equal(pgSealed.resultHash, memSealed.resultHash, 'Sealed resultHash must match identically between stores');
  assert.deepEqual(pgSealed.results, memSealed.results, 'Tally results must match identically between stores');
});

test('duplicate participation: unique violation maps to "already voted" false', async (t) => {
  if (!prisma) {
    t.skip('DATABASE_URL is not set: skipping Postgres store tests');
    return;
  }
  try {
    await prisma.$connect();
  } catch (err) {
    t.skip(`Cannot connect to database at ${databaseUrl}: skipping Postgres store tests`);
    return;
  }

  const pgStore = new PostgresVoteStore(prisma);
  const electionId = `dup-part-${Date.now()}`;
  const posId = `pos-dup-${Date.now()}`;
  const voterId = `voter-dup-${Date.now()}`;

  await pgStore.saveElection({
    id: electionId,
    tenantId: 'default',
    title: 'Duplicate Participation Test',
    mode: 'ANONYMOUS_AUDIT',
    state: 'OPEN',
    positions: [{ id: posId, type: 'SINGLE', seats: 1, candidateIds: ['c1'], allowAbstain: false }],
    titles: { [posId]: 'Pos' },
    candidates: { c1: { name: 'C1' } },
  });

  await pgStore.upsertVoters([{ id: voterId, name: 'V' }]);
  await pgStore.addEligibleVoters(electionId, [voterId]);

  const b1: StoredBallot = {
    electionId,
    positionId: posId,
    payload: { candidateIds: ['c1'] },
    ballotHash: randomBytes(32).toString('hex'),
    receiptHash: randomBytes(32).toString('hex'),
  };
  const b2: StoredBallot = {
    electionId,
    positionId: posId,
    payload: { candidateIds: ['c1'] },
    ballotHash: randomBytes(32).toString('hex'),
    receiptHash: randomBytes(32).toString('hex'),
  };

  const first = await pgStore.commitVote({ electionId, voterId, ballots: [b1] });
  assert.equal(first, true);

  // Second commit for same voter and position must return false (cleanly mapped from check or unique violation)
  const second = await pgStore.commitVote({ electionId, voterId, ballots: [b2] });
  assert.equal(second, false, 'Expected duplicate participation to return false');
});

test('concurrency: 20 parallel casts from same voter -> exactly one accepted', async (t) => {
  if (!prisma) {
    t.skip('DATABASE_URL is not set: skipping Postgres store tests');
    return;
  }
  try {
    await prisma.$connect();
  } catch (err) {
    t.skip(`Cannot connect to database at ${databaseUrl}: skipping Postgres store tests`);
    return;
  }

  const pgStore = new PostgresVoteStore(prisma);
  const elections = new ElectionsService(pgStore);
  const casting = new CastingService(pgStore, elections);

  const e = await elections.create(
    {
      tenantId: 'default',
      title: 'Same Voter 20 Parallel Casts Test',
      mode: 'ANONYMOUS_AUDIT',
      positions: [{ title: 'Chair', type: 'SINGLE', candidates: [{ name: 'A' }, { name: 'B' }] }],
    },
    'admin',
  );

  const voterId = `same-voter-${Date.now()}`;
  await elections.importVoters(e.id, { voters: [{ id: voterId, name: 'Voter Same', email: 's@test.com' }] }, 'admin');
  await elections.open(e.id, 'admin');

  const [pos] = e.positions;
  const cand = pos.candidateIds[0];

  const attempts = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      casting.cast(e.id, voterId, [{ positionId: pos.id, candidateIds: [cand] }], `key-${i}`),
    ),
  );

  const accepted = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');

  assert.equal(accepted.length, 1, 'Exactly one cast must be accepted');
  assert.equal(rejected.length, 19, 'All other 19 parallel attempts must be rejected');

  const turnout = await elections.turnout(e.id);
  assert.equal(turnout.voters, 1);
});

test('throughput: 200 parallel voters on PostgresVoteStore with single audit chain', async (t) => {
  if (!prisma) {
    t.skip('DATABASE_URL is not set: skipping Postgres store tests');
    return;
  }
  try {
    await prisma.$connect();
  } catch (err) {
    t.skip(`Cannot connect to database at ${databaseUrl}: skipping Postgres store tests`);
    return;
  }

  const pgStore = new PostgresVoteStore(prisma);
  const elections = new ElectionsService(pgStore);
  const casting = new CastingService(pgStore, elections);

  const NUM_VOTERS = 200;
  const e = await elections.create(
    {
      tenantId: 'default',
      title: 'Throughput 200 Parallel Test',
      mode: 'ANONYMOUS_AUDIT',
      positions: [
        { title: 'President', type: 'SINGLE', candidates: [{ name: 'Alice' }, { name: 'Bob' }] },
      ],
    },
    'admin',
  );

  const voterList = Array.from({ length: NUM_VOTERS }, (_, i) => ({
    id: `tp-voter-${i}-${Date.now()}`,
    name: `Voter ${i}`,
    email: `tp${i}@test.com`,
  }));

  await elections.importVoters(e.id, { voters: voterList }, 'admin');
  await elections.open(e.id, 'admin');

  const [pos] = e.positions;
  const candA = pos.candidateIds[0];
  const candB = pos.candidateIds[1];

  const startTime = Date.now();

  // Cast all 200 in parallel
  const results = await Promise.allSettled(
    voterList.map((v, i) => {
      const pick = i % 2 === 0 ? candA : candB;
      return casting.cast(e.id, v.id, [{ positionId: pos.id, candidateIds: [pick] }], `idemp-${i}`);
    }),
  );

  const durationMs = Date.now() - startTime;
  const successful = results.filter((r) => r.status === 'fulfilled');
  const failed = results.filter((r) => r.status === 'rejected');

  if (failed.length > 0) {
    console.error('Failed count:', failed.length, 'First failure:', (failed[0] as PromiseRejectedResult).reason);
  }

  const ballotsPerSecond = Math.round((successful.length / (durationMs / 1000)) * 10) / 10;

  console.log(`\n--- PostgresVoteStore Throughput Benchmark (200 parallel voters) ---`);
  console.log(`Total voters: ${NUM_VOTERS}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Total retries: ${pgStore.retryCount}`);
  console.log(`Duration: ${durationMs} ms`);
  console.log(`Throughput: ${ballotsPerSecond} ballots/second`);
  console.log(`-------------------------------------------------------------------\n`);

  assert.equal(successful.length, NUM_VOTERS, 'All 200 voters must be recorded with 0 dropped');
  assert.equal(failed.length, 0, 'No cast should fail');

  // Verify ballots count and integrity
  const ballots = await pgStore.ballotsFor(e.id, pos.id);
  assert.equal(ballots.length, NUM_VOTERS);

  const turnout = await elections.turnout(e.id);
  assert.equal(turnout.voters, NUM_VOTERS);
  assert.equal(turnout.eligible, NUM_VOTERS);

  // Close, seal and verify audit chain
  await elections.close(e.id, 'admin');
  const sealed = await elections.seal(e.id, 'admin');
  assert.equal(sealed.results[0].totalBallots, NUM_VOTERS);

  const verifyResult = await elections.verify(e.id);
  assert.equal(verifyResult.auditIntact, true);
  assert.equal(verifyResult.tallyMatches, true);
  assert.equal(verifyResult.hashMatches, true);
});
