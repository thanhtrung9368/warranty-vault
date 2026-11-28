// The catalog-agnostic translator.
//
// `catalog.ts` binds these functions to the full merged dictionary for the
// server; `client.tsx` binds them to whichever bundle the active provider was
// given. Keeping the mechanics here is what lets the client provider stay out
// of `messages/index.ts` — the whole point of the split: a public route must
// not pull the signed-in app's copy into its first-load JS.
//
// This module imports types and locale primitives only. Nothing here may import
// `./messages`, directly or transitively, or the split silently comes undone.

import type { Locale } from './locale';
import type { Catalog, Message, TranslateParams, Translator } from './types';

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
 * Render one message from `catalog`.
 *
 * A key that is not registered falls back to the key itself — the Vietnamese
 * original — in BOTH languages. That is the failure mode this design wants: an
 * unconverted string stays visibly Vietnamese rather than disappearing, and a
 * partially converted screen is obvious to anyone reading it.
 */
export function translateWith(
  catalog: Catalog,
  locale: Locale,
  key: string,
  params?: TranslateParams,
): string {
  const message = catalog[key];
  const template = message ? pick(message, locale, params) : key;
  return params ? interpolate(template, params) : template;
}

/** Bind a catalog + locale once so callers can pass a plain `(key, params) => string`. */
export function translatorForCatalog(catalog: Catalog, locale: Locale): Translator {
  return (key, params) => translateWith(catalog, locale, key, params);
}
