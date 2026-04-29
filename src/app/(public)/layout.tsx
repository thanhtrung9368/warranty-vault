import Link from 'next/link';
import { ArrowLeft, Shield } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-background via-background to-primary/5">
      <header className="flex items-center justify-between p-4 md:px-8">
        <Link href="/" className="flex items-center gap-2">
          <Shield className="h-6 w-6 text-primary" />
          <span className="font-bold tracking-tight">AssetVault</span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="flex-1 px-4 pb-12">
        <div className="mx-auto w-full max-w-3xl">
          <Link
            href="/login"
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Quay lại
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
