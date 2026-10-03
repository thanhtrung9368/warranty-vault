// Typed client for /v1/stats + /v1/forecast on the Go service.
//
// `UserStats` mirrors the existing shape from `lib/services/stats.ts` so callers
// don't need to relearn the schema — only the fetch path changes. The forecast is
// a separate endpoint (openapi tag `stats`) on purpose: `/v1/stats` is one round
// trip all three clients already share and its shape must not change, while the
// forward-looking arithmetic needs three extra queries per request.

import { apiFetch, type ApiResult } from './client';

export type DeviceStatusKey = 'ACTIVE' | 'EXPIRED' | 'SOLD' | 'BROKEN' | 'LOST';
export type SubscriptionStatusKey = 'ACTIVE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';
export type WishlistStatusKey = 'WATCHING' | 'DECIDED' | 'SKIPPED' | 'PURCHASED';

export type UserStats = {
  devices: {
    total: number;
    byStatus: Record<DeviceStatusKey, number>;
    totalPurchasePrice: number;
  };
  subscriptions: {
    total: number;
    byStatus: Record<SubscriptionStatusKey, number>;
    totalMonthlyVnd: number;
  };
  wishlist: {
    total: number;
    byStatus: Record<WishlistStatusKey, number>;
    totalCurrentPriceWatching: number;
  };
};

export async function get(): Promise<ApiResult<UserStats>> {
  return apiFetch<UserStats>('GET', '/v1/stats');
}

// ---- spending forecast (openapi `Forecast`) --------------------------------
//
// Money in this payload comes in three different flavours and the distinction is
// the whole point of the feature:
//   * `subscriptionVnd`            — a real scheduled charge in the window;
//   * `subscriptionAutoRenewVnd`   — the part of it that will be charged
//                                    automatically (the difference is money the
//                                    user still has to decide about);
//   * `warrantyExpiringVnd` /      — a REFERENCE, not a charge: the cost of the
//     `wishlistTargetVnd`            package that is expiring / the last recorded
//                                    price of a wishlist item.
// The API ships a Vietnamese `note` saying exactly that; it must be surfaced
// rather than paraphrased away (see `components/forecast-panel.tsx`).

export type ForecastBucket = {
  // `YYYY-MM`, UTC.
  month: string;
  subscriptionVnd: number;
  subscriptionAutoRenewVnd: number;
  subscriptionCount: number;
  warrantyExpiringVnd: number;
  warrantyExpiringCount: number;
  wishlistTargetVnd: number;
  wishlistTargetCount: number;
};

export type ForecastWarranty = {
  id: string;
  deviceId: string;
  deviceName: string;
  type: 'STANDARD' | 'EXTENDED' | 'THIRD_PARTY';
  provider: string | null;
  // RFC3339Nano UTC.
  endDate: string;
  // Bucket this row was counted in.
  month: string;
  months: number;
  // Price of the expiring package — reference for saving up, NOT a charge.
  // `null` means no price was ever recorded (which is not the same as 0đ).
  costVnd: number | null;
};

export type ForecastWishlistItem = {
  id: string;
  name: string;
  targetDate: string;
  month: string;
  priority: 'MUST' | 'WANT' | 'MAYBE';
  status: 'WATCHING' | 'DECIDED';
  // Last recorded price; `null` when none was ever entered.
  currentPriceVnd: number | null;
};

export type Forecast = {
  generatedAt: string;
  // [windowStart, windowEnd): a charge landing exactly on `windowEnd` belongs to
  // no bucket.
  windowStart: string;
  windowEnd: string;
  // The requested horizon in calendar months (1–24). `buckets` is normally
  // `months + 1` long — the partial current month plus full ones — so nothing may
  // assume exactly 12.
  months: number;
  currency: 'VND';
  subscriptionTotalVnd: number;
  subscriptionAutoRenewTotalVnd: number;
  // Canonical monthly equivalent — equal to `UserStats.subscriptions.totalMonthlyVnd`
  // for the same data, so never recompute it locally.
  subscriptionMonthlyAverageVnd: number;
  subscriptionsCount: number;
  chargesCount: number;
  buckets: ForecastBucket[];
  upcomingWarranties: ForecastWarranty[];
  upcomingWishlist: ForecastWishlistItem[];
  // Vietnamese honesty line. Render as-is.
  note: string;
};

// `months` is 1–24; Go answers 400 (rather than silently defaulting) for a
// non-integer or out-of-range value, so callers normalise first
// (`normalizeForecastMonths` in `lib/forecast-rollup`) and never send garbage.
export async function forecast(months = 12): Promise<ApiResult<Forecast>> {
  return apiFetch<Forecast>('GET', `/v1/forecast?months=${encodeURIComponent(String(months))}`);
}
