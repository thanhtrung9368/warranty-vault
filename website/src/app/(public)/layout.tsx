import Link from 'next/link';
import { ArrowLeft, Vault } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b-[1.5px] border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="brand-mark">
              <Vault className="h-[18px] w-[18px]" />
            </span>
            <span className="font-display text-base font-extrabold tracking-tight text-ink">
              WarrantyVault
            </span>
          </Link>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 px-4 py-10 md:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <Link
            href="/"
            className="mb-6 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Quay về trang chủ
          </Link>
          <div className="rounded-xl border-[1.5px] border-border bg-card p-6 shadow-soft sm:p-9">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
