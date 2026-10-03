import Link from 'next/link';
import {
  AlertTriangle,
  CalendarClock,
  Heart,
  Info,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ForecastBar } from '@/components/charts/lazy';
import { ForecastWindowPicker } from '@/components/forecast-window-picker';
import type { Forecast } from '@/lib/api/stats';
import {
  buildForecastRows,
  chargeCountLabel,
  forecastChartData,
  forecastTotals,
  forecastWindowLabel,
  packageCountLabel,
  possibleSpendTotals,
  warrantyTypeLabel,
  wishlistPriorityLabel,
  wishlistStatusLabel,
} from '@/lib/forecast-rollup';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

// The forward-looking half of `/stats`: what the next N months will charge
// (subscriptions), and what might come up (warranty expiries + wishlist target
// dates).
//
// The honesty rules this component exists to enforce, all from the API's own
// description of the endpoint:
//   * `subscriptionAutoRenewVnd` is money that WILL be taken automatically; the
//     rest of `subscriptionVnd` is money the user still has to decide about. They
//     are shown separately, never summed into one "you will pay" number.
//   * `warrantyExpiringVnd` is the price of the package that is ending — a
//     reference for saving up, NOT a charge.
//   * `wishlistTargetVnd` is the last RECORDED price of an item, also not a
//     charge.
// Neither reference column is ever added to the subscription total, and the
// API's Vietnamese `note` is rendered verbatim rather than paraphrased away.
export function ForecastPanel({
  forecast,
  months,
  year,
}: {
  forecast: Forecast;
  months: number;
  year?: string;
}) {
  const rows = buildForecastRows(forecast);
  const totals = forecastTotals(forecast);
  const possible = possibleSpendTotals(rows);
  const windowLabel = forecastWindowLabel(forecast);

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
              <span className="icon-badge icon-badge-xs tint-primary">
                <CalendarClock className="h-3.5 w-3.5" />
              </span>
              Dự báo chi tiêu
            </CardTitle>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {forecast.months} tháng tới{windowLabel ? ` · ${windowLabel}` : ''} · chỉ tính các gói
              đăng ký đang hoạt động.
            </p>
          </div>
          <ForecastWindowPicker months={months} year={year} />
        </CardHeader>
        <CardContent className="space-y-4">
          {/* The API's own Vietnamese explanation of the model (LIFETIME never
              charges, first/last months are partial, which money is certain).
              Shown as-is: it is the contract, not decoration. */}
          <div className="flex items-start gap-3 rounded-md bg-sky-soft p-3.5 text-sm text-sky-ink">
            <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{forecast.note}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MoneyBlock
              label="Sẽ bị trừ tự động"
              value={formatVND(totals.auto)}
              sub="Các gói bật tự động gia hạn"
              tone="primary"
              icon={<RefreshCw className="h-4 w-4" />}
            />
            <MoneyBlock
              label="Bạn phải tự gia hạn"
              value={formatVND(totals.selfRenew)}
              sub="Không tự trừ — bạn quyết định"
              tone="amber"
              icon={<AlertTriangle className="h-4 w-4" />}
            />
            <MoneyBlock
              label={`Tổng kỳ gia hạn ${forecast.months} tháng`}
              value={formatVND(totals.total)}
              sub={
                totals.subscriptionsCount > 0
                  ? `${packageCountLabel(totals.subscriptionsCount)} · ${chargeCountLabel(totals.chargesCount)}`
                  : 'Không có kỳ gia hạn nào'
              }
              tone="sky"
              icon={<Wallet className="h-4 w-4" />}
            />
            <MoneyBlock
              label="Trung bình mỗi tháng"
              value={formatVND(totals.monthlyAverage)}
              sub="Đúng bằng “Phí định kỳ mỗi tháng” ở trên"
              tone="violet"
              icon={<RefreshCw className="h-4 w-4" />}
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Kỳ gia hạn theo từng tháng. Cột xếp chồng: phần dưới là tiền sẽ tự động bị trừ, phần
              trên là gói bạn phải tự gia hạn. Biểu đồ chỉ gồm khoản đăng ký.
            </p>
            <ForecastBar data={forecastChartData(rows)} />
          </div>

          {/* Reference money, deliberately NOT part of the totals above. */}
          <div className="rounded-xl border-[1.5px] border-dashed border-border bg-surface-2 p-4">
            <p className="text-xs font-semibold text-ink-2">
              Có thể phát sinh trong {forecast.months} tháng tới — tham khảo, không phải khoản chắc
              chắn trả và không cộng vào tổng ở trên
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <span className="icon-badge icon-badge-sm tint-amber mt-0.5">
                  <ShieldCheck className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">
                    Bảo hành hết hạn: {formatVND(possible.warrantyVnd)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {possible.warrantyCount > 0
                      ? `${packageCountLabel(possible.warrantyCount)} • giá gói cũ, để tham khảo khi để dành tiền mua gói mới`
                      : 'Không có gói bảo hành nào hết hạn trong cửa sổ này'}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="icon-badge icon-badge-sm tint-rose mt-0.5">
                  <Heart className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">
                    Wishlist tới mốc: {formatVND(possible.wishlistVnd)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {possible.wishlistCount > 0
                      ? `${packageCountLabel(possible.wishlistCount, 'món')} • giá ghi nhận gần nhất, chưa chắc mua`
                      : 'Không có mốc wishlist nào trong cửa sổ này'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
            <span className="icon-badge icon-badge-xs tint-sky">
              <CalendarClock className="h-3.5 w-3.5" />
            </span>
            Từng tháng
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Tháng đánh dấu “một phần” chỉ tính các khoản rơi trong cửa sổ dự báo (tháng này tính
            từ hôm nay; tháng cuối tính tới hết cửa sổ). Tháng không có gì vẫn được liệt kê.
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Không có tháng nào trong cửa sổ này.</p>
          ) : (
            <ul>
              {rows.map((r, i) => (
                <li key={r.month} className={cn('info-row py-3', i === 0 && '!border-t-0 pt-0')}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2 font-display text-sm font-bold text-ink">
                      {r.label}
                      {r.isPartial && (
                        <Badge variant="secondary">
                          {r.isCurrentMonth ? 'tháng này' : 'tháng cuối'} · một phần
                        </Badge>
                      )}
                    </p>
                    <p className="font-semibold tabular-nums text-ink-2">
                      {formatVND(r.subscriptionVnd)}
                      {r.subscriptionCount > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          {packageCountLabel(r.subscriptionCount, 'kỳ')}
                        </span>
                      )}
                    </p>
                  </div>
                  {r.subscriptionVnd > 0 ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Tự động trừ {formatVND(r.autoRenewVnd)} • Phải tự gia hạn{' '}
                      {formatVND(r.selfRenewVnd)}
                    </p>
                  ) : (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Không có kỳ gia hạn nào.
                    </p>
                  )}
                  {(r.warrantyExpiringCount > 0 || r.wishlistTargetCount > 0) && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Có thể phát sinh:
                      {r.warrantyExpiringCount > 0 && (
                        <>
                          {' '}
                          bảo hành hết hạn {formatVND(r.warrantyExpiringVnd)} (
                          {packageCountLabel(r.warrantyExpiringCount)})
                        </>
                      )}
                      {r.warrantyExpiringCount > 0 && r.wishlistTargetCount > 0 && ' •'}
                      {r.wishlistTargetCount > 0 && (
                        <>
                          {' '}
                          wishlist {formatVND(r.wishlistTargetVnd)} (
                          {packageCountLabel(r.wishlistTargetCount, 'món')})
                        </>
                      )}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
              <span className="icon-badge icon-badge-xs tint-amber">
                <ShieldCheck className="h-3.5 w-3.5" />
              </span>
              Bảo hành sắp hết hạn
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Giá gói bên dưới là giá của gói đang hết hạn — chỉ để tham khảo khi để dành tiền, không
              phải khoản sẽ bị trừ.
            </p>
          </CardHeader>
          <CardContent>
            {forecast.upcomingWarranties.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Không có gói bảo hành nào hết hạn trong cửa sổ này.
              </p>
            ) : (
              <ul>
                {forecast.upcomingWarranties.map((w, i) => (
                  <li key={w.id} className={cn('info-row py-3', i === 0 && '!border-t-0 pt-0')}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        href={`/devices/${w.deviceId}`}
                        className="font-display text-sm font-bold text-ink hover:underline"
                      >
                        {w.deviceName}
                      </Link>
                      <span className="text-xs font-medium text-muted-foreground">
                        {formatDate(w.endDate)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Gói {warrantyTypeLabel(w.type)}
                      {w.provider ? ` • ${w.provider}` : ''} • {w.months} tháng
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {w.costVnd != null
                        ? `Giá gói cũ (tham khảo): ${formatVND(w.costVnd)}`
                        : 'Chưa ghi giá gói cũ'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-[15px] font-bold text-ink">
              <span className="icon-badge icon-badge-xs tint-rose">
                <Heart className="h-3.5 w-3.5" />
              </span>
              Wishlist tới mốc
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Giá bên dưới là giá ghi nhận gần nhất, chưa chắc bạn sẽ mua — không phải khoản sẽ bị
              trừ.
            </p>
          </CardHeader>
          <CardContent>
            {forecast.upcomingWishlist.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Không có mốc wishlist nào trong cửa sổ này.
              </p>
            ) : (
              <ul>
                {forecast.upcomingWishlist.map((w, i) => (
                  <li key={w.id} className={cn('info-row py-3', i === 0 && '!border-t-0 pt-0')}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link
                        href={`/wishlist/${w.id}`}
                        className="font-display text-sm font-bold text-ink hover:underline"
                      >
                        {w.name}
                      </Link>
                      <span className="text-xs font-medium text-muted-foreground">
                        {formatDate(w.targetDate)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {wishlistPriorityLabel(w.priority)} • {wishlistStatusLabel(w.status)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {w.currentPriceVnd != null
                        ? `Giá ghi nhận gần nhất: ${formatVND(w.currentPriceVnd)}`
                        : 'Chưa từng nhập giá'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type MoneyTone = 'primary' | 'amber' | 'sky' | 'violet';

const MONEY_TONES: Record<MoneyTone, string> = {
  primary: 'tint-primary',
  amber: 'tint-amber',
  sky: 'tint-sky',
  violet: 'tint-violet',
};

function MoneyBlock({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  tone: MoneyTone;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border-[1.5px] border-border bg-surface-2 p-4">
      <span className={cn('icon-badge icon-badge-sm', MONEY_TONES[tone])}>{icon}</span>
      <p className="mt-2 text-xs font-medium text-muted-foreground">{label}</p>
      <p className="font-display text-lg font-bold tabular-nums text-ink">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
