'use client';

import { use } from 'react';
import { ElectionDetail } from '@/components/ElectionDetail';

export default function AdminElection({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ElectionDetail id={id} readOnly={false} backHref="/admin" />;
}
