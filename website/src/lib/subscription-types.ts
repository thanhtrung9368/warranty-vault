export const BILLING_CYCLES = [
  'MONTHLY',
  'QUARTERLY',
  'YEARLY',
  'LIFETIME',
  'CUSTOM',
] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  MONTHLY: 'Hàng tháng',
  QUARTERLY: 'Hàng quý',
  YEARLY: 'Hàng năm',
  LIFETIME: 'Lifetime / Trọn đời',
  CUSTOM: 'Tuỳ chỉnh',
};

export const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELED', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  ACTIVE: 'Đang hoạt động',
  PAUSED: 'Tạm dừng',
  CANCELED: 'Đã huỷ',
  EXPIRED: 'Hết hạn',
};

export const SUBSCRIPTION_STATUS_COLORS: Record<SubscriptionStatus, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  PAUSED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  CANCELED: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  EXPIRED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export const SUBSCRIPTION_STATUS_BADGE_VARIANT: Record<
  SubscriptionStatus,
  'success' | 'warning' | 'secondary' | 'destructive'
> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  CANCELED: 'secondary',
  EXPIRED: 'destructive',
};

// Statuses a subscription must be in to count towards a *money* total.
//
// Canonical source: Go's `GET /api/v1/stats`, whose SQL aggregator
// (api/internal/store/queries/stats.sql::StatsSubscriptionsMonthly) filters
// `status = 'ACTIVE'` only. A PAUSED subscription is still *shown* as active
// (see SUBSCRIPTION_ACTIVE_STATUSES below) but it does not cost anything, so
// it must never add to "chi phí mỗi tháng".
export const SUBSCRIPTION_SPEND_STATUSES: SubscriptionStatus[] = ['ACTIVE'];

// The active/paused list filter + "đang hoạt động" counters. This means
// "rows we present as active", NOT "rows that count as spend" — use
// SUBSCRIPTION_SPEND_STATUSES / monthlySpendTotal() for money.
export const SUBSCRIPTION_ACTIVE_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'PAUSED'];

// Go's math.Round: rounds half away from zero. JS Math.round rounds half
// *up*, which only differs for negatives — prices are validated >= 0, but
// mirroring Go exactly costs nothing.
function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

// Convert one cycle's price into a monthly equivalent.
//
// This is a line-for-line mirror of Go's services.MonthlyEquivalent
// (api/internal/services/subscription_billing.go) so the web dashboard can
// never disagree with `GET /api/v1/stats` or with iOS/Android:
//   MONTHLY    -> price
//   QUARTERLY  -> price/3   (Go integer division == Math.trunc)
//   YEARLY     -> price/12  (truncated)
//   LIFETIME   -> 0
//   CUSTOM     -> round(price * 30 / intervalDays), 0 when intervalDays <= 0
//   anything else -> 0      (Go's `default` branch)
//
// Do NOT reintroduce an average-days model (price * 30 / 91, / 365): that was
// the old web-only formula and it disagreed with every other client.
export function monthlyEquivalent(
  price: number,
  cycle: BillingCycle,
  intervalDays?: number | null,
): number {
  switch (cycle) {
    case 'MONTHLY':
      return price;
    case 'QUARTERLY':
      return Math.trunc(price / 3);
    case 'YEARLY':
      return Math.trunc(price / 12);
    case 'LIFETIME':
      return 0;
    case 'CUSTOM':
      if (intervalDays == null || intervalDays <= 0) return 0;
      return roundHalfAwayFromZero((price * 30) / intervalDays);
    default:
      return 0;
  }
}

// Minimal structural shape of the rows monthlySpendTotal() accepts — matches
// the `/v1/subscriptions` wire rows without importing the API client type.
type SubscriptionSpendRow = {
  price: number;
  billingCycle: BillingCycle;
  intervalDays?: number | null;
  status: string;
};

// Total "chi phí mỗi tháng" for a list of subscriptions. Only rows in
// SUBSCRIPTION_SPEND_STATUSES count (ACTIVE), mirroring
// `GET /api/v1/stats`.subscriptions.totalMonthlyVnd so the web agrees with the
// mobile apps for the same account. LIFETIME rows contribute 0.
export function monthlySpendTotal(rows: readonly SubscriptionSpendRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (!(SUBSCRIPTION_SPEND_STATUSES as readonly string[]).includes(row.status)) {
      continue;
    }
    total += monthlyEquivalent(row.price, row.billingCycle, row.intervalDays);
  }
  return total;
}

// Compute the next renewal date from a starting date + cycle.
export function nextRenewalDate(
  from: Date,
  cycle: BillingCycle,
  intervalDays?: number | null,
): Date {
  const next = new Date(from);
  if (cycle === 'MONTHLY') next.setMonth(next.getMonth() + 1);
  else if (cycle === 'QUARTERLY') next.setMonth(next.getMonth() + 3);
  else if (cycle === 'YEARLY') next.setFullYear(next.getFullYear() + 1);
  else if (cycle === 'CUSTOM' && intervalDays && intervalDays > 0) {
    next.setDate(next.getDate() + intervalDays);
  } else if (cycle === 'LIFETIME') {
    // Sentinel: 100 years out. We never push for these.
    next.setFullYear(next.getFullYear() + 100);
  }
  return next;
}
