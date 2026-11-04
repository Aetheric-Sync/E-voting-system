import type { ElectionState, Sealed, Election, PublicResults } from './types';

export const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const STATE_LABEL: Record<ElectionState, string> = {
  DRAFT: 'Draft',
  OPEN: 'Voting open',
  CLOSED: 'Closed, awaiting results',
  SEALED: 'Results published',
};

export const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

/** datetime-local value (browser local time) -> ISO string, or undefined when empty. */
export const localToIso = (v: string) => (v ? new Date(v).toISOString() : undefined);

export function download(filename: string, text: string, mime = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

type ResultSource = Pick<Election | PublicResults, 'titles' | 'candidates' | 'positions'> & { sealed: Sealed };

export function resultsCsv(src: ResultSource): string {
  const rows = [['position', 'candidate', 'votes', 'elected']];
  for (const p of src.positions) {
    const r = src.sealed.results.find((x) => x.positionId === p.id);
    if (!r) continue;
    for (const id of p.candidateIds) {
      rows.push([src.titles[p.id], src.candidates[id]?.name ?? id, String(r.counts[id] ?? 0), r.winners.includes(id) ? 'yes' : 'no'].map(String));
    }
    rows.push([src.titles[p.id], '(abstained)', String(r.abstentions), ''].map(String));
  }
  rows.push(['result hash', src.sealed.resultHash, '', '']);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
