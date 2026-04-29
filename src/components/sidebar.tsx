'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Package,
  Bell,
  BarChart3,
  Settings,
  Vault,
  Heart,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (path: string) => boolean;
};

const items: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Tổng quan',
    icon: LayoutDashboard,
    match: (p) => p === '/dashboard',
  },
  {
    href: '/devices',
    label: 'Thiết bị',
    icon: Package,
    match: (p) => p.startsWith('/devices'),
  },
  {
    href: '/subscriptions',
    label: 'Đăng ký',
    icon: RefreshCw,
    match: (p) => p.startsWith('/subscriptions'),
  },
  {
    href: '/wishlist',
    label: 'Đang thèm',
    icon: Heart,
    match: (p) => p.startsWith('/wishlist'),
  },
  {
    href: '/reminders',
    label: 'Nhắc nhở',
    icon: Bell,
    match: (p) => p.startsWith('/reminders'),
  },
  {
    href: '/stats',
    label: 'Thống kê',
    icon: BarChart3,
    match: (p) => p.startsWith('/stats'),
  },
  {
    href: '/settings',
    label: 'Cài đặt',
    icon: Settings,
    match: (p) => p.startsWith('/settings'),
  },
];

const STORAGE_KEY = 'wv-sidebar-collapsed';

// Subscribe to "storage" events so multiple tabs stay in sync.
function subscribe(cb: () => void) {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
}

function getSnapshot(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

// Server snapshot: render expanded; the client effect will swap if needed.
function getServerSnapshot(): boolean {
  return false;
}

export function Sidebar({ reminderCount = 0 }: { reminderCount?: number }) {
  const pathname = usePathname();
  const collapsed = React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const toggle = () => {
    try {
      const next = !collapsed;
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      // Manually notify subscribers in this tab — the "storage" event only
      // fires for cross-tab changes.
      window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
    } catch {
      // ignore
    }
  };

  return (
    <aside
      className={cn(
        'hidden md:flex md:flex-col md:border-r md:bg-card/30 md:transition-[width]',
        collapsed ? 'md:w-16' : 'md:w-60',
      )}
    >
      <div
        className={cn(
          'flex h-16 items-center gap-2 border-b px-4',
          collapsed && 'justify-center px-2',
        )}
      >
        <Vault className="h-6 w-6 shrink-0 text-primary" />
        {!collapsed && (
          <span className="text-base font-bold tracking-tight">AssetVault</span>
        )}
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);
          const showBadge =
            item.href === '/reminders' && reminderCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                'relative flex items-center rounded-md text-sm transition-colors',
                collapsed
                  ? 'justify-center p-2'
                  : 'justify-between gap-3 px-3 py-2',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              <span
                className={cn(
                  'flex items-center',
                  collapsed ? 'gap-0' : 'gap-3',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && item.label}
              </span>
              {showBadge && !collapsed && (
                <Badge
                  variant="destructive"
                  className={cn(
                    'h-5 min-w-5 justify-center px-1.5 text-[10px]',
                    active && 'bg-white/20 text-white',
                  )}
                >
                  {reminderCount}
                </Badge>
              )}
              {showBadge && collapsed && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                  {reminderCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div
        className={cn(
          'flex border-t p-2',
          collapsed ? 'justify-center' : 'items-center justify-between gap-2 px-3',
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
          title={collapsed ? 'Mở rộng' : 'Thu gọn'}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
        {!collapsed && (
          <span className="text-xs text-muted-foreground">v0.1 — local-first</span>
        )}
      </div>
    </aside>
  );
}

export function MobileSidebar({ reminderCount = 0 }: { reminderCount?: number }) {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex justify-around border-t bg-background py-2 md:hidden">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'relative flex flex-col items-center gap-0.5 rounded-md px-3 py-1 text-[11px]',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="h-5 w-5" />
            {item.label}
            {item.href === '/reminders' && reminderCount > 0 && (
              <span className="absolute right-1 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold text-destructive-foreground">
                {reminderCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
