// The translator.
//
// `translate(locale, key, params)` is the whole public surface; everything else
// in the app goes through it (directly on the server, via `useT()` in the
// browser — see `client.tsx`).
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
import type { Catalog, Message, TranslateParams, Translator } from './types';

export type { Message, Catalog, TranslateParams, Translator } from './types';

/**
 * Fill `{name}` placeholders. Unknown placeholders are left alone rather than
 * replaced with "undefined": a typo should be visible in the UI, not silent.
 *
 * Runs only when params were actually passed, so a sentence containing a
 * literal `{` is returned verbatim — the same hazard the Go side contains by
 * skipping Sprintf for static messages.
 */
export function interpolate(template: string, params: TranslateParams): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

function pick(message: Message, locale: Locale, params?: TranslateParams): string {
  // Plurals exist in English and not in Vietnamese (docs/I18N_PLAN.md §4.6), so
  // only the `en` branch branches. `count` is the conventional param name; an
  // entry with `enOne` and no `count` is a mistake the catalog test catches.
  if (locale === 'en' && message.enOne !== undefined && params?.count === 1) {
    return message.enOne;
  }
  return locale === 'en' ? message.en : message.vi;
}

/**
 * Render one message.
 *
 * A key that is not registered falls back to the key itself — the Vietnamese
 * original — in BOTH languages. That is the failure mode this design wants: an
 * unconverted string stays visibly Vietnamese rather than disappearing, and a
 * partially converted screen is obvious to anyone reading it.
 */
export function translate(locale: Locale, key: string, params?: TranslateParams): string {
  const message = messages[key];
  const template = message ? pick(message, locale, params) : key;
  return params ? interpolate(template, params) : template;
}

/** Bind a locale once so callers can pass a plain `(key, params) => string`. */
export function translatorFor(locale: Locale): Translator {
  return (key, params) => translate(locale, key, params);
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
