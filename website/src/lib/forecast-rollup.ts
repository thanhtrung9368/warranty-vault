// Pure money/label helpers for the spending-forecast section of `/stats`.
//
// The shape comes straight from `GET /api/v1/forecast` (openapi `Forecast`) —
// nothing here recomputes the API's arithmetic, it only:
//   * normalises the `months` picker value (1–24; Go 400s on garbage),
//   * labels buckets (incl. the partial first/last month),
//   * splits each bucket's subscription money into "sẽ bị trừ tự động" and
//     "phải tự gia hạn" — a distinction the API models and the UI must keep, and
//   * keeps the two REFERENCE money columns (warranty / wishlist) visibly apart
//     from the scheduled charges so they can never be read as committed spend.
//
// Same pattern as `stats-rollup.ts`: no DB, no fetch, unit-tested.

import type {
  Forecast,
  ForecastBucket,
  ForecastWarranty,
  ForecastWishlistItem,
} from '@/lib/api/stats';
import {
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_STATUS_LABELS,
  type WishlistPriority,
  type WishlistStatus,
} from '@/lib/wishlist-types';
import { WARRANTY_TYPE_LABELS, type WarrantyType } from '@/lib/types';

export const FORECAST_MONTHS_MIN = 1;
export const FORECAST_MONTHS_MAX = 24;
export const FORECAST_MONTHS_DEFAULT = 12;

/** Windows offered by the picker on /stats. `FORECAST_MONTHS_DEFAULT` is one of them. */
export const FORECAST_MONTH_CHOICES = [3, 6, 12, 24] as const;

/**
 * Map the `?fm=` search param onto a legal `months` value.
 *
 * Out-of-range input is clamped rather than forwarded: the API deliberately
 * answers 400 for `months=0`, `months=25`, `months=abc` or `months=1.5` instead
 * of quietly using the default, and a URL the user can hand-edit is not a good
 * reason to render an error page for a stats view.
 */
export function normalizeForecastMonths(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return FORECAST_MONTHS_DEFAULT;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return FORECAST_MONTHS_DEFAULT;
  const whole = Math.trunc(n);
  if (whole < FORECAST_MONTHS_MIN) return FORECAST_MONTHS_MIN;
  if (whole > FORECAST_MONTHS_MAX) return FORECAST_MONTHS_MAX;
  return whole;
}

// ---- labels ----------------------------------------------------------------

/**
 * 'YYYY-MM' → 'Tháng 3/2026'. Rendered straight from the bucket key, so a bucket
 * is never shifted by a local-timezone round-trip (the API's buckets are UTC).
 */
export function bucketMonthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec((month ?? '').trim());
  if (!m) return month ?? '';
  return `Tháng ${Number(m[2])}/${m[1]}`;
}

/** Compact axis label: 'T3/26'. */
export function bucketMonthShortLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec((month ?? '').trim());
  if (!m) return month ?? '';
  return `T${Number(m[2])}/${m[1].slice(2)}`;
}

/** 'YYYY-MM' of an RFC3339 timestamp, in UTC — the same clock the buckets use. */
export function monthKeyOf(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 7);
}

export function warrantyTypeLabel(type: string): string {
  return WARRANTY_TYPE_LABELS[type as WarrantyType] ?? type;
}

export function wishlistPriorityLabel(priority: string): string {
  return WISHLIST_PRIORITY_LABELS[priority as WishlistPriority] ?? priority;
}

export function wishlistStatusLabel(status: string): string {
  return WISHLIST_STATUS_LABELS[status as WishlistStatus] ?? status;
}

// ---- buckets ---------------------------------------------------------------

export type ForecastBucketRow = {
  month: string;
  label: string;
  shortLabel: string;
  /** True for the bucket containing `generatedAt`: it only counts from today. */
  isCurrentMonth: boolean;
  /**
   * True for the bucket containing `windowEnd` (the window is right-open, so that
   * month only counts up to `windowEnd`). The API emits `months + 1` buckets
   * precisely so this tail month is not cut off — it is partial, not extra.
   */
  isClosingMonth: boolean;
  /** Either edge of the window only counts part of its month. */
  isPartial: boolean;
  /** Scheduled subscription charges, as the API counted them. */
  subscriptionVnd: number;
  /** The part of `subscriptionVnd` charged automatically (`autoRenew = true`). */
  autoRenewVnd: number;
  /** The rest — the user has to renew these by hand. Never negative. */
  selfRenewVnd: number;
  subscriptionCount: number;
  /** REFERENCE: price of packages expiring this month, not a charge. */
  warrantyExpiringVnd: number;
  warrantyExpiringCount: number;
  /** REFERENCE: last recorded price of wishlist items due this month. */
  wishlistTargetVnd: number;
  wishlistTargetCount: number;
  /** Possible (non-scheduled) spend this month, warranty + wishlist. */
  possibleSpendVnd: number;
  /** True when nothing at all happens this month. */
  isEmpty: boolean;
};

/**
 * Split one bucket's subscription money. The API guarantees
 * `subscriptionAutoRenewVnd <= subscriptionVnd`; the clamp is defensive so a
 * mismatch can never render as a negative "phải tự gia hạn".
 */
export function autoRenewSplit(bucket: {
  subscriptionVnd: number;
  subscriptionAutoRenewVnd: number;
}): { auto: number; selfRenew: number; total: number } {
  const total = Math.max(0, money(bucket.subscriptionVnd));
  const auto = Math.min(money(bucket.subscriptionAutoRenewVnd), total);
  return { auto, selfRenew: total - auto, total };
}

function money(v: number | null | undefined): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : 0;
  return n > 0 ? n : 0;
}

function count(v: number | null | undefined): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
  return n > 0 ? n : 0;
}

/**
 * Turn the API's buckets into render-ready rows: one row per bucket, in the order
 * the API sent them (it already lists them chronologically), WITHOUT assuming a
 * count — a 12-month window normally returns 13 buckets (a partial current month
 * plus 12 full ones), and exactly 12 when `now` is the first instant of a month.
 */
export function buildForecastRows(
  forecast:
    | (Pick<Forecast, 'buckets' | 'windowStart' | 'generatedAt'> &
        Partial<Pick<Forecast, 'windowEnd'>>)
    | null
    | undefined,
): ForecastBucketRow[] {
  const buckets: ForecastBucket[] = forecast?.buckets ?? [];
  const currentMonth = monthKeyOf(forecast?.windowStart ?? forecast?.generatedAt ?? '');
  const endMonth = monthKeyOf(forecast?.windowEnd ?? '');
  const lastMonth = buckets.length > 0 ? buckets[buckets.length - 1].month : '';
  return buckets.map((b) => {
    const split = autoRenewSplit(b);
    const warrantyExpiringVnd = money(b.warrantyExpiringVnd);
    const wishlistTargetVnd = money(b.wishlistTargetVnd);
    const subscriptionCount = count(b.subscriptionCount);
    const warrantyExpiringCount = count(b.warrantyExpiringCount);
    const wishlistTargetCount = count(b.wishlistTargetCount);
    const isCurrentMonth = currentMonth !== '' && b.month === currentMonth;
    // The window is right-open, so `windowEnd`'s own month is the one bucket that
    // gets cut off mid-month (`ForecastWindow` only appends it when `end` is not
    // exactly a month start). Checking against the LAST bucket keeps this correct
    // for the `months`-bucket case too, where `windowEnd` sits on a month start
    // and no bucket is truncated.
    const isClosingMonth = endMonth !== '' && b.month === endMonth && b.month === lastMonth;
    return {
      month: b.month,
      label: bucketMonthLabel(b.month),
      shortLabel: bucketMonthShortLabel(b.month),
      isCurrentMonth,
      isClosingMonth,
      isPartial: isCurrentMonth || isClosingMonth,
      subscriptionVnd: split.total,
      autoRenewVnd: split.auto,
      selfRenewVnd: split.selfRenew,
      subscriptionCount,
      warrantyExpiringVnd,
      warrantyExpiringCount,
      wishlistTargetVnd,
      wishlistTargetCount,
      possibleSpendVnd: warrantyExpiringVnd + wishlistTargetVnd,
      isEmpty:
        split.total === 0 &&
        subscriptionCount === 0 &&
        warrantyExpiringVnd === 0 &&
        warrantyExpiringCount === 0 &&
        wishlistTargetVnd === 0 &&
        wishlistTargetCount === 0,
    };
  });
}

/** Rows for the stacked bar: the scheduled charges, split auto / self-renew. */
export function forecastChartData(
  rows: ForecastBucketRow[],
): { month: string; label: string; total: number; auto: number; selfRenew: number }[] {
  return rows.map((r) => ({
    month: r.shortLabel,
    label: r.label,
    total: r.subscriptionVnd,
    auto: r.autoRenewVnd,
    selfRenew: r.selfRenewVnd,
  }));
}

// ---- totals ----------------------------------------------------------------

export type ForecastTotals = {
  /** Every scheduled charge in the window. */
  total: number;
  /** The part that will be taken automatically. */
  auto: number;
  /** The part the user has to renew by hand. */
  selfRenew: number;
  chargesCount: number;
  subscriptionsCount: number;
  /** Canonical monthly equivalent — the SAME number /stats shows above. */
  monthlyAverage: number;
};

/**
 * Window totals. Money totals come from the API's own top-level fields (never
 * re-summed from buckets: the API's `subscriptionTotalVnd` covers exactly the
 * window it computed), with `auto` clamped to the total for display safety.
 */
export function forecastTotals(
  forecast: Pick<
    Forecast,
    | 'subscriptionTotalVnd'
    | 'subscriptionAutoRenewTotalVnd'
    | 'subscriptionMonthlyAverageVnd'
    | 'subscriptionsCount'
    | 'chargesCount'
  > | null | undefined,
): ForecastTotals {
  const total = money(forecast?.subscriptionTotalVnd);
  const auto = Math.min(money(forecast?.subscriptionAutoRenewTotalVnd), total);
  return {
    total,
    auto,
    selfRenew: total - auto,
    chargesCount: count(forecast?.chargesCount),
    subscriptionsCount: count(forecast?.subscriptionsCount),
    monthlyAverage: money(forecast?.subscriptionMonthlyAverageVnd),
  };
}

export type PossibleSpendTotals = {
  warrantyVnd: number;
  warrantyCount: number;
  wishlistVnd: number;
  wishlistCount: number;
  total: number;
};

/** The two REFERENCE columns summed over the window — never added to `total`. */
export function possibleSpendTotals(rows: ForecastBucketRow[]): PossibleSpendTotals {
  return rows.reduce<PossibleSpendTotals>(
    (acc, r) => ({
      warrantyVnd: acc.warrantyVnd + r.warrantyExpiringVnd,
      warrantyCount: acc.warrantyCount + r.warrantyExpiringCount,
      wishlistVnd: acc.wishlistVnd + r.wishlistTargetVnd,
      wishlistCount: acc.wishlistCount + r.wishlistTargetCount,
      total: acc.total + r.possibleSpendVnd,
    }),
    { warrantyVnd: 0, warrantyCount: 0, wishlistVnd: 0, wishlistCount: 0, total: 0 },
  );
}

// ---- misc ------------------------------------------------------------------

/** 'Tháng 3/2026 – Tháng 3/2027' from the API's own window bounds. */
export function forecastWindowLabel(
  forecast: Pick<Forecast, 'windowStart' | 'windowEnd'> | null | undefined,
): string {
  const from = bucketMonthLabel(monthKeyOf(forecast?.windowStart ?? ''));
  const to = bucketMonthLabel(monthKeyOf(forecast?.windowEnd ?? ''));
  if (!from && !to) return '';
  if (from === to) return from;
  return `${from} – ${to}`;
}

/**
 * True when the window holds nothing at all — no scheduled charge and no
 * warranty/wishlist milestone. `/stats` uses it so a user whose only data is a
 * dated wishlist item still gets the forecast instead of the "chưa có gì để
 * thống kê" empty state.
 */
export function isForecastEmpty(
  forecast:
    | Pick<Forecast, 'buckets' | 'upcomingWarranties' | 'upcomingWishlist'>
    | null
    | undefined,
): boolean {
  if (!forecast) return true;
  if ((forecast.upcomingWarranties?.length ?? 0) > 0) return false;
  if ((forecast.upcomingWishlist?.length ?? 0) > 0) return false;
  return buildForecastRowsAll(forecast.buckets).every((r) => r.isEmpty);
}

// `buildForecastRows` needs window metadata only for `isCurrentMonth`; this thin
// wrapper lets the emptiness check run off buckets alone.
function buildForecastRowsAll(buckets: ForecastBucket[] | undefined): ForecastBucketRow[] {
  return buildForecastRows({ buckets: buckets ?? [], windowStart: '', generatedAt: '' });
}

/** '3 kỳ gia hạn' / '1 kỳ gia hạn' / 'Không có kỳ nào'. */
export function chargeCountLabel(n: number): string {
  if (n <= 0) return 'Không có kỳ nào';
  return `${n} kỳ gia hạn`;
}

/** '2 gói' / '1 gói' / '' — for the small "how many" suffixes. */
export function packageCountLabel(n: number, unit = 'gói'): string {
  if (n <= 0) return '';
  return `${n} ${unit}`;
}

export type { ForecastWarranty, ForecastWishlistItem };
