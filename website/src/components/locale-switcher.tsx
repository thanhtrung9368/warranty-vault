'use client';

// The language switcher.
//
// Two renderings of the same control:
//
//   * `variant="settings"` — the full row in Cài đặt, with the explanation that
//     the choice also governs push notifications and email.
//   * `variant="compact"` — the two-letter toggle in the public and auth
//     headers. Those pages have no session, and without a control there a
//     first-time visitor could never choose.
//
// Both render REAL `<Link>`s between the two URLs (`/privacy` ↔ `/vi/privacy`).
// That is the point of the switch: before, the control was a form that only
// wrote the `wv_locale` cookie, so a crawler — which sends no cookie and no
// `Accept-Language` — could never discover a Vietnamese version, and there was
// no `/vi` URL for one to live at. The link is now the discoverable surface.
//
// The click still persists the choice first (`rememberLocaleAction`: the
// `wv_locale` cookie, plus `User.locale` when signed in). It has to finish
// before the next document request: switching from `/vi` back to `/` while the
// cookie still says `vi` would otherwise render Vietnamese on the English URL,
// because the cookie outranks an unprefixed path. A full `location.assign` —
// rather than the client router — also guarantees the new request carries that
// cookie and starts from a clean shell, which is what a language change means.

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, Languages } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { rememberLocaleAction } from '@/app/actions/locale';
import { useT } from '@/lib/i18n/client';
import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  localePath,
  type Locale,
} from '@/lib/i18n/locale';

function useLocaleSwitch(current: Locale) {
  const pathname = usePathname() || '/';
  const [pending, setPending] = React.useState<Locale | null>(null);

  const switchTo = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, locale: Locale) => {
      // Modified clicks (new tab, new window, download) keep the browser's
      // normal anchor behaviour: the href is already the right URL.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      event.preventDefault();
      if (locale === current || pending) return;

      const href = localePath(pathname, locale);
      setPending(locale);

      // Persist, then navigate — in both the success and the failure branch.
      // A failed account write must not strand the reader on the old language;
      // the URL they asked for is still the right destination.
      void rememberLocaleAction(locale)
        .then((state) => {
          if (!state.ok && state.message) toast.error(state.message);
        })
        .catch(() => {
          // Network/action failure: the URL still says which language to show
          // (`/vi` forces Vietnamese), so navigation remains correct.
        })
        .finally(() => {
          window.location.assign(href);
        });
    },
    [current, pathname, pending],
  );

  return { pathname, pending, switchTo };
}

function OptionLink({
  locale,
  current,
  compact,
  href,
  pending,
  onSwitch,
}: {
  locale: Locale;
  current: Locale;
  compact: boolean;
  href: string;
  pending: Locale | null;
  onSwitch: (event: React.MouseEvent<HTMLAnchorElement>, locale: Locale) => void;
}) {
  const active = locale === current;
  const busy = pending === locale;

  if (compact) {
    return (
      <Link
        href={href}
        onClick={(event) => onSwitch(event, locale)}
        aria-label={LOCALE_LABELS[locale]}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'rounded-pill px-2.5 py-1 text-xs font-bold uppercase tracking-wide transition-colors',
          active ? 'bg-primary text-primary-foreground' : 'text-ink-2 hover:bg-secondary',
          pending !== null && 'opacity-60',
        )}
      >
        {LOCALE_SHORT_LABELS[locale]}
        {busy ? <span className="sr-only">…</span> : null}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      onClick={(event) => onSwitch(event, locale)}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-pill border-[1.5px] px-4 py-2 text-sm font-semibold transition-colors',
        active
          ? 'border-primary bg-primary-soft text-primary-ink'
          : 'border-border bg-card text-ink-2 hover:bg-secondary',
        pending !== null && 'opacity-60',
      )}
    >
      {active ? <Check className="h-4 w-4" /> : <Languages className="h-4 w-4 opacity-60" />}
      {LOCALE_LABELS[locale]}
    </Link>
  );
}

export function LocaleSwitcher({
  current,
  variant = 'settings',
}: {
  current: Locale;
  variant?: 'settings' | 'compact';
}) {
  const t = useT();
  const { pathname, pending, switchTo } = useLocaleSwitch(current);

  const links = LOCALES.map((locale) => ({
    locale,
    href: localePath(pathname, locale),
  }));

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-1 rounded-pill border-[1.5px] border-border bg-card p-0.5">
        {links.map(({ locale, href }) => (
          <OptionLink
            key={locale}
            locale={locale}
            current={current}
            compact
            href={href}
            pending={pending}
            onSwitch={switchTo}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-ink">{t('Ngôn ngữ hiển thị')}</p>
        <p className="text-xs text-muted-foreground">
          {t('Chọn ngôn ngữ cho giao diện, thông báo đẩy và email.')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {links.map(({ locale, href }) => (
          <OptionLink
            key={locale}
            locale={locale}
            current={current}
            compact={false}
            href={href}
            pending={pending}
            onSwitch={switchTo}
          />
        ))}
      </div>
    </div>
  );
}
