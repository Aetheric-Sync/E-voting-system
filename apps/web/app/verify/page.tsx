'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PublicShell } from '@/components/Shell';
import { Alert, Field } from '@/components/ui';
import { api, errorText } from '@/lib/api';

type Result = { found: false } | { found: true; election: string; position: string; ballotHash: string; state: string };

function VerifyForm() {
  const qs = useSearchParams();
  const [electionId, setElectionId] = useState(qs.get('e') ?? '');
  const [code, setCode] = useState(qs.get('code') ?? '');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function check(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setResult(null);
    setBusy(true);
    try {
      setResult(await api<Result>(`/public/elections/${encodeURIComponent(electionId.trim())}/receipt/${encodeURIComponent(code.trim())}`));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (qs.get('e') && qs.get('code')) void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="narrow">
      <h1>Check a receipt</h1>
      <p className="muted">Confirm that a ballot receipt is in the ballot box. This shows which position it was for, never who you voted for.</p>
      <form className="card" onSubmit={check}>
        <Field label="Election ID" hint="from your voting link">
          <input type="text" value={electionId} onChange={(e) => setElectionId(e.target.value)} required maxLength={64} />
        </Field>
        <Field label="Receipt code" hint="16 letters and numbers">
          <input type="text" value={code} onChange={(e) => setCode(e.target.value)} required maxLength={40} autoComplete="off" spellCheck={false} />
        </Field>
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Checking…' : 'Check receipt'}
        </button>
      </form>
      {error && <Alert kind="error">{error}</Alert>}
      {result?.found === true && (
        <Alert kind="ok">
          <strong>Found.</strong> A ballot with this receipt is recorded for <strong>{result.position}</strong> in <strong>{result.election}</strong>.
          <div className="small" style={{ marginTop: '.4rem' }}>
            Ballot fingerprint: <span className="hash">{result.ballotHash}</span>
          </div>
        </Alert>
      )}
      {result?.found === false && <Alert kind="warn">No ballot matches that receipt for this election. Check the code and election ID for typos.</Alert>}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <PublicShell>
      <Suspense>
        <VerifyForm />
      </Suspense>
    </PublicShell>
  );
}
