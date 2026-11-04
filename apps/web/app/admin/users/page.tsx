'use client';

import { FormEvent, useState } from 'react';
import { Alert, Field, Loading } from '@/components/ui';
import { api, errorText } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { StaffUser } from '@/lib/types';

export default function Users() {
  const users = useLoad(() => api<StaffUser[]>('/users'));
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'OBSERVER' as 'OBSERVER' | 'ADMIN' });
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setOk('');
    setBusy(true);
    try {
      await api('/users', { method: 'POST', body: f });
      setOk(`Created ${f.email}. Share the password with them privately.`);
      setF({ name: '', email: '', password: '', role: 'OBSERVER' });
      await users.reload(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Staff accounts</h1>
      <form className="card" onSubmit={submit}>
        <h2>Add a staff member</h2>
        <Field label="Full name">
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label="Email">
          <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="off" />
        </Field>
        <Field label="Temporary password" hint="at least 10 characters">
          <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={10} autoComplete="new-password" />
        </Field>
        <Field label="Role">
          <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as 'OBSERVER' | 'ADMIN' })}>
            <option value="OBSERVER">Observer (read-only audit and verification)</option>
            <option value="ADMIN">Administrator (full control)</option>
          </select>
        </Field>
        {error && <Alert kind="error">{error}</Alert>}
        {ok && <Alert kind="ok">{ok}</Alert>}
        <button className="btn primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <div className="card">
        <h2>Accounts</h2>
        {users.loading && !users.data && <Loading />}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {users.data?.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role.toLowerCase()}</td>
                  <td>{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
