'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { WarrlyLockup } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { useLocale, useT } from '@/lib/i18n/client';
import { localePath } from '@/lib/i18n/locale';
import { ConsentSettingsLink } from '@/components/consent/consent-banner';

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


/**
 * Footer for the legal pages.
 *
 * The landing page has its own footer; these three documents are reached from
 * the landing and from the auth screens and otherwise have no bottom chrome.
 * The consent control belongs here as well as on the landing, because a reader
 * who arrives at `/cookies` directly must be able to change the choice that
 * document describes.
 */
export function PublicFooter() {
  const locale = useLocale();
  const t = useT();

  return (
    <footer className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t-[1.5px] border-border pt-6 text-sm text-muted">
      <Link
        href={localePath('/privacy', locale)}
        prefetch={false}
        className="hover:text-ink hover:underline"
      >
        {t('Chính sách bảo mật')}
      </Link>
      <Link
        href={localePath('/terms', locale)}
        prefetch={false}
        className="hover:text-ink hover:underline"
      >
        {t('Điều khoản sử dụng')}
      </Link>
      <Link
        href={localePath('/cookies', locale)}
        prefetch={false}
        className="hover:text-ink hover:underline"
      >
        {t('Chính sách Cookie')}
      </Link>
      <ConsentSettingsLink className="hover:text-ink" />
      <a href="mailto:support@warrly.com" className="hover:text-ink hover:underline">
        {t('Hỗ trợ')}: support@warrly.com
      </a>
    </footer>
  );
}
