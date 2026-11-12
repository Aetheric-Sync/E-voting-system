'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
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

/** Accessible modal confirmation dialog: backdrop, focus trap, Escape to dismiss, focus returns to trigger, ARIA labelled. */
export function ConfirmButton({
  children,
  confirmText,
  description,
  onConfirm,
  className = 'btn',
  disabled,
}: {
  children: ReactNode;
  confirmText: string;
  description?: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  function close() {
    if (busy) return;
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    const timer = setTimeout(() => confirmBtnRef.current?.focus(), 50);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [open, busy]);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={className}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {children}
      </button>

      {open && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="modal-dialog stack"
          >
            <h2 id="confirm-dialog-title" style={{ margin: 0 }}>
              {confirmText}
            </h2>
            {description && <p className="muted small">{description}</p>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem', gap: '.5rem' }}>
              <button type="button" className="btn" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                ref={confirmBtnRef}
                type="button"
                className={className.includes('danger') ? 'btn danger' : 'btn primary'}
                disabled={busy}
                onClick={handleConfirm}
              >
                {busy ? 'Working…' : 'Yes, continue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
