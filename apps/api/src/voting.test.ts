import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditChain } from '@evote/core';
import { CastingService } from './casting/casting.service';
import { InMemoryVoteStore } from './domain/store';
import { ElectionsService } from './elections/elections.service';

async function setup(extra: { opensAt?: string; closesAt?: string } = {}) {
  const store = new InMemoryVoteStore();
  const elections = new ElectionsService(store);
  const casting = new CastingService(store, elections);
  const e = await elections.create(
    {
      tenantId: 't1',
      title: 'Dept election',
      mode: 'ANONYMOUS_AUDIT',
      ...extra,
      positions: [
        { title: 'President', type: 'SINGLE', allowAbstain: true, candidates: [{ name: 'Ada' }, { name: 'Bayo' }] },
        { title: 'Secretary', type: 'SINGLE', candidates: [{ name: 'Xola' }, { name: 'Yemi' }] },
      ],
    },
    'admin',
  );
  const rows = ['v1', 'v2', 'v3', 'v4'].map((id) => ({ id, name: id.toUpperCase(), email: `${id}@x.com` }));
  await elections.importVoters(e.id, { voters: rows }, 'admin');
  const [pres, sec] = e.positions;
  return { store, elections, casting, id: e.id, e, pres, sec, a: pres.candidateIds[0], b: pres.candidateIds[1], x: sec.candidateIds[0], y: sec.candidateIds[1] };
}

type S = Awaited<ReturnType<typeof setup>>;
const pick = (positionId: string, c: string) => ({ positionId, candidateIds: [c] });

test('full lifecycle: cast, close, seal, verify', async () => {
  const s = await setup();
  await s.elections.open(s.id, 'admin');
  await s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a), pick(s.sec.id, s.x)], 'k1');
  await s.casting.cast(s.id, 'v2', [pick(s.pres.id, s.a), pick(s.sec.id, s.y)], 'k2');
  await s.casting.cast(s.id, 'v3', [pick(s.pres.id, s.b)], 'k3');

  assert.deepEqual(await s.elections.turnout(s.id), { voters: 3, eligible: 4 });
  await assert.rejects(() => s.elections.seal(s.id, 'admin'), /closed/i);
  await assert.rejects(() => s.elections.results(s.id), /not published/i);

  await s.elections.close(s.id, 'admin');
  const sealed = await s.elections.seal(s.id, 'admin');
  const pres = sealed.results.find((r) => r.positionId === s.pres.id)!;
  assert.deepEqual(pres.counts, { [s.a]: 2, [s.b]: 1 });
  assert.deepEqual(pres.winners, [s.a]);

  const v = await s.elections.verify(s.id);
  assert.equal(v.tallyMatches && v.hashMatches && v.auditIntact, true);
});

test('double voting is rejected, even with a new idempotency key', async () => {
  const s = await setup();
  await s.elections.open(s.id, 'admin');
  await s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'k1');
  await assert.rejects(() => s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.b)], 'k2'), /already voted/);
  assert.equal((await s.elections.turnout(s.id)).voters, 1);
});

test('a voter can vote the skipped positions later but not the same one twice', async () => {
  const s = await setup();
  await s.elections.open(s.id, 'admin');
  await s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'k1');
  assert.deepEqual(await s.store.votedPositions(s.id, 'v1'), [s.pres.id]);
  await s.casting.cast(s.id, 'v1', [pick(s.sec.id, s.x)], 'k2');
  assert.equal((await s.store.votedPositions(s.id, 'v1')).length, 2);
});

test('retrying the same request is idempotent and returns no receipt', async () => {
  const s = await setup();
  await s.elections.open(s.id, 'admin');
  const first = await s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'same');
  assert.ok('receipts' in first && first.receipts[0].receiptCode.length === 16);
  assert.deepEqual(await s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'same'), { alreadyRecorded: true });
});

test('concurrent submissions from one voter record exactly one ballot', async () => {
  const s = await setup();
  await s.elections.open(s.id, 'admin');
  const attempts = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], `k${i}`)));
  assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1);
  assert.equal((await s.elections.turnout(s.id)).voters, 1);
});

test('a failed position validation writes nothing (all or nothing)', async () => {
  const s = await setup();
  await s.elections.open(s.id, 'admin');
  await assert.rejects(() => s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a), pick(s.sec.id, 'nope')], 'k1'));
  await s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a), pick(s.sec.id, s.x)], 'k2');
});

test('eligibility and state are enforced', async () => {
  const s = await setup();
  await assert.rejects(() => s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'k'), /not open/i);
  await s.elections.open(s.id, 'admin');
  await assert.rejects(() => s.casting.cast(s.id, 'stranger', [pick(s.pres.id, s.a)], 'k'), /register/);
  await assert.rejects(() => s.elections.importVoters(s.id, { voters: [{ id: 'v9', name: 'N', email: 'n@x.com' }] }, 'admin'), /locked/);
  await s.elections.close(s.id, 'admin');
  await assert.rejects(() => s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'k2'), /not open/i);
});

test('ballots and audit log contain no voter identifiers', async () => {
  const s = await setup();
  await s.elections.open(s.id, 'admin');
  await s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'k1');
  await s.casting.cast(s.id, 'v2', [pick(s.pres.id, s.b)], 'k2');
  const ballots = await s.store.ballotsFor(s.id, s.pres.id);
  const dump = JSON.stringify([ballots, s.store.audit(s.id).toArray()]);
  for (const voter of ['v1', 'v2', 'v1@x.com']) assert.equal(dump.includes(voter), false, `${voter} leaked`);
});

test('tampering with the audit log is detected', async () => {
  const s = await setup();
  await s.elections.open(s.id, 'admin');
  const log = s.store.audit(s.id).toArray();
  assert.equal(AuditChain.verify(log), -1);
  (log[1].payload as { added: number }).added = 999;
  assert.equal(AuditChain.verify(log), 1);
});

test('the voting window is enforced and the scheduler opens and closes', async () => {
  const s = await setup({ opensAt: '2030-01-01T09:00:00Z', closesAt: '2030-01-01T17:00:00Z' });
  const at = (iso: string) => Date.parse(iso);
  await s.elections.open(s.id, 'admin');
  await assert.rejects(() => s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'k1', at('2030-01-01T08:00:00Z')), /not started/i);
  await s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'k2', at('2030-01-01T10:00:00Z'));
  await assert.rejects(() => s.casting.cast(s.id, 'v2', [pick(s.pres.id, s.a)], 'k3', at('2030-01-01T17:00:01Z')), /closed/i);
  await s.elections.tick(at('2030-01-01T17:00:01Z'));
  assert.equal((await s.elections.get(s.id)).state, 'CLOSED');

  const s2 = await setup({ opensAt: '2030-02-01T09:00:00Z' });
  await s2.elections.tick(at('2030-02-01T09:00:01Z'));
  assert.equal((await s2.elections.get(s2.id)).state, 'OPEN');
  const log = s2.store.audit(s2.id).toArray();
  assert.equal(log.at(-1)!.actor, 'scheduler');
});

test('election setup is validated', async () => {
  const s = await setup();
  const base = { tenantId: 't', title: 'x', mode: 'ANONYMOUS_AUDIT' as const };
  const one = (p: object) => s.elections.create({ ...base, positions: [{ title: 'P', type: 'SINGLE', candidates: [{ name: 'A' }], ...p }] as never }, 'a');
  await assert.rejects(() => one({ candidates: [] }), /at least 1/);
  await assert.rejects(() => one({ type: 'REFERENDUM' }), /at least 2/);
  await assert.rejects(() => one({ type: 'MULTI', seats: 3 }), /more seats/);
  await assert.rejects(() => one({ candidates: [{ name: 'A' }, { name: ' a ' }] }), /twice/);
  await assert.rejects(() => one({ title: ' ' }), /needs a title/);
  await assert.rejects(() => s.elections.create({ ...base, closesAt: '2030-01-01', opensAt: '2031-01-01', positions: [{ title: 'P', type: 'SINGLE', candidates: [{ name: 'A' }] }] }, 'a'), /after the opening/);
  await assert.rejects(() => s.elections.create({ ...base, mode: 'E2E_VERIFIABLE', positions: [{ title: 'P', type: 'SINGLE', candidates: [{ name: 'A' }] }] }, 'a'), /not available/);
});

test('register import reports bad rows, masks contacts, and gates on state', async () => {
  const s = await setup();
  const r = await s.elections.importVoters(s.id, { csv: 'id,name,email\nn1,New One,n1@x.com\n,Bad,b@x.com' }, 'admin');
  assert.equal(r.added, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.eligible, 5);
  const reg = await s.elections.register(s.id);
  assert.equal(reg.find((v) => v.id === 'n1')!.email, 'n***@x.com');
  assert.equal(reg.find((v) => v.id === 'n1')!.hasVoted, false);
  await assert.rejects(() => s.elections.importVoters(s.id, {}, 'admin'), /CSV/);
});

test('voters only see their own non-draft elections', async () => {
  const s = await setup();
  assert.deepEqual(await s.elections.electionsForVoter('v1'), []);
  await s.elections.open(s.id, 'admin');
  const mine = await s.elections.electionsForVoter('v1');
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].votedPositionIds, []);
  assert.deepEqual(await s.elections.electionsForVoter('nobody'), []);
  const ballot = await s.elections.ballotForVoter(s.id, 'v1');
  assert.equal('sealed' in ballot, false);
  await assert.rejects(() => s.elections.ballotForVoter(s.id, 'nobody'), /not on the voter register/);
});

test('draft elections are hidden from non-admins', async () => {
  const s = await setup();
  await assert.rejects(() => s.elections.getVisible(s.id, false), /not found/i);
  assert.equal((await s.elections.getVisible(s.id, true)).id, s.id);
  assert.equal((await s.elections.list(false)).length, 0);
  assert.equal((await s.elections.list(true)).length, 1);
});

test('receipt check proves inclusion without revealing the choice', async () => {
  const s = await setup();
  await s.elections.open(s.id, 'admin');
  const r = await s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'k1');
  assert.ok('receipts' in r);
  const code = r.receipts[0].receiptCode;
  const hit = await s.elections.checkReceipt(s.id, code.toLowerCase().replace(/(.{4})/g, '$1 ').trim());
  assert.ok(hit.found);
  assert.equal(hit.position, 'President');
  assert.equal(JSON.stringify(hit).includes(s.a), false);
  assert.deepEqual(await s.elections.checkReceipt(s.id, '0123456789ABCDEF'), { found: false });
  await assert.rejects(() => s.elections.checkReceipt(s.id, 'short'), /16/);
});

test('public results exist only after sealing', async () => {
  const s = await setup();
  await s.elections.open(s.id, 'admin');
  await s.casting.cast(s.id, 'v1', [pick(s.pres.id, s.a)], 'k1');
  await assert.rejects(() => s.elections.publicResults(s.id), /not published/i);
  assert.equal((await s.elections.publicList()).length, 0);
  await s.elections.close(s.id, 'admin');
  await s.elections.seal(s.id, 'admin');
  const pub = await s.elections.publicResults(s.id);
  assert.equal(pub.candidates[s.a].name, 'Ada');
  assert.equal((await s.elections.publicList()).length, 1);
});

test('only drafts can be deleted', async () => {
  const s: S = await setup();
  await s.elections.open(s.id, 'admin');
  await assert.rejects(() => s.elections.remove(s.id, 'admin'), /draft/i);
  const s2 = await setup();
  await s2.elections.remove(s2.id, 'admin');
  await assert.rejects(() => s2.elections.get(s2.id), /not found/i);
});
