export interface IrvRound {
  round: number;
  counts: Record<string, number>;
  eliminated?: string;
}

export interface IrvResult {
  winner: string | null;
  rounds: IrvRound[];
  exhausted: number;
}

/**
 * Instant-runoff for a single seat. Ties for elimination break by fewest
 * first-preference votes, then lexicographically, so the result is deterministic
 * and reproducible by any observer.
 */
export function instantRunoff(candidateIds: string[], rankings: string[][]): IrvResult {
  const remaining = new Set(candidateIds);
  const firstPrefs: Record<string, number> = Object.fromEntries(candidateIds.map((c) => [c, 0]));
  for (const r of rankings) {
    const first = r.find((c) => remaining.has(c));
    if (first) firstPrefs[first]++;
  }

  const rounds: IrvRound[] = [];
  let exhausted = 0;
  let round = 1;

  while (remaining.size > 0) {
    const counts: Record<string, number> = Object.fromEntries([...remaining].map((c) => [c, 0]));
    exhausted = 0;
    for (const r of rankings) {
      const pick = r.find((c) => remaining.has(c));
      if (pick) counts[pick]++;
      else exhausted++;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);

    const leader = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (leader && (leader[1] * 2 > total || remaining.size === 1)) {
      rounds.push({ round, counts });
      return { winner: total === 0 ? null : leader[0], rounds, exhausted };
    }

    const loser = Object.entries(counts).sort(
      (a, b) => a[1] - b[1] || firstPrefs[a[0]] - firstPrefs[b[0]] || a[0].localeCompare(b[0]),
    )[0][0];
    rounds.push({ round, counts, eliminated: loser });
    remaining.delete(loser);
    round++;
  }
  return { winner: null, rounds, exhausted };
}
