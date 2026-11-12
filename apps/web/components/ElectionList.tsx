'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { fmtDate, STATE_LABEL } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { ElectionState, Summary } from '@/lib/types';
import { Alert, Loading, StateChip } from './ui';

type FilterState = 'ALL' | ElectionState;

const FILTER_OPTIONS: Array<{ key: FilterState; label: string }> = [
  { key: 'ALL', label: 'All states' },
  { key: 'DRAFT', label: 'Draft' },
  { key: 'OPEN', label: 'Open' },
  { key: 'CLOSED', label: 'Closed' },
  { key: 'SEALED', label: 'Sealed' },
];

export function ElectionList({ base, empty }: { base: string; empty?: React.ReactNode }) {
  const { data, error, loading } = useLoad(() => api<Summary[]>('/elections'), [], 20000);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterState>('ALL');

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((e) => {
      const matchesSearch = !search.trim() || e.title.toLowerCase().includes(search.trim().toLowerCase());
      const matchesFilter = filter === 'ALL' || e.state === filter;
      return matchesSearch && matchesFilter;
    });
  }, [data, search, filter]);

  return (
    <div className="stack">
      {loading && !data && <Loading />}
      {error && <Alert kind="error">{error}</Alert>}

      {data && data.length > 0 && (
        <div className="card" style={{ padding: '.8rem 1rem' }}>
          <div className="row between" style={{ gap: '.75rem' }}>
            <div style={{ flex: '1 1 240px' }}>
              <input
                type="search"
                placeholder="Search elections by title…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search elections by title"
                style={{ margin: 0 }}
              />
            </div>
            <div style={{ flex: '0 0 auto' }}>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as FilterState)}
                aria-label="Filter elections by state"
                style={{ margin: 0, minWidth: 140 }}
              >
                {FILTER_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {(search || filter !== 'ALL') && (
            <div className="row between small muted" style={{ marginTop: '.5rem' }}>
              <span>
                Found {filtered.length} of {data.length} election{data.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setSearch('');
                  setFilter('ALL');
                }}
              >
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}

      {data?.length === 0 && (empty ?? <Alert>No elections yet.</Alert>)}

      {data && data.length > 0 && filtered.length === 0 && (
        <Alert kind="info">
          No elections match your current search or filter criteria.{' '}
          <button
            type="button"
            className="btn sm"
            style={{ marginLeft: '.5rem' }}
            onClick={() => {
              setSearch('');
              setFilter('ALL');
            }}
          >
            Reset filter
          </button>
        </Alert>
      )}

      {filtered.map((e) => (
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
