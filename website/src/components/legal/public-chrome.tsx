'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { WarrlyLockup } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { useLocale, useT } from '@/lib/i18n/client';
import { localePath } from '@/lib/i18n/locale';

/**
 * The header and the "back to the landing page" link shared by `/privacy`,
 * `/terms` and `/cookies`.
 *
 * Client components for one reason: their two links have to follow the ACTIVE
 * language. On `/vi/privacy` the wordmark and the back link point at `/vi`, and
 * after an in-place switch back to English they point at `/`. A server-resolved
 * `href` would keep sending a Vietnamese reader to the English landing page.
 *
 * These pages have no session, so the compact switcher here is the only way a
 * first-time visitor can override their browser's Accept-Language. It is a real
 * link to `/vi` (or `/`) and also remembers the choice; under
 * `InstantI18nProvider` (mounted by `(public)/layout.tsx`) it switches in place
 * instead of navigating.
 */
export function PublicHeader() {
  const locale = useLocale();

  return (
    <header className="border-b-[1.5px] border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 md:px-8">
        <Link
          href={localePath('/', locale)}
          prefetch={false}
          aria-label="Warrly"
          className="inline-flex"
        >
          <WarrlyLockup height={40} />
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher variant="compact" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

export function PublicBackLink() {
  const locale = useLocale();
  const t = useT();

  return (
    <Link
      href={localePath('/', locale)}
      prefetch={false}
      className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
    >
      <ArrowLeft className="h-4 w-4" />
      {t('Quay về trang chủ')}
    </Link>
  );
}
