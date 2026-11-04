'use client';

import Link from 'next/link';
import { use } from 'react';
import { ResultsView } from '@/components/ResultsView';
import { PublicShell } from '@/components/Shell';
import { Alert, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import type { PublicResults } from '@/lib/types';

export default function PublicResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading } = useLoad(() => api<PublicResults>(`/public/elections/${encodeURIComponent(id)}/results`), [id]);
  return (
    <PublicShell>
      <p className="small">
        <Link href="/results">← All results</Link>
      </p>
      {loading && <Loading />}
      {error && <Alert kind="warn">Results for this election are not published (yet). {error}</Alert>}
      {data && (
        <>
          <h1>{data.title}</h1>
          {data.description && <p className="muted">{data.description}</p>}
          <ResultsView title={data.title} positions={data.positions} titles={data.titles} candidates={data.candidates} sealed={data.sealed} turnout={data.turnout} />
        </>
      )}
    </PublicShell>
  );
}
