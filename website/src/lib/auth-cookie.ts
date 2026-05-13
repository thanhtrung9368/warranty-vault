// Iron-session cookie used by the web frontend to carry the bearer token
// issued by the Go API. We deliberately store the bearer + its expiry only
// — user identity (id, email, name) is re-fetched via `GET /v1/auth/me`
// on every request that needs it (`getCurrentUser` uses React `cache()` so
// it's only one round-trip per request).

import { cookies } from 'next/headers';
import { getIronSession, type SessionOptions } from 'iron-session';

export type AuthCookie = {
  // Opaque bearer token issued by Go (`POST /v1/auth/login` etc.).
  accessToken?: string;
  // Server-issued absolute expiry as unix milliseconds.
  expiresAt?: number;
};

const password = process.env.SESSION_SECRET;
if (!password || password.length < 32) {
  throw new Error(
    'SESSION_SECRET phải được set trong .env (>= 32 ký tự). Chạy: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
  );
}

// Iron-session cookie absolute TTL. Independent from the token's own TTL —
// whichever expires first wins. Match the previous 7-day cookie.
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7;

const sessionOptions: SessionOptions = {
  password,
  cookieName: 'wv_session',
  ttl: COOKIE_MAX_AGE_SEC,
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SEC,
  },
};

async function getStore() {
  const c = await cookies();
  return getIronSession<AuthCookie>(c, sessionOptions);
}

export async function getAuthCookie(): Promise<AuthCookie> {
  const s = await getStore();
  return { accessToken: s.accessToken, expiresAt: s.expiresAt };
}

export async function setAuthCookie(payload: { accessToken: string; expiresAt: number }): Promise<void> {
  const s = await getStore();
  s.accessToken = payload.accessToken;
  s.expiresAt = payload.expiresAt;
  await s.save();
}

export async function destroyAuthCookie(): Promise<void> {
  const s = await getStore();
  s.destroy();
}

// Returns the standard `Authorization: Bearer …` header pair if a valid
// (unexpired) bearer is on the cookie, else an empty object so callers can
// spread it unconditionally.
export async function bearerHeader(): Promise<Record<string, string>> {
  const c = await getAuthCookie();
  if (!c.accessToken) return {};
  if (c.expiresAt && c.expiresAt <= Date.now()) return {};
  return { Authorization: `Bearer ${c.accessToken}` };
}
