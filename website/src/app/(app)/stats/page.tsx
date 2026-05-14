import Link from 'next/link';
import { ShieldCheck, TrendingUp, Trophy, BarChart3 } from 'lucide-react';
import { startOfMonth, subMonths, format } from 'date-fns';
import { vi } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CategoryIcon } from '@/components/category-icon';
import { MonthlyBar } from '@/components/charts/monthly-bar';
import { CategoryPie } from '@/components/charts/category-pie';
import { YearPicker } from '@/components/year-picker';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import type { DeviceListItem } from '@/lib/api/devices';
import { CATEGORY_LABELS, type Category } from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// All stats are now computed in-RSC from a single `GET /v1/devices` call.
// Volumes are tiny (≤50 devices per user) so an in-memory rollup beats
// adding aggregation endpoints to Go just for the stats page.

function monthlySpendBuckets(devices: DeviceListItem[], months = 12) {
  const start = startOfMonth(subMonths(new Date(), months - 1));
  const buckets = new Map<string, number>();
  for (let i = 0; i < months; i++) {
    const d = startOfMonth(subMonths(new Date(), months - 1 - i));
    buckets.set(format(d, 'yyyy-MM'), 0);
  }
  for (const d of devices) {
    const pd = new Date(d.purchaseDate);
    if (pd < start) continue;
    const key = format(startOfMonth(pd), 'yyyy-MM');
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + d.purchasePrice);
  }
  return Array.from(buckets.entries()).map(([k, total]) => {
    const [y, m] = k.split('-').map(Number);
    const dateObj = new Date(y, m - 1, 1);
    return {
      month: format(dateObj, 'MM/yy', { locale: vi }),
      total,
    };
  });
}

function spendByCategoryRollup(devices: DeviceListItem[]) {
  const map = new Map<string, { total: number; count: number }>();
  for (const d of devices) {
    const cur = map.get(d.category) ?? { total: 0, count: 0 };
    cur.total += d.purchasePrice;
    cur.count += 1;
    map.set(d.category, cur);
  }
  return Array.from(map.entries()).map(([category, v]) => ({
    category,
    label: CATEGORY_LABELS[category as Category] ?? category,
    total: v.total,
    count: v.count,
  }));
}

function yearlySpend(devices: DeviceListItem[], year: number) {
  let total = 0;
  let count = 0;
  for (const d of devices) {
    const pd = new Date(d.purchaseDate);
    if (pd.getFullYear() === year) {
      total += d.purchasePrice;
      count += 1;
    }
  }
  return { total, count };
}

function topExpensiveRollup(devices: DeviceListItem[], limit = 5) {
  return [...devices]
    .sort((a, b) => b.purchasePrice - a.purchasePrice)
    .slice(0, limit);
}

function activeAssetValue(devices: DeviceListItem[]) {
  const now = new Date();
  const active = devices.filter(
    (d) =>
      d.status === 'ACTIVE' &&
      d.effectiveWarrantyEnd != null &&
      new Date(d.effectiveWarrantyEnd) > now,
  );
  return {
    total: active.reduce((sum, d) => sum + d.purchasePrice, 0),
    count: active.length,
  };
}

function yearsWithData(devices: DeviceListItem[]): number[] {
  const set = new Set<number>();
  for (const d of devices) set.add(new Date(d.purchaseDate).getFullYear());
  set.add(new Date().getFullYear());
  return Array.from(set).sort((a, b) => b - a);
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const devicesRes = await api.devices.list();
  const devices: DeviceListItem[] = devicesRes.ok ? devicesRes.data : [];
  const total = devices.length;

  if (total === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Thống kê</h1>
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
            Chưa có gì để thống kê đâu — thêm thiết bị xong quay lại nhé.
          </p>
        </div>
        <EmptyState
          icon={BarChart3}
          tone="violet"
          title="Chưa có dữ liệu để thống kê"
          description="Thêm thiết bị xong tao sẽ vẽ chart cho mày xem chi tiêu mỗi tháng."
        />
      </div>
    );
  }

  const years = yearsWithData(devices);
  const currentYear = new Date().getFullYear();
  const year = sp.year ? Number(sp.year) : currentYear;

  const monthly = monthlySpendBuckets(devices, 12);
  const byCategory = spendByCategoryRollup(devices);
  const yearTotal = yearlySpend(devices, year);
  const top = topExpensiveRollup(devices, 5);
  const asset = activeAssetValue(devices);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Thống kê</h1>
        <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
          Tổng quan chi phí mua sắm và giá trị tài sản còn bảo hành.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="rounded-2xl border-amber-500/10 bg-amber-500/5 shadow-sm transition-all duration-200 hover:shadow-md">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Tổng chi {year}
              </p>
              <p className="mt-1.5 text-3xl font-bold tracking-tight">
                {formatVND(yearTotal.total)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{yearTotal.count} thiết bị</p>
            </div>
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <TrendingUp className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-emerald-500/10 bg-emerald-500/5 shadow-sm transition-all duration-200 hover:shadow-md">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Tài sản còn bảo hành
              </p>
              <p className="mt-1.5 text-3xl font-bold tracking-tight">
                {formatVND(asset.total)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{asset.count} thiết bị</p>
            </div>
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl border-primary/10 bg-primary/5 shadow-sm transition-all duration-200 hover:shadow-md">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Tổng số thiết bị
              </p>
              <p className="mt-1.5 text-3xl font-bold tracking-tight">{total}</p>
              <p className="mt-1 text-xs text-muted-foreground">đang theo dõi</p>
            </div>
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <BarChart3 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl shadow-sm transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Chi phí 12 tháng gần nhất</CardTitle>
          </CardHeader>
          <CardContent>
            <MonthlyBar data={monthly} />
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="text-base">Phân bổ theo loại</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryPie data={byCategory} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl shadow-sm transition-shadow hover:shadow-md">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Tổng chi theo năm</CardTitle>
            <YearPicker years={years} value={year} />
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <span className="text-3xl font-bold">{formatVND(yearTotal.total)}</span>
              <span className="pb-1 text-sm text-muted-foreground">
                ({yearTotal.count} thiết bị mua trong {year})
              </span>
            </div>
            <ul className="mt-4 grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              {byCategory
                .filter((c) => c.total > 0)
                .sort((a, b) => b.total - a.total)
                .map((c) => (
                  <li
                    key={c.category}
                    className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <CategoryIcon
                        category={c.category}
                        className="h-4 w-4 text-muted-foreground"
                      />
                      {c.label}
                    </span>
                    <span className="font-medium">{formatVND(c.total)}</span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex size-8 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Trophy className="h-4 w-4" />
              </span>
              Top 5 thiết bị đắt nhất
            </CardTitle>
          </CardHeader>
          <CardContent>
            {top.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
            ) : (
              <ol className="space-y-2">
                {top.map((d, i) => (
                  <li key={d.id}>
                    <Link
                      href={`/devices/${d.id}`}
                      className="flex items-center gap-3 rounded-md p-2 hover:bg-accent"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-sm font-bold">
                        {i + 1}
                      </span>
                      <CategoryIcon
                        category={d.category}
                        className="h-4 w-4 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{d.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {CATEGORY_LABELS[d.category as Category] ?? d.category}
                          {d.brand ? ` • ${d.brand}` : ''} • {formatDate(d.purchaseDate)}
                        </p>
                      </div>
                      <span className="font-semibold">{formatVND(d.purchasePrice)}</span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
