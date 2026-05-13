import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Shield } from 'lucide-react';
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
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-background via-background to-primary/5">
      <header className="flex items-center justify-between p-4 md:px-8">
        <Link href="/login" className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          <span className="font-bold tracking-tight">AssetVault</span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="px-4 pb-6 text-center text-xs text-muted-foreground md:px-8">
        <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link href="/terms" className="hover:text-foreground hover:underline">
            Điều khoản
          </Link>
          <Link href="/privacy" className="hover:text-foreground hover:underline">
            Bảo mật
          </Link>
          <Link href="/cookies" className="hover:text-foreground hover:underline">
            Cookie
          </Link>
        </nav>
      </footer>
    </div>
  );
}
