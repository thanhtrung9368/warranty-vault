'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { WarrlyLockup } from '@/components/brand';
import { useLocale, useT } from '@/lib/i18n/client';
import { localePath } from '@/lib/i18n/locale';

/**
 * The landing header.
 *
 * A client component because every word of it is translated (`useT`) and the
 * home link has to point at the language currently on screen — after an
 * in-place switch the `<a href>` for the wordmark must be `/vi`, not `/`.
 *
 * The switch itself is the compact `<LocaleSwitcher>`: on this page it finds
 * `InstantI18nProvider` above it and changes the language without navigating.
 */
export function LandingHeader({ signedIn }: { signedIn: boolean }) {
  const locale = useLocale();
  const t = useT();

  return (
    <header
      className="sticky top-0 z-30 border-b-[1.5px] border-border backdrop-blur-md"
      style={{ background: 'hsl(var(--background) / 0.85)' }}
    >
      {/* `flex-wrap`: the logo row keeps its size and the controls drop to a
          second, right-aligned row on narrow phones instead of pushing the
          header into horizontal overflow. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2 px-4 py-3.5 md:px-8">
        {/* The one lockup on this screen. The hero beside it never repeats
            the wordmark — one lockup per screen, and the header is it. The
            symbol + outline wordmark are a single SVG, so the mark cannot
            be restyled by the font/radius/accent presets. */}
        <Link
          href={localePath('/', locale)}
          prefetch={false}
          aria-label="Warrly"
          className="inline-flex"
        >
          <WarrlyLockup height={40} />
        </Link>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <LocaleSwitcher variant="compact" />
          <ThemeToggle />
          {signedIn ? (
            <Button asChild>
              <Link href="/dashboard">
                {t('Vào app')}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden text-sm font-semibold text-ink-2 hover:text-ink sm:inline-flex"
              >
                {t('Đăng nhập')}
              </Link>
              <Button asChild>
                <Link href="/register">{t('Bắt đầu miễn phí')}</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
