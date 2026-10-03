import Link from 'next/link';
import { Vault } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

// Chrome for the public auth flows. The "already signed in → /dashboard" guard
// deliberately does NOT live here: `/confirm-email/<token>` belongs to this
// group and must stay reachable for a signed-in visitor too — that link is
// mailed to the NEW address and is routinely opened in the browser where the
// user is still signed in. The guest-only pages call `requireGuest()`
// themselves (`@/lib/auth`), which is the exact check this layout used to run.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="auth-gradient flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-4 py-5 md:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="brand-mark">
            <Vault className="h-[18px] w-[18px]" />
          </span>
          <span className="font-display text-base font-extrabold tracking-tight text-ink">
            WarrantyVault
          </span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-muted md:px-8">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link href="/terms" className="hover:text-ink hover:underline">
            Điều khoản
          </Link>
          <Link href="/privacy" className="hover:text-ink hover:underline">
            Bảo mật
          </Link>
          <Link href="/cookies" className="hover:text-ink hover:underline">
            Cookie
          </Link>
        </nav>
      </footer>
    </div>
  );
}
