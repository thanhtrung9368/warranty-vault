import Link from 'next/link';
import { Plus, Vault } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import type { CurrentUser } from '@/lib/auth';

export function Topbar({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-card/85 px-4 backdrop-blur md:px-8">
      {/* Mobile brand */}
      <Link
        href="/dashboard"
        className="flex items-center gap-2 md:hidden"
      >
        <span className="brand-mark brand-mark-sm">
          <Vault className="h-4 w-4" />
        </span>
        <span className="font-display text-base font-extrabold tracking-tight text-ink">
          WarrantyVault
        </span>
      </Link>

      <div className="hidden md:block" />

      <div className="flex items-center gap-2">
        <Button
          asChild
          size="sm"
          className="h-10 px-4 shadow-soft"
        >
          <Link href="/devices/new">
            <Plus className="mr-1 h-4 w-4" />
            Thêm thiết bị
          </Link>
        </Button>
        <ThemeToggle />
        <UserMenu email={user.email} name={user.name} />
      </div>
    </header>
  );
}
