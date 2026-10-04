// Request-scoped locale plumbing: the cookie, the browser header, and the
// writers for the cookie.
//
// Server-only (it imports `next/headers`). Kept apart from `server.ts` so the
// modules that only need the raw signals — `lib/api/client.ts`, `lib/auth.ts` —
// can read them without pulling in the resolver, which reads the user, which
// reads the API client. That import loop is the reason this file exists.

import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  normalizeLocale,
  parseAcceptLanguage,
  type Locale,
} from './locale';

/**
 * The visitor's explicit choice, from the `wv_locale` cookie.
 *
 * `null` means "has not chosen in this browser" — which is different from
 * "chose English", and the difference matters: only a `null` here lets the
 * stored preference or the browser header decide.
 */
export const getCookieLocale = cache(async (): Promise<Locale | null> => {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
});

/** What the browser itself asks for. `null` when it asks for neither language. */
export const getAcceptLanguageLocale = cache(async (): Promise<Locale | null> => {
  const store = await headers();
  return parseAcceptLanguage(store.get('accept-language'));
});

/**
 * Record an explicit choice. Only callable from a Server Action or a Route
 * Handler — a React Server Component may read cookies but not write them, which
 * is why the switcher is an action and not an inline handler.
 *
 * `httpOnly: false` on purpose: it is two non-secret literals, and the value is
 * also readable by the client bundle if a component ever needs it before
 * hydration. `sameSite: 'lax'` so a link into the app still carries it.
 */
export async function setLocaleCookie(locale: Locale): Promise<void> {
  const store = await cookies();
  store.set({
    name: LOCALE_COOKIE,
    value: locale,
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

/**
 * Drop the local choice.
 *
 * Called on sign-out, and that is a correctness fix rather than tidiness: the
 * cookie is browser-scoped and outranks `User.locale`, so without this the next
 * account to sign in on a shared browser would inherit the previous account's
 * language instead of its own stored one.
 */
export async function clearLocaleCookie(): Promise<void> {
  const store = await cookies();
  store.delete({ name: LOCALE_COOKIE, path: '/' });
}
