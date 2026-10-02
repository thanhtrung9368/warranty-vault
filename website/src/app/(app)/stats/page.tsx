import Link from 'next/link';
import {
  ShieldCheck,
  TrendingUp,
  Trophy,
  BarChart3,
  Package,
  PieChart,
  Calendar,
  RefreshCw,
  Wallet,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CategoryIconBadge } from '@/components/category-icon';
import { MonthlyBar, CategoryPie } from '@/components/charts/lazy';
import { YearPicker } from '@/components/year-picker';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import type { DeviceListItem, Warranty } from '@/lib/api/devices';
import {
  activeAssetValue,
  allTimeSpend,
  buildSpendEntries,
  entriesForYear,
  monthlySpendBuckets,
  spendByCategoryRollup,
  topExpensiveRollup,
  yearlySpend,
  yearsWithData,
} from '@/lib/stats-rollup';
import { CATEGORY_LABELS, type Category } from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { requireUser } from '@/lib/auth';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Money rollups are computed in-RSC from per-user reads:
//   - `GET /v1/devices` for the device rows,
//   - `GET /v1/devices/{id}/warranties` for each device's packages (the list
//     projection has no `cost`, and openapi exposes no bulk warranty read),
//   - `GET /v1/stats` for the Go-normalized subscription spend.
// Volumes are tiny (≤50 devices, ≤5 warranties each) so an in-memory rollup
// beats adding aggregation endpoints to Go just for the stats page.
//
// Warranty packages are attributed to the month/year of their `startDate` and
// to the category of the device they cover — that's when the money was spent.

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;

  const [devicesRes, statsRes] = await Promise.all([
    api.devices.list(),
    api.stats.get(),
  ]);
  const devices: DeviceListItem[] = devicesRes.ok ? devicesRes.data : [];
  const subscriptionStats = statsRes.ok ? statsRes.data.subscriptions : null;

  const warrantyResults = await Promise.all(
    devices.map(async (d) => ({
      deviceId: d.id,
      res: await api.warranties.listForDevice(d.id),
    })),
  );
  const warrantiesByDevice = new Map<string, Warranty[]>(
    warrantyResults.map((r) => [r.deviceId, r.res.ok ? r.res.data : []]),
  );
  // A partial warranty read would silently under-report the totals (the bug
  // this page used to have), so flag it instead of hiding it.
  const warrantiesComplete = warrantyResults.every((r) => r.res.ok);

  const entries = buildSpendEntries(devices, warrantiesByDevice);
  const total = devices.length;
  const subscriptionTotal = subscriptionStats?.total ?? 0;

  if (total === 0 && subscriptionTotal === 0) {
    return (
      <div className="space-y-6">
        <div>
          <p className="eyebrow">Tổng quan</p>
          <h1 className="display mt-1 text-3xl text-ink md:text-4xl">Thống kê</h1>
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
  const parsedYear = sp.year ? Number(sp.year) : currentYear;
  const year = Number.isFinite(parsedYear) ? parsedYear : currentYear;

  const monthly = monthlySpendBuckets(entries, 12);
  const byCategory = spendByCategoryRollup(devices, entries);
  // Year-scoped category list (device counts stay 0 — the card shows money).
  const yearByCategory = spendByCategoryRollup([], entriesForYear(entries, year));
  const yearTotal = yearlySpend(entries, year);
  const allTime = allTimeSpend(entries);
  const top = topExpensiveRollup(devices, 5);
  const asset = activeAssetValue(devices);

  const monthlySubs = subscriptionStats?.totalMonthlyVnd ?? 0;
  const activeSubs = subscriptionStats?.byStatus?.ACTIVE ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Tổng quan</p>
        <h1 className="display mt-1 text-3xl text-ink md:text-4xl">Thống kê</h1>
        <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
          Tổng quan chi phí mua sắm (thiết bị + gói bảo hành) và giá trị tài sản còn bảo hành.
        </p>
      </div>

      {!warrantiesComplete && (
        <div className="flex items-start gap-3 rounded-md bg-amber-soft p-3.5 text-sm text-amber-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            Không tải được gói bảo hành của một vài thiết bị — các con số bên dưới có thể thiếu.
          </p>
        </div>
      )}

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          eyebrow={`Tổng chi ${year}`}
          value={formatVND(yearTotal.total)}
          sub={`${yearTotal.deviceCount} thiết bị • ${yearTotal.warrantyCount} gói bảo hành`}
          tint="tint-amber"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <KpiCard
          eyebrow="Tổng chi mua sắm"
          value={formatVND(allTime.total)}
          sub={`${allTime.deviceCount} thiết bị • ${allTime.warrantyCount} gói bảo hành`}
          tint="tint-violet"
          icon={<Wallet className="h-5 w-5" />}
        />
        <KpiCard
          eyebrow="Tài sản còn bảo hành"
          value={formatVND(asset.total)}
          sub={`${asset.count}/${total} thiết bị`}
          tint="tint-emerald"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <KpiCard
          eyebrow="Phí định kỳ mỗi tháng"
          value={subscriptionStats ? formatVND(monthlySubs) : '—'}
          sub={
            subscriptionStats
              ? `${activeSubs} gói đang hoạt động • ~${formatVND(monthlySubs * 12)}/năm`
              : 'Không tải được số liệu đăng ký'
          }
          tint="tint-sky"
          icon={<RefreshCw className="h-5 w-5" />}
        />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
              <span className="icon-badge icon-badge-xs tint-primary">
                <BarChart3 className="h-3.5 w-3.5" />
              </span>
              Chi phí 12 tháng gần nhất
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Gồm tiền thiết bị và gói bảo hành (tính theo ngày bắt đầu của gói).
            </p>
          </CardHeader>
          <CardContent>
            <MonthlyBar data={monthly} />
          </CardContent>
        </Card>

        <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
              <span className="icon-badge icon-badge-xs tint-violet">
                <PieChart className="h-3.5 w-3.5" />
              </span>
              Phân bổ theo loại
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Gói bảo hành được tính vào loại của thiết bị mà nó bảo vệ.
            </p>
          </CardHeader>
          <CardContent>
            <CategoryPie data={byCategory} />
          </CardContent>
        </Card>
      </div>

      {/* Year breakdown + Top 5 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
              <span className="icon-badge icon-badge-xs tint-sky">
                <Calendar className="h-3.5 w-3.5" />
              </span>
              Tổng chi theo năm
            </CardTitle>
            <YearPicker years={years} value={year} />
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <span className="display text-3xl text-ink">{formatVND(yearTotal.total)}</span>
              <span className="pb-1 text-sm text-muted-foreground">
                ({yearTotal.deviceCount} thiết bị • {yearTotal.warrantyCount} gói trong {year})
              </span>
            </div>
            {yearByCategory.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                Chưa có chi phí nào trong năm {year}.
              </p>
            ) : (
              <ul className="mt-4 space-y-1">
                {yearByCategory
                  .filter((c) => c.total > 0)
                  .sort((a, b) => b.total - a.total)
                  .map((c) => (
                    <li key={c.category} className="info-row flex items-center gap-3 py-2">
                      <CategoryIconBadge category={c.category} size="xs" />
                      <span className="flex-1 truncate text-sm">{c.label}</span>
                      <span className="font-semibold tabular-nums text-ink-2">
                        {formatVND(c.total)}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
              <span className="icon-badge icon-badge-xs tint-amber">
                <Trophy className="h-3.5 w-3.5" />
              </span>
              Top 5 thiết bị đắt nhất
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Xếp theo giá mua thiết bị (chưa gồm gói bảo hành).
            </p>
          </CardHeader>
          <CardContent>
            {top.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Chưa có dữ liệu.</p>
            ) : (
              <ol>
                {top.map((d, i) => (
                  <li key={d.id}>
                    <Link
                      href={`/devices/${d.id}`}
                      className={cn(
                        'info-row flex items-center gap-3 py-2.5 hover:opacity-80',
                        i === 0 && '!border-t-0 pt-0',
                      )}
                    >
                      <span className={cn('rank', `rank-${i + 1}`)}>{i + 1}</span>
                      <CategoryIconBadge category={d.category} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-display text-sm font-bold text-ink">
                          {d.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {CATEGORY_LABELS[d.category as Category] ?? d.category}
                          {d.brand ? ` • ${d.brand}` : ''} • {formatDate(d.purchaseDate)}
                        </p>
                      </div>
                      <span className="font-display font-bold tabular-nums text-ink">
                        {formatVND(d.purchasePrice)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {total === 0 && (
        <EmptyState
          icon={Package}
          tone="primary"
          title="Chưa có thiết bị nào"
          description="Phí định kỳ bên trên vẫn được tính từ các gói đăng ký. Thêm thiết bị để thấy chi tiêu mua sắm ở đây."
          cta={false}
        />
      )}
    </div>
  );
}

function KpiCard({
  eyebrow,
  value,
  sub,
  tint,
  icon,
}: {
  eyebrow: string;
  value: string;
  sub: string;
  tint: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="stat-card">
      <span className={cn('icon-badge icon-badge-sm stat-icon', tint)}>{icon}</span>
      <p className="stat-eyebrow">{eyebrow}</p>
      <p className="stat-value text-ink">{value}</p>
      <p className="stat-sub">{sub}</p>
    </div>
  );
}
