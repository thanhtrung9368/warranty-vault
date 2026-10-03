import { describe, expect, it } from 'vitest';
import type { DeviceListItem, Warranty } from '@/lib/api/devices';
import {
  activeAssetValue,
  allTimeSpend,
  buildSpendEntries,
  monthlySpendBuckets,
  spendByCategoryRollup,
  topExpensiveRollup,
  yearlySpend,
  yearsWithData,
} from '@/lib/stats-rollup';

function device(over: Partial<DeviceListItem> & { id: string }): DeviceListItem {
  return {
    userId: 'u1',
    name: 'Thiết bị',
    category: 'PHONE',
    brand: null,
    model: null,
    serialNumber: null,
    purchaseDate: '2026-03-15T00:00:00Z',
    purchasePrice: 0,
    purchasePlace: null,
    status: 'ACTIVE',
    notes: null,
    // Resale pair — defaults to "not sold"; the spend rollups ignore it.
    soldAt: null,
    soldPrice: null,
    // Return window (migration 0010) — defaults to "chưa ghi"; ignored here.
    returnWindowDays: null,
    receivedAt: null,
    createdAt: '2026-03-15T00:00:00Z',
    updatedAt: '2026-03-15T00:00:00Z',
    attachmentCount: 0,
    effectiveWarrantyEnd: null,
    returnDeadline: null,
    ...over,
  };
}

function warranty(
  over: Pick<Warranty, 'id' | 'deviceId'> & Partial<Warranty>,
): Warranty {
  return {
    type: 'STANDARD',
    provider: null,
    startDate: '2026-03-15T00:00:00Z',
    endDate: '2028-03-15T00:00:00Z',
    months: 24,
    cost: null,
    address: null,
    phone: null,
    notes: null,
    createdAt: '2026-03-15T00:00:00Z',
    updatedAt: '2026-03-15T00:00:00Z',
    ...over,
  };
}

// phone: bought 20tr in Mar 2026 + 2tr warranty package starting Apr 2026
// laptop: bought 30tr in Jun 2026, its warranty has no recorded cost
const devices: DeviceListItem[] = [
  device({
    id: 'phone',
    category: 'PHONE',
    purchaseDate: '2026-03-15T00:00:00Z',
    purchasePrice: 20_000_000,
    effectiveWarrantyEnd: '2028-03-15T00:00:00Z',
  }),
  device({
    id: 'laptop',
    category: 'LAPTOP',
    purchaseDate: '2026-06-10T00:00:00Z',
    purchasePrice: 30_000_000,
    effectiveWarrantyEnd: '2027-06-10T00:00:00Z',
  }),
];

const warrantiesByDevice = new Map<string, Warranty[]>([
  [
    'phone',
    [
      warranty({
        id: 'w1',
        deviceId: 'phone',
        cost: 2_000_000,
        startDate: '2026-04-01T00:00:00Z',
      }),
      warranty({
        id: 'w2',
        deviceId: 'phone',
        cost: null,
        startDate: '2027-04-01T00:00:00Z',
      }),
    ],
  ],
  ['laptop', [warranty({ id: 'w3', deviceId: 'laptop', cost: 0 })]],
]);

const entries = buildSpendEntries(devices, warrantiesByDevice);

describe('buildSpendEntries', () => {
  it('adds one entry per device plus one per paid warranty package', () => {
    expect(entries).toEqual([
      {
        amount: 20_000_000,
        date: new Date('2026-03-15T00:00:00Z'),
        category: 'PHONE',
        kind: 'device',
      },
      {
        amount: 2_000_000,
        date: new Date('2026-04-01T00:00:00Z'),
        category: 'PHONE',
        kind: 'warranty',
      },
      {
        amount: 30_000_000,
        date: new Date('2026-06-10T00:00:00Z'),
        category: 'LAPTOP',
        kind: 'device',
      },
    ]);
  });

  it('skips warranties with a null / zero cost', () => {
    expect(entries.filter((e) => e.kind === 'warranty')).toHaveLength(1);
  });
});

describe('allTimeSpend', () => {
  it('totals devices + warranty packages', () => {
    expect(allTimeSpend(entries)).toEqual({
      total: 52_000_000,
      deviceCount: 2,
      warrantyCount: 1,
    });
  });
});

describe('yearlySpend', () => {
  it('counts a warranty package in the year its coverage starts', () => {
    expect(yearlySpend(entries, 2026)).toEqual({
      total: 52_000_000,
      deviceCount: 2,
      warrantyCount: 1,
    });
    expect(yearlySpend(entries, 2025)).toEqual({
      total: 0,
      deviceCount: 0,
      warrantyCount: 0,
    });
  });
});

describe('monthlySpendBuckets', () => {
  it('always returns the trailing N months, newest bucket last', () => {
    expect(monthlySpendBuckets(entries, 12)).toHaveLength(12);
    expect(monthlySpendBuckets(entries, 1)).toHaveLength(1);
  });

  it('buckets by month and drops anything older than the window', () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);
    const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 15);
    const tooOld = new Date(now.getFullYear(), now.getMonth() - 13, 15);
    const buckets = monthlySpendBuckets(
      [
        { amount: 5_000, date: thisMonth, category: 'PHONE', kind: 'device' },
        { amount: 7_000, date: twoMonthsAgo, category: 'PHONE', kind: 'warranty' },
        { amount: 999_000, date: tooOld, category: 'PHONE', kind: 'device' },
      ],
      12,
    );
    expect(buckets[11].total).toBe(5_000);
    expect(buckets[9].total).toBe(7_000);
    expect(buckets.reduce((sum, b) => sum + b.total, 0)).toBe(12_000);
  });
});

describe('spendByCategoryRollup', () => {
  it('rolls warranty cost into the device category, keeping device counts', () => {
    const rows = spendByCategoryRollup(devices, entries);
    const phone = rows.find((r) => r.category === 'PHONE');
    const laptop = rows.find((r) => r.category === 'LAPTOP');
    expect(phone).toMatchObject({ label: 'Điện thoại', total: 22_000_000, count: 1 });
    expect(laptop).toMatchObject({ label: 'Laptop', total: 30_000_000, count: 1 });
  });
});

describe('activeAssetValue', () => {
  it('counts ACTIVE devices with a future warranty end, at purchase price only', () => {
    const asset = activeAssetValue([
      ...devices,
      device({
        id: 'sold',
        status: 'SOLD',
        purchasePrice: 99_000_000,
        effectiveWarrantyEnd: '2030-01-01T00:00:00Z',
      }),
      device({
        id: 'expired',
        purchasePrice: 50_000_000,
        effectiveWarrantyEnd: '2020-01-01T00:00:00Z',
      }),
      device({ id: 'nowarranty', purchasePrice: 10_000_000, effectiveWarrantyEnd: null }),
    ]);
    expect(asset).toEqual({ total: 50_000_000, count: 2 });
  });
});

describe('topExpensiveRollup / yearsWithData', () => {
  it('sorts by device price, highest first', () => {
    expect(topExpensiveRollup(devices, 5).map((d) => d.id)).toEqual(['laptop', 'phone']);
    expect(topExpensiveRollup(devices, 1).map((d) => d.id)).toEqual(['laptop']);
  });

  it('lists purchase years, newest first, always including the current year', () => {
    const currentYear = new Date().getFullYear();
    const years = yearsWithData([
      device({ id: 'a', purchaseDate: '2022-05-01T00:00:00Z' }),
      device({ id: 'b', purchaseDate: '2024-05-01T00:00:00Z' }),
    ]);
    expect(years).toContain(currentYear);
    expect(years).toEqual([...years].sort((a, b) => b - a));
  });
});
