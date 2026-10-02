import Link from 'next/link';
import {
  Package,
  ShieldCheck,
  AlertTriangle,
  ShieldX,
  ArrowRight,
  Heart,
  Calendar,
  RefreshCw,
  Plus,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryIconBadge } from '@/components/category-icon';
import { WarrantyPill } from '@/components/warranty-pill';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import type { WishlistItem } from '@/lib/api/wishlist';
import type { Subscription } from '@/lib/api/subscriptions';
import {
  monthlyEquivalent,
  SUBSCRIPTION_ACTIVE_STATUSES,
  type BillingCycle,
} from '@/lib/subscription-types';
import { WISHLIST_ACTIVE_STATUSES } from '@/lib/wishlist-types';
import { requireUser } from '@/lib/auth';
import { CATEGORY_LABELS } from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

// Local helpers — replaced the DB-side `wishlistTotals()` /
// `subscriptionTotals()` that went away with the Prisma layer in Phase F.
// We pull the lists from the Go API and crunch the numbers on the RSC.
// Volumes are tiny (≤200 wishlist, ≤100 subs per user).

type WishlistTotals = {
  count: number;
  totalPrice: number;
  upcoming: Array<Pick<WishlistItem, 'id' | 'name' | 'targetDate'>>;
};

function computeWishlistTotals(items: WishlistItem[]): WishlistTotals {
  const active = items.filter((i) =>
    (WISHLIST_ACTIVE_STATUSES as readonly string[]).includes(i.status),
  );
  const totalPrice = active.reduce(
    (sum, i) => sum + (i.currentPrice ?? i.initialPrice ?? 0),
    0,
  );
  const upcoming = active
    .filter((i) => i.targetDate)
    .sort(
      (a, b) =>
        new Date(a.targetDate ?? 0).getTime() - new Date(b.targetDate ?? 0).getTime(),
    )
    .slice(0, 3)
    .map((i) => ({ id: i.id, name: i.name, targetDate: i.targetDate }));
  return { count: active.length, totalPrice, upcoming };
}

type SubscriptionTotals = {
  count: number;
  monthly: number;
  yearly: number;
  upcoming: Array<Pick<Subscription, 'id' | 'name' | 'renewalDate' | 'price'>>;
};

function computeSubscriptionTotals(subs: Subscription[]): SubscriptionTotals {
  const active = subs.filter((s) =>
    (SUBSCRIPTION_ACTIVE_STATUSES as readonly string[]).includes(s.status),
  );
  let monthly = 0;
  for (const s of active) {
    const m = monthlyEquivalent(s.price, s.billingCycle as BillingCycle, s.intervalDays);
    if (m != null) monthly += m;
  }
  const upcoming = active
    .filter((s) => s.status === 'ACTIVE' && s.autoRenew && s.billingCycle !== 'LIFETIME')
    .sort(
      (a, b) =>
        new Date(a.renewalDate).getTime() - new Date(b.renewalDate).getTime(),
    )
    .slice(0, 5)
    .map((s) => ({ id: s.id, name: s.name, renewalDate: s.renewalDate, price: s.price }));
  return { count: active.length, monthly, yearly: monthly * 12, upcoming };
}

export const dynamic = 'force-dynamic';

function computeDeviceStats(devices: import('@/lib/api/devices').DeviceListItem[]) {
  const now = new Date();
  const in30 = new Date();
  in30.setDate(now.getDate() + 30);

  let active = 0;
  let soon = 0;
  let expired = 0;
  const soonItems: Array<{
    id: string;
    name: string;
    category: string;
    brand: string | null;
    purchaseDate: string;
    purchasePrice: number;
    effectiveWarrantyEnd: string;
  }> = [];

  for (const d of devices) {
    if (!d.effectiveWarrantyEnd) continue;
    const end = new Date(d.effectiveWarrantyEnd);
    if (d.status === 'ACTIVE' && end > now) active++;
    if (end < now) expired++;
    if (d.status === 'ACTIVE' && end > now && end <= in30) {
      soon++;
      soonItems.push({
        id: d.id,
        name: d.name,
        category: d.category,
        brand: d.brand,
        purchaseDate: d.purchaseDate,
        purchasePrice: d.purchasePrice,
        effectiveWarrantyEnd: d.effectiveWarrantyEnd,
      });
    }
  }

  soonItems.sort(
    (a, b) =>
      new Date(a.effectiveWarrantyEnd).getTime() -
      new Date(b.effectiveWarrantyEnd).getTime(),
  );

  return {
    total: devices.length,
    active,
    soon,
    expired,
    soonList: soonItems.slice(0, 8),
  };
}

type Tint = 'primary' | 'emerald' | 'amber' | 'zinc' | 'sky' | 'rose';
type StatCardProps = {
  label: string;
  value: number | string;
  icon: LucideIcon;
  sub: string;
  tone: Tint;
};

function StatCard({ label, value, icon: Icon, sub, tone }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-icon">
        <span className={cn('icon-badge', `tint-${tone}`)}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <div className="stat-eyebrow">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

function SectionCard({
  icon: Icon,
  tint,
  title,
  href,
  children,
}: {
  icon: LucideIcon;
  tint: Tint;
  title: string;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card p-5 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={cn('icon-badge icon-badge-sm', `tint-${tint}`)}>
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="font-display text-lg font-bold tracking-tight">
            {title}
          </h3>
        </div>
        <Button asChild variant="ghost" size="sm" className="h-8 px-3 text-primary">
          <Link href={href}>
            Xem tất cả
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
      {children}
    </div>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();
  const [devicesRes, wishlistRes, subsRes] = await Promise.all([
    api.devices.list(),
    api.wishlist.list({ status: 'ALL' }),
    api.subscriptions.list({ status: 'ALL' }),
  ]);
  const stats = computeDeviceStats(devicesRes.ok ? devicesRes.data : []);
  const wishlist = computeWishlistTotals(wishlistRes.ok ? wishlistRes.data.items : []);
  const subs = computeSubscriptionTotals(
    subsRes.ok ? subsRes.data.subscriptions : [],
  );

  const cards: StatCardProps[] = [
    {
      label: 'Tổng thiết bị',
      value: stats.total,
      icon: Package,
      sub: 'Đang theo dõi',
      tone: 'primary',
    },
    {
      label: 'Còn bảo hành',
      value: Math.max(0, stats.active - stats.soon),
      icon: ShieldCheck,
      sub: 'Còn được bảo vệ',
      tone: 'emerald',
    },
    {
      label: 'Sắp hết (≤30 ngày)',
      value: stats.soon,
      icon: AlertTriangle,
      sub: 'Cần để ý nha',
      tone: 'amber',
    },
    {
      label: 'Đã hết bảo hành',
      value: stats.expired,
      icon: ShieldX,
      sub: 'Hết kèo rồi',
      tone: 'zinc',
    },
  ];

  return (
    <div className="flex flex-col gap-7">
      {/* Hero greeting */}
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight md:text-[34px]">
          Chào{user.name ? `, ${user.name}` : ''}{' '}
          <span style={{ fontFamily: 'system-ui' }}>👋</span>
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
          Đây là tổng quan tình trạng bảo hành & chi phí của bạn hôm nay.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} />
        ))}
      </div>

      {/* Main grid — section cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Sắp hết bảo hành */}
        <SectionCard
          icon={AlertTriangle}
          tint="amber"
          title="Sắp hết bảo hành"
          href="/reminders"
        >
          {stats.soonList.length === 0 ? (
            <div className="py-3 text-sm text-muted-foreground">
              <span className="text-emerald-ink">✓</span> Tất cả đều ngon, không có
              gì sắp hết trong 30 ngày tới đâu.
            </div>
          ) : (
            <ul className="flex flex-col">
              {stats.soonList.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/devices/${d.id}`}
                    className="info-row -mx-2 items-center gap-3 rounded-md px-2 transition-colors hover:bg-secondary"
                  >
                    <CategoryIconBadge category={d.category} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink">
                        {d.name}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {CATEGORY_LABELS[d.category as keyof typeof CATEGORY_LABELS] ??
                          d.category}
                        {d.brand ? ` • ${d.brand}` : ''} • {formatDate(d.purchaseDate)}
                        {' • '}
                        {formatVND(d.purchasePrice)}
                      </div>
                    </div>
                    <WarrantyPill warrantyEnd={d.effectiveWarrantyEnd} variant="badge" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Subscriptions */}
        {subs.count > 0 && (
          <SectionCard
            icon={RefreshCw}
            tint="sky"
            title="Gói đăng ký"
            href="/subscriptions"
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <div className="stat-eyebrow">Mỗi tháng</div>
                <div className="font-display text-[28px] font-extrabold leading-tight tracking-tight">
                  {formatVND(subs.monthly)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  ~ {formatVND(subs.yearly)} / năm • {subs.count} gói đang hoạt động
                </div>
              </div>
              <div className="min-w-0">
                <div className="stat-eyebrow mb-1.5">Sắp gia hạn</div>
                {subs.upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Không có gói nào sắp charge
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {subs.upcoming.slice(0, 4).map((u) => (
                      <li key={u.id}>
                        <Link
                          href={`/subscriptions/${u.id}`}
                          className="flex items-center gap-2 text-[13px]"
                        >
                          <RefreshCw className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="font-semibold text-ink-2">
                            {formatDate(u.renewalDate)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {u.name}
                          </span>
                          <span className="font-semibold tabular-nums">
                            {formatVND(u.price)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </SectionCard>
        )}

        {/* Wishlist */}
        {wishlist.count > 0 && (
          <SectionCard icon={Heart} tint="rose" title="Đang thèm" href="/wishlist">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <div className="stat-eyebrow">Tổng tiền (giá hiện tại)</div>
                <div className="font-display text-[28px] font-extrabold leading-tight tracking-tight">
                  {formatVND(wishlist.totalPrice)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {wishlist.count} món đang theo dõi
                </div>
              </div>
              <div className="min-w-0">
                <div className="stat-eyebrow mb-1.5">Sắp tới ngày mua</div>
                {wishlist.upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Chưa có món nào đặt ngày dự kiến
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {wishlist.upcoming.map((u) => (
                      <li key={u.id}>
                        <Link
                          href={`/wishlist/${u.id}`}
                          className="flex items-center gap-2 text-[13px]"
                        >
                          <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" />
                          <span className="font-semibold text-ink-2">
                            {u.targetDate ? formatDate(u.targetDate) : ''}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {u.name}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </SectionCard>
        )}

        {/* Quick add — chunky playful card */}
        <div
          className="rounded-[var(--radius)] border-2 border-ink bg-gradient-to-br from-primary-soft to-primary-soft-2 p-5 shadow-chunky"
        >
          <div className="mb-3 flex items-center gap-2.5">
            <Zap className="h-5 w-5 text-primary-ink" />
            <h3 className="font-display text-lg font-extrabold tracking-tight text-primary-ink">
              Thêm nhanh
            </h3>
          </div>
          <p className="mb-4 text-[13px] text-primary-ink/85">
            Mới mua đồ? Note ngay vào kẻo lại quên.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" className="h-9">
              <Link href="/devices/new">
                <Plus className="mr-1 h-3.5 w-3.5" />
                Thiết bị
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 bg-card">
              <Link href="/subscriptions/new">
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                Gói đăng ký
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 bg-card">
              <Link href="/wishlist/new">
                <Heart className="mr-1 h-3.5 w-3.5" />
                Wishlist
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {stats.total === 0 && (
        <EmptyState
          title="Chưa có thiết bị nào, bắt đầu nào"
          description="Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... để theo dõi bảo hành tự động."
        />
      )}
    </div>
  );
}
