'use client';

import { download, pct, resultsCsv } from '@/lib/format';
import type { Candidate, Position, Sealed, Turnout } from '@/lib/types';
import { Alert } from './ui';

interface Props {
  title: string;
  positions: Position[];
  titles: Record<string, string>;
  candidates: Record<string, Candidate>;
  sealed: Sealed;
  turnout?: Turnout;
}

const TYPE_NOTE: Record<string, string> = {
  SINGLE: 'one winner',
  MULTI: 'several seats',
  APPROVAL: 'approval voting',
  RANKED: 'ranked choice',
  REFERENDUM: 'referendum',
};

export function ResultsView({ title, positions, titles, candidates, sealed, turnout }: Props) {
  const name = (id: string) => candidates[id]?.name ?? id;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'election';

  return (
    <div className="stack">
      {turnout && (
        <div className="grid cols-4">
          <div className="stat">
            <div className="n">{turnout.voters}</div>
            <div className="muted small">voters took part</div>
          </div>
          <div className="stat">
            <div className="n">{turnout.eligible}</div>
            <div className="muted small">on the register</div>
          </div>
          <div className="stat">
            <div className="n">{pct(turnout.voters, turnout.eligible)}%</div>
            <div className="muted small">turnout</div>
          </div>
        </div>
      )}

      {positions.map((p) => {
        const r = sealed.results.find((x) => x.positionId === p.id);
        if (!r) return null;
        const first = r.rounds?.[0]?.counts ?? r.counts;
        const order = [...p.candidateIds].sort((a, b) => (first[b] ?? 0) - (first[a] ?? 0));
        const max = Math.max(1, ...order.map((id) => first[id] ?? 0));
        return (
          <section key={p.id} className="card" aria-labelledby={`pos-${p.id}`}>
            <div className="row between">
              <h2 id={`pos-${p.id}`}>{titles[p.id]}</h2>
              <span className="muted small">
                {TYPE_NOTE[p.type]} · {r.totalBallots} ballot{r.totalBallots === 1 ? '' : 's'}
              </span>
            </div>
            {r.tiedAtCutoff && (
              <Alert kind="warn">
                <strong>Tie at the cut-off.</strong> The last seat is tied. The names marked below are only a stable placeholder: the electoral committee must decide how to settle it.
              </Alert>
            )}
            {order.map((id) => {
              const votes = first[id] ?? 0;
              const win = r.winners.includes(id);
              return (
                <div key={id} className="bar-row">
                  <div>
                    {name(id)}
                    {win && <span className="winner-tag">{p.type === 'REFERENDUM' ? 'CARRIED' : r.tiedAtCutoff ? 'TIED' : 'ELECTED'}</span>}
                  </div>
                  <div className={`bar ${win ? 'win' : ''}`} aria-hidden="true">
                    <div style={{ width: `${(votes / max) * 100}%` }} />
                  </div>
                  <div className="small right">
                    {votes} · {pct(votes, r.totalBallots)}%
                  </div>
                </div>
              );
            })}
            {r.abstentions > 0 && <p className="muted small">{r.abstentions} abstained.</p>}
            {r.rounds && r.rounds.length > 1 && (
              <details>
                <summary>How the ranked count was decided ({r.rounds.length} rounds)</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Round</th>
                        <th>Counts</th>
                        <th>Eliminated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.rounds.map((rd) => (
                        <tr key={rd.round}>
                          <td>{rd.round}</td>
                          <td>{Object.entries(rd.counts).map(([id, n]) => `${name(id)}: ${n}`).join(' · ')}</td>
                          <td>{rd.eliminated ? name(rd.eliminated) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </section>
        );
      })}

      <section className="card">
        <h2>Verify this result</h2>
        <p className="muted small">
          Anyone can check that these figures were not changed. The result hash is a fingerprint of the full count; the audit head ties it to the election&apos;s tamper-evident log.
        </p>
        <p className="small">Result hash</p>
        <p className="hash">{sealed.resultHash}</p>
        <p className="small">Audit log head at sealing</p>
        <p className="hash">{sealed.auditHead}</p>
        <div className="row noprint">
          <button className="btn sm" onClick={() => download(`${slug}-results.csv`, resultsCsv({ positions, titles, candidates, sealed }), 'text/csv')}>
            Download CSV
          </button>
          <button className="btn sm" onClick={() => download(`${slug}-results.json`, JSON.stringify({ title, sealed }, null, 2), 'application/json')}>
            Download JSON
          </button>
          <button className="btn sm" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </section>
    </div>
  );
}
