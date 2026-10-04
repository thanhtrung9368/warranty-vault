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
  Coins,
  TrendingDown,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CategoryIconBadge } from '@/components/category-icon';
import { MonthlyBar, CategoryPie } from '@/components/charts/lazy';
import { ForecastPanel } from '@/components/forecast-panel';
import { YearPicker } from '@/components/year-picker';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import type { DeviceListItem, Warranty } from '@/lib/api/devices';
import {
  activeAssetValue,
  allTimeSpend,
  buildSpendEntries,
  costPerDayRollup,
  entriesForYear,
  monthlySpendBuckets,
  spendByCategoryRollup,
  topExpensiveRollup,
  yearlySpend,
  yearsWithData,
  type CostPerDayRankRow,
} from '@/lib/stats-rollup';
import { isForecastEmpty, normalizeForecastMonths } from '@/lib/forecast-rollup';
import { categoryLabel } from '@/lib/i18n/labels';
import { getI18n } from '@/lib/i18n/server';
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
  // `fm` = forecast window in months (1–24; the picker offers 3/6/12/24).
  searchParams: Promise<{ year?: string; fm?: string }>;
}) {
  await requireUser();
  const { locale, t } = await getI18n();
  const sp = await searchParams;
  const forecastMonths = normalizeForecastMonths(sp.fm);

  const [devicesRes, statsRes, forecastRes] = await Promise.all([
    api.devices.list(),
    api.stats.get(),
    api.stats.forecast(forecastMonths),
  ]);
  const devices: DeviceListItem[] = devicesRes.ok ? devicesRes.data : [];
  const subscriptionStats = statsRes.ok ? statsRes.data.subscriptions : null;
  const forecast = forecastRes.ok ? forecastRes.data : null;

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

  // The forecast is part of "is there anything to show here": a user whose only
  // data is a dated wishlist item has a milestone to forecast, so they must not
  // get the "chưa có gì để thống kê" empty state.
  if (total === 0 && subscriptionTotal === 0 && isForecastEmpty(forecast, locale)) {
    return (
      <div className="space-y-6">
        <div>
          <p className="eyebrow">{t('Tổng quan')}</p>
          <h1 className="display mt-1 text-3xl text-ink md:text-4xl">{t('Thống kê')}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
            {t('Chưa có gì để thống kê đâu — thêm thiết bị xong quay lại nhé.')}
          </p>
        </div>
        <EmptyState
          icon={BarChart3}
          tone="violet"
          title={t('Chưa có dữ liệu để thống kê')}
          description={t('Thêm thiết bị xong tao sẽ vẽ chart cho mày xem chi tiêu mỗi tháng.')}
        />
      </div>
    );
  }

  const years = yearsWithData(devices);
  const currentYear = new Date().getFullYear();
  const parsedYear = sp.year ? Number(sp.year) : currentYear;
  const year = Number.isFinite(parsedYear) ? parsedYear : currentYear;

  const monthly = monthlySpendBuckets(entries, 12, locale);
  const byCategory = spendByCategoryRollup(devices, entries, locale);
  // Year-scoped category list (device counts stay 0 — the card shows money).
  const yearByCategory = spendByCategoryRollup([], entriesForYear(entries, year), locale);
  const yearTotal = yearlySpend(entries, year);
  const allTime = allTimeSpend(entries);
  const top = topExpensiveRollup(devices, 5);
  const asset = activeAssetValue(devices);
  // đ/ngày (FEATURE_IDEAS #7): the inverse story of `top`. Same pure helper the
  // device detail card uses, over the same warranty map this page already
  // fetched — no extra request, no second money-math variant.
  const perDayRanking = costPerDayRollup(devices, warrantiesByDevice, {
    limit: 5,
    locale,
  });

  const monthlySubs = subscriptionStats?.totalMonthlyVnd ?? 0;
  const activeSubs = subscriptionStats?.byStatus?.ACTIVE ?? 0;

  // "Không xếp hạng: …" — one sentence built from whichever reasons apply, so
  // the note reads as one line rather than a fragment glued together in JSX.
  const skippedNote = [
    perDayRanking.skipped.noPurchaseDate > 0
      ? t('{count} thiết bị thiếu ngày mua', { count: perDayRanking.skipped.noPurchaseDate })
      : null,
    perDayRanking.skipped.noRecordedCost > 0
      ? t('{count} thiết bị chưa ghi giá', { count: perDayRanking.skipped.noRecordedCost })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{t('Tổng quan')}</p>
        <h1 className="display mt-1 text-3xl text-ink md:text-4xl">{t('Thống kê')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
          {t(
            'Tổng quan chi phí mua sắm (thiết bị + gói bảo hành) và giá trị tài sản còn bảo hành.',
          )}
        </p>
      </div>

      {!warrantiesComplete && (
        <div className="flex items-start gap-3 rounded-md bg-amber-soft p-3.5 text-sm text-amber-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            {t(
              'Không tải được gói bảo hành của một vài thiết bị — các con số bên dưới có thể thiếu.',
            )}
          </p>
        </div>
      )}

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          eyebrow={t('Tổng chi {year}', { year })}
          value={formatVND(yearTotal.total, locale)}
          sub={t('{devices} thiết bị • {warranties} gói bảo hành', {
            devices: yearTotal.deviceCount,
            warranties: yearTotal.warrantyCount,
          })}
          tint="tint-amber"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <KpiCard
          eyebrow={t('Tổng chi mua sắm')}
          value={formatVND(allTime.total, locale)}
          sub={t('{devices} thiết bị • {warranties} gói bảo hành', {
            devices: allTime.deviceCount,
            warranties: allTime.warrantyCount,
          })}
          tint="tint-violet"
          icon={<Wallet className="h-5 w-5" />}
        />
        <KpiCard
          eyebrow={t('Tài sản còn bảo hành')}
          value={formatVND(asset.total, locale)}
          sub={t('{count}/{total} thiết bị', { count: asset.count, total })}
          tint="tint-emerald"
          icon={<ShieldCheck className="h-5 w-5" />}
        />
        <KpiCard
          eyebrow={t('Phí định kỳ mỗi tháng')}
          value={subscriptionStats ? formatVND(monthlySubs, locale) : '—'}
          sub={
            subscriptionStats
              ? t('{count} gói đang hoạt động • ~{amount}/năm', {
                  count: activeSubs,
                  amount: formatVND(monthlySubs * 12, locale),
                })
              : t('Không tải được số liệu đăng ký')
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
              {t('Chi phí 12 tháng gần nhất')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t('Gồm tiền thiết bị và gói bảo hành (tính theo ngày bắt đầu của gói).')}
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
              {t('Phân bổ theo loại')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t('Gói bảo hành được tính vào loại của thiết bị mà nó bảo vệ.')}
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
              {t('Tổng chi theo năm')}
            </CardTitle>
            <YearPicker years={years} value={year} />
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <span className="display text-3xl text-ink">
                {formatVND(yearTotal.total, locale)}
              </span>
              <span className="pb-1 text-sm text-muted-foreground">
                {t('({devices} thiết bị • {warranties} gói trong {year})', {
                  devices: yearTotal.deviceCount,
                  warranties: yearTotal.warrantyCount,
                  year,
                })}
              </span>
            </div>
            {yearByCategory.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                {t('Chưa có chi phí nào trong năm {year}.', { year })}
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
                        {formatVND(c.total, locale)}
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
              {t('Top 5 thiết bị đắt nhất')}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {t('Xếp theo giá mua thiết bị (chưa gồm gói bảo hành).')}
            </p>
          </CardHeader>
          <CardContent>
            {top.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('Chưa có dữ liệu.')}
              </p>
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
                          {categoryLabel(d.category, locale)}
                          {d.brand ? ` • ${d.brand}` : ''} •{' '}
                          {formatDate(d.purchaseDate, locale)}
                        </p>
                      </div>
                      <span className="font-display font-bold tabular-nums text-ink">
                        {formatVND(d.purchasePrice, locale)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── đ/ngày (FEATURE_IDEAS #7) ──────────────────────────────────────
          The deliberate inverse of "Top 5 thiết bị đắt nhất" above: raw price
          says what you paid once, đ/ngày says what the thing costs you to own.
          Both directions are shown because they tell different stories — the
          machine that is cheapest per day is often the most expensive one. */}
      <Card
        id="chi-phi-moi-ngay"
        className="scroll-mt-24 rounded-lg border-[1.5px] border-border bg-card shadow-soft"
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
            <span className="icon-badge icon-badge-xs tint-amber">
              <Coins className="h-3.5 w-3.5" />
            </span>
            {t('Chi phí mỗi ngày')}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {t(
              '(giá mua + gói bảo hành − tiền bán) ÷ số ngày sở hữu. Máy đắt mà dùng lâu có thể rẻ mỗi ngày hơn máy rẻ mà dùng ngắn.',
            )}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <CostPerDayList
              title={t('Rẻ nhất mỗi ngày')}
              icon={<TrendingDown className="h-3.5 w-3.5" />}
              tone="emerald"
              rows={perDayRanking.cheapest}
            />
            <CostPerDayList
              title={t('Đắt nhất mỗi ngày')}
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              tone="rose"
              rows={perDayRanking.priciest}
            />
          </div>
          {skippedNote !== '' && (
            <p className="border-t border-dashed border-border pt-3 text-xs text-muted-foreground">
              {t('Không xếp hạng:')} {skippedNote}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Forward-looking half ──────────────────────────────────────────
          `GET /v1/forecast?months=` — the next N months of subscription
          charges, warranty expiries and wishlist milestones. It is a separate
          endpoint from /v1/stats (whose shape all three clients share), and its
          two reference money columns are never presented as committed spend. */}
      {forecast ? (
        <ForecastPanel forecast={forecast} months={forecastMonths} year={sp.year} />
      ) : (
        <div className="flex items-start gap-3 rounded-md bg-amber-soft p-3.5 text-sm text-amber-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            {t('Không tải được dự báo chi tiêu — phần dự báo tạm ẩn, thử tải lại trang nhé.')}
          </p>
        </div>
      )}

      {total === 0 && (
        <EmptyState
          icon={Package}
          tone="primary"
          title={t('Chưa có thiết bị nào')}
          description={t(
            'Phí định kỳ bên trên vẫn được tính từ các gói đăng ký. Thêm thiết bị để thấy chi tiêu mua sắm ở đây.',
          )}
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

// One direction of the đ/ngày leaderboard. `≥` marks a figure that is only a
// lower bound because at least one warranty package has no recorded cost — the
// row stays in the ranking, but the number cannot be read as exact.
//
// It resolves the language itself (`getI18n()` is `cache()`d per request, so
// this costs nothing): the component is small enough that threading a
// translator through its props would be more code than the call.
async function CostPerDayList({
  title,
  icon,
  tone,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  tone: 'emerald' | 'rose';
  rows: CostPerDayRankRow[];
}) {
  const { locale, t } = await getI18n();
  const anyLowerBound = rows.some((r) => r.cost.hasUnrecordedWarrantyCost);

  return (
    <div>
      <p
        className={cn(
          'mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide',
          tone === 'emerald' ? 'text-emerald-ink' : 'text-rose-ink',
        )}
      >
        {icon}
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          {t('Chưa đủ dữ liệu — cần ngày mua và giá mua.')}
        </p>
      ) : (
        <ol>
          {rows.map((r, i) => (
            <li key={r.device.id}>
              <Link
                href={`/devices/${r.device.id}`}
                className={cn(
                  'info-row flex items-center gap-3 py-2.5 hover:opacity-80',
                  i === 0 && '!border-t-0 pt-0',
                )}
              >
                <span className={cn('rank', `rank-${i + 1}`)}>{i + 1}</span>
                <CategoryIconBadge category={r.device.category} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-sm font-bold text-ink">
                    {r.device.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {categoryLabel(r.device.category, locale)} •{' '}
                    {t('{days} ngày', { days: r.cost.days, count: r.cost.days })}
                    {r.cost.endedBySale ? ` ${t('(đã bán)')}` : ''}
                  </p>
                </div>
                <span className="text-right">
                  <span className="block font-display font-bold tabular-nums text-ink">
                    {r.cost.hasUnrecordedWarrantyCost ? '≥ ' : ''}
                    {r.cost.perDayLabel}
                  </span>
                  <span className="block text-xs tabular-nums text-muted-foreground">
                    {t('tổng {amount}', { amount: formatVND(r.cost.net, locale) })}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {anyLowerBound && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t('“≥” = còn gói bảo hành chưa ghi giá, con số thực có thể cao hơn.')}
        </p>
      )}
    </div>
  );
}
