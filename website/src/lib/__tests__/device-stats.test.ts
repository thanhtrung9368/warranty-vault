// The dashboard tiles must reconcile. This pins the pure bucket function with
// the three cases the audit called out: a device with no warranty, a SOLD
// device with lapsed cover, and one expiring tomorrow — plus a covered and an
// already-expired device so every bucket has a member.
//
// A visual check cannot prove this: the old bug produced five plausible-looking
// numbers whose sum was one short, which looks like a design choice until you
// add the rows up. The assertion `sum === total` is the actual contract.

import { describe, expect, it } from 'vitest';
import type { DeviceListItem } from '@/lib/api/devices';
import {
  computeDeviceStats,
  EXPIRING_WINDOW_DAYS,
  isActiveDevice,
} from '@/lib/device-stats';

function device(
  over: Partial<DeviceListItem> & { id: string },
): DeviceListItem {
  const base: DeviceListItem = {
    id: 'device',
    userId: 'u1',
    name: 'Thiết bị',
    category: 'PHONE',
    brand: null,
    model: null,
    serialNumber: null,
    purchaseDate: '2026-03-15',
    purchasePrice: 0,
    currency: 'VND',
    fxRate: null,
    purchasePriceVnd: 0,
    soldPriceVnd: null,
    purchasePlace: null,
    status: 'ACTIVE',
    notes: null,
    soldAt: null,
    soldPrice: null,
    returnWindowDays: null,
    receivedAt: null,
    leadDays: [30, 7],
    activationRequired: false,
    activatedAt: null,
    extendedCoverBuyBy: null,
    brandWarrantyStatus: null,
    brandWarrantyStart: null,
    brandWarrantyEnd: null,
    brandCheckedAt: null,
    brandLookupUrl: null,
    warrantyMismatch: null,
    createdAt: '2026-03-15T00:00:00Z',
    updatedAt: '2026-03-15T00:00:00Z',
    attachmentCount: 0,
    effectiveWarrantyEnd: null,
    returnDeadline: null,
  };
  return { ...base, ...over };
}

// A fixed local noon so `daysUntil`'s calendar-day arithmetic is deterministic
// regardless of the machine's timezone.
const NOW = new Date(2026, 9, 21, 12, 0, 0);

describe('computeDeviceStats', () => {
  const devices = [
    // No Warranty row at all: the old function `continue`d before counting it,
    // so it appeared in Total and in no other tile.
    device({ id: 'no-warranty', name: 'Máy giặt', effectiveWarrantyEnd: null }),
    // Sold history with lapsed cover: must not inflate "out of warranty".
    device({
      id: 'sold',
      name: 'iPhone cũ',
      status: 'SOLD',
      effectiveWarrantyEnd: '2020-01-01',
    }),
    // Tomorrow: expiring, not covered.
    device({
      id: 'tomorrow',
      name: 'Tủ lạnh',
      effectiveWarrantyEnd: '2026-10-22',
    }),
    // More than 30 days out.
    device({
      id: 'covered',
      name: 'Laptop',
      effectiveWarrantyEnd: '2026-12-20',
    }),
    // Ended yesterday.
    device({
      id: 'expired',
      name: 'Máy ảnh',
      effectiveWarrantyEnd: '2026-10-20',
    }),
    // BROKEN is still an active device for the quota and for these tiles.
    device({
      id: 'broken',
      name: 'Điện thoại',
      status: 'BROKEN',
      effectiveWarrantyEnd: '2027-01-01',
    }),
  ];

  const stats = computeDeviceStats(devices, NOW);

  it('puts every active device in exactly one bucket', () => {
    expect(stats.covered).toBe(2); // covered + broken
    expect(stats.expiring).toBe(1);
    expect(stats.expired).toBe(1);
    expect(stats.noWarranty).toBe(1);
    expect(stats.total).toBe(5); // sold excluded
  });

  it('sums the buckets to the total', () => {
    const sum =
      stats.covered + stats.expiring + stats.expired + stats.noWarranty;
    expect(sum).toBe(stats.total);
  });

  it('excludes sold devices from the total and every bucket', () => {
    expect(isActiveDevice({ status: 'SOLD' })).toBe(false);
    expect(isActiveDevice({ status: 'ACTIVE' })).toBe(true);
    expect(stats.expired).toBe(1); // only the ACTIVE device from yesterday
  });

  it('keeps the "expiring soon" list to the expiring bucket', () => {
    expect(stats.soonList.map((item) => item.id)).toEqual(['tomorrow']);
  });

  it('treats the 30-day boundary as inclusive and today as still in force', () => {
    const boundary = computeDeviceStats(
      [
        device({ id: 'today', effectiveWarrantyEnd: '2026-10-21' }),
        device({ id: 'day-30', effectiveWarrantyEnd: '2026-11-20' }),
        device({ id: 'day-31', effectiveWarrantyEnd: '2026-11-21' }),
        device({ id: 'yesterday', effectiveWarrantyEnd: '2026-10-20' }),
      ],
      NOW,
    );
    expect(EXPIRING_WINDOW_DAYS).toBe(30);
    expect(boundary.expiring).toBe(2); // today + day 30
    expect(boundary.covered).toBe(1); // day 31
    expect(boundary.expired).toBe(1); // yesterday
    expect(boundary.total).toBe(4);
    expect(
      boundary.covered +
        boundary.expiring +
        boundary.expired +
        boundary.noWarranty,
    ).toBe(boundary.total);
  });

  it('handles an empty account without inventing a bucket', () => {
    expect(computeDeviceStats([], NOW)).toEqual({
      total: 0,
      covered: 0,
      expiring: 0,
      expired: 0,
      noWarranty: 0,
      soonList: [],
    });
  });
});
