// The SERVER translator, bound to the full merged dictionary.
//
// `translate(locale, key, params)` is the whole public surface for server code;
// `useT()` in the browser resolves against the route bundle its provider was
// given instead (see `client.tsx` and `translate.ts`). Keeping this module out
// of the client provider's import graph is what stops the ~80 KB-gzip app
// catalog from being part of `/` and `/login`'s first load.
//
// ── Why the key is the Vietnamese sentence ────────────────────────────────
//
// Same trade as the Go catalog (`api/internal/i18n/catalog.go`, and
// docs/I18N_PLAN.md §3.1): Vietnamese is the ORIGINAL text of this app, so the
// migration is additive — the existing literal is *wrapped*, never rewritten.
// `t('Còn {days} ngày', { days: 3 })` shows a reviewer exactly which sentence is
// being translated, and a key nobody registered degrades to the correct
// Vietnamese sentence instead of an identifier like `devices.empty.title`.
//
// The cost is the same as on the server: editing a Vietnamese sentence means
// editing its key in the message file too.

import { DEFAULT_LOCALE, type Locale } from './locale';
import { messages } from './messages';
import { interpolate, translateWith, translatorForCatalog } from './translate';
import type { Catalog, TranslateParams, Translator } from './types';

export type { Message, Catalog, TranslateParams, Translator } from './types';

// Server-side helpers keep translating against the FULL dictionary. That is
// deliberate: only the client reference manifest is the problem, and server
// bundles already contain every message. The browser gets a route bundle handed
// to it as a prop by the layout that owns it (see `messages/bundles.ts`).

export { interpolate };

/**
 * Render one message from the full catalog.
 *
 * A key that is not registered falls back to the key itself — the Vietnamese
 * original — in BOTH languages. That is the failure mode this design wants: an
 * unconverted string stays visibly Vietnamese rather than disappearing, and a
 * partially converted screen is obvious to anyone reading it.
 */
export function translate(locale: Locale, key: string, params?: TranslateParams): string {
  return translateWith(messages, locale, key, params);
}

/** Bind a locale once so callers can pass a plain `(key, params) => string`. */
export function translatorFor(locale: Locale): Translator {
  return translatorForCatalog(messages, locale);
}

export function hasMessage(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(messages, key);
}

/** Every registered Vietnamese string. The "vi dictionary" of the parity test. */
export function vietnameseMessages(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(messages)) out[key] = message.vi;
  return out;
}

/** Every registered English string. The "en dictionary" of the parity test. */
export function englishMessages(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(messages)) out[key] = message.en;
  return out;
}

/** The merged catalog, for tests that need to inspect entries wholesale. */
export function allMessages(): Catalog {
  return messages;
}

export { DEFAULT_LOCALE };
