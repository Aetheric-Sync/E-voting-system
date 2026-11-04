'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/Shell';
import { Alert, Field } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import type { Me } from '@/lib/types';

export default function VoterSignIn() {
  const router = useRouter();
  const [voterId, setVoterId] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'id' | 'code'>('id');
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  // Already signed in as a voter? Go straight to the elections.
  useEffect(() => {
    api<Me>('/auth/me').then((m) => m.role === 'VOTER' && router.replace('/vote/elections')).catch(() => {});
  }, [router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<{ sent: true; devCode?: string }>('/auth/voter/request-otp', { method: 'POST', body: { voterId } });
      setDevCode(r.devCode ?? '');
      setStep('code');
      setCooldown(30);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/auth/voter/verify-otp', { method: 'POST', body: { voterId, code } });
      router.push('/vote/elections');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <div className="narrow">
        <h1>Sign in to vote</h1>
        {step === 'id' ? (
          <form className="card" onSubmit={requestCode}>
            <Field label="Matric / voter number" hint="as on the register">
              <input type="text" value={voterId} onChange={(e) => setVoterId(e.target.value)} autoComplete="username" autoFocus required maxLength={80} />
            </Field>
            {error && <Alert kind="error">{error}</Alert>}
            <button className="btn primary block" disabled={busy || !voterId.trim()}>
              {busy ? 'Sending…' : 'Send me a code'}
            </button>
          </form>
        ) : (
          <form className="card" onSubmit={verify}>
            <p>
              If <strong>{voterId.trim()}</strong> is on a voter register, a 6-digit code was sent to the email or phone number held for it. It is valid for 10 minutes.
            </p>
            {devCode && <Alert kind="warn">Demo mode: your code is <strong className="mono">{devCode}</strong>. This banner never appears in a real deployment.</Alert>}
            <Field label="6-digit code">
              <input className="code-input" type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoComplete="one-time-code" autoFocus required />
            </Field>
            {error && <Alert kind="error">{error}</Alert>}
            <button className="btn primary block" disabled={busy || code.length !== 6}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
            <div className="row between" style={{ marginTop: '.75rem' }}>
              <button type="button" className="btn sm" onClick={() => { setStep('id'); setCode(''); setError(''); }}>
                Use a different number
              </button>
              <button type="button" className="btn sm" disabled={cooldown > 0 || busy} onClick={() => requestCode()}>
                {cooldown > 0 ? `Send again in ${cooldown}s` : 'Send again'}
              </button>
            </div>
          </form>
        )}
        <p className="muted small">Not on the register? Contact your department&apos;s electoral committee. We cannot tell you here whether an ID is registered.</p>
      </div>
    </PublicShell>
  );
}
