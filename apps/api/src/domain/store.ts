import { AuditChain, IntegrityMode, PositionConfig, SealedTally, StoredBallot, VoterRow } from '@evote/core';

export type ElectionState = 'DRAFT' | 'OPEN' | 'CLOSED' | 'SEALED';

export interface CandidateInfo {
  name: string;
  bio?: string;
}

export interface Election {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
  mode: IntegrityMode;
  state: ElectionState;
  positions: PositionConfig[];
  /** positionId -> display title */
  titles: Record<string, string>;
  /** candidateId -> display info */
  candidates: Record<string, CandidateInfo>;
  /** ISO timestamps. The scheduler opens/closes at these times; casting also enforces them. */
  opensAt?: string;
  closesAt?: string;
  sealed?: SealedTally;
}

export type VoterRecord = VoterRow & { tenantId?: string; status?: string };

/**
 * Storage port. The in-memory adapter below is for tests and local dev; the
 * Postgres adapter must keep the same guarantees:
 *   - commitVote is ONE serializable transaction
 *   - participation rows hold (election, voter, position) and NOTHING about the ballot
 *   - ballot rows hold NO voter reference and NO timestamp
 */
export interface VoteStore {
  saveElection(e: Election): Promise<void>;
  getElection(id: string): Promise<Election | undefined>;
  listElections(): Promise<Election[]>;
  deleteElection(id: string): Promise<void>;

  upsertVoters(voters: VoterRecord[]): Promise<void>;
  getVoter(id: string): Promise<VoterRecord | undefined>;
  addEligibleVoters(electionId: string, voterIds: string[]): Promise<number>;
  isEligible(electionId: string, voterId: string): Promise<boolean>;
  eligibleVoters(electionId: string): Promise<VoterRecord[]>;
  electionIdsFor(voterId: string): Promise<string[]>;
  votedPositions(electionId: string, voterId: string): Promise<string[]>;

  /**
   * Atomically record participation and insert ballots.
   * Returns false (and writes nothing) if the voter already voted on any listed position.
   */
  commitVote(args: { electionId: string; voterId: string; ballots: StoredBallot[] }): Promise<boolean>;

  /** Ballots for a position, in an order unrelated to insertion order. */
  ballotsFor(electionId: string, positionId: string): Promise<StoredBallot[]>;
  findReceipt(electionId: string, receiptHash: string): Promise<{ positionId: string; ballotHash: string } | undefined>;
  turnout(electionId: string): Promise<{ voters: number; eligible: number }>;

  audit(electionId: string): AuditChain;
}

export const VOTE_STORE = Symbol('VOTE_STORE');

export class InMemoryVoteStore implements VoteStore {
  private elections = new Map<string, Election>();
  private registry = new Map<string, VoterRecord>();
  private eligible = new Map<string, Set<string>>();
  /** key: election|voter|position  (no ballot reference) */
  private participation = new Set<string>();
  private voted = new Map<string, Set<string>>();
  private ballots = new Map<string, StoredBallot[]>();
  private chains = new Map<string, AuditChain>();

  async saveElection(e: Election) {
    this.elections.set(e.id, structuredClone(e));
  }
  async getElection(id: string) {
    const e = this.elections.get(id);
    return e ? structuredClone(e) : undefined;
  }
  async listElections() {
    return [...this.elections.values()].map((e) => structuredClone(e));
  }
  async deleteElection(id: string) {
    this.elections.delete(id);
    this.eligible.delete(id);
    this.chains.delete(id);
  }

  async upsertVoters(voters: VoterRecord[]) {
    for (const v of voters) this.registry.set(v.id, { ...v });
  }
  async getVoter(id: string) {
    const v = this.registry.get(id);
    return v ? { ...v } : undefined;
  }
  async addEligibleVoters(electionId: string, voterIds: string[]) {
    const set = this.eligible.get(electionId) ?? new Set<string>();
    voterIds.forEach((v) => set.add(v));
    this.eligible.set(electionId, set);
    return set.size;
  }
  async isEligible(electionId: string, voterId: string) {
    return this.eligible.get(electionId)?.has(voterId) ?? false;
  }
  async eligibleVoters(electionId: string) {
    const ids = [...(this.eligible.get(electionId) ?? [])].sort();
    return ids.map((id) => this.registry.get(id)).filter((v): v is VoterRecord => !!v).map((v) => ({ ...v }));
  }
  async electionIdsFor(voterId: string) {
    return [...this.eligible.entries()].filter(([, s]) => s.has(voterId)).map(([id]) => id);
  }
  async votedPositions(electionId: string, voterId: string) {
    const prefix = `${electionId}|${voterId}|`;
    return [...this.participation].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }

  async commitVote({ electionId, voterId, ballots }: { electionId: string; voterId: string; ballots: StoredBallot[] }) {
    // Single-threaded critical section: check-then-write has no awaits in between.
    const keys = ballots.map((b) => `${electionId}|${voterId}|${b.positionId}`);
    if (keys.some((k) => this.participation.has(k))) return false;
    keys.forEach((k) => this.participation.add(k));
    const v = this.voted.get(electionId) ?? new Set<string>();
    v.add(voterId);
    this.voted.set(electionId, v);
    for (const b of ballots) {
      const key = `${electionId}|${b.positionId}`;
      const list = this.ballots.get(key) ?? [];
      list.push(structuredClone(b));
      this.ballots.set(key, list);
    }
    this.audit(electionId).append('BALLOT_ACCEPTED', 'system', { ballotHashes: ballots.map((b) => b.ballotHash) });
    return true;
  }

  async ballotsFor(electionId: string, positionId: string) {
    const list = this.ballots.get(`${electionId}|${positionId}`) ?? [];
    // Sorted by random ballot hash, so output order says nothing about cast order.
    return list.map((b) => structuredClone(b)).sort((a, b) => a.ballotHash.localeCompare(b.ballotHash));
  }

  async findReceipt(electionId: string, receiptHash: string) {
    for (const [key, list] of this.ballots) {
      if (!key.startsWith(`${electionId}|`)) continue;
      const hit = list.find((b) => b.receiptHash === receiptHash);
      if (hit) return { positionId: hit.positionId, ballotHash: hit.ballotHash };
    }
    return undefined;
  }

  async turnout(electionId: string) {
    return {
      voters: this.voted.get(electionId)?.size ?? 0,
      eligible: this.eligible.get(electionId)?.size ?? 0,
    };
  }

  audit(electionId: string) {
    let c = this.chains.get(electionId);
    if (!c) {
      c = new AuditChain();
      this.chains.set(electionId, c);
    }
    return c;
  }
}
