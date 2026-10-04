// Locale primitives for the web client.
//
// Pure: this module imports nothing. That is deliberate — it is the piece both
// the server resolver and the browser provider agree on, and it is what the
// unit tests pin.
//
// Which language is which (docs/I18N_PLAN.md §2.4): **Vietnamese is the
// ORIGINAL**. Every user-facing sentence in this app was written in Vietnamese
// first and the English column is a translation of it. Nothing here ever
// "re-translates" Vietnamese; the web dictionary is keyed by the Vietnamese
// source string (see `catalog.ts`), exactly like the Go catalog
// (`api/internal/i18n/catalog.go`).
//
// English is the product default (docs/I18N_PLAN.md §2.2) — the owner asked for
// it, and it is the level every fallback chain here ends on.

export type Locale = 'vi' | 'en';

/** English first: it is the default, and this order drives the switcher. */
export const LOCALES = ['en', 'vi'] as const satisfies readonly Locale[];

/** Served when nothing else produced a supported language. */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Cookie carrying the visitor's explicit choice of language.
 *
 * Deliberately NOT part of the iron-session payload: `wv_session` is encrypted
 * and holds the bearer token, and its contents are meaningless to a signed-out
 * visitor. This cookie has to work for a first-time anonymous reader of `/`,
 * which is precisely the visitor the session cookie cannot describe. It holds
 * one of two non-secret literals, so it is not httpOnly — the language a page
 * is served in is not a secret, and salting it into the encrypted session would
 * make it unreadable to the one component that wants it mid-render.
 */
export const LOCALE_COOKIE = 'wv_locale';

/** One year. A language choice is not session-scoped. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Endonym — a language is always listed in its own language. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  vi: 'Tiếng Việt',
};

/** Compact form for the header switch. */
export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  en: 'EN',
  vi: 'VI',
};

/** `lang` value handed to the Go API. Exact literals only (openapi documents
 *  `vi`/`en`; anything else makes the server fall through to the next level). */
export function langTag(locale: Locale): string {
  return locale;
}

const LOCALE_SET = new Set<string>(LOCALES);

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && LOCALE_SET.has(value);
}

/**
 * Exact match on `vi`/`en`, case-insensitive and trimmed. Anything else is
 * `null` — never a guess, and never an error. A junk cookie must fall through
 * to the next level rather than pinning the language (the Go side takes the
 * same line for `?lang=`, see `i18n.QueryTag`).
 */
export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return isLocale(trimmed) ? trimmed : null;
}

type LanguageRange = { base: string; q: number; index: number };

/**
 * Best supported language from an `Accept-Language` header, or `null`.
 *
 * Hand-rolled rather than pulled from a library: the header is a q-weighted
 * list, the only tags that can match are `vi`/`en`, and the whole job is
 * "highest q wins, ties broken by position". The Go side uses
 * `golang.org/x/text/language` for this; the web only ever needs the answer for
 * the two languages it ships, so it does the same thing in twenty lines instead
 * of taking a dependency.
 *
 * `null` — not `DEFAULT_LOCALE` — when nothing matches. That distinction is the
 * whole reason this returns a nullable: `Accept-Language: fr` must leave the
 * decision to the level below (the stored preference), exactly as
 * `i18n.HeaderTag` does on the server.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranges: LanguageRange[] = [];

  header.split(',').forEach((part, index) => {
    const [rawTag, ...params] = part.split(';');
    const tag = rawTag.trim().toLowerCase();
    if (!tag) return;
    let q = 1;
    for (const param of params) {
      const [rawKey, rawValue] = param.split('=');
      if (rawKey?.trim().toLowerCase() !== 'q') continue;
      const parsed = Number.parseFloat((rawValue ?? '').trim());
      q = Number.isFinite(parsed) ? parsed : 0;
    }
    // `q=0` means "explicitly not acceptable" — RFC 9110, and the one case
    // where a listed tag must be dropped rather than considered.
    if (q <= 0) return;
    ranges.push({ base: tag.split('-')[0], q, index });
  });

  ranges.sort((a, b) => b.q - a.q || a.index - b.index);
  for (const range of ranges) {
    if (isLocale(range.base)) return range.base;
  }
  // `*` (or any unsupported tag) lands here: "I accept anything" is not a
  // choice of Vietnamese, so it must not outrank the stored preference.
  return null;
}

export type LocaleSources = {
  /** `wv_locale` cookie — an explicit choice made in THIS browser. */
  cookie?: string | null;
  /** `User.locale` from `GET /v1/auth/me` — authoritative for the account. */
  user?: string | null;
  /** The browser's own `Accept-Language`. */
  acceptLanguage?: string | null;
};

/**
 * The web's language precedence, first match wins:
 *
 *   1. `wv_locale` cookie   — the visitor said so, in this browser
 *   2. `User.locale`        — the account said so (set here or on a phone)
 *   3. `Accept-Language`    — the only signal a brand-new visitor has
 *   4. `en`                 — the product default
 *
 * Why the cookie outranks the stored preference rather than the other way
 * round: both levels exist, and one of them has to win. The cookie wins because
 * it is strictly the more recent of the two *for this browser* — the switcher
 * writes `User.locale` and the cookie in the same action, so a cookie that
 * disagrees with the row can only be one written after the row was last read.
 * The alternative (row wins) would make the switcher appear broken for the
 * window between the `PATCH` and the next `/auth/me` read, and would leave an
 * anonymous visitor — who has no row at all — with no way to choose.
 *
 * The price, stated plainly: the web and the mobile clients can disagree, and
 * `wv_locale` is a second source of truth. It is bounded by clearing the cookie
 * on sign-out (`clearLocaleCookie` in `request.ts`), so one account's choice
 * cannot leak into the next account that signs in on the same browser.
 *
 * Note the order differs from the API's own chain (`?lang=` → `Accept-Language`
 * → `User.locale` → `en`). That is not an inconsistency: the API's
 * `Accept-Language` is a statement by *one client* about *one response*, and
 * the web sends it explicitly as `?lang=` once it has resolved. Here the header
 * is only a guess about a visitor who has told us nothing.
 */
export function resolveLocale(sources: LocaleSources): Locale {
  return (
    normalizeLocale(sources.cookie) ??
    normalizeLocale(sources.user) ??
    parseAcceptLanguage(sources.acceptLanguage) ??
    DEFAULT_LOCALE
  );
}

/**
 * Add/replace `?lang=` on an API path.
 *
 * This is how the resolved language reaches the Go service. `?lang=` is level 1
 * of the server's precedence chain (it beats the stored preference), so the
 * response language is always the one the page is rendered in, with no chance
 * of the two drifting apart.
 *
 * It is also the cache fix — see the note in `lib/api/catalog.ts`. A language
 * carried in a HEADER is invisible to Next's Data Cache key, which is the URL;
 * a language carried in the URL partitions the cache by construction.
 */
export function withLangParam(path: string, locale: Locale): string {
  const hashAt = path.indexOf('#');
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const queryAt = base.indexOf('?');
  const pathname = queryAt === -1 ? base : base.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : base.slice(queryAt + 1));
  // set(), not append(): a caller that already put `lang` in the path must not
  // produce `?lang=vi&lang=en` (Go reads the FIRST value, so the second would be
  // silently ignored — a bug that looks like a caching problem).
  params.set('lang', langTag(locale));
  return `${pathname}?${params.toString()}${hash}`;
}
