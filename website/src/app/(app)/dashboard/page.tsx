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
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CategoryIcon } from '@/components/category-icon';
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

// Local helpers — replace the old prisma-backed `wishlistTotals()` and
// `subscriptionTotals()`. We pull the lists from the Go API and crunch the
// numbers on the RSC. Volumes are tiny (≤200 wishlist, ≤100 subs per user).

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

  const cards = [
    {
      label: 'Tổng thiết bị',
      value: stats.total,
      icon: Package,
      sub: 'Đang theo dõi',
      cardClass:
        'bg-primary/5 border-primary/10 hover:border-primary/30',
      iconClass: 'bg-primary/10 text-primary',
    },
    {
      label: 'Còn bảo hành',
      value: stats.active,
      icon: ShieldCheck,
      sub: 'Còn được bảo vệ',
      cardClass:
        'bg-emerald-500/5 border-emerald-500/10 hover:border-emerald-500/30',
      iconClass:
        'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Sắp hết (≤30 ngày)',
      value: stats.soon,
      icon: AlertTriangle,
      sub: 'Cần để ý nha',
      cardClass:
        'bg-amber-500/5 border-amber-500/10 hover:border-amber-500/30',
      iconClass:
        'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    },
    {
      label: 'Đã hết bảo hành',
      value: stats.expired,
      icon: ShieldX,
      sub: 'Hết kèo rồi',
      cardClass:
        'bg-muted/40 border-border hover:border-muted-foreground/30',
      iconClass:
        'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
          Chào{user.name ? `, ${user.name}` : ''} 👋
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
          Đây là tổng quan tình trạng bảo hành & chi phí của bạn hôm nay.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card
              key={c.label}
              className={cn(
                'rounded-2xl border shadow-sm transition-all duration-200 hover:shadow-md',
                c.cardClass,
              )}
            >
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {c.label}
                  </p>
                  <p className="mt-1.5 text-3xl font-bold tracking-tight">
                    {c.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.sub}</p>
                </div>
                <div
                  className={cn(
                    'flex size-12 shrink-0 items-center justify-center rounded-full',
                    c.iconClass,
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="rounded-2xl shadow-sm transition-shadow hover:shadow-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
            </span>
            Sắp hết bảo hành
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/reminders">
              Xem tất cả
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          {stats.soonList.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Tất cả đều ngon, không có gì sắp hết trong 30 ngày tới đâu.
            </p>
          ) : (
            <ul className="divide-y">
              {stats.soonList.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/devices/${d.id}`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-lg p-2 transition-colors hover:bg-accent"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="rounded-lg bg-muted p-2">
                        <CategoryIcon
                          category={d.category}
                          className="h-4 w-4 text-muted-foreground"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{d.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {CATEGORY_LABELS[d.category as keyof typeof CATEGORY_LABELS] ?? d.category}
                          {d.brand ? ` • ${d.brand}` : ''} • Mua {formatDate(d.purchaseDate)} •{' '}
                          {formatVND(d.purchasePrice)}
                        </p>
                      </div>
                    </div>
                    <WarrantyPill warrantyEnd={d.effectiveWarrantyEnd} variant="badge" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {subs.count > 0 && (
        <Card className="rounded-2xl shadow-sm transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <RefreshCw className="h-4 w-4" />
              </span>
              Gói đăng ký
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/subscriptions">
                Xem tất cả
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Mỗi tháng</p>
                <p className="mt-1 text-3xl font-bold">{formatVND(subs.monthly)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ~ {formatVND(subs.yearly)} / năm • {subs.count} gói đang hoạt động
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Sắp gia hạn</p>
                {subs.upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Không có gói nào sắp charge
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {subs.upcoming.slice(0, 4).map((u) => (
                      <li key={u.id} className="flex items-center gap-2 text-sm">
                        <RefreshCw className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {formatDate(u.renewalDate)}
                        </span>
                        <Link
                          href={`/subscriptions/${u.id}`}
                          className="truncate hover:underline"
                        >
                          {u.name}
                        </Link>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {formatVND(u.price)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {wishlist.count > 0 && (
        <Card className="rounded-2xl shadow-sm transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
                <Heart className="h-4 w-4" />
              </span>
              Đang thèm
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/wishlist">
                Xem tất cả
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">
                  Tổng tiền (giá hiện tại)
                </p>
                <p className="mt-1 text-3xl font-bold">{formatVND(wishlist.totalPrice)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {wishlist.count} món đang theo dõi
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Sắp tới ngày mua</p>
                {wishlist.upcoming.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Chưa có món nào đặt ngày dự kiến
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {wishlist.upcoming.map((u) => (
                      <li key={u.id} className="flex items-center gap-2 text-sm">
                        <Calendar className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {u.targetDate ? formatDate(u.targetDate) : ''}
                        </span>
                        <Link href={`/wishlist/${u.id}`} className="truncate hover:underline">
                          {u.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {stats.total === 0 && (
        <EmptyState
          title="Chưa có thiết bị nào, bắt đầu nào"
          description="Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... để theo dõi bảo hành tự động."
        />
      )}
    </div>
  );
}
