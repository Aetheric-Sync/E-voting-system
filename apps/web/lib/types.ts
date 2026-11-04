export type Role = 'ADMIN' | 'OBSERVER' | 'VOTER';
export type BallotType = 'SINGLE' | 'MULTI' | 'APPROVAL' | 'RANKED' | 'REFERENDUM';
export type ElectionState = 'DRAFT' | 'OPEN' | 'CLOSED' | 'SEALED';

export interface Me {
  id: string;
  role: Role;
  name: string;
}

export interface Position {
  id: string;
  type: BallotType;
  seats: number;
  candidateIds: string[];
  allowAbstain: boolean;
}

export interface Candidate {
  name: string;
  bio?: string;
}

export interface TallyResult {
  positionId: string;
  type: BallotType;
  counts: Record<string, number>;
  winners: string[];
  abstentions: number;
  totalBallots: number;
  tiedAtCutoff?: boolean;
  rounds?: Array<{ round: number; counts: Record<string, number>; eliminated?: string }>;
}

export interface Sealed {
  electionId: string;
  results: TallyResult[];
  resultHash: string;
  auditHead: string;
}

export interface Election {
  id: string;
  title: string;
  description?: string;
  mode: 'ANONYMOUS_AUDIT' | 'E2E_VERIFIABLE';
  state: ElectionState;
  positions: Position[];
  titles: Record<string, string>;
  candidates: Record<string, Candidate>;
  opensAt?: string;
  closesAt?: string;
  sealed?: Sealed;
}

export interface Summary {
  id: string;
  title: string;
  description?: string;
  state: ElectionState;
  opensAt?: string;
  closesAt?: string;
  positionCount: number;
  mode: string;
}

export interface VoterElection extends Summary {
  votedPositionIds: string[];
}

export interface VoterBallot extends Omit<Election, 'sealed'> {
  votedPositionIds: string[];
}

export interface Turnout {
  voters: number;
  eligible: number;
}

export interface AuditEntry {
  seq: number;
  prevHash: string;
  hash: string;
  event: string;
  actor: string;
  payload: unknown;
  at: string;
}

export interface RegisterRow {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  hasVoted: boolean;
}

export interface PublicResults {
  id: string;
  title: string;
  description?: string;
  positions: Position[];
  titles: Record<string, string>;
  candidates: Record<string, Candidate>;
  sealed: Sealed;
  turnout: Turnout;
}

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'OBSERVER';
  createdAt: string;
}
