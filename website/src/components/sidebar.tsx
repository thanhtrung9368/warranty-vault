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
} from 'lucide-react';
import { cn } from '@/lib/utils';

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

export function Sidebar({ reminderCount = 0 }: { reminderCount?: number }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1.5 border-r border-border bg-card px-3.5 py-4 md:flex">
      {/* Brand */}
      <Link
        href="/dashboard"
        className="flex items-center gap-2.5 px-2 pb-4 pt-2.5"
      >
        <span className="brand-mark brand-mark-sm">
          <Vault className="h-4 w-4" />
        </span>
        <span className="font-display text-[17px] font-extrabold tracking-tight text-ink">
          WarrantyVault
        </span>
      </Link>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);
          const showBadge = item.href === '/reminders' && reminderCount > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-active={active ? 'true' : undefined}
              className={cn(
                'relative flex h-[42px] items-center gap-3 overflow-hidden rounded-md px-3 text-sm font-semibold transition-colors',
                active
                  ? 'bg-primary-soft text-primary-ink'
                  : 'text-ink-2 hover:bg-secondary hover:text-ink',
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute -left-3.5 top-2.5 bottom-2.5 w-1 rounded-r bg-primary"
                />
              )}
              <span className="flex w-[22px] items-center justify-center">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="flex-1 truncate">{item.label}</span>
              {showBadge && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                  {reminderCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/**
 * Mobile pill-shaped bottom navigation — 5 most important destinations.
 * Hidden on desktop (sidebar takes over from md: up).
 */
export function MobileBottomNav({
  reminderCount = 0,
}: {
  reminderCount?: number;
}) {
  const pathname = usePathname();
  const mobileItems = items.filter((i) =>
    ['/dashboard', '/devices', '/subscriptions', '/wishlist', '/settings'].includes(
      i.href,
    ),
  );
  return (
    <nav
      className="fixed bottom-3 left-3 right-3 z-40 flex h-16 items-center justify-around rounded-pill border border-border bg-card p-1.5 shadow-lift md:hidden"
      aria-label="Điều hướng chính"
    >
      {mobileItems.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        const showBadge = item.href === '/reminders' && reminderCount > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            data-active={active ? 'true' : undefined}
            className={cn(
              'relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-pill px-1 text-[10px] font-semibold transition-colors',
              active
                ? 'bg-primary-soft text-primary-ink'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="leading-none">{item.label}</span>
            {showBadge && (
              <span className="absolute right-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {reminderCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// Back-compat export — older callers import `MobileSidebar`.
export const MobileSidebar = MobileBottomNav;
