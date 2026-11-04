'use client';

import Link from 'next/link';
import { PublicShell } from '@/components/Shell';
import { Alert, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { Summary } from '@/lib/types';

export default function ResultsIndex() {
  const { data, error, loading } = useLoad(() => api<Summary[]>('/public/elections'));
  return (
    <PublicShell>
      <h1>Published results</h1>
      {loading && <Loading />}
      {error && <Alert kind="error">{error}</Alert>}
      {data?.length === 0 && <Alert>No results have been published yet.</Alert>}
      {data?.map((e) => (
        <Link key={e.id} href={`/results/${e.id}`} className="card link">
          <h2>{e.title}</h2>
          {e.description && <p className="muted">{e.description}</p>}
          <p className="small muted">{e.closesAt ? `Closed ${fmtDate(e.closesAt)}` : `${e.positionCount} position${e.positionCount === 1 ? '' : 's'}`}</p>
        </Link>
      ))}
    </PublicShell>
  );
}
