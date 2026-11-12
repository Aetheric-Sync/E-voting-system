import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

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

test('migration: default tenant row exists and allows election creation and voter import', async (t) => {
  if (!prisma) {
    t.skip('DATABASE_URL is not set: skipping Postgres migration tests');
    return;
  }
  try {
    await prisma.$connect();
  } catch (err) {
    t.skip(`Cannot connect to database at ${databaseUrl}: skipping Postgres migration tests`);
    return;
  }

  // 1. Verify default tenant exists
  const defaultTenant = await prisma.tenant.findUnique({
    where: { id: 'default' },
  });
  assert.ok(defaultTenant, 'Default tenant should exist from initial migration seed');
  assert.equal(defaultTenant.id, 'default');

  // 2. Fresh election can be created under default tenant
  const testElectionId = `test-election-${Date.now()}`;
  const election = await prisma.election.create({
    data: {
      id: testElectionId,
      tenantId: 'default',
      title: 'Fresh DB Election Test',
      mode: 'ANONYMOUS_AUDIT',
      state: 'DRAFT',
      positions: {
        create: [
          {
            id: `pos-${testElectionId}-1`,
            title: 'Chair',
            type: 'SINGLE',
            seats: 1,
            candidates: {
              create: [
                { id: `cand-${testElectionId}-1`, name: 'Candidate 1' },
                { id: `cand-${testElectionId}-2`, name: 'Candidate 2' },
              ],
            },
          },
        ],
      },
    },
  });
  assert.equal(election.id, testElectionId);

  // 3. Voter import under default tenant and register for election
  const testVoterId = `voter-${Date.now()}`;
  const voter = await prisma.voter.create({
    data: {
      id: testVoterId,
      tenantId: 'default',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
    },
  });
  assert.equal(voter.id, testVoterId);
  assert.equal(voter.tenantId, 'default');

  const eligible = await prisma.eligibleVoter.create({
    data: {
      electionId: testElectionId,
      tenantId: 'default',
      voterId: testVoterId,
    },
  });
  assert.equal(eligible.voterId, testVoterId);

  // Cleanup election and voter
  await prisma.eligibleVoter.deleteMany({ where: { electionId: testElectionId } });
  await prisma.position.deleteMany({ where: { electionId: testElectionId } });
  await prisma.election.delete({ where: { id: testElectionId } });
  await prisma.voter.delete({ where: { tenantId_id: { tenantId: 'default', id: testVoterId } } });
});

test('migration: immutability triggers block UPDATE and DELETE on AuditLog, Ballot, and Participation', async (t) => {
  if (!prisma) {
    t.skip('DATABASE_URL is not set: skipping Postgres migration tests');
    return;
  }
  try {
    await prisma.$connect();
  } catch (err) {
    t.skip(`Cannot connect to database at ${databaseUrl}: skipping Postgres migration tests`);
    return;
  }

  const runId = Date.now();
  const testElectionId = `immut-el-${runId}`;
  const testPosId = `immut-pos-${runId}`;
  const testVoterId = `immut-vot-${runId}`;

  // Create prerequisite records
  await prisma.election.create({
    data: {
      id: testElectionId,
      tenantId: 'default',
      title: 'Immutability Test Election',
      mode: 'ANONYMOUS_AUDIT',
      state: 'OPEN',
      positions: {
        create: [
          {
            id: testPosId,
            title: 'President',
            type: 'SINGLE',
            seats: 1,
          },
        ],
      },
    },
  });

  await prisma.voter.create({
    data: {
      id: testVoterId,
      tenantId: 'default',
      name: 'Test Voter',
    },
  });

  // 1. AuditLog: append, then attempt UPDATE and DELETE
  await prisma.auditLog.create({
    data: {
      electionId: testElectionId,
      seq: 0,
      prevHash: 'GENESIS',
      hash: `hash-audit-${runId}`,
      event: 'ELECTION_CREATED',
      actor: 'admin@system',
      payload: {},
      at: new Date(),
    },
  });

  // Attempt UPDATE on AuditLog -> must throw trigger exception
  await assert.rejects(
    async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE "AuditLog" SET "actor" = 'hacker' WHERE "electionId" = $1 AND "seq" = 0`,
        testElectionId,
      );
    },
    (err: Error) => {
      assert.match(err.message, /Table AuditLog is append-only: UPDATE and DELETE are prohibited/);
      return true;
    },
    'Expected UPDATE on AuditLog to be rejected by trigger',
  );

  // Attempt DELETE on AuditLog -> must throw trigger exception
  await assert.rejects(
    async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "AuditLog" WHERE "electionId" = $1 AND "seq" = 0`,
        testElectionId,
      );
    },
    (err: Error) => {
      assert.match(err.message, /Table AuditLog is append-only: UPDATE and DELETE are prohibited/);
      return true;
    },
    'Expected DELETE on AuditLog to be rejected by trigger',
  );

  // 2. Ballot: insert, then attempt UPDATE and DELETE
  const testBallotId = `ballot-${runId}`;
  await prisma.ballot.create({
    data: {
      id: testBallotId,
      electionId: testElectionId,
      positionId: testPosId,
      payload: { candidateId: 'cand-1' },
      ballotHash: `bhash-${runId}`,
      receiptHash: `rhash-${runId}`,
    },
  });

  // Attempt UPDATE on Ballot -> must throw trigger exception
  await assert.rejects(
    async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE "Ballot" SET "payload" = '{"candidateId":"tampered"}'::jsonb WHERE "id" = $1`,
        testBallotId,
      );
    },
    (err: Error) => {
      assert.match(err.message, /Table Ballot is append-only: UPDATE and DELETE are prohibited/);
      return true;
    },
    'Expected UPDATE on Ballot to be rejected by trigger',
  );

  // Attempt DELETE on Ballot -> must throw trigger exception
  await assert.rejects(
    async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "Ballot" WHERE "id" = $1`,
        testBallotId,
      );
    },
    (err: Error) => {
      assert.match(err.message, /Table Ballot is append-only: UPDATE and DELETE are prohibited/);
      return true;
    },
    'Expected DELETE on Ballot to be rejected by trigger',
  );

  // 3. Participation: insert, then attempt UPDATE and DELETE
  await prisma.participation.create({
    data: {
      electionId: testElectionId,
      positionId: testPosId,
      tenantId: 'default',
      voterId: testVoterId,
    },
  });

  // Attempt UPDATE on Participation -> must throw trigger exception
  await assert.rejects(
    async () => {
      await prisma.$executeRawUnsafe(
        `UPDATE "Participation" SET "voterId" = 'other-voter' WHERE "electionId" = $1 AND "positionId" = $2`,
        testElectionId,
        testPosId,
      );
    },
    (err: Error) => {
      assert.match(err.message, /Table Participation is append-only: UPDATE and DELETE are prohibited/);
      return true;
    },
    'Expected UPDATE on Participation to be rejected by trigger',
  );

  // Attempt DELETE on Participation -> must throw trigger exception
  await assert.rejects(
    async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "Participation" WHERE "electionId" = $1 AND "positionId" = $2`,
        testElectionId,
        testPosId,
      );
    },
    (err: Error) => {
      assert.match(err.message, /Table Participation is append-only: UPDATE and DELETE are prohibited/);
      return true;
    },
    'Expected DELETE on Participation to be rejected by trigger',
  );

  // Foreign keys on Participation test:
  // Inserting Participation for a non-existent voter should fail foreign key constraint
  await assert.rejects(
    async () => {
      await prisma.participation.create({
        data: {
          electionId: testElectionId,
          positionId: testPosId,
          tenantId: 'default',
          voterId: 'non-existent-voter',
        },
      });
    },
    /foreign key constraint/i,
    'Expected Participation foreign key violation on invalid voter',
  );
});

test('migration: Election.state can only move forward, preventing rolling back an OPEN election to DRAFT and deleting its audit rows', async (t) => {
  if (!prisma) {
    t.skip('DATABASE_URL is not set: skipping Postgres migration tests');
    return;
  }
  try {
    await prisma.$connect();
  } catch (err) {
    t.skip(`Cannot connect to database at ${databaseUrl}: skipping Postgres migration tests`);
    return;
  }

  const runId = Date.now();
  const testElectionId = `forward-el-${runId}`;

  // 1. Create election in DRAFT then advance to OPEN
  await prisma.election.create({
    data: {
      id: testElectionId,
      tenantId: 'default',
      title: 'State Transition Test Election',
      mode: 'ANONYMOUS_AUDIT',
      state: 'DRAFT',
    },
  });

  // Advance DRAFT -> OPEN (valid forward transition)
  await prisma.election.update({
    where: { id: testElectionId },
    data: { state: 'OPEN' },
  });

  // Add an audit log entry while OPEN
  await prisma.auditLog.create({
    data: {
      electionId: testElectionId,
      seq: 0,
      prevHash: 'GENESIS',
      hash: `hash-open-${runId}`,
      event: 'ELECTION_OPENED',
      actor: 'admin',
      payload: {},
      at: new Date(),
    },
  });

  // 2. Attempt to move the OPEN election back to DRAFT -> MUST FAIL by trigger
  await assert.rejects(
    async () => {
      await prisma.election.update({
        where: { id: testElectionId },
        data: { state: 'DRAFT' },
      });
    },
    (err: Error) => {
      assert.match(err.message, /Invalid election state transition from OPEN to DRAFT: state can only move forward/);
      return true;
    },
    'Expected backward state transition from OPEN to DRAFT to be rejected by trigger',
  );

  // 3. Attempt to delete audit rows of the OPEN election -> MUST FAIL by trigger
  await assert.rejects(
    async () => {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "AuditLog" WHERE "electionId" = $1`,
        testElectionId,
      );
    },
    (err: Error) => {
      assert.match(err.message, /Table AuditLog is append-only: UPDATE and DELETE are prohibited/);
      return true;
    },
    'Expected DELETE on AuditLog of OPEN election to be rejected by trigger',
  );

  // 4. Verify further forward transitions work (OPEN -> CLOSED -> SEALED)
  await prisma.election.update({
    where: { id: testElectionId },
    data: { state: 'CLOSED' },
  });

  await prisma.election.update({
    where: { id: testElectionId },
    data: { state: 'SEALED' },
  });

  // Attempting SEALED -> CLOSED or SEALED -> OPEN must fail
  await assert.rejects(
    async () => {
      await prisma.election.update({
        where: { id: testElectionId },
        data: { state: 'CLOSED' },
      });
    },
    /Invalid election state transition from SEALED to CLOSED/,
  );
});
