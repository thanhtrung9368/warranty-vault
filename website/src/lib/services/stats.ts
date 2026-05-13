import { prisma } from '@/lib/prisma';

// Status taxonomies — kept as plain string literals because the Prisma schema
// stores them as String columns (validated in app code). Mirror the values in
// `prisma/schema.prisma` and `src/lib/types.ts`.
const DEVICE_STATUSES = ['ACTIVE', 'EXPIRED', 'SOLD', 'BROKEN', 'LOST'] as const;
const SUBSCRIPTION_STATUSES = ['ACTIVE', 'PAUSED', 'CANCELED', 'EXPIRED'] as const;
const WISHLIST_STATUSES = ['WATCHING', 'DECIDED', 'SKIPPED', 'PURCHASED'] as const;

export type DeviceStatusKey = (typeof DEVICE_STATUSES)[number];
export type SubscriptionStatusKey = (typeof SUBSCRIPTION_STATUSES)[number];
export type WishlistStatusKey = (typeof WISHLIST_STATUSES)[number];

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

function emptyMap<K extends string>(keys: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of keys) out[k] = 0;
  return out;
}

/**
 * Convert a sub's `price` (per cycle) into a normalized monthly VND amount.
 * Mirrors the rules in CLAUDE.md / subscription-types: MONTHLY=price,
 * QUARTERLY=floor(price/3), YEARLY=floor(price/12), CUSTOM=round(price*30/intervalDays).
 * LIFETIME never contributes (filtered before this is called).
 */
function monthlyVnd(
  billingCycle: string,
  price: number,
  intervalDays: number | null,
): number {
  switch (billingCycle) {
    case 'MONTHLY':
      return price;
    case 'QUARTERLY':
      return Math.floor(price / 3);
    case 'YEARLY':
      return Math.floor(price / 12);
    case 'CUSTOM': {
      if (!intervalDays || intervalDays <= 0) return 0;
      return Math.round((price * 30) / intervalDays);
    }
    case 'LIFETIME':
    default:
      return 0;
  }
}

/**
 * Aggregate per-user stats for the dashboard / mobile home screen.
 *
 * Trade-off: we use parallel `groupBy` queries rather than a single hand-rolled
 * raw SQL union. groupBy gives type-safety and works across Postgres/SQLite,
 * and at the per-user scale (≤50 devices, ≤100 subs, ≤200 wishlist items)
 * 6 indexed queries in parallel are well under 50ms — no need to optimize
 * further. Subscriptions are pulled in full (small N) so we can compute the
 * monthly equivalent in JS without complex SQL.
 */
export async function getUserStats(userId: string): Promise<UserStats> {
  const [
    deviceGrouped,
    deviceSum,
    activeNonLifetimeSubs,
    subGrouped,
    wishlistGrouped,
    wishlistActiveAgg,
  ] = await Promise.all([
    prisma.device.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.device.aggregate({
      where: { userId },
      _sum: { purchasePrice: true },
      _count: { _all: true },
    }),
    prisma.subscription.findMany({
      where: { userId, status: 'ACTIVE', billingCycle: { not: 'LIFETIME' } },
      select: { billingCycle: true, price: true, intervalDays: true },
    }),
    prisma.subscription.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.wishlistItem.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    }),
    prisma.wishlistItem.aggregate({
      where: { userId, status: { in: ['WATCHING', 'DECIDED'] } },
      _sum: { currentPrice: true },
    }),
  ]);

  // Devices ----------------------------------------------------------------
  const deviceByStatus = emptyMap(DEVICE_STATUSES);
  for (const row of deviceGrouped) {
    const k = row.status as DeviceStatusKey;
    if (k in deviceByStatus) deviceByStatus[k] = row._count._all;
  }

  // Subscriptions ----------------------------------------------------------
  const subByStatus = emptyMap(SUBSCRIPTION_STATUSES);
  let subTotal = 0;
  for (const row of subGrouped) {
    const k = row.status as SubscriptionStatusKey;
    subTotal += row._count._all;
    if (k in subByStatus) subByStatus[k] = row._count._all;
  }

  let totalMonthlyVnd = 0;
  for (const sub of activeNonLifetimeSubs) {
    totalMonthlyVnd += monthlyVnd(sub.billingCycle, sub.price, sub.intervalDays);
  }

  // Wishlist ---------------------------------------------------------------
  const wishlistByStatus = emptyMap(WISHLIST_STATUSES);
  let wishlistTotal = 0;
  for (const row of wishlistGrouped) {
    const k = row.status as WishlistStatusKey;
    wishlistTotal += row._count._all;
    if (k in wishlistByStatus) wishlistByStatus[k] = row._count._all;
  }

  return {
    devices: {
      total: deviceSum._count._all,
      byStatus: deviceByStatus,
      totalPurchasePrice: deviceSum._sum.purchasePrice ?? 0,
    },
    subscriptions: {
      total: subTotal,
      byStatus: subByStatus,
      totalMonthlyVnd,
    },
    wishlist: {
      total: wishlistTotal,
      byStatus: wishlistByStatus,
      totalCurrentPriceWatching: wishlistActiveAgg._sum.currentPrice ?? 0,
    },
  };
}
