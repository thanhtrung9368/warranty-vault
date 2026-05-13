// Typed client for /v1/stats on the Go service.
//
// Mirrors the existing `UserStats` shape from `lib/services/stats.ts` so
// callers don't need to relearn the schema — only the fetch path changes.

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
