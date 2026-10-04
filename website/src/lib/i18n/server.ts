// The language a request renders in — resolved once, used everywhere.
//
// Precedence (and why) lives in `locale.ts::resolveLocale`. This module is only
// the server half that gathers the three signals:
//
//   cookie (`wv_locale`)  →  `User.locale`  →  `Accept-Language`  →  `en`
//
// `User.locale` is read through `getCurrentUser()`, which is already
// `cache()`d per request and already needed by `(app)/layout.tsx` — so lifting
// the stored preference costs no extra round trip on an authenticated page, and
// costs nothing at all on a public one (with no session cookie it returns null
// without calling the API).

import { cache } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { translatorFor, type Translator } from './catalog';
import { DEFAULT_LOCALE, resolveLocale, type Locale } from './locale';
import { getAcceptLanguageLocale, getCookieLocale } from './request';

/**
 * The language of the current request.
 *
 * Safe to call from any Server Component, Server Action or Route Handler; the
 * React `cache()` makes the second and later calls free within one request.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const cookie = await getCookieLocale();
  if (cookie) return cookie;

  // Only reached when this browser has no explicit choice. A signed-out visitor
  // short-circuits inside `getCurrentUser` (no session cookie ⇒ no API call).
  const user = await getCurrentUser();
  const acceptLanguage = await getAcceptLanguageLocale();

  return resolveLocale({ user: user?.locale, acceptLanguage, cookie: null });
});

export type I18n = { locale: Locale; t: Translator };

/**
 * Locale + its bound translator. The ergonomic form for a page:
 *
 *     const { locale, t } = await getI18n();
 *
 * `locale` is still needed alongside `t` because a few helpers take the locale
 * themselves rather than a translator (`format.ts`, `lib/types.ts` labels).
 */
export const getI18n = cache(async (): Promise<I18n> => {
  const locale = await getLocale();
  return { locale, t: translatorFor(locale) };
});

/** Translator only — for the many places that need nothing else. */
export async function getT(): Promise<Translator> {
  return (await getI18n()).t;
}

export { DEFAULT_LOCALE };
