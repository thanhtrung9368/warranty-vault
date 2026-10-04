'use client';

// Client-side half of the i18n plumbing.
//
// The locale arrives as a prop from the server (the root layout resolves it per
// request) and the dictionary is imported directly rather than serialised into
// the RSC payload — every client component needs the same catalog, so shipping
// it once in the JS bundle is both smaller and non-duplicative.
//
// Client components are the reason this exists at all: most of this app's copy
// is inside `'use client'` components (forms, dialogs, filter bars) that cannot
// call the server resolver.

import * as React from 'react';
import { translatorFor, type Translator } from './catalog';
import { DEFAULT_LOCALE, type Locale } from './locale';

const LocaleContext = React.createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

/**
 * The active locale. Also what locale-aware helpers need (`formatVND(x, locale)`).
 *
 * Falls back to `DEFAULT_LOCALE` outside a provider rather than throwing: a
 * client component rendered in isolation (a test, a story) should render
 * English, not crash.
 */
export function useLocale(): Locale {
  return React.useContext(LocaleContext);
}

/** The bound translator for the active locale. */
export function useT(): Translator {
  const locale = useLocale();
  return React.useMemo(() => translatorFor(locale), [locale]);
}
