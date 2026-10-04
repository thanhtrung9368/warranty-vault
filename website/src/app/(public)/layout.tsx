import Link from 'next/link';
import { ArrowLeft, Vault } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { getI18n } from '@/lib/i18n/server';

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale, t } = await getI18n();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-[1.5px] border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="brand-mark">
              <Vault className="h-[18px] w-[18px]" />
            </span>
            <span className="font-display text-base font-extrabold tracking-tight text-ink">
              WarrantyVault
            </span>
          </Link>
          {/* These pages have no session, so the switcher here is the only way a
              first-time visitor can override their browser's Accept-Language.
              It writes the `wv_locale` cookie and nothing else — there is no
              account to persist to. */}
          <div className="flex items-center gap-2">
            <LocaleSwitcher current={locale} variant="compact" />
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="flex-1 px-4 py-10 md:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <Link
            href="/"
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
