import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditChain, AnonymousStrategy, instantRunoff, PositionConfig, SelectionError, StoredBallot } from './index';

const single: PositionConfig = {
  id: 'pres',
  type: 'SINGLE',
  seats: 1,
  candidateIds: ['a', 'b', 'c'],
  allowAbstain: true,
};

test('audit chain verifies and detects tampering', () => {
  const chain = new AuditChain();
  chain.append('ELECTION_CREATED', 'admin', { id: 'e1' });
  chain.append('ELECTION_OPENED', 'admin');
  chain.append('BALLOT_CAST', 'system', { n: 1 });
  assert.equal(AuditChain.verify(chain.toArray()), -1);

  const tampered = chain.toArray();
  (tampered[1].payload as Record<string, unknown>).x = 'edited';
  assert.equal(AuditChain.verify(tampered), 1);

  const reordered = chain.toArray();
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.notEqual(AuditChain.verify(reordered), -1);
});

test('stored ballots carry no voter identity and hide the receipt code', () => {
  const s = new AnonymousStrategy();
  const { stored, receiptCode } = s.prepare('e1', single, { positionId: 'pres', candidateIds: ['a'] });
  assert.deepEqual(Object.keys(stored).sort(), ['ballotHash', 'electionId', 'payload', 'positionId', 'receiptHash']);
  assert.notEqual(stored.receiptHash, receiptCode);
});

test('validation enforces position rules', () => {
  const s = new AnonymousStrategy();
  assert.throws(() => s.validate(single, { positionId: 'pres', candidateIds: ['a', 'b'] }), SelectionError);
  assert.throws(() => s.validate(single, { positionId: 'pres', candidateIds: ['zzz'] }), SelectionError);
  assert.throws(() => s.validate(single, { positionId: 'other', candidateIds: ['a'] }), SelectionError);
  assert.throws(
    () => s.validate({ ...single, allowAbstain: false }, { positionId: 'pres', candidateIds: [], abstain: true }),
    SelectionError,
  );
  assert.doesNotThrow(() => s.validate(single, { positionId: 'pres', candidateIds: [], abstain: true }));
});

test('tally counts, handles abstentions, and verify() accepts only the true result', () => {
  const s = new AnonymousStrategy();
  const make = (c: string[], abstain = false): StoredBallot =>
    s.prepare('e1', single, { positionId: 'pres', candidateIds: c, abstain }).stored;
  const ballots = [make(['a']), make(['a']), make(['b']), make([], true)];
  const result = s.tally(single, ballots);
  assert.deepEqual(result.counts, { a: 2, b: 1, c: 0 });
  assert.deepEqual(result.winners, ['a']);
  assert.equal(result.abstentions, 1);
  assert.equal(s.verify(single, ballots, result), true);
  assert.equal(s.verify(single, ballots, { ...result, counts: { a: 1, b: 2, c: 0 } }), false);
});

test('a tie at the cut-off is flagged, not hidden', () => {
  const s = new AnonymousStrategy();
  const mk = (ids: string[]) => s.prepare('e1', single, { positionId: 'pres', candidateIds: ids }).stored;
  assert.equal(s.tally(single, [mk(['a']), mk(['b'])]).tiedAtCutoff, true);
  assert.equal(s.tally(single, [mk(['a']), mk(['a']), mk(['b'])]).tiedAtCutoff, false);
  const pos: PositionConfig = { ...single, type: 'MULTI', seats: 2 };
  const m = (ids: string[]) => s.prepare('e1', pos, { positionId: 'pres', candidateIds: ids }).stored;
  assert.equal(s.tally(pos, [m(['a', 'b']), m(['a', 'c']), m(['a', 'c'])]).tiedAtCutoff, false);
  assert.equal(s.tally(pos, [m(['a', 'b']), m(['a', 'c'])]).tiedAtCutoff, true);
});

test('multi-seat picks the top N', () => {
  const s = new AnonymousStrategy();
  const pos: PositionConfig = { ...single, id: 'reps', type: 'MULTI', seats: 2 };
  const b = (ids: string[]) => s.prepare('e1', pos, { positionId: 'reps', candidateIds: ids }).stored;
  const r = s.tally(pos, [b(['a', 'b']), b(['a', 'c']), b(['a', 'b'])]);
  assert.deepEqual(r.winners, ['a', 'b']);
});

test('instant runoff transfers votes from eliminated candidates', () => {
  const rankings = [
    ['a', 'c'],
    ['a', 'c'],
    ['b', 'c'],
    ['b', 'c'],
    ['c', 'b'],
  ];
  const r = instantRunoff(['a', 'b', 'c'], rankings);
  assert.equal(r.rounds[0].eliminated, 'c');
  assert.equal(r.winner, 'b');
});

test('instant runoff is deterministic on ties', () => {
  const r1 = instantRunoff(['x', 'y'], [['x'], ['y']]);
  const r2 = instantRunoff(['x', 'y'], [['y'], ['x']]);
  assert.equal(r1.winner, r2.winner);
});
