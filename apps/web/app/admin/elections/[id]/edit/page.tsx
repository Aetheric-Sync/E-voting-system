'use client';

import { use } from 'react';
import Link from 'next/link';
import { ElectionForm } from '@/components/ElectionForm';
import { Alert, Loading } from '@/components/ui';
import { api } from '@/lib/api';
import { useLoad } from '@/lib/hooks';
import type { Election } from '@/lib/types';

export default function EditElectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading } = useLoad(() => api<Election>(`/elections/${id}`), [id]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <Alert kind="error">{error}</Alert>;
  if (!data) return null;

  if (data.state !== 'DRAFT') {
    return (
      <div className="stack">
        <p className="small">
          <Link href={`/admin/elections/${id}`}>← Back to election</Link>
        </p>
        <Alert kind="warn">
          Only draft elections can be edited. Voting has already opened or closed for this election.
        </Alert>
      </div>
    );
  }

  return <ElectionForm initial={data} />;
}

