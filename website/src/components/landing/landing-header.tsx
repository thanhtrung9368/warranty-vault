'use client';

import Link from 'next/link';
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
 * One row at every width. The old header wrapped its controls onto a second
 * row at 390 px, which read as a broken toolbar rather than a masthead. The
 * primary CTA is hidden below `sm` and the hero carries it instead: a phone
 * visitor meets the action in the first screenful, not twice in the top 120 px.
 */
export function LandingHeader({ signedIn }: { signedIn: boolean }) {
  const locale = useLocale();
  const t = useT();

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 md:px-8">
        {/* The one lockup on this screen. The hero never repeats the wordmark —
            one lockup per screen, and the header is it. The symbol + outline
            wordmark are a single SVG, so the mark cannot be restyled by the
            font/radius/accent presets. */}
        <Link
          href={localePath('/', locale)}
          prefetch={false}
          aria-label="Warrly"
          className="inline-flex shrink-0"
        >
          <WarrlyLockup height={32} />
        </Link>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <LocaleSwitcher variant="compact" />
          <ThemeToggle />
          {/* The header carries navigation only. The hero below this row owns
              the screen's one coral action, so a second filled button here was
              the same instruction twice before a reader had read the headline. */}
          {signedIn ? (
            <Link
              href="/dashboard"
              className="hidden text-sm font-semibold text-ink-2 hover:text-ink sm:inline-flex"
            >
              {t('Vào app')}
            </Link>
          ) : (
            <Link
              href="/login"
              className="hidden text-sm font-semibold text-ink-2 hover:text-ink sm:inline-flex"
            >
              {t('Đăng nhập')}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
