'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Field } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { localToIso } from '@/lib/format';
import type { BallotType } from '@/lib/types';

interface Cand {
  key: number;
  name: string;
  bio: string;
}
interface Pos {
  key: number;
  title: string;
  type: BallotType;
  seats: number;
  allowAbstain: boolean;
  candidates: Cand[];
}

let counter = 1;
const cand = (): Cand => ({ key: counter++, name: '', bio: '' });
const pos = (): Pos => ({ key: counter++, title: '', type: 'SINGLE', seats: 1, allowAbstain: true, candidates: [cand(), cand()] });

const TYPES: Array<[BallotType, string, string]> = [
  ['SINGLE', 'Single choice', 'Pick one candidate. Most votes wins.'],
  ['MULTI', 'Several seats', 'Pick up to N candidates. The top N win.'],
  ['APPROVAL', 'Approval', 'Approve as many candidates as you like.'],
  ['RANKED', 'Ranked choice', 'Rank candidates. Instant runoff, one seat.'],
  ['REFERENDUM', 'Referendum', 'Options such as Yes / No.'],
];

export default function NewElection() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');
  const [positions, setPositions] = useState<Pos[]>([pos()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const setPos = (key: number, patch: Partial<Pos>) => setPositions((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const setCand = (pk: number, ck: number, patch: Partial<Cand>) =>
    setPositions((ps) => ps.map((p) => (p.key === pk ? { ...p, candidates: p.candidates.map((c) => (c.key === ck ? { ...c, ...patch } : c)) } : p)));

  function changeType(p: Pos, type: BallotType) {
    const patch: Partial<Pos> = { type };
    if (type === 'REFERENDUM') {
      patch.candidates = [
        { key: counter++, name: 'Yes', bio: '' },
        { key: counter++, name: 'No', bio: '' },
      ];
      patch.seats = 1;
    } else if (p.type === 'REFERENDUM') {
      patch.candidates = [cand(), cand()];
    }
    if (type !== 'MULTI') patch.seats = 1;
    else if (p.seats < 2) patch.seats = 2;
    setPos(p.key, patch);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (opens && closes && new Date(closes) <= new Date(opens)) return setError('The closing time must be after the opening time.');
    const body = {
      title: title.trim(),
      description: description.trim() || undefined,
      mode: 'ANONYMOUS_AUDIT',
      opensAt: localToIso(opens),
      closesAt: localToIso(closes),
      positions: positions.map((p) => ({
        title: p.title.trim(),
        type: p.type,
        seats: p.type === 'MULTI' ? p.seats : 1,
        allowAbstain: p.allowAbstain,
        candidates: p.candidates.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), bio: c.bio.trim() || undefined })),
      })),
    };
    setBusy(true);
    try {
      const created = await api<{ id: string }>('/elections', { method: 'POST', body });
      router.push(`/admin/elections/${created.id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h1>New election</h1>
      <p className="muted">It starts as a draft. You add voters next, then open it when you are ready.</p>

      <div className="card">
        <h2>Basics</h2>
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required placeholder="Students' Union Election 2026" />
        </Field>
        <Field label="Description" hint="optional">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} style={{ minHeight: 70 }} />
        </Field>
        <div className="grid cols-3">
          <Field label="Opens automatically" hint="optional">
            <input type="datetime-local" value={opens} onChange={(e) => setOpens(e.target.value)} />
          </Field>
          <Field label="Closes automatically" hint="optional">
            <input type="datetime-local" value={closes} onChange={(e) => setCloses(e.target.value)} />
          </Field>
        </div>
        <p className="muted small">Times use this device's time zone. Leave both empty to open and close by hand.</p>
      </div>

      {positions.map((p, i) => (
        <fieldset key={p.key} className="card">
          <legend className="small muted">Position {i + 1}</legend>
          <div className="row between">
            <h2>{p.title || `Position ${i + 1}`}</h2>
            {positions.length > 1 && (
              <button type="button" className="btn sm" onClick={() => setPositions(positions.filter((x) => x.key !== p.key))}>
                Remove position
              </button>
            )}
          </div>
          <Field label="Position title">
            <input value={p.title} onChange={(e) => setPos(p.key, { title: e.target.value })} maxLength={120} required placeholder="President" />
          </Field>
          <div className="grid cols-3">
            <Field label="Voting method">
              <select value={p.type} onChange={(e) => changeType(p, e.target.value as BallotType)}>
                {TYPES.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {p.type === 'MULTI' && (
              <Field label="Seats">
                <input type="number" min={2} max={Math.max(2, p.candidates.length)} value={p.seats} onChange={(e) => setPos(p.key, { seats: Number(e.target.value) })} />
              </Field>
            )}
          </div>
          <p className="muted small">{TYPES.find(([v]) => v === p.type)?.[2]}</p>
          <label className="row" style={{ marginBottom: '.75rem' }}>
            <input type="checkbox" checked={p.allowAbstain} onChange={(e) => setPos(p.key, { allowAbstain: e.target.checked })} />
            Voters can abstain
          </label>

          <h3>{p.type === 'REFERENDUM' ? 'Options' : 'Candidates'}</h3>
          {p.candidates.map((c, ci) => (
            <div key={c.key} className="row" style={{ alignItems: 'flex-start', marginBottom: '.5rem' }}>
              <input
                style={{ flex: '1 1 160px', margin: 0 }}
                placeholder={p.type === 'REFERENDUM' ? 'Option' : `Candidate ${ci + 1} name`}
                aria-label={`Name ${ci + 1}`}
                value={c.name}
                maxLength={80}
                onChange={(e) => setCand(p.key, c.key, { name: e.target.value })}
              />
              <input
                style={{ flex: '2 1 220px', margin: 0 }}
                placeholder="Short bio (optional)"
                aria-label={`Bio ${ci + 1}`}
                value={c.bio}
                maxLength={300}
                onChange={(e) => setCand(p.key, c.key, { bio: e.target.value })}
              />
              {p.candidates.length > 2 && (
                <button type="button" className="btn sm" aria-label={`Remove candidate ${ci + 1}`} onClick={() => setPos(p.key, { candidates: p.candidates.filter((x) => x.key !== c.key) })}>
                  ✕
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn sm" onClick={() => setPos(p.key, { candidates: [...p.candidates, cand()] })}>
            + Add {p.type === 'REFERENDUM' ? 'option' : 'candidate'}
          </button>
        </fieldset>
      ))}

      <button type="button" className="btn" onClick={() => setPositions([...positions, pos()])}>
        + Add another position
      </button>

      {error && <Alert kind="error">{error}</Alert>}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create draft election'}
        </button>
      </div>
    </form>
  );
}
