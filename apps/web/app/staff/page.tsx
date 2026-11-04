'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PublicShell } from '@/components/Shell';
import { Alert, Field } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import type { Me } from '@/lib/types';

export default function StaffSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Me>('/auth/me')
      .then((m) => {
        if (m.role === 'ADMIN') router.replace('/admin');
        else if (m.role === 'OBSERVER') router.replace('/observer');
      })
      .catch(() => {});
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<{ role: 'ADMIN' | 'OBSERVER' }>('/auth/staff/login', { method: 'POST', body: { email, password } });
      router.push(r.role === 'ADMIN' ? '/admin' : '/observer');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <div className="narrow">
        <h1>Staff sign in</h1>
        <form className="card" onSubmit={submit}>
          <Field label="Email">
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
          </Field>
          <Field label="Password">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </Field>
          {error && <Alert kind="error">{error}</Alert>}
          <button className="btn primary block" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="muted small">Administrators set up and run elections. Observers get read-only access to the audit trail and verification.</p>
      </div>
    </PublicShell>
  );
}
