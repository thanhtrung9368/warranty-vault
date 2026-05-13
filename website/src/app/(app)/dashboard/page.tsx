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
import { wishlistTotals } from '@/lib/wishlist';
import { subscriptionTotals } from '@/lib/subscriptions';
import { requireUser } from '@/lib/auth';
import { CATEGORY_LABELS } from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Mirror of the previous dashboardStats() projection — computed in-memory
// from the device list since the Go service exposes per-device warranty
// metadata via `effectiveWarrantyEnd` on every list row.
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
  const [devicesRes, wishlist, subs] = await Promise.all([
    api.devices.list(),
    wishlistTotals(user.id),
    subscriptionTotals(user.id),
  ]);
  const stats = computeDeviceStats(devicesRes.ok ? devicesRes.data : []);

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
