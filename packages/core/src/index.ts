import { AnonymousStrategy } from './anonymous-strategy';
import { E2eVerifiableStrategy } from './e2e-strategy';
import { IntegrityMode, IntegrityStrategy } from './integrity';

export * from './audit-chain';
export * from './integrity';
export * from './ranked-choice';
export * from './voter-csv';
export { AnonymousStrategy } from './anonymous-strategy';
export { E2eVerifiableStrategy } from './e2e-strategy';

export function strategyFor(mode: IntegrityMode): IntegrityStrategy {
  return mode === 'ANONYMOUS_AUDIT' ? new AnonymousStrategy() : new E2eVerifiableStrategy();
}
