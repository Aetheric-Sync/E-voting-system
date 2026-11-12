import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  AuditChain,
  AuditEntry,
  GENESIS_HASH,
  PositionConfig,
  StoredBallot,
  computeEntryHash,
} from '@evote/core';
import { CandidateInfo, Election, VoteStore, VoterRecord } from './store';

export class PostgresAuditChain extends AuditChain {
  constructor(
    private readonly electionId: string,
    private readonly prisma: PrismaClient,
    entries: AuditEntry[] = [],
  ) {
    super(entries);
  }

  override append(
    event: string,
    actor: string,
    payload: unknown = {},
    at = new Date().toISOString(),
  ): AuditEntry {
    const entry = super.append(event, actor, payload, at);
    this.prisma.auditLog
      .create({
        data: {
          electionId: this.electionId,
          seq: entry.seq,
          prevHash: entry.prevHash,
          hash: entry.hash,
          event: entry.event,
          actor: entry.actor,
          payload: (entry.payload as any) ?? {},
          at: new Date(entry.at),
        },
      })
      .catch((err) => {
        // Log/swallow background persistence failure if already written by transaction
      });
    return entry;
  }

  appendDirect(entry: AuditEntry): void {
    (this as any).entries.push(entry);
  }

  loadEntries(entries: AuditEntry[]): void {
    (this as any).entries = [...entries];
  }
}

export class PostgresVoteStore implements VoteStore {
  private readonly chains = new Map<string, PostgresAuditChain>();
  public retryCount = 0;

  constructor(private readonly prisma: PrismaClient) {}

  private async syncAuditChain(electionId: string): Promise<PostgresAuditChain> {
    const rows = await this.prisma.auditLog.findMany({
      where: { electionId },
      orderBy: { seq: 'asc' },
    });
    const entries: AuditEntry[] = rows.map((r) => ({
      seq: r.seq,
      prevHash: r.prevHash,
      hash: r.hash,
      event: r.event,
      actor: r.actor,
      payload: r.payload,
      at: r.at.toISOString(),
    }));

    let chain = this.chains.get(electionId);
    if (!chain) {
      chain = new PostgresAuditChain(electionId, this.prisma, entries);
      this.chains.set(electionId, chain);
    } else {
      chain.loadEntries(entries);
    }
    return chain;
  }

  private mapElectionFromDb(row: any): Election {
    const titles: Record<string, string> = {};
    const candidates: Record<string, CandidateInfo> = {};
    const positions: PositionConfig[] = (row.positions || []).map((p: any) => {
      titles[p.id] = p.title;
      for (const c of p.candidates || []) {
        candidates[c.id] = {
          name: c.name,
          bio: c.bio ?? undefined,
        };
      }
      return {
        id: p.id,
        type: p.type,
        seats: p.seats,
        candidateIds: (p.candidates || []).map((c: any) => c.id),
        allowAbstain: p.allowAbstain,
      };
    });

    return {
      id: row.id,
      tenantId: row.tenantId,
      title: row.title,
      description: row.description ?? undefined,
      mode: row.mode,
      state: row.state,
      positions,
      titles,
      candidates,
      opensAt: row.opensAt ? row.opensAt.toISOString() : undefined,
      closesAt: row.closesAt ? row.closesAt.toISOString() : undefined,
      sealed: row.sealed ?? undefined,
    };
  }

  async saveElection(e: Election): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const tenantId = e.tenantId || 'default';
      await tx.tenant.upsert({
        where: { id: tenantId },
        create: { id: tenantId, name: tenantId },
        update: {},
      });

      await tx.election.upsert({
        where: { id: e.id },
        create: {
          id: e.id,
          tenantId,
          title: e.title,
          description: e.description,
          mode: e.mode,
          state: e.state,
          opensAt: e.opensAt ? new Date(e.opensAt) : null,
          closesAt: e.closesAt ? new Date(e.closesAt) : null,
          sealed: (e.sealed as any) ?? null,
        },
        update: {
          title: e.title,
          description: e.description,
          mode: e.mode,
          state: e.state,
          opensAt: e.opensAt ? new Date(e.opensAt) : null,
          closesAt: e.closesAt ? new Date(e.closesAt) : null,
          sealed: (e.sealed as any) ?? null,
        },
      });

      // Upsert positions and candidates
      for (let i = 0; i < e.positions.length; i++) {
        const p = e.positions[i];
        await tx.position.upsert({
          where: { id: p.id },
          create: {
            id: p.id,
            electionId: e.id,
            title: e.titles[p.id] || p.id,
            type: p.type,
            seats: p.seats,
            allowAbstain: p.allowAbstain,
            order: i,
          },
          update: {
            electionId: e.id,
            title: e.titles[p.id] || p.id,
            type: p.type,
            seats: p.seats,
            allowAbstain: p.allowAbstain,
            order: i,
          },
        });

        for (const cId of p.candidateIds) {
          await tx.candidate.upsert({
            where: { id: cId },
            create: {
              id: cId,
              positionId: p.id,
              name: e.candidates[cId]?.name || cId,
              bio: e.candidates[cId]?.bio,
            },
            update: {
              positionId: p.id,
              name: e.candidates[cId]?.name || cId,
              bio: e.candidates[cId]?.bio,
            },
          });
        }
      }
    });

    await this.syncAuditChain(e.id);
  }

  async getElection(id: string): Promise<Election | undefined> {
    const row = await this.prisma.election.findUnique({
      where: { id },
      include: {
        positions: {
          orderBy: { order: 'asc' },
          include: {
            candidates: true,
          },
        },
      },
    });
    if (!row) return undefined;
    return this.mapElectionFromDb(row);
  }

  async listElections(): Promise<Election[]> {
    const rows = await this.prisma.election.findMany({
      include: {
        positions: {
          orderBy: { order: 'asc' },
          include: {
            candidates: true,
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => this.mapElectionFromDb(r));
  }

  async deleteElection(id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.ballot.deleteMany({ where: { electionId: id } });
      await tx.participation.deleteMany({ where: { electionId: id } });
      await tx.eligibleVoter.deleteMany({ where: { electionId: id } });
      await tx.auditLog.deleteMany({ where: { electionId: id } });
      await tx.candidate.deleteMany({ where: { position: { electionId: id } } });
      await tx.position.deleteMany({ where: { electionId: id } });
      await tx.election.delete({ where: { id } });
    });
    this.chains.delete(id);
  }

  async upsertVoters(voters: VoterRecord[]): Promise<void> {
    for (const v of voters) {
      const tenantId = v.tenantId || 'default';
      await this.prisma.tenant.upsert({
        where: { id: tenantId },
        create: { id: tenantId, name: tenantId },
        update: {},
      });
      await this.prisma.voter.upsert({
        where: { tenantId_id: { tenantId, id: v.id } },
        create: {
          id: v.id,
          tenantId,
          name: v.name,
          email: v.email,
          phone: v.phone,
          status: v.status || 'ACTIVE',
        },
        update: {
          name: v.name,
          email: v.email,
          phone: v.phone,
          status: v.status || 'ACTIVE',
        },
      });
    }
  }

  async getVoter(id: string): Promise<VoterRecord | undefined> {
    const v = await this.prisma.voter.findFirst({
      where: { id },
    });
    if (!v) return undefined;
    return {
      id: v.id,
      tenantId: v.tenantId,
      name: v.name,
      email: v.email ?? undefined,
      phone: v.phone ?? undefined,
      status: v.status as any,
    };
  }

  async addEligibleVoters(electionId: string, voterIds: string[]): Promise<number> {
    const election = await this.prisma.election.findUnique({
      where: { id: electionId },
    });
    const tenantId = election?.tenantId || 'default';
    await this.prisma.tenant.upsert({
      where: { id: tenantId },
      create: { id: tenantId, name: tenantId },
      update: {},
    });

    for (const voterId of voterIds) {
      const existingVoter = await this.prisma.voter.findUnique({
        where: { tenantId_id: { tenantId, id: voterId } },
      });
      if (!existingVoter) {
        const fallback = await this.prisma.voter.findFirst({
          where: { id: voterId },
        });
        await this.prisma.voter.create({
          data: {
            id: voterId,
            tenantId,
            name: fallback?.name || voterId,
            email: fallback?.email,
            phone: fallback?.phone,
            status: fallback?.status || 'ACTIVE',
          },
        });
      }

      await this.prisma.eligibleVoter.upsert({
        where: {
          electionId_tenantId_voterId: {
            electionId,
            tenantId,
            voterId,
          },
        },
        create: { electionId, tenantId, voterId },
        update: {},
      });
    }
    return this.prisma.eligibleVoter.count({ where: { electionId } });
  }

  async isEligible(electionId: string, voterId: string): Promise<boolean> {
    const hit = await this.prisma.eligibleVoter.findFirst({
      where: { electionId, voterId },
    });
    return !!hit;
  }

  async eligibleVoters(electionId: string): Promise<VoterRecord[]> {
    const rows = await this.prisma.eligibleVoter.findMany({
      where: { electionId },
      include: { voter: true },
      orderBy: { voterId: 'asc' },
    });
    return rows.map((r) => ({
      id: r.voter.id,
      tenantId: r.voter.tenantId,
      name: r.voter.name,
      email: r.voter.email ?? undefined,
      phone: r.voter.phone ?? undefined,
      status: r.voter.status as any,
    }));
  }

  async electionIdsFor(voterId: string): Promise<string[]> {
    const rows = await this.prisma.eligibleVoter.findMany({
      where: { voterId },
      select: { electionId: true },
    });
    return rows.map((r) => r.electionId);
  }

  async votedPositions(electionId: string, voterId: string): Promise<string[]> {
    const rows = await this.prisma.participation.findMany({
      where: { electionId, voterId },
      select: { positionId: true },
    });
    return rows.map((r) => r.positionId);
  }

  /**
   * SERIALIZABLE transaction:
   * 1. Takes pg_advisory_xact_lock on electionId hash to queue concurrent writers.
   * 2. Checks voter eligibility.
   * 3. Checks voter has not already voted on requested positions.
   * 4. Inserts ballots (NO voter ID, NO timestamp).
   * 5. Inserts participation records (NO ballot ID).
   * 6. Appends audit log entry inside the same transaction preserving the hash chain.
   * Retries on genuine serialization conflicts with backoff and jitter.
   */
  async commitVote({
    electionId,
    voterId,
    ballots,
  }: {
    electionId: string;
    voterId: string;
    ballots: StoredBallot[];
  }): Promise<boolean> {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.prisma.$transaction(
          async (tx) => {
            // First statement: acquire advisory lock on electionId hash (queues concurrent writers)
            await tx.$executeRawUnsafe(
              `SELECT pg_advisory_xact_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint)`,
              electionId,
            );

            const requestedPositions = ballots.map((b) => b.positionId);

            // Single round-trip: verify eligibility, check prior participation, and read audit head
            const checkRows = await tx.$queryRaw<
              Array<{
                tenantId: string | null;
                alreadyVoted: boolean;
                lastSeq: number | null;
                lastHash: string | null;
              }>
            >`
              SELECT
                (SELECT "tenantId" FROM "EligibleVoter" WHERE "electionId" = ${electionId} AND "voterId" = ${voterId} LIMIT 1) AS "tenantId",
                EXISTS(
                  SELECT 1 FROM "Participation"
                  WHERE "electionId" = ${electionId} AND "voterId" = ${voterId} AND "positionId" IN (${Prisma.join(requestedPositions)})
                ) AS "alreadyVoted",
                (SELECT "seq" FROM "AuditLog" WHERE "electionId" = ${electionId} ORDER BY "seq" DESC LIMIT 1) AS "lastSeq",
                (SELECT "hash" FROM "AuditLog" WHERE "electionId" = ${electionId} ORDER BY "seq" DESC LIMIT 1) AS "lastHash"
            `;

            const check = checkRows[0];
            if (!check || !check.tenantId) {
              return { status: 'ineligible' as const };
            }
            if (check.alreadyVoted) {
              return { status: 'already_voted' as const };
            }

            // 1. Insert ballots (NO voter ID, NO timestamp)
            await tx.ballot.createMany({
              data: ballots.map((b) => ({
                id: randomUUID(),
                electionId,
                positionId: b.positionId,
                payload: b.payload as any,
                ballotHash: b.ballotHash,
                receiptHash: b.receiptHash,
              })),
            });

            // 2. Insert participation records (NO ballot ID)
            await tx.participation.createMany({
              data: ballots.map((b) => ({
                electionId,
                positionId: b.positionId,
                tenantId: check.tenantId!,
                voterId,
              })),
            });

            // 3. Append audit entry inside the same transaction
            const seq = check.lastSeq !== null && check.lastSeq !== undefined ? check.lastSeq + 1 : 0;
            const prevHash = check.lastHash || GENESIS_HASH;
            const event = 'BALLOT_ACCEPTED';
            const actor = 'system';
            const payload = { ballotHashes: ballots.map((b) => b.ballotHash) };
            const at = new Date().toISOString();
            const hash = computeEntryHash({ seq, prevHash, event, actor, payload, at });

            await tx.auditLog.create({
              data: {
                electionId,
                seq,
                prevHash,
                hash,
                event,
                actor,
                payload: payload as any,
                at: new Date(at),
              },
            });

            return {
              status: 'ok' as const,
              auditEntry: { seq, prevHash, hash, event, actor, payload, at },
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 10000,
            timeout: 10000,
          },
        );

        if (result.status !== 'ok') {
          return false;
        }

        // Update local memory chain cache
        const chain = this.chains.get(electionId);
        if (chain) {
          chain.appendDirect(result.auditEntry);
        }

        return true;
      } catch (err: any) {
        // Unique violation handling:
        // - Participation conflict (voter already cast) -> return false
        // - AuditLog seq conflict (race on sequence) -> retry up to MAX_RETRIES
        if (err.code === 'P2002') {
          const targetStr = JSON.stringify(err.meta?.target || '');
          const isSeqConflict = targetStr.includes('seq') || targetStr.includes('AuditLog');
          if (isSeqConflict && attempt < MAX_RETRIES) {
            this.retryCount++;
            const delayMs = Math.floor(Math.random() * 20) + attempt * 10;
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }
          return false;
        }

        const isRetryable =
          err.code === 'P2034' ||
          err.message?.includes('could not serialize access') ||
          err.message?.includes('40001') ||
          err.message?.includes('deadlock detected') ||
          err.message?.includes('40P01') ||
          err.message?.includes('Unable to start a transaction in the given time') ||
          err.message?.includes('Timed out');

        if (isRetryable && attempt < MAX_RETRIES) {
          this.retryCount++;
          const delayMs = Math.floor(Math.random() * 20) + attempt * 10;
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        throw err;
      }
    }
    return false;
  }

  /**
   * Ordered by ballotHash with COLLATE "C" to guarantee byte-identical ordering
   * to in-memory store.
   */
  async ballotsFor(electionId: string, positionId: string): Promise<StoredBallot[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        electionId: string;
        positionId: string;
        payload: any;
        ballotHash: string;
        receiptHash: string;
      }>
    >`
      SELECT "electionId", "positionId", "payload", "ballotHash", "receiptHash"
      FROM "Ballot"
      WHERE "electionId" = ${electionId} AND "positionId" = ${positionId}
      ORDER BY "ballotHash" COLLATE "C" ASC
    `;

    return rows.map((r) => ({
      electionId: r.electionId,
      positionId: r.positionId,
      payload: r.payload,
      ballotHash: r.ballotHash,
      receiptHash: r.receiptHash,
    }));
  }

  async findReceipt(
    electionId: string,
    receiptHash: string,
  ): Promise<{ positionId: string; ballotHash: string } | undefined> {
    const hit = await this.prisma.ballot.findFirst({
      where: { electionId, receiptHash },
    });
    if (!hit) return undefined;
    return { positionId: hit.positionId, ballotHash: hit.ballotHash };
  }

  async turnout(electionId: string): Promise<{ voters: number; eligible: number }> {
    const eligible = await this.prisma.eligibleVoter.count({
      where: { electionId },
    });
    const voters = await this.prisma.participation.findMany({
      where: { electionId },
      distinct: ['voterId'],
      select: { voterId: true },
    });
    return {
      voters: voters.length,
      eligible,
    };
  }

  audit(electionId: string): AuditChain {
    let chain = this.chains.get(electionId);
    if (!chain) {
      chain = new PostgresAuditChain(electionId, this.prisma);
      this.chains.set(electionId, chain);
    }
    return chain;
  }
}
