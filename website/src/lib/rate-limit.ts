import { headers } from 'next/headers';
import { tryCreateUpstashLimiter } from '@/lib/rate-limit-upstash';

// ---------------------------------------------------------------------------
// RateLimiter interface — backend-agnostic so we can swap in Redis later.
// All implementations must be safe to call concurrently.
// ---------------------------------------------------------------------------
export type RateLimiterCheck =
  | { ok: true; remaining: number; retryAfterSec: 0 }
  | { ok: false; remaining: 0; retryAfterSec: number };

export interface RateLimiter {
  /**
   * Atomically increment the counter for `key` within a sliding-fixed window
   * of `windowMs`. Returns ok:false with the seconds-until-reset when the
   * counter would exceed `max`.
   */
  check(key: string, max: number, windowMs: number): Promise<RateLimiterCheck>;
}

// Backwards-compat alias used by callers.
export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
};

// ---------------------------------------------------------------------------
// In-memory implementation (single-instance only — fine for local dev and a
// single Vercel function instance, NOT safe across multiple instances).
// ---------------------------------------------------------------------------
type Bucket = { count: number; resetAt: number };

export class InMemoryRateLimiter implements RateLimiter {
  private store: Map<string, Bucket>;

  constructor(store?: Map<string, Bucket>) {
    // Stash on globalThis so HMR (Next dev) doesn't blow the buckets away
    // each request.
    const g = globalThis as { __wvRateLimitStore?: Map<string, Bucket> };
    this.store = store ?? g.__wvRateLimitStore ?? new Map();
    g.__wvRateLimitStore = this.store;
  }

  async check(key: string, max: number, windowMs: number): Promise<RateLimiterCheck> {
    const now = Date.now();
    const existing = this.store.get(key);
    if (!existing || existing.resetAt <= now) {
      this.store.set(key, { count: 1, resetAt: now + windowMs });
      return { ok: true, remaining: max - 1, retryAfterSec: 0 };
    }
    if (existing.count >= max) {
      return {
        ok: false,
        remaining: 0,
        retryAfterSec: Math.ceil((existing.resetAt - now) / 1000),
      };
    }
    existing.count++;
    return { ok: true, remaining: max - existing.count, retryAfterSec: 0 };
  }
}

// ---------------------------------------------------------------------------
// Factory. Reads env RATE_LIMITER (default "memory"). When we add Redis,
// just plug a new branch here — no caller changes needed.
// ---------------------------------------------------------------------------
let _instance: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (_instance) return _instance;
  const backend = (process.env.RATE_LIMITER ?? 'memory').toLowerCase();
  switch (backend) {
    case 'memory':
      _instance = new InMemoryRateLimiter();
      return _instance;
    case 'redis':
    case 'upstash': {
      const upstash = tryCreateUpstashLimiter();
      if (upstash) {
        _instance = upstash;
        return _instance;
      }
      console.warn('[rate-limit] RATE_LIMITER=redis but UPSTASH_REDIS_REST_URL/TOKEN missing; using memory.');
      _instance = new InMemoryRateLimiter();
      return _instance;
    }
    default:
      // Unknown backend → fall back to memory rather than crash the server.
      console.warn(`[rate-limit] Unknown RATE_LIMITER="${backend}"; falling back to memory.`);
      _instance = new InMemoryRateLimiter();
      return _instance;
  }
}

// Test hook — lets unit tests reset the singleton between cases.
export function __resetRateLimiterForTests(impl?: RateLimiter): void {
  _instance = impl ?? null;
}

// ---------------------------------------------------------------------------
// Public helpers (legacy signatures preserved — internal calls now route
// through getRateLimiter().check).
// ---------------------------------------------------------------------------

export async function getClientIp(): Promise<string> {
  const h = await headers();
  // Common CDN/proxy headers. Vercel sends x-forwarded-for.
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const realIp = h.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}

/**
 * Rate limit an auth attempt by IP + optional identifier (email).
 * Two buckets: per-IP (broad) and per-IP+identifier (targeted) — both must pass.
 */
export async function rateLimitAuth(
  action: 'login' | 'register' | 'change-password' | 'forgot',
  identifier?: string,
): Promise<RateLimitResult> {
  const ip = await getClientIp();
  const windowMs = 15 * 60 * 1000;
  // 'login' is the most common legitimate retry pattern; others are tighter.
  const ipLimit = action === 'login' ? 20 : 10;
  const identifierLimit = 5;

  const limiter = getRateLimiter();

  const ipResult = await limiter.check(`${action}:ip:${ip}`, ipLimit, windowMs);
  if (!ipResult.ok) return ipResult;

  if (identifier) {
    const idResult = await limiter.check(
      `${action}:ipid:${ip}:${identifier.toLowerCase()}`,
      identifierLimit,
      windowMs,
    );
    if (!idResult.ok) return idResult;
  }

  return ipResult;
}

/**
 * Rate limit authenticated mutations per user (spam / accidental loop protection).
 * 60 writes per minute per user across all write endpoints.
 */
export async function rateLimitUserWrite(userId: string): Promise<RateLimitResult> {
  return getRateLimiter().check(`write:user:${userId}`, 60, 60 * 1000);
}

export function formatRetry(seconds: number): string {
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} phút`;
  return `${seconds} giây`;
}
