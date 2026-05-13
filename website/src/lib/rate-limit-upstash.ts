import type { RateLimiter, RateLimiterCheck } from '@/lib/rate-limit';

// Upstash Redis REST-based rate limiter. Safe across multiple instances
// (Vercel functions, multi-region). Uses a pipeline of 3 commands:
//   INCR key            — atomic counter for this window
//   PEXPIRE key ms NX   — set TTL only on first hit (NX = no-overwrite)
//   PTTL key            — read remaining ms for retry-after when over limit
//
// Env required:
//   UPSTASH_REDIS_REST_URL    e.g. https://us1-foo-12345.upstash.io
//   UPSTASH_REDIS_REST_TOKEN  bearer token
//
// Activate by setting RATE_LIMITER=redis. Without env, getRateLimiter()
// falls back to in-memory.

type PipelineEntry = { result?: number | string | null; error?: string };

export class UpstashRateLimiter implements RateLimiter {
  private url: string;
  private token: string;
  private prefix: string;

  constructor(url: string, token: string, prefix = 'wv:rl:') {
    this.url = url.replace(/\/+$/, '');
    this.token = token;
    this.prefix = prefix;
  }

  async check(key: string, max: number, windowMs: number): Promise<RateLimiterCheck> {
    const k = this.prefix + key;
    try {
      const res = await fetch(`${this.url}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', k],
          ['PEXPIRE', k, String(windowMs), 'NX'],
          ['PTTL', k],
        ]),
        // Don't let a slow Redis stall a request indefinitely.
        signal: AbortSignal.timeout(2000),
      });

      if (!res.ok) {
        // Fail open — better to let traffic through than to wedge auth flows
        // when Redis is down. Log and approve.
        console.warn(`[rate-limit upstash] HTTP ${res.status}; failing open`);
        return { ok: true, remaining: max - 1, retryAfterSec: 0 };
      }

      const json = (await res.json()) as PipelineEntry[];
      const incr = json[0]?.result;
      const pttl = json[2]?.result;
      const count = typeof incr === 'number' ? incr : Number(incr ?? 0);

      if (count > max) {
        const ttlMs = typeof pttl === 'number' ? pttl : Number(pttl ?? windowMs);
        const retryAfterSec = Math.max(1, Math.ceil(ttlMs / 1000));
        return { ok: false, remaining: 0, retryAfterSec };
      }
      return { ok: true, remaining: Math.max(0, max - count), retryAfterSec: 0 };
    } catch (e) {
      // Network/timeout — fail open, same reasoning as above.
      console.warn(`[rate-limit upstash] ${e instanceof Error ? e.message : String(e)}; failing open`);
      return { ok: true, remaining: max - 1, retryAfterSec: 0 };
    }
  }
}

export function tryCreateUpstashLimiter(): UpstashRateLimiter | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new UpstashRateLimiter(url, token);
}
