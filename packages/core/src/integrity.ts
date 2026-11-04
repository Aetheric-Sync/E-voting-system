/**
 * Every election picks one integrity mode at creation. Both modes implement this
 * contract so casting, tally and audit code never branches on the mode.
 */
export type IntegrityMode = 'ANONYMOUS_AUDIT' | 'E2E_VERIFIABLE';

export type BallotType = 'SINGLE' | 'MULTI' | 'APPROVAL' | 'RANKED' | 'REFERENDUM';

export interface PositionConfig {
  id: string;
  type: BallotType;
  /** Number of seats (MULTI / RANKED). */
  seats: number;
  candidateIds: string[];
  /** Whether abstain is allowed. */
  allowAbstain: boolean;
}

/** A voter's choice for one position. RANKED uses ordered candidate ids. */
export interface Selection {
  positionId: string;
  candidateIds: string[];
  abstain?: boolean;
}

/** What gets stored. Contains no voter identity. */
export interface StoredBallot {
  electionId: string;
  positionId: string;
  /** Plain selection (Mode A) or ciphertext (Mode B). */
  payload: unknown;
  ballotHash: string;
  /** SHA-256 of the receipt code. The code itself is only given to the voter. */
  receiptHash: string;
}

export interface PreparedBallot {
  stored: StoredBallot;
  /** Shown to the voter once; lets them confirm the ballot was recorded. */
  receiptCode: string;
}

export interface TallyResult {
  positionId: string;
  type: BallotType;
  counts: Record<string, number>;
  winners: string[];
  abstentions: number;
  totalBallots: number;
  /**
   * True when the last seat is tied with the first candidate left out. `winners` then holds a
   * deterministic but arbitrary pick, and the electoral committee must decide (runoff, lots, ...).
   */
  tiedAtCutoff?: boolean;
  /** Round-by-round detail for ranked ballots. */
  rounds?: Array<{ round: number; counts: Record<string, number>; eliminated?: string }>;
}

export interface SealedTally {
  electionId: string;
  results: TallyResult[];
  /** SHA-256 over the canonical result set; publish this value. */
  resultHash: string;
  /** Hash of the audit chain head at sealing time. */
  auditHead: string;
}

export class SelectionError extends Error {}

export interface IntegrityStrategy {
  readonly mode: IntegrityMode;
  /** Validate a selection against the position rules. Throws SelectionError. */
  validate(position: PositionConfig, selection: Selection): void;
  /** Turn a validated selection into an identity-free stored ballot. */
  prepare(electionId: string, position: PositionConfig, selection: Selection): PreparedBallot;
  /** Count stored ballots for one position. */
  tally(position: PositionConfig, ballots: StoredBallot[]): TallyResult;
  /** Re-check a published result against the stored ballots. */
  verify(position: PositionConfig, ballots: StoredBallot[], claimed: TallyResult): boolean;
}
