import { describe, it, expect } from 'vitest';
import {
  monthlyEquivalent,
  monthlySpendTotal,
  nextRenewalDate,
  SUBSCRIPTION_ACTIVE_STATUSES,
  SUBSCRIPTION_SPEND_STATUSES,
  type BillingCycle,
  type SubscriptionStatus,
} from '@/lib/subscription-types';

// These numbers are pinned to Go's canonical implementation and its own test
// table in `api/internal/services/subscription_billing_test.go` (see also the
// SQL aggregator in `api/internal/store/queries/stats.sql`). If a case here
// changes, Go has to change first — the web must never drift again.

describe('monthlyEquivalent', () => {
  it('returns the price unchanged for MONTHLY', () => {
    expect(monthlyEquivalent(100_000, 'MONTHLY')).toBe(100_000);
  });

  it('divides QUARTERLY by 3, like Go (`price/3`)', () => {
    // Go: MonthlyEquivalent(300000, QUARTERLY) == 100000.
    // The old web formula (30/91 average days) returned 98_901.
    expect(monthlyEquivalent(300_000, 'QUARTERLY')).toBe(100_000);
  });

  it('truncates QUARTERLY instead of rounding', () => {
    // Go: 100000/3 == 33333 (integer division), not 33333.33 -> 33333 either
    // way, but assert the exact truncation so a `Math.round` refactor breaks.
    expect(monthlyEquivalent(100_000, 'QUARTERLY')).toBe(33_333);
    expect(monthlyEquivalent(100_001, 'QUARTERLY')).toBe(33_333);
    expect(monthlyEquivalent(100_002, 'QUARTERLY')).toBe(33_334);
  });

  it('divides YEARLY by 12, like Go (`price/12`)', () => {
    // Go: MonthlyEquivalent(1200000, YEARLY) == 100000.
    // The old web formula (30/365 average days) returned 98_630.
    expect(monthlyEquivalent(1_200_000, 'YEARLY')).toBe(100_000);
  });

  it('truncates YEARLY instead of rounding', () => {
    expect(monthlyEquivalent(100_000, 'YEARLY')).toBe(8_333);
    // 100019/12 = 8334.91: truncation gives 8334, rounding would give 8335.
    expect(monthlyEquivalent(100_019, 'YEARLY')).toBe(8_334);
    expect(monthlyEquivalent(100_020, 'YEARLY')).toBe(8_335);
  });

  it('treats LIFETIME as zero monthly cost', () => {
    // Go: MonthlyEquivalent(999999, LIFETIME) == 0.
    expect(monthlyEquivalent(999_999, 'LIFETIME')).toBe(0);
  });

  it('scales CUSTOM by 30/intervalDays', () => {
    // Go's table: custom 30d, custom 60d.
    expect(monthlyEquivalent(100_000, 'CUSTOM', 30)).toBe(100_000);
    expect(monthlyEquivalent(200_000, 'CUSTOM', 60)).toBe(100_000);
    expect(monthlyEquivalent(60_000, 'CUSTOM', 15)).toBe(120_000);
  });

  it('rounds CUSTOM to the nearest VND', () => {
    // 150000 * 30 / 7 = 642857.14 -> 642857
    expect(monthlyEquivalent(150_000, 'CUSTOM', 7)).toBe(642_857);
    // 35 * 30 / 4 = 262.5 -> 263 (Go's math.Round: half away from zero).
    expect(monthlyEquivalent(35, 'CUSTOM', 4)).toBe(263);
  });

  it('returns 0 for CUSTOM without a positive intervalDays', () => {
    // Go returns 0 here (it used to be `null` on the web, which made the two
    // sides disagree about rows nobody could total).
    expect(monthlyEquivalent(60_000, 'CUSTOM')).toBe(0);
    expect(monthlyEquivalent(60_000, 'CUSTOM', 0)).toBe(0);
    expect(monthlyEquivalent(60_000, 'CUSTOM', -5)).toBe(0);
  });

  it('returns 0 for an unknown cycle, like Go`s default branch', () => {
    expect(monthlyEquivalent(100_000, 'WHATEVER' as unknown as BillingCycle)).toBe(0);
  });
});

describe('subscription spend statuses', () => {
  it('counts ACTIVE as spend but keeps PAUSED as merely "shown active"', () => {
    // Guards against "simplifying" the two constants into one: flipping
    // SUBSCRIPTION_ACTIVE_STATUSES to ['ACTIVE'] would silently change the
    // "đang hoạt động" counters on /dashboard and /subscriptions.
    expect(SUBSCRIPTION_SPEND_STATUSES).toEqual(['ACTIVE']);
    expect(SUBSCRIPTION_ACTIVE_STATUSES).toEqual(['ACTIVE', 'PAUSED']);
  });
});

describe('monthlySpendTotal', () => {
  function row(
    price: number,
    billingCycle: BillingCycle,
    status: SubscriptionStatus,
    intervalDays?: number | null,
  ) {
    return { price, billingCycle, status, intervalDays };
  }

  it('returns 0 for an empty list', () => {
    expect(monthlySpendTotal([])).toBe(0);
  });

  it('matches the Go stats fixture (480k monthly + 1.2M yearly = 580k)', () => {
    // api/internal/services/stats.go documents this exact fixture.
    const rows = [row(480_000, 'MONTHLY', 'ACTIVE'), row(1_200_000, 'YEARLY', 'ACTIVE')];
    expect(monthlySpendTotal(rows)).toBe(580_000);
  });

  it('excludes PAUSED subscriptions from the monthly total', () => {
    // Regression guard for the old web behaviour: it summed ACTIVE + PAUSED
    // and used the average-day divisors, so this user saw 197_531 on the web
    // while `GET /api/v1/stats` reported 100_000.
    const rows = [
      row(300_000, 'QUARTERLY', 'ACTIVE'),
      row(1_200_000, 'YEARLY', 'PAUSED'),
    ];
    expect(monthlySpendTotal(rows)).toBe(100_000);
  });

  it('excludes CANCELED and EXPIRED subscriptions', () => {
    const rows = [
      row(300_000, 'QUARTERLY', 'ACTIVE'),
      row(900_000, 'QUARTERLY', 'CANCELED'),
      row(2_400_000, 'YEARLY', 'EXPIRED'),
    ];
    expect(monthlySpendTotal(rows)).toBe(100_000);
  });

  it('adds 0 for ACTIVE LIFETIME rows (Go filters them as well)', () => {
    const rows = [row(100_000, 'MONTHLY', 'ACTIVE'), row(9_900_000, 'LIFETIME', 'ACTIVE')];
    expect(monthlySpendTotal(rows)).toBe(100_000);
  });

  it('sums CUSTOM rows with the Go rounding', () => {
    const rows = [
      row(60_000, 'CUSTOM', 'ACTIVE', 15), // 120000
      row(150_000, 'CUSTOM', 'ACTIVE', 7), // 642857.14 -> 642857
      row(100_000, 'CUSTOM', 'ACTIVE', null), // 0
    ];
    expect(monthlySpendTotal(rows)).toBe(762_857);
  });
});

describe('nextRenewalDate', () => {
  // Build dates in local time to match the function's local-time mutations.
  const from = new Date(2026, 0, 15); // 2026-01-15

  function ymd(d: Date) {
    return [d.getFullYear(), d.getMonth(), d.getDate()];
  }

  it('adds one month for MONTHLY', () => {
    expect(ymd(nextRenewalDate(from, 'MONTHLY'))).toEqual([2026, 1, 15]);
  });

  it('normalises month-end overflow like Go`s AddDate', () => {
    // Go's TestNextRenewalDate_MonthlyFebLeapYear: Jan 31 + 1 month is
    // Mar 2 in a leap year and Mar 3 otherwise.
    expect(ymd(nextRenewalDate(new Date(2024, 0, 31), 'MONTHLY'))).toEqual([2024, 2, 2]);
    expect(ymd(nextRenewalDate(new Date(2026, 0, 31), 'MONTHLY'))).toEqual([2026, 2, 3]);
  });

  it('adds three months for QUARTERLY', () => {
    expect(ymd(nextRenewalDate(from, 'QUARTERLY'))).toEqual([2026, 3, 15]);
  });

  it('adds one year for YEARLY', () => {
    expect(ymd(nextRenewalDate(from, 'YEARLY'))).toEqual([2027, 0, 15]);
  });

  it('adds intervalDays for CUSTOM', () => {
    expect(ymd(nextRenewalDate(from, 'CUSTOM', 10))).toEqual([2026, 0, 25]);
  });

  it('pushes LIFETIME 100 years out (sentinel)', () => {
    expect(nextRenewalDate(from, 'LIFETIME').getFullYear()).toBe(2126);
  });

  it('does not mutate the input date', () => {
    const original = new Date(2026, 0, 15);
    nextRenewalDate(original, 'YEARLY');
    expect(ymd(original)).toEqual([2026, 0, 15]);
  });
});
