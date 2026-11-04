import { randomBytes } from 'node:crypto';
import { canonicalJson, sha256 } from './audit-chain';
import { instantRunoff } from './ranked-choice';
import {
  IntegrityStrategy,
  PositionConfig,
  PreparedBallot,
  Selection,
  SelectionError,
  StoredBallot,
  TallyResult,
} from './integrity';

/**
 * Mode A: ballots are stored in the clear but carry no voter identity.
 * Integrity comes from the audit chain and the published result hash.
 */
export class AnonymousStrategy implements IntegrityStrategy {
  readonly mode = 'ANONYMOUS_AUDIT' as const;

  validate(position: PositionConfig, selection: Selection): void {
    if (selection.positionId !== position.id) throw new SelectionError('Selection is for a different position');
    const ids = selection.candidateIds;
    if (selection.abstain) {
      if (!position.allowAbstain) throw new SelectionError('Abstaining is not allowed for this position');
      if (ids.length) throw new SelectionError('An abstention cannot include candidates');
      return;
    }
    if (new Set(ids).size !== ids.length) throw new SelectionError('Duplicate candidates in selection');
    for (const id of ids) {
      if (!position.candidateIds.includes(id)) throw new SelectionError(`Unknown candidate: ${id}`);
    }
    switch (position.type) {
      case 'SINGLE':
      case 'REFERENDUM':
        if (ids.length !== 1) throw new SelectionError('Choose exactly one option');
        break;
      case 'MULTI':
        if (ids.length < 1 || ids.length > position.seats)
          throw new SelectionError(`Choose between 1 and ${position.seats} candidates`);
        break;
      case 'APPROVAL':
        if (ids.length < 1) throw new SelectionError('Approve at least one candidate');
        break;
      case 'RANKED':
        if (ids.length < 1) throw new SelectionError('Rank at least one candidate');
        break;
    }
  }

  prepare(electionId: string, position: PositionConfig, selection: Selection): PreparedBallot {
    this.validate(position, selection);
    const payload = selection.abstain
      ? { abstain: true }
      : { candidateIds: [...selection.candidateIds] };
    const receiptCode = randomBytes(8).toString('hex').toUpperCase();
    const nonce = randomBytes(16).toString('hex');
    const stored: StoredBallot = {
      electionId,
      positionId: position.id,
      payload,
      ballotHash: sha256(canonicalJson({ electionId, positionId: position.id, payload, nonce })),
      receiptHash: sha256(receiptCode),
    };
    return { stored, receiptCode };
  }

  tally(position: PositionConfig, ballots: StoredBallot[]): TallyResult {
    const counts: Record<string, number> = Object.fromEntries(position.candidateIds.map((c) => [c, 0]));
    let abstentions = 0;
    const rankings: string[][] = [];

    for (const b of ballots) {
      const p = b.payload as { abstain?: boolean; candidateIds?: string[] };
      if (p.abstain) {
        abstentions++;
        continue;
      }
      const ids = p.candidateIds ?? [];
      if (position.type === 'RANKED') rankings.push(ids);
      else for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
    }

    if (position.type === 'RANKED') {
      if (position.seats !== 1) throw new Error('Multi-seat ranked ballots (STV) are not implemented yet');
      const irv = instantRunoff(position.candidateIds, rankings);
      const first = irv.rounds[0]?.counts ?? counts;
      return {
        positionId: position.id,
        type: position.type,
        counts: first,
        winners: irv.winner ? [irv.winner] : [],
        abstentions,
        totalBallots: ballots.length,
        rounds: irv.rounds,
      };
    }

    // Deterministic ordering: votes desc, then id. A tie at the cut line is flagged
    // (tiedAtCutoff) so the committee decides; the order here is only a stable placeholder.
    const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const winners = ranked.slice(0, position.seats).map(([id]) => id);
    const last = ranked[position.seats - 1];
    const next = ranked[position.seats];
    return {
      positionId: position.id,
      type: position.type,
      counts,
      winners,
      abstentions,
      totalBallots: ballots.length,
      tiedAtCutoff: !!last && !!next && last[1] === next[1],
    };
  }

  verify(position: PositionConfig, ballots: StoredBallot[], claimed: TallyResult): boolean {
    return canonicalJson(this.tally(position, ballots)) === canonicalJson(claimed);
  }
}
