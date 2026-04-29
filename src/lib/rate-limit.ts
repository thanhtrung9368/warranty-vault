import { headers } from 'next/headers';

type Bucket = {
  count: number;
  resetAt: number;
};

const store: Map<string, Bucket> =
  (globalThis as { __wvRateLimitStore?: Map<string, Bucket> }).__wvRateLimitStore ??
  new Map();
(globalThis as { __wvRateLimitStore?: Map<string, Bucket> }).__wvRateLimitStore = store;

type Options = {
  key: string;
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
};

function hit({ key, limit, windowMs }: Options): RateLimitResult {
  const now = Date.now();
  const existing = store.get(key);
  if (!existing || existing.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSec: 0 };
  }
  if (existing.count >= limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
  }
  existing.count++;
  return { ok: true, remaining: limit - existing.count, retryAfterSec: 0 };
}

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
  action: 'login' | 'register' | 'change-password',
  identifier?: string,
): Promise<RateLimitResult> {
  const ip = await getClientIp();
  const windowMs = 15 * 60 * 1000;
  const ipLimit = action === 'login' ? 20 : 10;
  const identifierLimit = 5;

  const ipResult = hit({ key: `${action}:ip:${ip}`, limit: ipLimit, windowMs });
  if (!ipResult.ok) return ipResult;

  if (identifier) {
    const idResult = hit({
      key: `${action}:ipid:${ip}:${identifier.toLowerCase()}`,
      limit: identifierLimit,
      windowMs,
    });
    if (!idResult.ok) return idResult;
  }

  return ipResult;
}

/**
 * Rate limit authenticated mutations per user (spam / accidental loop protection).
 * 60 writes per minute per user across all write endpoints.
 */
export async function rateLimitUserWrite(userId: string): Promise<RateLimitResult> {
  return hit({ key: `write:user:${userId}`, limit: 60, windowMs: 60 * 1000 });
}

export function formatRetry(seconds: number): string {
  if (seconds >= 60) return `${Math.ceil(seconds / 60)} phút`;
  return `${seconds} giây`;
}
