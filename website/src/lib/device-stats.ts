// The dashboard's warranty buckets — one pure function, tested without Next.
//
// Before this module the buckets lived inside `dashboard/page.tsx` and did not
// reconcile:
//   * `total` was `devices.length`, but any device without a warranty was
//     skipped by `continue` — present in the total, absent from every tile;
//   * `expired` counted every device past its end regardless of status, so a
//     SOLD device with lapsed cover inflated "out of warranty";
//   * "covered" and "expiring" overlapped (expiring was a subset of covered),
//     so even adding the three visible numbers could not sum to the total.
//
// The contract now is: the buckets are mutually exclusive over ACTIVE devices
// (the same meaning as the Go quota — anything whose status is not `SOLD`), and
// `total` is their sum. A device with no warranty gets its own bucket instead of
// disappearing; that is the most urgent state right after a first save and is
// already a known action kind (`DEVICE_NO_WARRANTY`).
//
// `now` is a parameter (not `new Date()` inside) so the 30-day boundary and the
// "expires tomorrow" fixture are deterministic at test time.

import type { DeviceListItem } from '@/lib/api/devices';
import { daysUntil, parseDayValue } from '@/lib/api-day';

/** The subset of `DeviceListItem` the warranty timeline below renders. */
export type DeviceSoonItem = Pick<
  DeviceListItem,
  | 'id'
  | 'name'
  | 'category'
  | 'brand'
  | 'purchaseDate'
  | 'purchasePrice'
  | 'currency'
  | 'purchasePriceVnd'
  | 'effectiveWarrantyEnd'
> & {
  // Narrowed from `string | null`: this item is only ever built when a date
  // exists, so the card can render `<WarrantyPill warrantyEnd>` unguarded.
  effectiveWarrantyEnd: string;
};

export type DeviceStats = {
  /** Non-SOLD devices. Always `covered + expiring + expired + noWarranty`. */
  total: number;
  /** Warranty ends more than 30 days from today. */
  covered: number;
  /** Warranty ends today or within the next 30 days. */
  expiring: number;
  /** Warranty ended before today. */
  expired: number;
  /** No warranty row at all — `effectiveWarrantyEnd` is null. */
  noWarranty: number;
  soonList: DeviceSoonItem[];
};

/** A device counts as active unless it has been sold (Go's quota predicate). */
export function isActiveDevice(device: Pick<DeviceListItem, 'status'>): boolean {
  return device.status !== 'SOLD';
}

export const EXPIRING_WINDOW_DAYS = 30;

export function computeDeviceStats(
  devices: readonly DeviceListItem[],
  now: Date = new Date(),
): DeviceStats {
  let total = 0;
  let covered = 0;
  let expiring = 0;
  let expired = 0;
  let noWarranty = 0;
  const soonList: DeviceSoonItem[] = [];

  for (const device of devices) {
    if (!isActiveDevice(device)) continue;
    total += 1;

    if (!device.effectiveWarrantyEnd) {
      noWarranty += 1;
      continue;
    }

    // Day boundaries, not instants: a warranty ending today is still in force,
    // and one that ended yesterday is not. `daysUntil` reads the server's
    // day-instant shape without shifting it into the previous local day.
    const daysLeft = daysUntil(device.effectiveWarrantyEnd, now);

    if (!Number.isFinite(daysLeft) || daysLeft < 0) {
      expired += 1;
      continue;
    }
    if (daysLeft <= EXPIRING_WINDOW_DAYS) {
      expiring += 1;
      soonList.push({
        id: device.id,
        name: device.name,
        category: device.category,
        brand: device.brand,
        purchaseDate: device.purchaseDate,
        purchasePrice: device.purchasePrice,
        currency: device.currency,
        purchasePriceVnd: device.purchasePriceVnd,
        effectiveWarrantyEnd: device.effectiveWarrantyEnd,
      });
      continue;
    }
    covered += 1;
  }

  soonList.sort(
    (a, b) =>
      (parseDayValue(a.effectiveWarrantyEnd)?.getTime() ?? 0) -
      (parseDayValue(b.effectiveWarrantyEnd)?.getTime() ?? 0),
  );

  return {
    total,
    covered,
    expiring,
    expired,
    noWarranty,
    soonList: soonList.slice(0, 8),
  };
}
