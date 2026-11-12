import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type Redis from 'ioredis';

export interface RateLimitStore {
  /** Returns true if call is allowed under limit and window; false if exceeded. */
  allow(key: string, limit: number, windowSeconds: number, now?: number): Promise<boolean> | boolean;

  /** Check if an idempotency key was previously seen and recorded. */
  hasSeenIdempotency(key: string, now?: number): Promise<boolean> | boolean;

  /** Record an idempotency key with TTL. */
  markIdempotency(key: string, ttlSeconds?: number, now?: number): Promise<void> | void;

  /** Optional cleanup on shutdown. */
  close?(): Promise<void>;
}

export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

export class InMemoryRateLimitStore implements RateLimitStore {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private idempotency = new Map<string, number>();

  allow(key: string, limit: number, windowSeconds: number, now = Date.now()): boolean {
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      if (this.hits.size > 50_000) this.pruneHits(now);
      return true;
    }
    cur.count++;
    return cur.count <= limit;
  }

  hasSeenIdempotency(key: string, now = Date.now()): boolean {
    const exp = this.idempotency.get(key);
    if (!exp) return false;
    if (exp <= now) {
      this.idempotency.delete(key);
      return false;
    }
    return true;
  }

  markIdempotency(key: string, ttlSeconds = 86400, now = Date.now()): void {
    this.idempotency.set(key, now + ttlSeconds * 1000);
    if (this.idempotency.size > 50_000) {
      for (const [k, v] of this.idempotency) if (v <= now) this.idempotency.delete(k);
    }
  }

  private pruneHits(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }

  async close(): Promise<void> {
    this.hits.clear();
    this.idempotency.clear();
  }
}

const LUA_RATE_LIMIT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])

local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, window)
else
  local ttl = redis.call('TTL', key)
  if ttl == -1 then
    redis.call('EXPIRE', key, window)
  end
end

if current <= limit then
  return 1
else
  return 0
end
`;

export class RedisRateLimitStore implements RateLimitStore {
  private readonly redis: Redis;
  private readonly ownsClient: boolean;
  private readonly log = new Logger('RedisRateLimit');

  constructor(redisOrUrl: string | Redis) {
    if (typeof redisOrUrl === 'string') {
      const RedisClient = require('ioredis');
      this.redis = new RedisClient(redisOrUrl, {
        lazyConnect: false,
        maxRetriesPerRequest: 3,
        retryStrategy(times: number) {
          return Math.min(times * 100, 3000);
        },
      });
      this.ownsClient = true;
      this.redis.on('error', (err: Error) => {
        this.log.error(`Redis connection error: ${err.message}`);
      });
    } else {
      this.redis = redisOrUrl;
      this.ownsClient = false;
    }
  }

  async allow(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const res = await this.redis.eval(LUA_RATE_LIMIT, 1, `ratelimit:${key}`, limit, windowSeconds);
    return res === 1;
  }

  async hasSeenIdempotency(key: string): Promise<boolean> {
    const res = await this.redis.exists(`idemp:${key}`);
    return res === 1;
  }

  async markIdempotency(key: string, ttlSeconds = 86400): Promise<void> {
    await this.redis.set(`idemp:${key}`, '1', 'EX', ttlSeconds);
  }

  async close(): Promise<void> {
    if (this.ownsClient) {
      await this.redis.quit();
    }
  }
}

@Injectable()
export class RateLimiter {
  private readonly store: RateLimitStore;

  constructor(@Optional() @Inject(RATE_LIMIT_STORE) store?: RateLimitStore) {
    if (process.env.NO_RATE_LIMIT === 'true' && process.env.NODE_ENV === 'production') {
      throw new Error('NO_RATE_LIMIT must not be enabled in production');
    }
    this.store = store ?? new InMemoryRateLimitStore();
  }

  allow(key: string, limit: number, windowSeconds: number, now = Date.now()): boolean | Promise<boolean> {
    if (process.env.NO_RATE_LIMIT === 'true') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('NO_RATE_LIMIT must not be enabled in production');
      }
      return true;
    }
    return this.store.allow(key, limit, windowSeconds, now);
  }
}
