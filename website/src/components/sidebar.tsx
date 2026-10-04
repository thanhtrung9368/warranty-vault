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
  ListChecks,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n/client';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match: (path: string) => boolean;
};

// `label` stays the Vietnamese ORIGINAL — it is the dictionary key, looked up
// with `t(item.label)` at render time (see `lib/i18n/catalog.ts`), so the nav
// cannot drift from the headings the catalogue already carries: `Tổng quan` is
// `messages/dashboard.ts`'s "Overview", `Đang thèm` is its (and
// `messages/wishlist.ts`'s) "Wishlist".
//
// The `/subscriptions` item reads `Gói đăng ký`, not the shorter `Đăng ký` it
// used to. This is the one place the "key is the Vietnamese sentence" design
// forced a COPY change, and it is worth knowing why: `Đăng ký` is also the
// account-creation action ("Sign up") in `messages/common.ts`, and one
// Vietnamese key can only carry one English. Left alone, an English nav read
// "Sign up" and pointed at the subscription list. `Gói đăng ký` is the term the
// subscriptions page itself uses for its `<h1>`, it is already registered as
// "Subscriptions", and it says what the section holds instead of naming the
// act of signing up for it. Same fix applied to the two back links in
// `(app)/subscriptions/new/page.tsx` and `[id]/page.tsx`, which had it worse:
// they read "Sign up" while navigating AWAY from the subscriptions list.
const items: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Tổng quan',
    icon: LayoutDashboard,
    match: (p) => p === '/dashboard',
  },
  {
    href: '/actions',
    label: 'Việc cần xử lý',
    icon: ListChecks,
    match: (p) => p.startsWith('/actions'),
  },
  {
    href: '/devices',
    label: 'Thiết bị',
    icon: Package,
    match: (p) => p.startsWith('/devices'),
  },
  {
    href: '/subscriptions',
    label: 'Gói đăng ký',
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

// Per-item badge. The reminders count is "gói bảo hành sắp hết"; the actions
// count is `ActionQueue.counts.total`, i.e. the ACTIONABLE subset — the server
// keeps snoozed rows out of it on purpose, so a snooze never inflates the badge.
function navBadge(href: string, reminderCount: number, actionCount: number): number {
  if (href === '/reminders') return reminderCount;
  if (href === '/actions') return actionCount;
  return 0;
}

const BADGE_CLASS: Record<string, string> = {
  '/reminders': 'bg-primary text-primary-foreground',
  '/actions': 'bg-amber-soft text-amber-ink',
};

export function Sidebar({
  reminderCount = 0,
  actionCount = 0,
}: {
  reminderCount?: number;
  actionCount?: number;
}) {
  const pathname = usePathname();
  const t = useT();

  return (
    <aside className="wv-sidebar sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1.5 border-r border-border bg-card px-3.5 py-4 md:flex">
      {/* Brand */}
      <Link
        href="/dashboard"
        className="wv-sidebar-brand flex items-center gap-2.5 px-2 pb-4 pt-2.5"
      >
        <span className="brand-mark brand-mark-sm">
          <Vault className="h-4 w-4" />
        </span>
        <span className="wv-sidebar-brand-text font-display text-[17px] font-extrabold tracking-tight text-ink">
          WarrantyVault
        </span>
      </Link>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.match(pathname);
          const badge = navBadge(item.href, reminderCount, actionCount);
          return (
            <Link
              key={item.href}
              href={item.href}
              data-active={active ? 'true' : undefined}
              title={t(item.label)}
              aria-label={t(item.label)}
              className={cn(
                'wv-sidebar-item relative flex h-[42px] items-center gap-3 overflow-hidden rounded-md px-3 text-sm font-semibold transition-colors',
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
              <span className="wv-sidebar-label flex-1 truncate">{t(item.label)}</span>
              {badge > 0 && (
                <span
                  className={cn(
                    'wv-sidebar-badge ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
                    BADGE_CLASS[item.href] ?? 'bg-primary text-primary-foreground',
                  )}
                >
                  {badge}
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
 * Mobile pill-shaped bottom navigation. Renders every section (same order +
 * labels as the desktop sidebar) in a horizontally scrollable strip — all 8
 * entries don't fit on a phone at once, so the active one is scrolled into
 * view. Hidden on desktop (sidebar takes over from md: up).
 */
export function MobileBottomNav({
  reminderCount = 0,
  actionCount = 0,
}: {
  reminderCount?: number;
  actionCount?: number;
}) {
  const pathname = usePathname();
  const t = useT();
  const navRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [pathname]);

  return (
    <nav
      ref={navRef}
      className="no-scrollbar fixed bottom-3 left-3 right-3 z-40 flex h-16 items-center gap-1 overflow-x-auto rounded-pill border border-border bg-card p-1.5 shadow-lift md:hidden"
      aria-label={t('Điều hướng chính')}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        const badge = navBadge(item.href, reminderCount, actionCount);
        return (
          <Link
            key={item.href}
            href={item.href}
            data-active={active ? 'true' : undefined}
            aria-label={t(item.label)}
            className={cn(
              'relative flex h-full min-w-[62px] flex-1 flex-col items-center justify-center gap-0.5 rounded-pill px-1.5 text-[10px] font-semibold transition-colors',
              active
                ? 'bg-primary-soft text-primary-ink'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            <Icon className="h-5 w-5" />
            <span className="whitespace-nowrap leading-none">{t(item.label)}</span>
            {badge > 0 && (
              <span
                className={cn(
                  'absolute right-2 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold',
                  BADGE_CLASS[item.href] ?? 'bg-primary text-primary-foreground',
                )}
              >
                {badge}
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
