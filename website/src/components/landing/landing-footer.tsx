'use client';

import Link from 'next/link';
import { WarrlyWordmark } from '@/components/brand';
import { useLocale, useT } from '@/lib/i18n/client';
import { localePath } from '@/lib/i18n/locale';

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
    <footer className="border-t-[1.5px] border-border bg-card px-4 py-8 md:px-8">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
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
        <div className="text-[13px] text-muted">
          {t('© {year} Warrly.', {
            year,
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          {/* The legal pages exist in both languages; keep the footer inside
              the language of the page the reader is on, so a `/vi` link does
              not hand them an English document. */}
          <Link
            href={localePath('/privacy', locale)}
            prefetch={false}
            className="text-muted hover:text-ink"
          >
            Privacy
          </Link>
          <Link
            href={localePath('/terms', locale)}
            prefetch={false}
            className="text-muted hover:text-ink"
          >
            Terms
          </Link>
          <Link
            href={localePath('/cookies', locale)}
            prefetch={false}
            className="text-muted hover:text-ink"
          >
            Cookies
          </Link>
          {/* The support address is data, not copy: it is the same mailbox the
              privacy and terms pages already print. */}
          <a href="mailto:hi@warrly.com" className="text-muted hover:text-ink">
            {t('Hỗ trợ')}: hi@warrly.com
          </a>
          <Link href="/login" className="font-semibold text-primary hover:underline">
            {t('Đăng nhập')}
          </Link>
        </div>
      </div>
    </footer>
  );
}
