import {
  IntegrityStrategy,
  PositionConfig,
  PreparedBallot,
  Selection,
  StoredBallot,
  TallyResult,
} from './integrity';

/**
 * Mode B placeholder (roadmap Phase 5). The contract is fixed so elections can
 * already be created in this mode; every operation throws until the following
 * are implemented:
 *
 *  - threshold key ceremony (t-of-n trustees), election public key published
 *  - client-side ballot encryption + proof of well-formedness
 *  - public bulletin board with inclusion proofs
 *  - homomorphic tally or verifiable mixnet, with decryption proofs
 *  - standalone verifier that re-checks the whole election from public data
 *
 * Use a reviewed construction (ElectionGuard / Helios style); never roll your
 * own primitives.
 */
export class E2eVerifiableStrategy implements IntegrityStrategy {
  readonly mode = 'E2E_VERIFIABLE' as const;

  private notReady(): never {
    throw new Error('E2E_VERIFIABLE mode is not implemented yet (Phase 5)');
  }

  validate(_position: PositionConfig, _selection: Selection): void {
    this.notReady();
  }
  prepare(_electionId: string, _position: PositionConfig, _selection: Selection): PreparedBallot {
    return this.notReady();
  }
  tally(_position: PositionConfig, _ballots: StoredBallot[]): TallyResult {
    return this.notReady();
  }
  verify(_position: PositionConfig, _ballots: StoredBallot[], _claimed: TallyResult): boolean {
    return this.notReady();
  }
}
