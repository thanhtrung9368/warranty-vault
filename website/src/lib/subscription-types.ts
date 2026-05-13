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

// Average days per cycle, used to:
//  - bump renewalDate when cron auto-bills
//  - normalize cost-per-cycle to "monthly equivalent" for the dashboard
export const BILLING_CYCLE_DAYS: Record<BillingCycle, number | null> = {
  MONTHLY: 30,
  QUARTERLY: 91,
  YEARLY: 365,
  LIFETIME: null, // never renews
  CUSTOM: null, // intervalDays on the row
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

export const SUBSCRIPTION_ACTIVE_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'PAUSED'];

// Convert one cycle's price into a monthly equivalent. Used by dashboard +
// stats. Null = unable to normalize (CUSTOM with no intervalDays, or LIFETIME).
export function monthlyEquivalent(
  price: number,
  cycle: BillingCycle,
  intervalDays?: number | null,
): number | null {
  if (cycle === 'LIFETIME') return 0;
  if (cycle === 'CUSTOM') {
    if (!intervalDays || intervalDays <= 0) return null;
    return Math.round((price * 30) / intervalDays);
  }
  const days = BILLING_CYCLE_DAYS[cycle];
  if (!days) return null;
  return Math.round((price * 30) / days);
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
