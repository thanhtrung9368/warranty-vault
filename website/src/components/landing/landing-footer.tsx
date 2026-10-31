'use client';

import Link from 'next/link';
import { WarrlyWordmark } from '@/components/brand';
import { useLocale, useT } from '@/lib/i18n/client';
import { localePath } from '@/lib/i18n/locale';
import { ConsentSettingsLink } from '@/components/consent/consent-banner';

/**
 * The landing footer.
 *
 * The legal links follow the ACTIVE locale: after switching to Vietnamese on
 * `/`, they must point at `/vi/privacy`, `/vi/terms`, `/vi/cookies` — a
 * Vietnamese reader clicking "Chính sách bảo mật" must not be handed the
 * English document.
 *
 * `year` arrives from the server so the SSR text and the hydrated text cannot
 * disagree on New Year's Eve (the same reason the product shot's day arithmetic
 * happens server-side).
 */
export function LandingFooter({ year }: { year: number }) {
  const locale = useLocale();
  const t = useT();

  return (
    <footer className="border-t border-border px-4 py-10 md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 md:flex-row md:items-start md:justify-between">
        <div>
          {/* Footer: the wordmark alone, per the brand lockup rules. */}
          <Link
            href={localePath('/', locale)}
            prefetch={false}
            aria-label="Warrly"
            className="inline-flex"
          >
            <WarrlyWordmark height={22} />
          </Link>
          {/* The year is interpolated rather than concatenated, so the sentence
              stays one translatable key. */}
          <div className="mt-3 text-[13px] text-ink-2/80">
            {t('© {year} Warrly.', { year })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] sm:gap-x-8">
          {/* The legal pages exist in both languages; keep the footer inside
              the language of the page the reader is on, so a `/vi` link does
              not hand them an English document. */}
          <Link
            href={localePath('/privacy', locale)}
            prefetch={false}
            className="text-ink-2/80 hover:text-ink hover:underline"
          >
            Privacy
          </Link>
          <Link
            href={localePath('/terms', locale)}
            prefetch={false}
            className="text-ink-2/80 hover:text-ink hover:underline"
          >
            Terms
          </Link>
          <Link
            href={localePath('/cookies', locale)}
            prefetch={false}
            className="text-ink-2/80 hover:text-ink hover:underline"
          >
            Cookies
          </Link>
          <ConsentSettingsLink className="hover:text-ink" />
          {/* The support address is data, not copy: it is the same mailbox the
              privacy and terms pages already print. */}
          <a href="mailto:support@warrly.com" className="text-ink-2/80 hover:text-ink hover:underline">
            {t('Hỗ trợ')}: support@warrly.com
          </a>
          <Link
            href="/login"
            className="font-semibold text-ink-2 hover:text-ink hover:underline"
          >
            {t('Đăng nhập')}
          </Link>
        </div>
      </div>
    </footer>
  );
}
