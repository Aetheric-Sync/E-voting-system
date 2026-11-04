/** Fixed-window limiter. In-process; move to Redis before running more than one API instance. */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  /** Returns true when the call is allowed. */
  allow(key: string, limit: number, windowSeconds: number, now = Date.now()): boolean {
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      if (this.hits.size > 50_000) this.prune(now);
      return true;
    }
    cur.count++;
    return cur.count <= limit;
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}
