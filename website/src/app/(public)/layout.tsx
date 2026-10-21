import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { WarrlyLockup } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { PublicStructuredData } from '@/lib/structured-data';
import { localePath } from '@/lib/i18n/locale';
import { getI18n } from '@/lib/i18n/server';

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, t } = await getI18n();
  // Keep the reader inside the language they are reading: on `/vi/privacy` the
  // home link points at `/vi`, not `/`. Without this, one click off a shared
  // Vietnamese link would land on the English route in a browser that has no
  // `wv_locale` cookie yet.
  const homeHref = localePath('/', locale);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-[1.5px] border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <Link href={homeHref} aria-label="Warrly" className="inline-flex">
            <WarrlyLockup height={40} />
          </Link>
          {/* These pages have no session, so the switcher here is the only way a
              first-time visitor can override their browser's Accept-Language.
              It is a real link to `/vi` (or `/`) and also remembers the choice
              in the `wv_locale` cookie; there is no account to persist to. */}
          <div className="flex items-center gap-2">
            <LocaleSwitcher current={locale} variant="compact" />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-10 md:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <PublicStructuredData />
          <Link
            href={homeHref}
            className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('Quay về trang chủ')}
          </Link>
          <div className="rounded-xl border-[1.5px] border-border bg-card p-6 shadow-soft sm:p-9">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
