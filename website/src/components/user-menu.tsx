'use client';

import { useTransition } from 'react';
import { LogOut, User as UserIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { logoutUser } from '@/app/actions/auth';
import { useT } from '@/lib/i18n/client';

export function UserMenu({
  email,
  name,
}: {
  email: string;
  name: string | null;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const initial = (name || email)[0]?.toUpperCase() ?? '?';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-10 gap-2 rounded-pill border-border bg-card pl-1 pr-3 text-ink-2 shadow-none hover:bg-secondary"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            {initial}
          </span>
          <span className="hidden max-w-[140px] truncate text-sm font-semibold md:inline">
            {name || email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <UserIcon className="h-4 w-4 text-muted-foreground" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{name || t('Người dùng')}</p>
            <p className="truncate text-xs font-normal text-muted-foreground">{email}</p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(e) => {
            e.preventDefault();
            startTransition(async () => {
              try {
                await logoutUser();
              } catch {
                toast.error(t('Không đăng xuất được'));
              }
            });
          }}
          className="text-destructive focus:text-destructive"
        >
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="mr-2 h-4 w-4" />
          )}
          {t('Đăng xuất')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
