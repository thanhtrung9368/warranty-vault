import { cookies } from 'next/headers';
import { getIronSession, type SessionOptions } from 'iron-session';

export type SessionData = {
  userId?: string;
  email?: string;
  // Bumped on password change so older cookies are detected as stale.
  passwordChangedAt?: number;
};

const password = process.env.SESSION_SECRET;
if (!password || password.length < 32) {
  throw new Error(
    'SESSION_SECRET phải được set trong .env (>= 32 ký tự). Chạy: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
  );
}

const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days absolute

export const sessionOptions: SessionOptions = {
  password,
  cookieName: 'wv_session',
  ttl: SESSION_MAX_AGE_SEC,
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SEC,
  },
};

export async function getSession() {
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions);
}
