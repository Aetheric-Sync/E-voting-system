'use client';

import Link from 'next/link';
import { use, useMemo, useRef, useState } from 'react';
import { Shell } from '@/components/Shell';
import { Alert, Loading, StateChip } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { Position, VoterBallot } from '@/lib/types';

const NAV = [
  { href: '/vote/elections', label: 'My elections' },
  { href: '/verify', label: 'Check a receipt' },
];

interface Pick {
  ids: string[];
  abstain: boolean;
}

const INSTRUCTION = (p: Position) => {
  switch (p.type) {
    case 'SINGLE':
    case 'REFERENDUM':
      return 'Choose one.';
    case 'MULTI':
      return `Choose up to ${p.seats}.`;
    case 'APPROVAL':
      return 'Choose every candidate you approve of.';
    case 'RANKED':
      return 'Tap candidates in order of preference (first tap is rank 1). Use ▲ and ▼ to reorder preferences.';
  }
};

const fmtReceipt = (c: string) => c.replace(/(.{4})(?=.)/g, '$1-');

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function BallotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: ballot, error, loading, reload } = useLoad(() => api<VoterBallot>(`/me/elections/${id}`), [id]);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [phase, setPhase] = useState<'select' | 'review' | 'done'>('select');
  const [receipts, setReceipts] = useState<Array<{ positionId: string; receiptCode: string }>>([]);
  const [submitError, setSubmitError] = useState('');
  const [limitMsg, setLimitMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const key = useRef(crypto.randomUUID());

  // Fair ordering: candidates are shuffled once per visit (referendum options keep their order).
  const order = useMemo(() => {
    const o: Record<string, string[]> = {};
    for (const p of ballot?.positions ?? []) {
      o[p.id] = p.type === 'REFERENDUM' ? p.candidateIds : shuffled(p.candidateIds);
    }
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballot?.id]);

  const pending = useMemo(
    () => (ballot ? ballot.positions.filter((p) => !ballot.votedPositionIds.includes(p.id)) : []),
    [ballot],
  );
  const chosen = pending.filter((p) => (picks[p.id]?.ids.length ?? 0) > 0 || picks[p.id]?.abstain);

  function setPick(p: Position, cid: string) {
    setLimitMsg('');
    const candName = ballot?.candidates[cid]?.name ?? 'Candidate';
    setPicks((prev) => {
      const cur = prev[p.id] ?? { ids: [], abstain: false };
      if (p.type === 'SINGLE' || p.type === 'REFERENDUM') {
        setLiveMessage(`Selected ${candName}`);
        return { ...prev, [p.id]: { ids: [cid], abstain: false } };
      }
      const has = cur.ids.includes(cid);
      if (has) {
        const nextIds = cur.ids.filter((x) => x !== cid);
        const countMsg = p.type === 'MULTI' ? `, ${nextIds.length} of ${p.seats} selected` : '';
        setLiveMessage(`Removed ${candName}${countMsg}`);
        return { ...prev, [p.id]: { ids: nextIds, abstain: false } };
      }
      if (p.type === 'MULTI' && cur.ids.length >= p.seats) {
        setLimitMsg(`You can choose at most ${p.seats} for this position. Untick one first.`);
        return prev;
      }
      const newIds = [...cur.ids, cid];
      if (p.type === 'RANKED') {
        setLiveMessage(`${candName} added at rank ${newIds.length}`);
      } else {
        const countMsg = p.type === 'MULTI' ? `, ${newIds.length} of ${p.seats} selected` : '';
        setLiveMessage(`Selected ${candName}${countMsg}`);
      }
      return { ...prev, [p.id]: { ids: newIds, abstain: false } };
    });
    key.current = crypto.randomUUID();
  }

  function moveRank(p: Position, cid: string, direction: -1 | 1) {
    const candName = ballot?.candidates[cid]?.name ?? 'Candidate';
    setPicks((prev) => {
      const cur = prev[p.id] ?? { ids: [], abstain: false };
      const idx = cur.ids.indexOf(cid);
      if (idx < 0) return prev;
      const targetIdx = idx + direction;
      if (targetIdx < 0 || targetIdx >= cur.ids.length) return prev;
      const newIds = [...cur.ids];
      const [removed] = newIds.splice(idx, 1);
      newIds.splice(targetIdx, 0, removed);
      setLiveMessage(`${candName} moved to rank ${targetIdx + 1}`);
      return { ...prev, [p.id]: { ids: newIds, abstain: false } };
    });
    key.current = crypto.randomUUID();
  }

  function setAbstain(p: Position) {
    setPicks((prev) => {
      const nextAbstain = !prev[p.id]?.abstain;
      setLiveMessage(nextAbstain ? `Abstained on ${ballot?.titles[p.id] ?? 'position'}` : 'Cleared abstention');
      return { ...prev, [p.id]: { ids: [], abstain: nextAbstain } };
    });
    key.current = crypto.randomUUID();
  }

  async function submit() {
    setSubmitError('');
    setSubmitting(true);
    try {
      const selections = chosen.map((p) => ({
        positionId: p.id,
        candidateIds: picks[p.id].abstain ? [] : picks[p.id].ids,
        abstain: picks[p.id].abstain,
      }));
      const r = await api<{ receipts?: Array<{ positionId: string; receiptCode: string }>; alreadyRecorded?: true }>(
        `/elections/${id}/cast`,
        {
          method: 'POST',
          body: { selections },
          headers: { 'idempotency-key': key.current },
        },
      );
      if (r.alreadyRecorded) {
        setSubmitError(
          'Your ballot was already recorded on an earlier attempt. For privacy the receipt is only shown once. Check "My elections" to confirm.',
        );
        return;
      }
      setReceipts(r.receipts ?? []);
      setPhase('done');
      void reload(true);
    } catch (e) {
      setSubmitError(errorText(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell allow={['VOTER']} login="/vote" nav={NAV}>
      <div className="mid">
        {/* Screen reader live region */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {liveMessage}
        </div>

        {loading && !ballot && <Loading />}
        {error && <Alert kind="error">{error}</Alert>}
        {ballot && (
          <>
            <div className="row between">
              <h1>{ballot.title}</h1>
              <StateChip state={ballot.state} />
            </div>
            {ballot.description && <p className="muted">{ballot.description}</p>}

            {ballot.state !== 'OPEN' && (
              <Alert kind="warn">
                {ballot.state === 'DRAFT' ? 'This election has not started.' : 'Voting is closed for this election.'}{' '}
                {ballot.state === 'SEALED' && <Link href={`/results/${ballot.id}`}>See the results</Link>}
              </Alert>
            )}
            {ballot.state === 'OPEN' && ballot.closesAt && (
              <p className="small muted">Voting closes {fmtDate(ballot.closesAt)}.</p>
            )}

            {phase === 'done' && (
              <div className="card">
                <h2>Your vote is recorded</h2>
                <Alert kind="warn">
                  <strong>Save your receipt codes now.</strong> They are shown once and are not stored next to your
                  name, so nobody, including us, can look them up for you later.
                </Alert>
                {receipts.map((r) => (
                  <div key={r.positionId} className="stack" style={{ marginBottom: '1rem' }}>
                    <div className="small muted">{ballot.titles[r.positionId]}</div>
                    <div className="receipt">{fmtReceipt(r.receiptCode)}</div>{' '}
                    <Link className="small" href={`/verify?e=${ballot.id}&code=${r.receiptCode}`}>
                      Check receipt
                    </Link>
                  </div>
                ))}
                <p className="small muted">
                  A receipt proves your ballot is in the ballot box and was counted. It does not show who you voted
                  for, so it cannot be used to prove your choice to anyone else.
                </p>
                <div className="row noprint" style={{ marginTop: '1rem' }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      try {
                        const txt = receipts
                          .map((r) => `${ballot.titles[r.positionId]}: ${fmtReceipt(r.receiptCode)}`)
                          .join('\n');
                        if (navigator.clipboard?.writeText) {
                          await navigator.clipboard.writeText(txt);
                        }
                      } catch {
                        // ignore clipboard errors
                      }
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2500);
                    }}
                    aria-live="polite"
                  >
                    {copied ? '✓ Copied!' : 'Copy codes'}
                  </button>
                  <button type="button" className="btn" onClick={() => window.print()}>
                    Print
                  </button>
                  <Link className="btn primary" href="/vote/elections">
                    Done
                  </Link>
                </div>
              </div>
            )}

            {ballot.state === 'OPEN' && phase !== 'done' && (
              <>
                {ballot.votedPositionIds.length > 0 && (
                  <Alert kind="ok">
                    You have already voted on:{' '}
                    {ballot.positions
                      .filter((p) => ballot.votedPositionIds.includes(p.id))
                      .map((p) => ballot.titles[p.id])
                      .join(', ')}
                    .
                  </Alert>
                )}
                {pending.length === 0 && <Alert kind="ok">You have voted on every position. Thank you.</Alert>}

                {phase === 'select' &&
                  pending.map((p) => {
                    const pick = picks[p.id] ?? { ids: [], abstain: false };
                    return (
                      <fieldset key={p.id} className="card" style={{ margin: '0 0 1rem' }}>
                        <legend className="sr-only">{ballot.titles[p.id]}</legend>
                        <div className="row between center">
                          <h2>{ballot.titles[p.id]}</h2>
                          {p.type === 'MULTI' && (
                            <span className="chip sm" aria-live="polite">
                              {pick.ids.length} of {p.seats} selected
                            </span>
                          )}
                        </div>
                        <p className="muted small">{INSTRUCTION(p)}</p>
                        {order[p.id]?.map((cid) => {
                          const idx = pick.ids.indexOf(cid);
                          const on = idx >= 0;
                          const c = ballot.candidates[cid];
                          return (
                            <div key={cid} className={`option ${on ? 'on' : ''}`}>
                              {p.type === 'RANKED' ? (
                                <>
                                  <label
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '.75rem',
                                      cursor: 'pointer',
                                      flex: '1 1 auto',
                                      minHeight: 44,
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      className="sr-only"
                                      checked={on}
                                      onChange={() => setPick(p, cid)}
                                      aria-label={`${c?.name}${on ? ` (ranked ${idx + 1})` : ''}`}
                                    />
                                    <span className={`rank ${on ? '' : 'empty'}`} aria-hidden="true">
                                      {on ? idx + 1 : ''}
                                    </span>
                                    <span>
                                      <strong>{c?.name}</strong>
                                      {on && <span className="sr-only"> ranked {idx + 1}</span>}
                                      {c?.bio && <div className="bio">{c.bio}</div>}
                                    </span>
                                  </label>

                                  {on && (
                                    <div
                                      className="rank-controls"
                                      role="group"
                                      aria-label={`Ranking controls for ${c?.name}`}
                                    >
                                      <button
                                        type="button"
                                        className="rank-btn"
                                        disabled={idx === 0}
                                        onClick={() => moveRank(p, cid, -1)}
                                        aria-label={`Move ${c?.name} up in rank (currently rank ${idx + 1})`}
                                      >
                                        ▲
                                      </button>
                                      <button
                                        type="button"
                                        className="rank-btn"
                                        disabled={idx === pick.ids.length - 1}
                                        onClick={() => moveRank(p, cid, 1)}
                                        aria-label={`Move ${c?.name} down in rank (currently rank ${idx + 1})`}
                                      >
                                        ▼
                                      </button>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <label
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '.75rem',
                                    cursor: 'pointer',
                                    width: '100%',
                                    minHeight: 44,
                                  }}
                                >
                                  <input
                                    type={p.type === 'SINGLE' || p.type === 'REFERENDUM' ? 'radio' : 'checkbox'}
                                    name={p.id}
                                    checked={on}
                                    onChange={() => setPick(p, cid)}
                                    aria-label={c?.name}
                                  />
                                  <span>
                                    <strong>{c?.name}</strong>
                                    {c?.bio && <div className="bio">{c.bio}</div>}
                                  </span>
                                </label>
                              )}
                            </div>
                          );
                        })}
                        {p.allowAbstain && (
                          <div className={`option ${pick.abstain ? 'on' : ''}`}>
                            <label
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '.75rem',
                                cursor: 'pointer',
                                width: '100%',
                                minHeight: 44,
                              }}
                            >
                              <input
                                type={p.type === 'SINGLE' || p.type === 'REFERENDUM' ? 'radio' : 'checkbox'}
                                name={p.id}
                                checked={pick.abstain}
                                onChange={() => setAbstain(p)}
                                aria-label="Abstain"
                              />
                              <span>
                                <strong>Abstain</strong>
                                <div className="bio">Count me as taking part, but not choosing anyone.</div>
                              </span>
                            </label>
                          </div>
                        )}
                      </fieldset>
                    );
                  })}

                {phase === 'select' && limitMsg && <Alert kind="warn">{limitMsg}</Alert>}
                {phase === 'select' && pending.length > 0 && (
                  <div className="row between" style={{ alignItems: 'center' }}>
                    <span className="muted small" aria-live="polite">
                      {chosen.length} of {pending.length} position{pending.length === 1 ? '' : 's'} chosen
                    </span>
                    <button
                      className="btn primary"
                      disabled={chosen.length === 0}
                      onClick={() => setPhase('review')}
                    >
                      Review my ballot
                    </button>
                  </div>
                )}

                {phase === 'review' && (
                  <div className="card">
                    <h2>Check your ballot</h2>
                    <p className="muted small">Once you submit, your vote cannot be changed.</p>
                    {pending.map((p) => {
                      const pick = picks[p.id];
                      const picked = pick?.abstain
                        ? 'Abstain'
                        : pick?.ids
                            .map((cid, i) => `${p.type === 'RANKED' ? `${i + 1}. ` : ''}${ballot.candidates[cid]?.name}`)
                            .join(p.type === 'RANKED' ? ' → ' : ', ');
                      return (
                        <div key={p.id} style={{ marginBottom: '.75rem' }}>
                          <div className="small muted">{ballot.titles[p.id]}</div>
                          {picked ? (
                            <strong>{picked}</strong>
                          ) : (
                            <span className="muted">
                              No selection: skipped. You can vote on it later while voting is open.
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {submitError && <Alert kind="error">{submitError}</Alert>}
                    <div className="row">
                      <button
                        className="btn"
                        disabled={submitting}
                        onClick={() => {
                          setPhase('select');
                          setSubmitError('');
                        }}
                      >
                        Go back
                      </button>
                      <button
                        className="btn primary"
                        disabled={submitting || chosen.length === 0}
                        onClick={submit}
                      >
                        {submitting ? 'Submitting…' : 'Submit my vote'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
