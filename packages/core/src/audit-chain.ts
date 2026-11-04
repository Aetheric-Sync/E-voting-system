import { createHash } from 'node:crypto';

export interface AuditEntry {
  seq: number;
  prevHash: string;
  hash: string;
  event: string;
  actor: string;
  payload: unknown;
  at: string;
}

export const GENESIS_HASH = '0'.repeat(64);

/** Deterministic JSON: object keys sorted, so the same data always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function computeEntryHash(e: Omit<AuditEntry, 'hash'>): string {
  return sha256(
    canonicalJson({
      seq: e.seq,
      prevHash: e.prevHash,
      event: e.event,
      actor: e.actor,
      payload: e.payload,
      at: e.at,
    }),
  );
}

/** Append-only, tamper-evident log. Each entry commits to the one before it. */
export class AuditChain {
  private entries: AuditEntry[];

  constructor(existing: AuditEntry[] = []) {
    this.entries = [...existing];
  }

  get head(): string {
    return this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS_HASH;
  }

  get length(): number {
    return this.entries.length;
  }

  append(event: string, actor: string, payload: unknown = {}, at = new Date().toISOString()): AuditEntry {
    const base = { seq: this.entries.length, prevHash: this.head, event, actor, payload, at };
    const entry: AuditEntry = { ...base, hash: computeEntryHash(base) };
    this.entries.push(entry);
    return entry;
  }

  toArray(): AuditEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /** Returns the index of the first broken entry, or -1 when the chain is intact. */
  static verify(entries: AuditEntry[]): number {
    let prev = GENESIS_HASH;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const { hash, ...rest } = e;
      if (e.seq !== i || e.prevHash !== prev || computeEntryHash(rest) !== hash) return i;
      prev = hash;
    }
    return -1;
  }
}
