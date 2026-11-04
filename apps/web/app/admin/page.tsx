'use client';

import Link from 'next/link';
import { ElectionList } from '@/components/ElectionList';
import { Alert } from '@/components/ui';

export default function AdminHome() {
  return (
    <div>
      <div className="row between">
        <h1>Elections</h1>
        <Link href="/admin/elections/new" className="btn primary">
          New election
        </Link>
      </div>
      <ElectionList
        base="/admin/elections"
        empty={
          <Alert>
            No elections yet. <Link href="/admin/elections/new">Create the first one</Link>.
          </Alert>
        }
      />
    </div>
  );
}
