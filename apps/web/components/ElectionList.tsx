'use client';

import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { Summary } from '@/lib/types';
import { Alert, Loading, StateChip } from './ui';

export function ElectionList({ base, empty }: { base: string; empty?: React.ReactNode }) {
  const { data, error, loading } = useLoad(() => api<Summary[]>('/elections'), [], 20000);
  return (
    <div>
      {loading && !data && <Loading />}
      {error && <Alert kind="error">{error}</Alert>}
      {data?.length === 0 && (empty ?? <Alert>No elections yet.</Alert>)}
      {data?.map((e) => (
        <Link key={e.id} href={`${base}/${e.id}`} className="card link">
          <div className="row between">
            <h2>{e.title}</h2>
            <StateChip state={e.state} />
          </div>
          {e.description && <p className="muted">{e.description}</p>}
          <p className="small muted">
            {e.positionCount} position{e.positionCount === 1 ? '' : 's'}
            {e.opensAt ? ` · opens ${fmtDate(e.opensAt)}` : ''}
          </p>
        </Link>
      ))}
    </div>
  );
}
