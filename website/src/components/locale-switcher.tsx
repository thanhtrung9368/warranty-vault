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
// Both render a REAL `<a>` (through `next/link`, which is only an anchor here)
// between the two URLs (`/privacy` ↔ `/vi/privacy`). That is the point of the
// switch: the href is what a crawler follows and what works with JavaScript
// off. On the public marketing surface — where `InstantI18nProvider` is mounted
// — a plain left click never follows that href: it calls `switchLocale`, which
// changes the React tree, `<html lang>` and the URL synchronously. Zero network
// requests, no router, no Server Action, no document replacement.
//
// Everywhere else (the signed-in app, the auth screens) there is no in-place
// provider, and the switch keeps its old shape: persist the choice with a
// Server Action, then load the URL the link already points at. Those surfaces
// resolve their copy on the server, so an in-place switch would leave half the
// page in the old language — a reload is the honest behaviour there. The
// distinction is read from `useLocaleSwitch()`, not guessed.

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Check, Languages } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { rememberLocaleAction } from '@/app/actions/locale';
import { useLocale, useLocaleSwitch, useT } from '@/lib/i18n/client';
import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
  localePath,
  type Locale,
} from '@/lib/i18n/locale';

type OptionProps = {
  locale: Locale;
  current: Locale;
  compact: boolean;
  href: string;
  pending: Locale | null;
  onSwitch: (event: React.MouseEvent<HTMLAnchorElement>, locale: Locale) => void;
};

/** Modified clicks (new tab, new window, download) keep the anchor behaviour. */
function isPlainLeftClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function OptionLink({
  locale,
  current,
  compact,
  href,
  pending,
  onSwitch,
}: OptionProps) {
  const active = locale === current;
  const busy = pending === locale;

  if (compact) {
    return (
      <Link
        href={href}
        // The switch is never a Link navigation: on the instant surface it is
        // prevented and handled in place, and on the fallback surface the page
        // reloads. A prefetch of the other language's RSC payload would be a
        // server render nobody asked for — the exact cost this change removes.
        prefetch={false}
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
      prefetch={false}
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
  variant = 'settings',
}: {
  variant?: 'settings' | 'compact';
}) {
  const t = useT();
  // The active language comes from the provider, not from a prop: on the
  // instant surface it changes the moment the switch does, and the highlight
  // has to move with it. Everywhere else it is the server's answer, unchanged.
  const current = useLocale();
  const switchInPlace = useLocaleSwitch();
  const pathname = usePathname() || '/';
  const [pending, setPending] = React.useState<Locale | null>(null);

  const switchTo = React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, locale: Locale) => {
      if (!isPlainLeftClick(event)) return;

      // The anchor is real. Without JavaScript (or without an in-place
      // provider) it simply loads the URL it points at.
      event.preventDefault();
      if (locale === current) return;

      // The instant path. Everything below this branch is the legacy path for
      // surfaces whose copy is server-resolved.
      if (switchInPlace) {
        switchInPlace(locale);
        return;
      }

      if (pending) return;
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
    [current, pathname, pending, switchInPlace],
  );

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
