'use client';

import Link from 'next/link';
import { Shell } from '@/components/Shell';
import { Alert, Loading, StateChip } from '@/components/ui';
import { api } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useLoad } from '@/lib/hooks';
import type { VoterElection } from '@/lib/types';

const NAV = [{ href: '/vote/elections', label: 'My elections' }, { href: '/verify', label: 'Check a receipt' }];

export default function MyElections() {
  const { data, error, loading } = useLoad(() => api<VoterElection[]>('/me/elections'), [], 20000);
  return (
    <Shell allow={['VOTER']} login="/vote" nav={NAV}>
      <div className="mid">
        <h1>Your elections</h1>
        {loading && !data && <Loading />}
        {error && <Alert kind="error">{error}</Alert>}
        {data?.length === 0 && <Alert>You are not on the register for any election that has opened yet. If you expected one, contact the electoral committee.</Alert>}
        {data?.map((e) => {
          const left = e.positionCount - e.votedPositionIds.length;
          return (
            <div key={e.id} className="card">
              <div className="row between">
                <h2>{e.title}</h2>
                <StateChip state={e.state} />
              </div>
              {e.description && <p className="muted">{e.description}</p>}
              <p className="small muted">
                {e.opensAt && <>Opens {fmtDate(e.opensAt)}. </>}
                {e.closesAt && <>Closes {fmtDate(e.closesAt)}.</>}
              </p>
              {e.state === 'OPEN' && left > 0 && (
                <Link className="btn primary" href={`/vote/elections/${e.id}`}>
                  {e.votedPositionIds.length ? `Vote on the remaining ${left}` : 'Vote now'}
                </Link>
              )}
              {e.state === 'OPEN' && left === 0 && <Alert kind="ok">Your vote is recorded. Thank you.</Alert>}
              {e.state === 'CLOSED' && <p className="muted">Voting has ended. Results will be published after the count is sealed.</p>}
              {e.state === 'SEALED' && (
                <Link className="btn" href={`/results/${e.id}`}>
                  See results
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </Shell>
  );
}
