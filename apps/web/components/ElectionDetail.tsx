'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChangeEvent, useMemo, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { download, fmtDate, pct } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { AuditEntry, Election, RegisterRow, Turnout } from '@/lib/types';
import { ResultsView } from './ResultsView';
import { Alert, ConfirmButton, Loading, Meter, StateChip } from './ui';

type Tab = 'overview' | 'voters' | 'ballot' | 'results' | 'audit';

const EVENT_LABEL: Record<string, string> = {
  ELECTION_CREATED: 'Election created',
  REGISTER_UPDATED: 'Voter register updated',
  ELECTION_OPENED: 'Voting opened',
  BALLOT_ACCEPTED: 'Ballot accepted',
  ELECTION_CLOSED: 'Voting closed',
  RESULT_SEALED: 'Results sealed',
};

const TEMPLATE = 'id,name,email,phone\nCSC/21/001,Ada Obi,ada@example.com,\nCSC/21/002,Musa Bello,,+2348030000000\n';

export function ElectionDetail({ id, readOnly, backHref }: { id: string; readOnly: boolean; backHref: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const [actionError, setActionError] = useState('');
  const election = useLoad(() => api<Election>(`/elections/${id}`), [id], 15000);
  const e = election.data;
  const turnout = useLoad(() => api<Turnout>(`/elections/${id}/turnout`), [id, e?.state], e?.state === 'OPEN' ? 8000 : undefined);

  async function act(path: string) {
    setActionError('');
    try {
      await api(`/elections/${id}/${path}`, { method: 'POST' });
      await Promise.all([election.reload(true), turnout.reload(true)]);
    } catch (err) {
      setActionError(errorText(err));
    }
  }
  async function remove() {
    try {
      await api(`/elections/${id}`, { method: 'DELETE' });
      router.push(backHref);
    } catch (err) {
      setActionError(errorText(err));
    }
  }

  if (election.loading && !e) return <Loading />;
  if (election.error && !e) return <Alert kind="error">{election.error}</Alert>;
  if (!e) return null;

  const tabs: Array<[Tab, string]> = [
    ['overview', 'Overview'],
    ...(readOnly ? [] : ([['voters', 'Voters']] as Array<[Tab, string]>)),
    ['ballot', 'Ballot'],
    ['results', 'Results'],
    ['audit', 'Audit & verification'],
  ];

  return (
    <div>
      <p className="small">
        <Link href={backHref}>← All elections</Link>
      </p>
      <div className="row between">
        <h1>{e.title}</h1>
        <StateChip state={e.state} />
      </div>
      {e.description && <p className="muted">{e.description}</p>}
      {actionError && <Alert kind="error">{actionError}</Alert>}

      <div className="tabs" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <Overview e={e} turnout={turnout.data} readOnly={readOnly} act={act} remove={remove} />
      )}
      {tab === 'voters' && !readOnly && <Voters id={id} state={e.state} onChanged={() => { void turnout.reload(true); }} />}
      {tab === 'ballot' && <BallotPreview e={e} />}
      {tab === 'results' &&
        (e.sealed ? (
          <ResultsView title={e.title} positions={e.positions} titles={e.titles} candidates={e.candidates} sealed={e.sealed} turnout={turnout.data ?? undefined} />
        ) : (
          <Alert>Results appear here once the election is closed and sealed. Counts are never visible while voting is open.</Alert>
        ))}
      {tab === 'audit' && <Audit e={e} />}
    </div>
  );
}

function Overview({ e, turnout, readOnly, act, remove }: { e: Election; turnout: Turnout | null; readOnly: boolean; act: (p: string) => Promise<void>; remove: () => Promise<void> }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return (
    <div className="stack">
      <div className="grid cols-4">
        <div className="stat">
          <div className="n">{e.positions.length}</div>
          <div className="muted small">position{e.positions.length === 1 ? '' : 's'}</div>
        </div>
        <div className="stat">
          <div className="n">{turnout?.eligible ?? '—'}</div>
          <div className="muted small">on the register</div>
        </div>
        <div className="stat">
          <div className="n">{turnout?.voters ?? '—'}</div>
          <div className="muted small">have voted</div>
        </div>
        <div className="stat">
          <div className="n">{turnout ? `${pct(turnout.voters, turnout.eligible)}%` : '—'}</div>
          <div className="muted small">turnout</div>
        </div>
      </div>

      {turnout && e.state !== 'DRAFT' && (
        <div className="card">
          <div className="row between">
            <strong>Turnout</strong>
            <span className="muted small">
              {turnout.voters} of {turnout.eligible}
            </span>
          </div>
          <Meter value={turnout.voters} max={turnout.eligible} label="Turnout" />
          {e.state === 'OPEN' && <p className="muted small" style={{ marginTop: '.5rem' }}>Updates every few seconds. Only turnout is shown, never counts.</p>}
        </div>
      )}

      <div className="card">
        <h2>Schedule</h2>
        <p className="muted">
          Opens: {e.opensAt ? fmtDate(e.opensAt) : 'when an administrator opens it'}
          <br />
          Closes: {e.closesAt ? fmtDate(e.closesAt) : 'when an administrator closes it'}
        </p>
        {(e.opensAt || e.closesAt) && <p className="muted small">Scheduled times open and close the election automatically. Sealing the result always needs an administrator.</p>}
      </div>

      {e.state !== 'DRAFT' && (
        <div className="card">
          <h2>Voter link</h2>
          <p className="muted small">Share this with voters. They sign in with their matric number and a one-time code.</p>
          <p className="mono">{origin}/vote</p>
        </div>
      )}

      {!readOnly && (
        <div className="card">
          <h2>Actions</h2>
          {e.state === 'DRAFT' && (
            <>
              <ul className="small muted">
                <li>{e.positions.length} position(s) set up</li>
                <li>{turnout?.eligible ? `${turnout.eligible} voters on the register` : 'No voters yet. Add them in the Voters tab.'}</li>
              </ul>
              <Alert kind="info">Opening locks the ballot and the voter register. Check both first.</Alert>
              <div className="row">
                <ConfirmButton className="btn primary" confirmText="Open voting now?" disabled={!turnout?.eligible} onConfirm={() => act('open')}>
                  Open voting
                </ConfirmButton>
                <ConfirmButton className="btn danger" confirmText="Delete this draft for good?" onConfirm={remove}>
                  Delete draft
                </ConfirmButton>
              </div>
            </>
          )}
          {e.state === 'OPEN' && (
            <ConfirmButton className="btn primary" confirmText="Stop accepting votes now?" onConfirm={() => act('close')}>
              Close voting
            </ConfirmButton>
          )}
          {e.state === 'CLOSED' && (
            <>
              <p className="muted small">Sealing counts every ballot, publishes the result, and records its fingerprint in the audit log. It cannot be undone.</p>
              <ConfirmButton className="btn primary" confirmText="Count and publish the results?" onConfirm={() => act('seal')}>
                Seal and publish results
              </ConfirmButton>
            </>
          )}
          {e.state === 'SEALED' && (
            <p>
              Results are public at <Link href={`/results/${e.id}`}>/results/{e.id}</Link>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Voters({ id, state, onChanged }: { id: string; state: Election['state']; onChanged: () => void }) {
  const register = useLoad(() => api<RegisterRow[]>(`/elections/${id}/register`), [id]);
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<{ added: number; eligible: number; errors: Array<{ line: number; message: string }> } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const locked = state !== 'DRAFT';

  function onFile(ev: ChangeEvent<HTMLInputElement>) {
    const f = ev.target.files?.[0];
    if (!f) return;
    if (f.size > 5_000_000) return setError('That file is over 5 MB.');
    const r = new FileReader();
    r.onload = () => setCsv(String(r.result ?? ''));
    r.readAsText(f);
  }

  async function submit() {
    setError('');
    setResult(null);
    setBusy(true);
    try {
      setResult(await api(`/elections/${id}/voters`, { method: 'POST', body: { csv } }));
      setCsv('');
      await register.reload(true);
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => (register.data ?? []).filter((r) => !q || `${r.id} ${r.name}`.toLowerCase().includes(q.toLowerCase())), [register.data, q]);

  return (
    <div className="stack">
      {locked ? (
        <Alert kind="info">The register is locked because voting has opened.</Alert>
      ) : (
        <div className="card">
          <h2>Import voters</h2>
          <p className="muted small">
            One voter per line: <code>id, name, email, phone</code>. Every voter needs an email or a phone number, so a one-time code can reach them. Importing again adds to the register.
          </p>
          <div className="row noprint" style={{ marginBottom: '.75rem' }}>
            <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} aria-label="Choose a CSV file" />
            <button className="btn sm" onClick={() => download('voter-template.csv', TEMPLATE, 'text/csv')}>
              Download template
            </button>
          </div>
          <textarea value={csv} onChange={(ev) => setCsv(ev.target.value)} placeholder={TEMPLATE} aria-label="Voter CSV" spellCheck={false} />
          {error && <Alert kind="error">{error}</Alert>}
          {result && (
            <Alert kind={result.errors.length ? 'warn' : 'ok'}>
              Added {result.added} voter{result.added === 1 ? '' : 's'}. The register now has {result.eligible}.
              {result.errors.length > 0 && (
                <>
                  {' '}
                  {result.errors.length} row{result.errors.length === 1 ? ' was' : 's were'} skipped:
                  <ul>
                    {result.errors.slice(0, 20).map((er) => (
                      <li key={er.line}>
                        Line {er.line}: {er.message}
                      </li>
                    ))}
                  </ul>
                  {result.errors.length > 20 && <p>…and {result.errors.length - 20} more.</p>}
                </>
              )}
            </Alert>
          )}
          <button className="btn primary" disabled={busy || !csv.trim()} onClick={submit}>
            {busy ? 'Importing…' : 'Import voters'}
          </button>
        </div>
      )}

      <div className="card">
        <div className="row between">
          <h2>Register ({register.data?.length ?? 0})</h2>
          <input type="text" placeholder="Search by name or ID" value={q} onChange={(ev) => setQ(ev.target.value)} style={{ maxWidth: 240, margin: 0 }} aria-label="Search the register" />
        </div>
        {register.loading && !register.data && <Loading />}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Contact</th>
                <th>Voted</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td>
                  <td>{r.name}</td>
                  <td className="muted">{r.email ?? r.phone}</td>
                  <td>{r.hasVoted ? 'Yes' : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {register.data?.length ? 'No match.' : 'No voters yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 200 && <p className="muted small">Showing the first 200 of {rows.length}. Search to narrow down.</p>}
        <p className="muted small">Contacts are partly hidden. Whether someone voted is shown, never what they voted.</p>
      </div>
    </div>
  );
}

function BallotPreview({ e }: { e: Election }) {
  return (
    <div className="stack">
      {e.positions.map((p) => (
        <div key={p.id} className="card">
          <div className="row between">
            <h2>{e.titles[p.id]}</h2>
            <span className="muted small">
              {p.type.toLowerCase()}
              {p.type === 'MULTI' ? ` · ${p.seats} seats` : ''}
              {p.allowAbstain ? ' · abstain allowed' : ''}
            </span>
          </div>
          <ul>
            {p.candidateIds.map((cid) => (
              <li key={cid}>
                <strong>{e.candidates[cid]?.name}</strong>
                {e.candidates[cid]?.bio && <span className="muted"> — {e.candidates[cid].bio}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <p className="muted small">Voters see candidates in a random order each visit, except referendum options.</p>
    </div>
  );
}

function Audit({ e }: { e: Election }) {
  const audit = useLoad(() => api<{ entries: AuditEntry[]; intact: boolean }>(`/elections/${e.id}/audit`), [e.id, e.state], e.state === 'OPEN' ? 15000 : undefined);
  const [verify, setVerify] = useState<{ tallyMatches: boolean; hashMatches: boolean; auditIntact: boolean } | null>(null);
  const [verifyError, setVerifyError] = useState('');
  const [limit, setLimit] = useState(50);

  async function runVerify() {
    setVerifyError('');
    try {
      setVerify(await api(`/elections/${e.id}/verify`));
    } catch (err) {
      setVerifyError(errorText(err));
    }
  }

  const entries = audit.data?.entries ?? [];
  const shown = [...entries].reverse().slice(0, limit);
  const check = (ok: boolean, label: string) => (
    <li>
      <strong>{ok ? 'Passed' : 'FAILED'}</strong>: {label}
    </li>
  );

  return (
    <div className="stack">
      {audit.data && (audit.data.intact ? <Alert kind="ok">The audit log is intact: every entry links to the one before it.</Alert> : <Alert kind="error">The audit log has been altered. Treat this election as compromised.</Alert>)}

      <div className="card">
        <h2>Independent verification</h2>
        <p className="muted small">Recounts every ballot from storage and compares it with the published result, checks the result fingerprint, and re-walks the audit chain.</p>
        <button className="btn primary" disabled={e.state !== 'SEALED'} onClick={runVerify}>
          Run verification
        </button>
        {e.state !== 'SEALED' && <span className="muted small"> Available once results are sealed.</span>}
        {verifyError && <Alert kind="error">{verifyError}</Alert>}
        {verify && (
          <ul style={{ marginTop: '.75rem' }}>
            {check(verify.tallyMatches, 'recount matches the published result')}
            {check(verify.hashMatches, 'result fingerprint matches')}
            {check(verify.auditIntact, 'audit chain is unbroken')}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="row between">
          <h2>Audit log ({entries.length})</h2>
          <div className="row noprint">
            <button className="btn sm" onClick={() => download(`audit-${e.id}.json`, JSON.stringify(entries, null, 2), 'application/json')}>
              Export JSON
            </button>
          </div>
        </div>
        {audit.loading && !audit.data && <Loading />}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>When</th>
                <th>Event</th>
                <th>By</th>
                <th>Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.seq}>
                  <td>{r.seq}</td>
                  <td>{fmtDate(r.at)}</td>
                  <td>
                    {EVENT_LABEL[r.event] ?? r.event}
                    <details>
                      <summary className="small muted">details</summary>
                      <pre className="hash" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.payload, null, 2)}</pre>
                    </details>
                  </td>
                  <td className="mono">{r.actor.length > 12 ? `${r.actor.slice(0, 8)}…` : r.actor}</td>
                  <td className="hash">{r.hash.slice(0, 16)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {entries.length > limit && (
          <button className="btn sm" onClick={() => setLimit(limit + 200)}>
            Show more ({entries.length - limit} older)
          </button>
        )}
        <p className="muted small">The log records that ballots were accepted, never who cast them or what they chose.</p>
      </div>
    </div>
  );
}
