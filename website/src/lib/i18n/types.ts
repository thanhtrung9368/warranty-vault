// Types shared by the message files and the translator.
//
// Split out of `catalog.ts` so the `messages/*.ts` modules can import the type
// without importing the module that imports THEM (which would be a cycle).

/**
 * One translated sentence.
 *
 * `vi` is the ORIGINAL — it is always the key it was registered under, so it is
 * never re-typed by hand (see `defineMessages`). `en` is the translation.
 */
export type Message = {
  vi: string;
  en: string;
  /**
   * Singular English form, used only when the caller passes `count: 1`.
   *
   * Vietnamese does not inflect for number, so there is no `viOne`: the single
   * `vi` string is correct for every count (docs/I18N_PLAN.md §4.6). English
   * does inflect, so an entry whose text contains a count must supply this or
   * read "1 days left".
   */
  enOne?: string;
};

/** What a message file exports: Vietnamese key → its translation. */
export type Catalog = Record<string, Message>;

/** Shorthand accepted by `defineMessages` — the common case is a bare string. */
export type MessageInput = string | { en: string; enOne?: string };

export type TranslateParams = Record<string, string | number>;

/** Bound translator: `t('Còn {days} ngày', { days: 3 })`. */
export type Translator = (key: string, params?: TranslateParams) => string;

/**
 * Build a catalog from `vietnameseKey: englishTranslation` pairs.
 *
 * The Vietnamese column is derived from the key rather than repeated, which is
 * the whole point: the key IS the original sentence (the same design as
 * `api/internal/i18n/catalog.go`), so the two cannot drift and nobody has to
 * type "Đã lưu" twice.
 *
 * A key with no entry is not an error — `translate` returns the key itself,
 * which is the correct Vietnamese sentence. That is the safe failure mode: a
 * string nobody translated stays visibly Vietnamese instead of vanishing or
 * turning into an identifier.
 */
export function defineMessages(input: Record<string, MessageInput>): Catalog {
  const out: Catalog = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = typeof value === 'string' ? { vi: key, en: value } : { vi: key, ...value };
  }
  return out;
}
