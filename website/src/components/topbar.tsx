import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WarrlyMark } from '@/components/brand';
import { GlobalSearch } from '@/components/global-search';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import type { CurrentUser } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';

export async function Topbar({ user }: { user: CurrentUser }) {
  const { t } = await getI18n();
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-card/85 px-4 backdrop-blur md:gap-3 md:px-8">
      {/* Mobile brand: the symbol alone, fixed at 24px. No wordmark here —
          the shell already has a lockup on the landing/auth screens, and the
          topbar has to leave room for search on a 360px phone. */}
      <Link
        href="/dashboard"
        aria-label="Warrly"
        className="flex items-center md:hidden"
      >
        <WarrlyMark size={36} />
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
            {t('Thêm thiết bị')}
          </Link>
        </Button>
        <ThemeToggle />
        <UserMenu email={user.email} name={user.name} />
      </div>
    </header>
  );
}
