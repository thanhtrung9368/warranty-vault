import Link from 'next/link';
import { Plus, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import type { CurrentUser } from '@/lib/auth';

export function Topbar({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/80 px-4 backdrop-blur md:px-8">
      <div className="flex items-center gap-2 md:hidden">
        <Shield className="h-5 w-5 text-primary" />
        <span className="font-bold">AssetVault</span>
      </div>
      <div className="hidden md:block" />
      <div className="flex items-center gap-2">
        <Button
          asChild
          size="sm"
          className="rounded-full shadow-sm transition-transform hover:scale-[1.03]"
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
