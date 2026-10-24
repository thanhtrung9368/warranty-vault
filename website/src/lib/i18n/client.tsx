'use client';

// Client-side half of the i18n plumbing.
//
// `I18nProvider` is the read-only provider the root layout mounts: one locale,
// resolved on the server for this request. Every client component below it can
// translate, but nothing below it can CHANGE which language is shown.
//
// `InstantI18nProvider` is the public-marketing surface's provider. It holds
// the active locale in state, seeded with the server-resolved one, so the first
// paint is byte-identical to what the server rendered and the no-JS view is
// unchanged. What it adds is `switchLocale`, which changes the language
// synchronously and NEVER navigates:
//
//   1. `setLocale(next)` — a state update inside a click handler. React flushes
//      discrete-event updates before the browser paints, so every `useT()` text
//      node below is on screen changed in the same frame.
//   2. `document.documentElement.lang = next` — the document's language is
//      outside the React tree, so it is written imperatively.
//   3. `history.replaceState` — the URL stays shareable (`/` ↔ `/vi`) without a
//      router navigation, a document request, or a Server Action.
//   4. the `wv_locale` cookie — written AFTER the paint (rAF → task) so it can
//      never sit on the click path. It is what makes the preference survive a
//      reload and what the NEXT server render resolves from.
//
// ── Why "both catalogs" costs nothing ─────────────────────────────────────
//
// A `Message` (see `types.ts`) already carries BOTH columns, `vi` and `en`, and
// is keyed by the Vietnamese original. The merged map in `messages/index.ts` is
// therefore the Vietnamese catalog AND the English catalog at once; the
// directory `translate(locale, key)` picks the column. The provider is seeded
// with the SSR locale so the first render cannot disagree with the server, and
// switching is just a different column of data that is ALREADY in this bundle
// (`client.tsx` → `catalog.ts` → `messages`). No second catalog is shipped, and
// nothing is fetched on the click.
//
// That is also why the switch is cheap for the server: the click requests
// nothing, so it costs nothing per click.

import * as React from 'react';
import { translatorFor, type Translator } from './catalog';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  localePath,
  normalizeLocale,
  splitLocalePath,
  type Locale,
} from './locale';

/** Change the language of everything under an `InstantI18nProvider`. */
export type LocaleSwitch = (locale: Locale) => void;

const LocaleContext = React.createContext<Locale>(DEFAULT_LOCALE);
const LocaleSwitchContext = React.createContext<LocaleSwitch | null>(null);

/**
 * Broadcast a locale change to every provider on the page.
 *
 * The public surface nests `InstantI18nProvider` below the root layout's
 * `I18nProvider`, and a client-side navigation away from that surface keeps
 * the root provider mounted. The event is what keeps the two in step, so a
 * server-rendered page and the client components inside it cannot disagree
 * about the language after an in-place switch.
 */
const LOCALE_CHANGE_EVENT = 'wv:localechange';

function broadcastLocale(locale: Locale): void {
  window.dispatchEvent(new CustomEvent<Locale>(LOCALE_CHANGE_EVENT, { detail: locale }));
}

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  // The read-only provider still has to FOLLOW an in-place switch. Without
  // this, a reader who switches to Vietnamese on the landing and then clicks
  // "Đăng ký" would land on a server-rendered Vietnamese page whose CLIENT
  // components (the form) still used the old locale — the root layout is not
  // re-rendered by a client navigation, so its prop never changes. The switch
  // therefore broadcasts one custom event and this provider mirrors it.
  const [active, setActive] = React.useState<Locale>(locale);
  React.useEffect(() => {
    function onChange(event: Event) {
      const next = normalizeLocale((event as CustomEvent<unknown>).detail);
      if (next) setActive(next);
    }
    window.addEventListener(LOCALE_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, onChange);
  }, []);
  return <LocaleContext.Provider value={active}>{children}</LocaleContext.Provider>;
}

/**
 * Persist the language for the next request, without blocking this one.
 *
 * Same attributes the server's `setLocaleCookie` writes (`path`, `maxAge`,
 * `sameSite: 'lax'`), except `secure`, which is derived from the actual
 * protocol: setting it on `http://localhost` would make the cookie vanish.
 *
 * `document.cookie` is the whole write — a few microseconds, no request, no
 * Server Action, nothing to await.
 */
function writeLocaleCookie(locale: Locale): void {
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax${secure}`;
}

/**
 * Run `fn` in the first task after the next paint.
 *
 * `requestAnimationFrame` fires before the frame is painted; the timeout it
 * schedules runs after it. The fallback (no rAF, e.g. a test DOM) is the next
 * task, which is the same "not on the click path" guarantee in weaker form.
 */
function afterPaint(fn: () => void): void {
  if (typeof window.requestAnimationFrame !== 'function') {
    window.setTimeout(fn, 0);
    return;
  }
  window.requestAnimationFrame(() => {
    window.setTimeout(fn, 0);
  });
}

/** The `wv_locale` value this browser currently holds, if it is a supported one. */
function readLocaleCookie(): Locale | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`),
  );
  return match ? normalizeLocale(decodeURIComponent(match[1])) : null;
}

/**
 * The public surface's provider: translate now, switch without navigating.
 *
 * Seeded with the server's answer, never with a guess: the server render and
 * the hydration render must produce the same string, or React would patch the
 * text after hydration and the no-JS/SEO view would differ from the first
 * paint. A language is only ever different after an explicit click.
 */
export function InstantI18nProvider({
  locale: initialLocale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocale] = React.useState<Locale>(initialLocale);

  const switchLocale = React.useCallback<LocaleSwitch>((next) => {
    setLocale(next);
    document.documentElement.lang = next;

    // Keep the query string and fragment: a filter/section in the URL is not
    // part of the language. `localePath` only ever looks at the pathname.
    const { pathname, search, hash } = window.location;
    const nextPath = localePath(pathname, next);
    if (nextPath !== pathname) {
      // `window.history.state` is passed through so Next's router state (the
      // RSC tree it associates with this entry) is preserved by its own
      // patched `replaceState`, which then updates `usePathname()` without a
      // request. No router, no `router.push`, no navigation entry.
      window.history.replaceState(
        window.history.state,
        '',
        `${nextPath}${search}${hash}`,
      );
    }

    // Keep the root provider (and anything mounted outside this subtree, such
    // as a client navigation's destination) in the same language.
    broadcastLocale(next);

    // Never awaited, and deliberately not before the paint: a slow cookie write
    // cannot delay the visible change because the change already happened.
    afterPaint(() => writeLocaleCookie(next));
  }, []);

  // A history restore can hand this subtree an RSC tree from an earlier
  // language (the URL was changed with `replaceState`, so no payload was
  // fetched for it). The URL's own `/vi` prefix is authoritative, and the
  // cookie — written by the last switch — is the next signal, exactly the
  // order `resolveLocale` uses. Never guesses from `Accept-Language` here.
  //
  // It runs once on mount as well as on `popstate`: after a `Back` into the
  // landing, the provider is a NEW instance (the old one unmounted when the
  // reader navigated away), so a listener alone would miss the event that
  // restored it. On a normal first load every signal already agrees with the
  // server's answer, so this is a no-op there.
  React.useEffect(() => {
    function syncFromHistory() {
      const pathLocale = splitLocalePath(window.location.pathname).locale;
      const next = pathLocale ?? readLocaleCookie();
      if (!next) return;
      setLocale((current) => (current === next ? current : next));
      document.documentElement.lang = next;
      broadcastLocale(next);
    }
    syncFromHistory();
    window.addEventListener('popstate', syncFromHistory);
    return () => window.removeEventListener('popstate', syncFromHistory);
  }, []);

  return (
    <LocaleSwitchContext.Provider value={switchLocale}>
      <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
    </LocaleSwitchContext.Provider>
  );
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

/**
 * `null` outside an `InstantI18nProvider`, i.e. on every surface whose copy is
 * still resolved on the server (the signed-in app and the auth forms). The
 * switcher degrades to its old "persist, then navigate" path there instead of
 * pretending it can switch in place.
 */
export function useLocaleSwitch(): LocaleSwitch | null {
  return React.useContext(LocaleSwitchContext);
}
