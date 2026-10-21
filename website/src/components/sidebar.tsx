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
  Inbox,
  Wrench,
  Menu,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
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
    // Capture-first inbox: receipts uploaded before a device is chosen. Sits
    // next to "Việc cần xử lý" because both are queues of things still waiting
    // for a decision, and its badge is exactly the number of unfiled files.
    href: '/inbox',
    label: 'Hộp thư',
    icon: Inbox,
    match: (p) => p.startsWith('/inbox'),
  },
  {
    href: '/devices',
    label: 'Thiết bị',
    icon: Package,
    match: (p) => p.startsWith('/devices'),
  },
  {
    // Cross-device repair cases. Deliberately a sibling of /devices rather
    // than a tab inside it: "what is at the shop right now" spans every
    // device, which is exactly what the per-device card cannot answer.
    href: '/claims',
    label: 'Sửa chữa',
    icon: Wrench,
    match: (p) => p.startsWith('/claims'),
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

const ITEM_BY_HREF = new Map(items.map((item) => [item.href, item]));

function itemFor(href: string): NavItem {
  const item = ITEM_BY_HREF.get(href);
  if (!item) throw new Error(`sidebar: unknown nav href ${href}`);
  return item;
}

// Ten flat destinations is a list, not a map. Three labelled groups put the
// three questions the app answers in order — "what am I tracking?", "what needs
// me?", "everything else" — and Settings is pinned to the bottom because it is
// about the account, not about the vault. The labels are Vietnamese catalog
// keys (`messages/common.ts`).
const NAV_GROUPS: { id: string; label: string; hrefs: string[] }[] = [
  { id: 'tracking', label: 'Theo dõi', hrefs: ['/dashboard', '/devices', '/reminders'] },
  { id: 'attention', label: 'Cần chú ý', hrefs: ['/actions', '/inbox', '/claims'] },
  { id: 'more', label: 'Mục khác', hrefs: ['/subscriptions', '/wishlist', '/stats'] },
];

// Material's phone guidance is 3–5 fixed destinations. The five the phone keeps
// are the ones that answer "now": overview, the vault itself, the two queues,
// and a way to reach everything else. The other six (Settings included) live in
// the "More" sheet.
const MOBILE_PRIMARY_HREFS = ['/dashboard', '/devices', '/actions', '/inbox'];
const MOBILE_SHEET_HREFS = [
  '/reminders',
  '/claims',
  '/subscriptions',
  '/wishlist',
  '/stats',
  '/settings',
];

// Per-item badge. The reminders count is "gói bảo hành sắp hết"; the actions
// count is `ActionQueue.counts.total`, i.e. the ACTIONABLE subset — the server
// keeps snoozed rows out of it on purpose, so a snooze never inflates the badge.
// The inbox count is unfiled attachments, which by contract occupy no device
// slot — it is not a fifth "device full" warning.
function navBadge(
  href: string,
  reminderCount: number,
  actionCount: number,
  inboxCount: number,
): number {
  if (href === '/reminders') return reminderCount;
  if (href === '/actions') return actionCount;
  if (href === '/inbox') return inboxCount;
  return 0;
}

const BADGE_CLASS: Record<string, string> = {
  '/reminders': 'bg-primary text-primary-foreground',
  '/actions': 'bg-amber-soft text-amber-ink',
  '/inbox': 'bg-sky-soft text-sky-ink',
};

export function Sidebar({
  reminderCount = 0,
  actionCount = 0,
  inboxCount = 0,
}: {
  reminderCount?: number;
  actionCount?: number;
  inboxCount?: number;
}) {
  const pathname = usePathname();
  const t = useT();

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = item.match(pathname);
    const badge = navBadge(item.href, reminderCount, actionCount, inboxCount);
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
            className="absolute -left-3.5 top-2.5 bottom-2.5 w-1 rounded-r-sm bg-primary"
          />
        )}
        <span className="flex w-[22px] items-center justify-center">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className="wv-sidebar-label flex-1 truncate">{t(item.label)}</span>
        {badge > 0 && (
          <span
            className={cn(
              'wv-sidebar-badge ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold',
              BADGE_CLASS[item.href] ?? 'bg-primary text-primary-foreground',
            )}
          >
            {badge}
          </span>
        )}
      </Link>
    );
  };

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
        <span className="wv-sidebar-brand-text font-display text-lg font-extrabold tracking-tight text-ink">
          Warrly
        </span>
      </Link>

      {/* Grouped nav. The scrolling area holds the three groups; Settings sits
          outside it so it stays pinned to the bottom however short the viewport
          is (it used to be the tenth item of the same flat list). */}
      <nav className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-[0.09em] text-muted-foreground">
              {t(group.label)}
            </p>
            {group.hrefs.map((href) => renderItem(itemFor(href)))}
          </div>
        ))}
      </nav>
      <div className="mt-1 border-t border-border pt-2">
        {renderItem(itemFor('/settings'))}
      </div>
    </aside>
  );
}

/**
 * Phone navigation: exactly five fixed destinations, as Material guidance says
 * (3–5). It used to render all ten in a horizontal scroller — about 5.5 fit at
 * 390px, there was no affordance that more existed, and on `/settings` the
 * strip opened scrolled to its end.
 *
 * Overview / Devices / Action items / Inbox are the four that answer "now";
 * "More" opens a bottom sheet with the remaining six (Reminders, Claims,
 * Subscriptions, Wishlist, Stats, Settings). The sheet can show the reminder
 * badge that the bar no longer has a slot for, and the More button still
 * carries the total of the hidden badges so a due reminder is never invisible.
 * Hidden on desktop (the sidebar takes over from md: up).
 */
export function MobileBottomNav({
  reminderCount = 0,
  actionCount = 0,
  inboxCount = 0,
}: {
  reminderCount?: number;
  actionCount?: number;
  inboxCount?: number;
}) {
  const pathname = usePathname();
  const t = useT();
  const [moreOpen, setMoreOpen] = React.useState(false);
  // A route change (including back/forward while the sheet is open) closes it;
  // the rows also close it on click so the page transition is not behind an
  // overlay.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- closing a sheet in response to navigation
    setMoreOpen(false);
  }, [pathname]);

  const primary = MOBILE_PRIMARY_HREFS.map(itemFor);
  const sheet = MOBILE_SHEET_HREFS.map(itemFor);
  const moreActive = sheet.some((item) => item.match(pathname));
  // The bar has no Reminders slot anymore, so the More button carries the sum
  // of the badges hiding behind it. Today that is only the reminder count.
  const moreBadge = sheet.reduce(
    (sum, item) => sum + navBadge(item.href, reminderCount, actionCount, inboxCount),
    0,
  );

  const itemClass = (active: boolean) =>
    cn(
      'relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-pill px-0.5 text-xs font-semibold transition-colors',
      active ? 'bg-primary-soft text-primary-ink' : 'text-ink-2 hover:text-ink',
    );

  return (
    <nav
      className="fixed bottom-3 left-3 right-3 z-40 flex h-16 items-center gap-1 rounded-pill border border-border bg-card p-1.5 shadow-lift md:hidden"
      aria-label={t('Điều hướng chính')}
    >
      {primary.map((item) => {
        const Icon = item.icon;
        const active = item.match(pathname);
        const badge = navBadge(item.href, reminderCount, actionCount, inboxCount);
        return (
          <Link
            key={item.href}
            href={item.href}
            data-active={active ? 'true' : undefined}
            aria-label={t(item.label)}
            className={itemClass(active)}
          >
            <Icon className="h-5 w-5" />
            <span className="block min-h-[23px] w-full text-center leading-[1.15]">{t(item.label)}</span>
            {badge > 0 && (
              <span
                className={cn(
                  'absolute right-1.5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-xs font-bold',
                  BADGE_CLASS[item.href] ?? 'bg-primary text-primary-foreground',
                )}
              >
                {badge}
              </span>
            )}
          </Link>
        );
      })}

      <Dialog open={moreOpen} onOpenChange={setMoreOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            data-active={moreActive ? 'true' : undefined}
            aria-label={t('Mục khác')}
            className={itemClass(moreActive)}
          >
            <Menu className="h-5 w-5" />
            <span className="block min-h-[23px] w-full text-center leading-[1.15]">{t('Mục khác')}</span>
            {moreBadge > 0 && (
              <span className="absolute right-1.5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                {moreBadge}
              </span>
            )}
          </button>
        </DialogTrigger>
        <DialogContent
          placement="bottom"
          className="max-h-[85vh] overflow-y-auto md:hidden"
        >
          <DialogTitle className="font-display text-lg font-bold tracking-tight">
            {t('Mục khác')}
          </DialogTitle>
          {/* Radix wants a description for the dialog; the nav landmark already
              carries the same sentence for screen readers. */}
          <DialogDescription className="sr-only">
            {t('Điều hướng chính')}
          </DialogDescription>
          <div className="grid gap-1">
            {sheet.map((item) => {
              const Icon = item.icon;
              const active = item.match(pathname);
              const badge = navBadge(item.href, reminderCount, actionCount, inboxCount);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  data-active={active ? 'true' : undefined}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-colors',
                    active
                      ? 'bg-primary-soft text-primary-ink'
                      : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  <span className="flex-1 truncate">{t(item.label)}</span>
                  {badge > 0 && (
                    <span
                      className={cn(
                        'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold',
                        BADGE_CLASS[item.href] ?? 'bg-primary text-primary-foreground',
                      )}
                    >
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </nav>
  );
}

// Back-compat export — older callers import `MobileSidebar`.
export const MobileSidebar = MobileBottomNav;
