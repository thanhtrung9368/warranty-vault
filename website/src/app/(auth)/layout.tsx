import type { Metadata } from 'next';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { OfflineCacheCleaner } from '@/components/offline-cache-cleaner';
import { AppBadge } from '@/components/app-badge';
import { WarrlyLockup } from '@/components/brand';
import { getI18n } from '@/lib/i18n/server';

// Same reasoning as `(app)/layout.tsx`: a sign-in form is not a duplicate of
// `/`, so it must neither inherit the homepage canonical URL nor be indexed.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
};

// Chrome for the public auth flows. The "already signed in → /dashboard" guard
// deliberately does NOT live here: `/confirm-email/<token>` belongs to this
// group and must stay reachable for a signed-in visitor too — that link is
// mailed to the NEW address and is routinely opened in the browser where the
// user is still signed in. The guest-only pages call `requireGuest()`
// themselves (`@/lib/auth`), which is the exact check this layout used to run.
//
// The language switcher matters more here than anywhere else in the app: a
// signed-out visitor is exactly who has no `User.locale`, and the validation
// copy these forms render comes from Go — so the cookie set here is what makes
// "Email không hợp lệ" arrive in the language of the form.
export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = await getI18n();
  return (
    <div className="auth-gradient flex min-h-screen flex-col">
      {/* A signed-out browser must not keep the previous account's cached
          device pages. Covers sign-out redirects and expired sessions. */}
      <OfflineCacheCleaner />
      {/* …and it must not keep yesterday's "2 deadlines due" icon badge either.
          There is no reminders read on these pages, so the honest count is 0. */}
      <AppBadge count={0} />
      <header className="flex items-center justify-between gap-3 px-4 py-5 md:px-8">
        <Link href="/" aria-label="Warrly" className="inline-flex">
          <WarrlyLockup height={40} />
        </Link>
        <div className="flex items-center gap-2">
          <LocaleSwitcher variant="compact" />
          <ThemeToggle />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-muted md:px-8">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link href="/terms" className="hover:text-ink hover:underline">
            {t('Điều khoản')}
          </Link>
          <Link href="/privacy" className="hover:text-ink hover:underline">
            {t('Bảo mật')}
          </Link>
          <Link href="/cookies" className="hover:text-ink hover:underline">
            {t('Cookie')}
          </Link>
        </nav>
      </footer>
    </div>
  );
}
