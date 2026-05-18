import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Vault } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { ThemeToggle } from '@/components/theme-toggle';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

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
