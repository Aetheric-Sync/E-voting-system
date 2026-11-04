'use client';

import { ReactNode, useState } from 'react';
import { STATE_LABEL } from '@/lib/format';
import type { ElectionState } from '@/lib/types';

export function StateChip({ state }: { state: ElectionState }) {
  return <span className={`chip ${state}`}>{STATE_LABEL[state]}</span>;
}

export function Alert({ kind = 'info', children }: { kind?: 'error' | 'ok' | 'warn' | 'info'; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted" role="status">
      {label}
    </p>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      {label}
      {hint && <span className="hint">{hint}</span>}
      {children}
    </label>
  );
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const p = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label} className="meter">
      <div style={{ width: `${p}%` }} />
    </div>
  );
}

/** Two-step button: first click asks, second click does it. Avoids blocking browser dialogs. */
export function ConfirmButton({
  children,
  confirmText,
  onConfirm,
  className = 'btn',
  disabled,
}: {
  children: ReactNode;
  confirmText: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  return (
    <span className="alert warn row" style={{ margin: 0, padding: '.5rem .75rem' }}>
      <span>{confirmText}</span>
      <button
        type="button"
        className="btn sm primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {busy ? 'Working…' : 'Yes, continue'}
      </button>
      <button type="button" className="btn sm" disabled={busy} onClick={() => setAsking(false)}>
        Cancel
      </button>
    </span>
  );
}
