'use client';

import { ElectionList } from '@/components/ElectionList';

export default function ObserverHome() {
  return (
    <div>
      <h1>Elections</h1>
      <p className="muted">Read-only access to turnout, the audit trail and verification. Observers never see counts before results are sealed.</p>
      <ElectionList base="/observer/elections" />
    </div>
  );
}
