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
import { dashboardStats } from '@/lib/devices';
import { wishlistTotals } from '@/lib/wishlist';
import { subscriptionTotals } from '@/lib/subscriptions';
import { requireUser } from '@/lib/auth';
import { CATEGORY_LABELS } from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser();
  const [stats, wishlist, subs] = await Promise.all([
    dashboardStats(user.id),
    wishlistTotals(user.id),
    subscriptionTotals(user.id),
  ]);

  const cards = [
    {
      label: 'Tổng thiết bị',
      value: stats.total,
      icon: Package,
      tint: 'bg-primary/10 text-primary',
    },
    {
      label: 'Còn bảo hành',
      value: stats.active,
      icon: ShieldCheck,
      tint: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    },
    {
      label: 'Sắp hết (≤30 ngày)',
      value: stats.soon,
      icon: AlertTriangle,
      tint: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    },
    {
      label: 'Đã hết bảo hành',
      value: stats.expired,
      icon: ShieldX,
      tint: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400',
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tổng quan</h1>
        <p className="text-sm text-muted-foreground">
          Theo dõi nhanh tình trạng bảo hành các thiết bị của bạn.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label}>
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {c.label}
                  </p>
                  <p className="mt-1 text-2xl font-bold">{c.value}</p>
                </div>
                <div className={`rounded-lg p-3 ${c.tint}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
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
              Không có thiết bị nào sắp hết bảo hành trong 30 ngày tới.
            </p>
          ) : (
            <ul className="divide-y">
              {stats.soonList.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/devices/${d.id}`}
                    className="-mx-2 flex items-center justify-between gap-3 rounded-md p-2 hover:bg-accent"
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-sky-500" />
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5 text-rose-500" />
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

      {stats.total === 0 && <EmptyState />}
    </div>
  );
}
