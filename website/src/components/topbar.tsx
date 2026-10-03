import Link from 'next/link';
import { Plus, Vault } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { GlobalSearch } from '@/components/global-search';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import type { CurrentUser } from '@/lib/auth';

export function Topbar({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-card/85 px-4 backdrop-blur md:gap-3 md:px-8">
      {/* Mobile brand. The wordmark is `sm:`-only so the search box (and the
          rest of the actions) still fit on a 360px-wide phone; the vault mark
          stays as the link back to /dashboard. */}
      <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
        <span className="brand-mark brand-mark-sm">
          <Vault className="h-4 w-4" />
        </span>
        <span className="hidden font-display text-base font-extrabold tracking-tight text-ink sm:inline">
          WarrantyVault
        </span>
      </Link>

      {/* Global cross-entity search (devices + subscriptions + wishlist, one
          round trip). Renders the inline field on md+ and an icon + overlay
          below that. */}
      <GlobalSearch />

      <div className="ml-auto flex items-center gap-2">
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
