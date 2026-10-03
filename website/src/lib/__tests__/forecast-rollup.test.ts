import { describe, it, expect } from 'vitest';
import {
  FORECAST_MONTHS_DEFAULT,
  FORECAST_MONTHS_MAX,
  FORECAST_MONTHS_MIN,
  autoRenewSplit,
  bucketMonthLabel,
  bucketMonthShortLabel,
  chargeCountLabel,
  forecastChartData,
  forecastTotals,
  forecastWindowLabel,
  buildForecastRows,
  isForecastEmpty,
  monthKeyOf,
  normalizeForecastMonths,
  packageCountLabel,
  possibleSpendTotals,
} from '@/lib/forecast-rollup';
import type { Forecast, ForecastBucket } from '@/lib/api/stats';

// Fixtures follow the API's own rules: a 12-month window normally yields 13
// buckets (a partial current month + 12 full ones), the last one partial too.
// Money is int64 VND; the two reference columns are NOT charges.

function bucket(over: Partial<ForecastBucket> & { month: string }): ForecastBucket {
  return {
    subscriptionVnd: 0,
    subscriptionAutoRenewVnd: 0,
    subscriptionCount: 0,
    warrantyExpiringVnd: 0,
    warrantyExpiringCount: 0,
    wishlistTargetVnd: 0,
    wishlistTargetCount: 0,
    ...over,
  };
}

const FORECAST: Pick<Forecast, 'buckets' | 'windowStart' | 'generatedAt' | 'windowEnd'> = {
  generatedAt: '2026-03-14T09:00:00Z',
  windowStart: '2026-03-14T09:00:00Z',
  // A 3-month window opened mid-March ends mid-June, so — exactly like the real
  // 12-month payload — it carries months+1 = 4 buckets, and BOTH edges are cut
  // off mid-month (the first counts from today, the last only up to windowEnd).
  windowEnd: '2026-06-14T09:00:00Z',
  buckets: [
    bucket({ month: '2026-03' }),
    bucket({
      month: '2026-04',
      subscriptionVnd: 1_500_000,
      subscriptionAutoRenewVnd: 1_500_000,
      subscriptionCount: 2,
      warrantyExpiringVnd: 4_000_000,
      warrantyExpiringCount: 1,
      wishlistTargetVnd: 25_000_000,
      wishlistTargetCount: 1,
    }),
    bucket({
      month: '2026-05',
      subscriptionVnd: 400_000,
      subscriptionAutoRenewVnd: 100_000,
      subscriptionCount: 1,
      wishlistTargetVnd: 9_000_000,
      wishlistTargetCount: 1,
    }),
    // Even an empty month keeps its place in the list.
    bucket({ month: '2026-06' }),
  ],
};

describe('normalizeForecastMonths', () => {
  it('defaults to 12 when the param is absent or blank', () => {
    expect(normalizeForecastMonths(undefined)).toBe(FORECAST_MONTHS_DEFAULT);
    expect(normalizeForecastMonths(null)).toBe(FORECAST_MONTHS_DEFAULT);
    expect(normalizeForecastMonths('')).toBe(FORECAST_MONTHS_DEFAULT);
    expect(FORECAST_MONTHS_DEFAULT).toBe(12);
  });

  it('accepts the whole 1–24 range', () => {
    expect(normalizeForecastMonths('1')).toBe(FORECAST_MONTHS_MIN);
    expect(normalizeForecastMonths('24')).toBe(FORECAST_MONTHS_MAX);
    expect(normalizeForecastMonths('6')).toBe(6);
    expect(normalizeForecastMonths(9)).toBe(9);
  });

  it('clamps out-of-range values instead of forwarding them', () => {
    // The API answers 400 for these; a hand-edited ?fm= URL must not break /stats.
    expect(normalizeForecastMonths('0')).toBe(FORECAST_MONTHS_MIN);
    expect(normalizeForecastMonths('-5')).toBe(FORECAST_MONTHS_MIN);
    expect(normalizeForecastMonths('25')).toBe(FORECAST_MONTHS_MAX);
    expect(normalizeForecastMonths('9999')).toBe(FORECAST_MONTHS_MAX);
  });

  it('falls back to the default for garbage, and truncates fractions', () => {
    expect(normalizeForecastMonths('abc')).toBe(FORECAST_MONTHS_DEFAULT);
    expect(normalizeForecastMonths('NaN')).toBe(FORECAST_MONTHS_DEFAULT);
    // Non-finite is "not a number we can use" → the default, not a clamp.
    expect(normalizeForecastMonths('Infinity')).toBe(FORECAST_MONTHS_DEFAULT);
    // …while a finite but absurd value clamps into range.
    expect(normalizeForecastMonths('1e9')).toBe(FORECAST_MONTHS_MAX);
    // 1.5 is a 400 from Go; the picker only ever produces integers, so a
    // fractional URL value degrades to a legal integer.
    expect(normalizeForecastMonths('1.5')).toBe(1);
    expect(normalizeForecastMonths('12.9')).toBe(12);
  });
});

describe('bucket labels', () => {
  it('renders Vietnamese month labels from the UTC bucket key', () => {
    expect(bucketMonthLabel('2026-03')).toBe('Tháng 3/2026');
    expect(bucketMonthLabel('2026-12')).toBe('Tháng 12/2026');
    expect(bucketMonthShortLabel('2026-03')).toBe('T3/26');
    expect(bucketMonthShortLabel('2027-01')).toBe('T1/27');
  });

  it('leaves an unexpected key untouched instead of inventing a month', () => {
    expect(bucketMonthLabel('')).toBe('');
    expect(bucketMonthLabel('2026-3')).toBe('2026-3');
    expect(bucketMonthShortLabel('nope')).toBe('nope');
  });

  it('derives the current month from a UTC timestamp', () => {
    expect(monthKeyOf('2026-03-14T09:00:00Z')).toBe('2026-03');
    // 23:30 UTC on the 31st is still March in the bucket clock.
    expect(monthKeyOf('2026-03-31T23:30:00Z')).toBe('2026-03');
    expect(monthKeyOf('not-a-date')).toBe('');
  });
});

describe('autoRenewSplit', () => {
  it('splits money that will be charged automatically from money to decide on', () => {
    expect(autoRenewSplit({ subscriptionVnd: 400_000, subscriptionAutoRenewVnd: 100_000 })).toEqual(
      { auto: 100_000, selfRenew: 300_000, total: 400_000 },
    );
  });

  it('handles the all-automatic and none-automatic ends', () => {
    expect(autoRenewSplit({ subscriptionVnd: 200_000, subscriptionAutoRenewVnd: 200_000 })).toEqual(
      { auto: 200_000, selfRenew: 0, total: 200_000 },
    );
    expect(autoRenewSplit({ subscriptionVnd: 200_000, subscriptionAutoRenewVnd: 0 })).toEqual({
      auto: 0,
      selfRenew: 200_000,
      total: 200_000,
    });
  });

  it('never renders a negative "phải tự gia hạn"', () => {
    expect(autoRenewSplit({ subscriptionVnd: 100, subscriptionAutoRenewVnd: 900 }).selfRenew).toBe(
      0,
    );
    expect(autoRenewSplit({ subscriptionVnd: -5, subscriptionAutoRenewVnd: -9 })).toEqual({
      auto: 0,
      selfRenew: 0,
      total: 0,
    });
  });
});

describe('buildForecastRows', () => {
  const rows = buildForecastRows(FORECAST);

  it('keeps every bucket the API sent, in order — no assumption of 12', () => {
    expect(rows.map((r) => r.month)).toEqual([
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
    ]);
  });

  it('marks the bucket that contains windowStart as the partial current month', () => {
    expect(rows.filter((r) => r.isCurrentMonth).map((r) => r.month)).toEqual(['2026-03']);
  });

  it('marks the bucket that contains windowEnd as the partial closing month', () => {
    expect(rows.filter((r) => r.isClosingMonth).map((r) => r.month)).toEqual(['2026-06']);
    expect(rows.map((r) => r.isPartial)).toEqual([true, false, false, true]);
  });

  it('does not mark a closing month when the window ends on a month start', () => {
    // now = the first instant of a month → exactly `months` buckets, none partial
    // at the tail (openapi: "đúng `months` phần tử khi gọi đúng 00:00 ngày 1").
    const edge = buildForecastRows({
      generatedAt: '2026-03-01T00:00:00Z',
      windowStart: '2026-03-01T00:00:00Z',
      windowEnd: '2026-04-01T00:00:00Z',
      buckets: [bucket({ month: '2026-03' })],
    });
    expect(edge).toHaveLength(1);
    expect(edge[0].isCurrentMonth).toBe(true);
    expect(edge[0].isClosingMonth).toBe(false);
  });

  it('keeps the auto / self-renew split per month', () => {
    const may = rows[2];
    expect(may.subscriptionVnd).toBe(400_000);
    expect(may.autoRenewVnd).toBe(100_000);
    expect(may.selfRenewVnd).toBe(300_000);
    expect(may.subscriptionCount).toBe(1);
  });

  it('keeps the reference columns separate from the charges', () => {
    const apr = rows[1];
    expect(apr.subscriptionVnd).toBe(1_500_000);
    expect(apr.warrantyExpiringVnd).toBe(4_000_000);
    expect(apr.wishlistTargetVnd).toBe(25_000_000);
    // `possibleSpendVnd` is a helper label, never part of `subscriptionVnd`.
    expect(apr.possibleSpendVnd).toBe(29_000_000);
    expect(apr.isEmpty).toBe(false);
  });

  it('flags a month with nothing in it', () => {
    expect(rows[0].isEmpty).toBe(true);
    expect(rows[3].isEmpty).toBe(true);
  });

  it('survives a missing / empty payload', () => {
    expect(buildForecastRows(null)).toEqual([]);
    expect(buildForecastRows(undefined)).toEqual([]);
    expect(buildForecastRows({ buckets: [], windowStart: '', generatedAt: '' })).toEqual([]);
  });

  it('builds stacked chart rows off the same numbers', () => {
    const data = forecastChartData(rows);
    expect(data[1]).toEqual({
      month: 'T4/26',
      label: 'Tháng 4/2026',
      total: 1_500_000,
      auto: 1_500_000,
      selfRenew: 0,
    });
    expect(data[2].selfRenew).toBe(300_000);
  });
});

describe('forecastTotals', () => {
  it('reads the window totals from the API, not from the buckets', () => {
    const totals = forecastTotals({
      subscriptionTotalVnd: 1_900_000,
      subscriptionAutoRenewTotalVnd: 1_600_000,
      subscriptionMonthlyAverageVnd: 350_000,
      subscriptionsCount: 3,
      chargesCount: 4,
    });
    expect(totals).toEqual({
      total: 1_900_000,
      auto: 1_600_000,
      selfRenew: 300_000,
      monthlyAverage: 350_000,
      subscriptionsCount: 3,
      chargesCount: 4,
    });
  });

  it('clamps a nonsense auto-renew total and tolerates a null payload', () => {
    expect(
      forecastTotals({
        subscriptionTotalVnd: 100,
        subscriptionAutoRenewTotalVnd: 500,
        subscriptionMonthlyAverageVnd: 0,
        subscriptionsCount: 0,
        chargesCount: 0,
      }).selfRenew,
    ).toBe(0);
    expect(forecastTotals(null).total).toBe(0);
  });
});

describe('possibleSpendTotals', () => {
  it('sums the reference columns without touching the scheduled total', () => {
    const rows = buildForecastRows(FORECAST);
    expect(possibleSpendTotals(rows)).toEqual({
      warrantyVnd: 4_000_000,
      warrantyCount: 1,
      wishlistVnd: 34_000_000,
      wishlistCount: 2,
      total: 38_000_000,
    });
  });
});

describe('isForecastEmpty', () => {
  it('is true only when nothing at all happens in the window', () => {
    expect(isForecastEmpty(null)).toBe(true);
    expect(
      isForecastEmpty({ buckets: [bucket({ month: '2026-03' })], upcomingWarranties: [], upcomingWishlist: [] }),
    ).toBe(true);
    expect(
      isForecastEmpty({
        buckets: [bucket({ month: '2026-03', subscriptionVnd: 1 })],
        upcomingWarranties: [],
        upcomingWishlist: [],
      }),
    ).toBe(false);
  });

  it('is false when only a wishlist milestone exists — no device/subscription needed', () => {
    expect(
      isForecastEmpty({
        buckets: [bucket({ month: '2026-03' })],
        upcomingWarranties: [],
        upcomingWishlist: [
          {
            id: 'w1',
            name: 'iPad',
            targetDate: '2026-04-01T00:00:00Z',
            month: '2026-04',
            priority: 'WANT',
            status: 'WATCHING',
            currentPriceVnd: null,
          },
        ],
      }),
    ).toBe(false);
  });
});

describe('window + count labels', () => {
  it('labels the window from the API bounds', () => {
    expect(
      forecastWindowLabel({
        windowStart: '2026-03-14T09:00:00Z',
        windowEnd: '2027-03-14T09:00:00Z',
      }),
    ).toBe('Tháng 3/2026 – Tháng 3/2027');
    expect(forecastWindowLabel(null)).toBe('');
  });

  it('pluralises counts in Vietnamese', () => {
    expect(chargeCountLabel(0)).toBe('Không có kỳ nào');
    expect(chargeCountLabel(1)).toBe('1 kỳ gia hạn');
    expect(chargeCountLabel(4)).toBe('4 kỳ gia hạn');
    expect(packageCountLabel(0)).toBe('');
    expect(packageCountLabel(1)).toBe('1 gói');
    expect(packageCountLabel(2, 'món')).toBe('2 món');
  });
});
