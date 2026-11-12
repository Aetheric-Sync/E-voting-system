import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { Selection, SelectionError, strategyFor } from '@evote/core';
import { VOTE_STORE, VoteStore } from '../domain/store';
import { ElectionsService } from '../elections/elections.service';
import { InMemoryRateLimitStore, RATE_LIMIT_STORE, RateLimitStore } from '../auth/rate-limit';

export interface CastResult {
  /** One receipt per position. Shown once; never stored next to the voter. */
  receipts: Array<{ positionId: string; receiptCode: string }>;
}

@Injectable()
export class CastingService {
  /**
   * Idempotency keys are remembered per voter, but only as "this request already
   * succeeded". Receipt codes are never stored here: linking voter -> receipt would
   * link voter -> ballot and break anonymity. A replay therefore returns no receipts.
   */
  private readonly rateLimitStore: RateLimitStore;

  constructor(
    @Inject(VOTE_STORE) private readonly store: VoteStore,
    @Inject(ElectionsService) private readonly elections: ElectionsService,
    @Optional() @Inject(RATE_LIMIT_STORE) rateLimitStore?: RateLimitStore,
  ) {
    this.rateLimitStore = rateLimitStore ?? new InMemoryRateLimitStore();
  }

  async cast(
    electionId: string,
    voterId: string,
    selections: Selection[],
    idempotencyKey: string,
    now = Date.now(),
  ): Promise<CastResult | { alreadyRecorded: true }> {
    if (!idempotencyKey || idempotencyKey.length > 100) throw new BadRequestException('Idempotency-Key header is required');
    const replayKey = `${electionId}|${voterId}|${idempotencyKey}`;
    if (await this.rateLimitStore.hasSeenIdempotency(replayKey)) return { alreadyRecorded: true };

    const election = await this.elections.get(electionId);
    if (election.state !== 'OPEN') throw new ConflictException('Voting is not open');
    if (election.opensAt && Date.parse(election.opensAt) > now) throw new ConflictException('Voting has not started yet');
    if (election.closesAt && Date.parse(election.closesAt) <= now) throw new ConflictException('The voting window has closed');
    if (!(await this.store.isEligible(electionId, voterId))) throw new ForbiddenException('You are not on the voter register');
    if (!Array.isArray(selections) || !selections.length) throw new BadRequestException('Nothing was selected');
    if (selections.length > election.positions.length) throw new BadRequestException('Too many selections');

    const positionIds = selections.map((s) => s?.positionId);
    if (new Set(positionIds).size !== positionIds.length) throw new BadRequestException('One selection per position');

    const strategy = strategyFor(election.mode);
    const prepared = [];
    try {
      for (const sel of selections) {
        const position = election.positions.find((p) => p.id === sel.positionId);
        if (!position) throw new BadRequestException('Unknown position');
        prepared.push(strategy.prepare(electionId, position, { positionId: sel.positionId, candidateIds: sel.candidateIds ?? [], abstain: !!sel.abstain }));
      }
    } catch (err) {
      if (err instanceof SelectionError) throw new BadRequestException(err.message);
      throw err;
    }

    const ok = await this.store.commitVote({ electionId, voterId, ballots: prepared.map((p) => p.stored) });
    if (!ok) throw new ConflictException('You have already voted on one of these positions');

    await this.rateLimitStore.markIdempotency(replayKey);

    return { receipts: prepared.map((p) => ({ positionId: p.stored.positionId, receiptCode: p.receiptCode })) };
  }
}
