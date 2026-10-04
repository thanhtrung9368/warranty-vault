// Web auth resolver. The source of truth for user identity is the Go service.
// This module:
//   1) reads the bearer token from the iron-session cookie,
//   2) calls `GET /v1/auth/me` (deduped per request via React `cache()`),
//   3) returns the same `CurrentUser` shape callers used pre-cutover so
//      pages, layouts and server actions don't need to change signatures.
//
// The call is a plain `fetch`, NOT `api.auth.me()`, and that is deliberate.
// `getCurrentUser()` is level 2 of the language chain (`lib/i18n/server.ts`),
// and `apiFetch` resolves its language through that same chain — routing this
// call through the client would make `getLocale()` call itself. `lib/auth.ts`
// therefore imports no API client, which also keeps `GET /v1/auth/me` at
// exactly ONE round trip per request.

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { GO_API_URL } from '@/lib/api/base-url';
import { getAuthCookie, bearerHeader } from '@/lib/auth-cookie';
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locale';
import { getAcceptLanguageLocale, getCookieLocale } from '@/lib/i18n/request';

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  aiOptIn: boolean;
  /**
   * The stored language preference (migration 0014), or `null` when the user has
   * never chosen one. `null` is NOT `'en'`: it means "no opinion", which lets the
   * browser's own `Accept-Language` decide.
   */
  locale: Locale | null;
};

function normalizeStoredLocale(value: unknown): Locale | null {
  return value === 'vi' || value === 'en' ? value : null;
}

// React `cache()` dedupes within a single request — multiple RSCs calling
// `requireUser()`/`getLocale()` produce a single `/v1/auth/me` round-trip.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const c = await getAuthCookie();
  if (!c.accessToken) return null;
  if (c.expiresAt && c.expiresAt <= Date.now()) return null;

  // Every server → API call states its language explicitly, and this one is no
  // exception even though it discards the envelope: a 401 from the Go middleware
  // is a rendered sentence, and leaving it to the server's default would put
  // English text in the logs of a Vietnamese request.
  const locale: Locale =
    (await getCookieLocale()) ?? (await getAcceptLanguageLocale()) ?? DEFAULT_LOCALE;

  let res: Response;
  try {
    res = await fetch(`${GO_API_URL}/v1/auth/me?lang=${locale}`, {
      method: 'GET',
      headers: await bearerHeader(),
      cache: 'no-store',
    });
  } catch (err) {
    console.error('[auth] GET /v1/auth/me failed:', err);
    return null;
  }
  if (!res.ok) return null;

  try {
    const body = (await res.json()) as {
      user?: {
        id?: string;
        email?: string;
        name?: string | null;
        aiOptIn?: boolean;
        locale?: string | null;
      };
    };
    const u = body.user;
    if (!u?.id || !u?.email) return null;
    return {
      id: u.id,
      email: u.email,
      name: u.name ?? null,
      aiOptIn: Boolean(u.aiOptIn),
      locale: normalizeStoredLocale(u.locale),
    };
  } catch {
    return null;
  }
});

// For server components / server actions invoked from the web. Redirects
// to /login on miss.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

// Guest-only pages (login / register / forgot / reset): a signed-in visitor is
// sent to the dashboard instead of being shown the form again.
//
// This used to live in the `(auth)` layout, which made every route under it
// guest-only — including `/confirm-email/<token>`, the link the email-change
// flow mails to the NEW address. That link is routinely opened in the browser
// where the user is still signed in (they requested the change from Cài đặt),
// and the layout would bounce them to /dashboard with the token never consumed.
// Keeping the check on the guest-only pages instead lets the confirm page be
// public for both audiences while preserving the old behaviour everywhere else.
export async function requireGuest(): Promise<void> {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');
}
