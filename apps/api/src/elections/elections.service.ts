import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditChain,
  BallotType,
  IntegrityMode,
  PositionConfig,
  SealedTally,
  VoterRow,
  canonicalJson,
  normalizeVoterId,
  parseVoterCsv,
  sha256,
  strategyFor,
} from '@evote/core';
import { CandidateInfo, Election, VOTE_STORE, VoteStore } from '../domain/store';

export interface CreateElectionInput {
  tenantId: string;
  title: string;
  description?: string;
  mode: IntegrityMode;
  opensAt?: string;
  closesAt?: string;
  positions: Array<{
    id?: string;
    title: string;
    type: BallotType;
    seats?: number;
    allowAbstain?: boolean;
    candidates: Array<{ id?: string; name: string; bio?: string }>;
  }>;
}

export interface ElectionSummary {
  id: string;
  title: string;
  description?: string;
  state: Election['state'];
  opensAt?: string;
  closesAt?: string;
  positionCount: number;
  mode: IntegrityMode;
}

const BALLOT_TYPES: BallotType[] = ['SINGLE', 'MULTI', 'APPROVAL', 'RANKED', 'REFERENDUM'];

const summarize = (e: Election): ElectionSummary => ({
  id: e.id,
  title: e.title,
  description: e.description,
  state: e.state,
  opensAt: e.opensAt,
  closesAt: e.closesAt,
  positionCount: e.positions.length,
  mode: e.mode,
});

function isoOrUndefined(v: string | undefined, field: string): string | undefined {
  if (!v) return undefined;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new BadRequestException(`${field} is not a valid date`);
  return new Date(t).toISOString();
}

@Injectable()
export class ElectionsService {
  constructor(@Inject(VOTE_STORE) private readonly store: VoteStore) {}

  async create(input: CreateElectionInput, actor: string): Promise<Election> {
    if (!input.title?.trim()) throw new BadRequestException('A title is required');
    if (!input.positions?.length) throw new BadRequestException('Add at least one position');
    if (input.mode === 'E2E_VERIFIABLE') throw new BadRequestException('End-to-end verifiable mode is not available yet');
    if (input.mode !== 'ANONYMOUS_AUDIT') throw new BadRequestException('Unknown integrity mode');

    const opensAt = isoOrUndefined(input.opensAt, 'opensAt');
    const closesAt = isoOrUndefined(input.closesAt, 'closesAt');
    if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) {
      throw new BadRequestException('The closing time must be after the opening time');
    }

    const titles: Record<string, string> = {};
    const candidates: Record<string, CandidateInfo> = {};
    const positions: PositionConfig[] = input.positions.map((p, i) => {
      const label = p.title?.trim();
      if (!label) throw new BadRequestException(`Position ${i + 1} needs a title`);
      if (!BALLOT_TYPES.includes(p.type)) throw new BadRequestException(`Position "${label}" has an unknown ballot type`);
      const min = p.type === 'REFERENDUM' ? 2 : 1;
      if ((p.candidates?.length ?? 0) < min) throw new BadRequestException(`Position "${label}" needs at least ${min} ${p.type === 'REFERENDUM' ? 'options' : 'candidate'}`);
      const seats = p.type === 'MULTI' ? Math.floor(p.seats ?? 1) : 1;
      if (seats < 1) throw new BadRequestException(`Position "${label}" needs at least one seat`);
      if (p.type === 'MULTI' && seats > p.candidates.length) throw new BadRequestException(`Position "${label}" has more seats than candidates`);

      const ids: string[] = [];
      const names = new Set<string>();
      for (const c of p.candidates) {
        const name = c.name?.trim();
        if (!name) throw new BadRequestException(`A candidate in "${label}" has no name`);
        if (names.has(name.toLowerCase())) throw new BadRequestException(`"${name}" appears twice in "${label}"`);
        names.add(name.toLowerCase());
        const id = randomUUID();
        candidates[id] = { name, ...(c.bio?.trim() ? { bio: c.bio.trim().slice(0, 600) } : {}) };
        ids.push(id);
      }
      const id = randomUUID();
      titles[id] = label;
      return { id, type: p.type, seats, candidateIds: ids, allowAbstain: !!p.allowAbstain };
    });

    const election: Election = {
      id: randomUUID(),
      tenantId: input.tenantId || 'default',
      title: input.title.trim(),
      description: input.description?.trim() || undefined,
      mode: input.mode,
      state: 'DRAFT',
      positions,
      titles,
      candidates,
      opensAt,
      closesAt,
    };
    await this.store.saveElection(election);
    this.store.audit(election.id).append('ELECTION_CREATED', actor, {
      mode: election.mode,
      positions: positions.map((p) => ({ id: p.id, type: p.type, seats: p.seats, candidates: p.candidateIds.length })),
    });
    return election;
  }

  async get(id: string): Promise<Election> {
    const e = await this.store.getElection(id);
    if (!e) throw new NotFoundException('Election not found');
    return e;
  }

  async list(includeDrafts: boolean): Promise<ElectionSummary[]> {
    return (await this.store.listElections())
      .filter((e) => includeDrafts || e.state !== 'DRAFT')
      .sort((a, b) => (b.opensAt ?? '').localeCompare(a.opensAt ?? '') || a.title.localeCompare(b.title))
      .map(summarize);
  }

  /** Draft elections are only visible to staff who may edit them. */
  async getVisible(id: string, includeDrafts: boolean): Promise<Election> {
    const e = await this.get(id);
    if (e.state === 'DRAFT' && !includeDrafts) throw new NotFoundException('Election not found');
    return e;
  }

  async remove(id: string, actor: string) {
    const e = await this.get(id);
    if (e.state !== 'DRAFT') throw new ConflictException('Only a draft election can be deleted');
    await this.store.deleteElection(id);
    return { deleted: true, by: actor };
  }

  async importVoters(id: string, input: { csv?: string; voters?: VoterRow[] }, actor: string) {
    const e = await this.get(id);
    if (e.state !== 'DRAFT') throw new ConflictException('The voter register is locked once voting opens');
    let rows: VoterRow[];
    let errors: Array<{ line: number; message: string }> = [];
    if (typeof input.csv === 'string') {
      if (input.csv.length > 20_000_000) throw new BadRequestException('File is too large');
      ({ voters: rows, errors } = parseVoterCsv(input.csv));
    } else if (Array.isArray(input.voters)) {
      rows = input.voters.map((v) => ({ ...v, id: normalizeVoterId(String(v.id ?? '')) })).filter((v) => v.id && v.name);
    } else throw new BadRequestException('Send a CSV file or a list of voters');

    await this.store.upsertVoters(rows);
    const eligible = await this.store.addEligibleVoters(id, rows.map((r) => r.id));
    this.store.audit(id).append('REGISTER_UPDATED', actor, { added: rows.length, eligible, rejected: errors.length });
    return { added: rows.length, eligible, errors };
  }

  async register(id: string) {
    await this.get(id);
    const voters = await this.store.eligibleVoters(id);
    return Promise.all(
      voters.map(async (v) => ({
        id: v.id,
        name: v.name,
        email: v.email ? maskEmail(v.email) : undefined,
        phone: v.phone ? maskPhone(v.phone) : undefined,
        hasVoted: (await this.store.votedPositions(id, v.id)).length > 0,
      })),
    );
  }

  async open(id: string, actor: string) {
    const e = await this.get(id);
    if (e.state !== 'DRAFT') throw new ConflictException(`Cannot open an election that is ${e.state.toLowerCase()}`);
    const { eligible } = await this.store.turnout(id);
    if (eligible === 0) throw new ConflictException('The voter register is empty');
    e.state = 'OPEN';
    await this.store.saveElection(e);
    this.store.audit(id).append('ELECTION_OPENED', actor, { eligible });
    return e;
  }

  async close(id: string, actor: string) {
    const e = await this.get(id);
    if (e.state !== 'OPEN') throw new ConflictException(`Cannot close an election that is ${e.state.toLowerCase()}`);
    e.state = 'CLOSED';
    await this.store.saveElection(e);
    this.store.audit(id).append('ELECTION_CLOSED', actor, await this.store.turnout(id));
    return e;
  }

  /** Opens/closes elections whose scheduled time has arrived. Sealing always needs a person. */
  async tick(now = Date.now()) {
    for (const e of await this.store.listElections()) {
      if (e.state === 'DRAFT' && e.opensAt && Date.parse(e.opensAt) <= now) {
        if ((await this.store.turnout(e.id)).eligible > 0 && (!e.closesAt || Date.parse(e.closesAt) > now)) await this.open(e.id, 'scheduler');
      } else if (e.state === 'OPEN' && e.closesAt && Date.parse(e.closesAt) <= now) {
        await this.close(e.id, 'scheduler');
      }
    }
  }

  /** Tally, hash the result, and bind it to the audit chain head. */
  async seal(id: string, actor: string): Promise<SealedTally> {
    const e = await this.get(id);
    if (e.state !== 'CLOSED') throw new ConflictException('Only a closed election can be sealed');
    const strategy = strategyFor(e.mode);
    const results = [];
    for (const p of e.positions) results.push(strategy.tally(p, await this.store.ballotsFor(id, p.id)));
    const chain = this.store.audit(id);
    const resultHash = sha256(canonicalJson({ electionId: id, results }));
    const sealed: SealedTally = { electionId: id, results, resultHash, auditHead: chain.head };
    chain.append('RESULT_SEALED', actor, { resultHash });
    e.state = 'SEALED';
    e.sealed = sealed;
    await this.store.saveElection(e);
    return sealed;
  }

  async results(id: string): Promise<SealedTally> {
    const e = await this.get(id);
    if (!e.sealed) throw new ConflictException('Results are not published yet');
    return e.sealed;
  }

  /** Live turnout only. Never exposes counts before sealing. */
  async turnout(id: string) {
    await this.get(id);
    return this.store.turnout(id);
  }

  async auditLog(id: string) {
    await this.get(id);
    const entries = this.store.audit(id).toArray();
    return { entries, intact: AuditChain.verify(entries) === -1 };
  }

  /** Observer check: recompute every tally from the stored ballots. */
  async verify(id: string) {
    const e = await this.get(id);
    if (!e.sealed) throw new ConflictException('Results are not published yet');
    const strategy = strategyFor(e.mode);
    const checks = [];
    for (const p of e.positions) {
      const claimed = e.sealed.results.find((r) => r.positionId === p.id)!;
      checks.push({ positionId: p.id, ok: strategy.verify(p, await this.store.ballotsFor(id, p.id), claimed) });
    }
    const recomputed = sha256(canonicalJson({ electionId: id, results: e.sealed.results }));
    return {
      tallyMatches: checks.every((c) => c.ok),
      hashMatches: recomputed === e.sealed.resultHash,
      auditIntact: AuditChain.verify(this.store.audit(id).toArray()) === -1,
      checks,
    };
  }

  // ---- voter views ---------------------------------------------------------

  async electionsForVoter(voterId: string) {
    const out = [];
    for (const id of await this.store.electionIdsFor(voterId)) {
      const e = await this.store.getElection(id);
      if (!e || e.state === 'DRAFT') continue;
      out.push({ ...summarize(e), votedPositionIds: await this.store.votedPositions(id, voterId) });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  async ballotForVoter(id: string, voterId: string) {
    const e = await this.getVisible(id, false);
    if (!(await this.store.isEligible(id, voterId))) throw new ForbiddenException('You are not on the voter register for this election');
    const { sealed: _results, ...rest } = e;
    return { ...rest, votedPositionIds: await this.store.votedPositions(id, voterId) };
  }

  // ---- public views --------------------------------------------------------

  async publicList() {
    return (await this.list(false)).filter((e) => e.state === 'SEALED');
  }

  async publicResults(id: string) {
    const e = await this.get(id);
    if (!e.sealed) throw new NotFoundException('Results are not published');
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      mode: e.mode,
      positions: e.positions,
      titles: e.titles,
      candidates: e.candidates,
      sealed: e.sealed,
      turnout: await this.store.turnout(id),
    };
  }

  /** A voter proves their ballot is in the box. Reveals the position and ballot hash, never the choice. */
  async checkReceipt(electionId: string, code: string) {
    const e = await this.get(electionId);
    if (e.state === 'DRAFT') throw new NotFoundException('Election not found');
    const clean = (code ?? '').replace(/[\s-]/g, '').toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(clean)) throw new BadRequestException('A receipt code is 16 letters and numbers');
    const hit = await this.store.findReceipt(electionId, createHash('sha256').update(clean).digest('hex'));
    if (!hit) return { found: false as const };
    return { found: true as const, election: e.title, position: e.titles[hit.positionId] ?? hit.positionId, ballotHash: hit.ballotHash, state: e.state };
  }
}

function maskEmail(email: string) {
  const [u, d] = email.split('@');
  return `${u.slice(0, 1)}***@${d}`;
}
function maskPhone(phone: string) {
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}
