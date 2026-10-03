import { describe, expect, it } from 'vitest';
import type { DeviceListItem, Warranty } from '@/lib/api/devices';
import {
  activeAssetValue,
  allTimeSpend,
  buildSpendEntries,
  costPerDay,
  costPerDayRollup,
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

// ── Cost of ownership per day (đ/ngày, FEATURE_IDEAS #7) ────────────────────
// The edge cases below are the contract: divide-by-zero, missing date, a sale
// dated before the purchase, and unrecorded warranty cost.
describe('costPerDay', () => {
  // Local-time "now" so the calendar-day arithmetic is timezone-independent.
  const now = new Date(2026, 5, 15, 12, 0); // 15/06/2026

  it('divides (giá mua + gói bảo hành) by days owned', () => {
    const cost = costPerDay(
      device({ id: 'a', purchaseDate: '2026-05-16T00:00:00', purchasePrice: 30_000_000 }),
      [warranty({ id: 'w1', deviceId: 'a', cost: 3_000_000 })],
      now,
    );
    expect(cost).toMatchObject({
      perDay: 1_100_000,
      spent: 33_000_000,
      net: 33_000_000,
      days: 30,
      fromDay: '2026-05-16',
      toDay: '2026-06-15',
      endedBySale: false,
      hasNoRecordedCost: false,
      pricedWarrantyCount: 1,
    });
    expect(cost?.perDayLabel).toContain('1.100.000');
    expect(cost?.perDayLabel.endsWith('/ngày')).toBe(true);
  });

  it('charges a device bought today as one day — never divides by zero', () => {
    const cost = costPerDay(
      device({ id: 'today', purchaseDate: '2026-06-15T09:30:00', purchasePrice: 8_000_000 }),
      [],
      now,
    );
    expect(cost?.days).toBe(1);
    expect(cost?.perDay).toBe(8_000_000);
    expect(Number.isFinite(cost?.perDay)).toBe(true);
  });

  it('counts calendar days, not 24-hour windows', () => {
    // 23:30 → 00:30 the next day is "1 ngày" on the calendar, not 0.
    const cost = costPerDay(
      device({ id: 'late', purchaseDate: '2026-03-01T23:30:00', purchasePrice: 1_000_000 }),
      [],
      new Date(2026, 2, 11, 0, 30),
    );
    expect(cost?.days).toBe(10);
    expect(cost?.perDay).toBe(100_000);
  });

  it('returns null when the purchase date is missing or unreadable', () => {
    expect(costPerDay(device({ id: 'x', purchaseDate: '' }), [], now)).toBeNull();
    expect(costPerDay(device({ id: 'x', purchaseDate: 'không phải ngày' }), [], now)).toBeNull();
  });

  it('treats an unrecorded warranty cost as unknown, not as zero', () => {
    const cost = costPerDay(
      device({ id: 'a', purchaseDate: '2026-05-16T00:00:00', purchasePrice: 30_000_000 }),
      [
        warranty({ id: 'w1', deviceId: 'a', cost: null }),
        warranty({ id: 'w2', deviceId: 'a', cost: 3_000_000 }),
      ],
      now,
    );
    expect(cost?.warrantyPart).toBe(3_000_000);
    expect(cost?.hasUnrecordedWarrantyCost).toBe(true);
    expect(cost?.pricedWarrantyCount).toBe(1);
  });

  it('does not flag a recorded 0 ₫ package, and ignores negative / NaN costs', () => {
    const free = costPerDay(
      device({ id: 'a', purchaseDate: '2026-06-15T00:00:00', purchasePrice: 5_000_000 }),
      [warranty({ id: 'w1', deviceId: 'a', cost: 0 })],
      now,
    );
    expect(free?.hasUnrecordedWarrantyCost).toBe(false);
    expect(free?.warrantyPart).toBe(0);

    const bad = costPerDay(
      device({ id: 'b', purchaseDate: '2026-06-15T00:00:00', purchasePrice: 5_000_000 }),
      [
        warranty({ id: 'w1', deviceId: 'b', cost: -1_000_000 }),
        warranty({ id: 'w2', deviceId: 'b', cost: Number.NaN }),
      ],
      now,
    );
    // Bad data must not make the device look cheaper than it was.
    expect(bad?.warrantyPart).toBe(0);
    expect(bad?.hasUnrecordedWarrantyCost).toBe(true);
  });

  it('stops the clock at soldAt and subtracts the sale proceeds', () => {
    const cost = costPerDay(
      device({
        id: 'sold',
        purchaseDate: '2026-01-15T00:00:00',
        purchasePrice: 20_000_000,
        soldAt: '2026-06-15T00:00:00',
        soldPrice: 14_000_000,
      }),
      [warranty({ id: 'w1', deviceId: 'sold', cost: 1_000_000 })],
      now,
    );
    expect(cost).toMatchObject({
      days: 151,
      spent: 21_000_000,
      soldPart: 14_000_000,
      net: 7_000_000,
      endedBySale: true,
      toDay: '2026-06-15',
      fullyRecovered: false,
    });
    expect(cost?.perDay).toBe(Math.round(7_000_000 / 151));
  });

  it('clamps a sale dated before the purchase to one day and flags it', () => {
    const cost = costPerDay(
      device({
        id: 'bad',
        purchaseDate: '2026-06-01T00:00:00',
        purchasePrice: 10_000_000,
        soldAt: '2026-05-01T00:00:00',
        soldPrice: 2_000_000,
      }),
      [],
      now,
    );
    expect(cost?.soldBeforePurchase).toBe(true);
    expect(cost?.days).toBe(1);
    expect(cost?.perDay).toBe(8_000_000);
    expect(cost?.perDay).toBeGreaterThan(0);
    expect(Number.isFinite(cost?.perDay)).toBe(true);
  });

  it('never returns a negative figure when the resale covered everything', () => {
    const cost = costPerDay(
      device({
        id: 'profit',
        purchaseDate: '2026-01-15T00:00:00',
        purchasePrice: 10_000_000,
        soldAt: '2026-06-15T00:00:00',
        soldPrice: 15_000_000,
      }),
      [],
      now,
    );
    expect(cost?.net).toBe(-5_000_000);
    expect(cost?.fullyRecovered).toBe(true);
    expect(cost?.perDay).toBe(0);
    expect(cost?.perDayLabel.startsWith('0')).toBe(true);
  });

  it('subtracts an undated sale price but flags the missing date', () => {
    const cost = costPerDay(
      device({
        id: 'half',
        purchaseDate: '2026-06-15T00:00:00',
        purchasePrice: 10_000_000,
        soldAt: null,
        soldPrice: 4_000_000,
      }),
      [],
      now,
    );
    expect(cost?.hasUndatedSale).toBe(true);
    expect(cost?.endedBySale).toBe(false);
    expect(cost?.toDay).toBe('2026-06-15');
    expect(cost?.net).toBe(6_000_000);
  });

  it('rounds to whole đồng and flags a device with nothing recorded', () => {
    const cost = costPerDay(
      device({ id: 'round', purchaseDate: '2026-06-01T00:00:00', purchasePrice: 1_000 }),
      [],
      now,
    );
    // 1000 / 14 days = 71.43 → 71
    expect(cost?.days).toBe(14);
    expect(cost?.perDay).toBe(71);
    expect(Number.isInteger(cost?.perDay)).toBe(true);

    const unrecorded = costPerDay(
      device({ id: 'free', purchaseDate: '2026-06-01T00:00:00', purchasePrice: 0 }),
      [warranty({ id: 'w1', deviceId: 'free', cost: 0 })],
      now,
    );
    expect(unrecorded?.hasNoRecordedCost).toBe(true);
  });
});

describe('costPerDayRollup', () => {
  const now = new Date(2026, 5, 15, 12, 0);
  // Same 33tr over 30 days vs 30tr over 5 years: the cheap device per day is the
  // expensive one per purchase — the whole point of the inverse ranking.
  const priced: DeviceListItem[] = [
    device({
      id: 'short',
      name: 'Máy ảnh',
      purchaseDate: '2026-05-16T00:00:00',
      purchasePrice: 30_000_000,
    }),
    device({
      id: 'long',
      name: 'Laptop',
      purchaseDate: '2021-06-15T00:00:00',
      purchasePrice: 30_000_000,
    }),
    device({ id: 'undated', name: 'Không rõ ngày', purchaseDate: '' }),
    device({ id: 'unpriced', name: 'Chưa ghi giá', purchaseDate: '2026-06-01T00:00:00' }),
  ];
  const warranties = new Map<string, Warranty[]>([
    ['short', [warranty({ id: 'w1', deviceId: 'short', cost: 3_000_000 })]],
  ]);

  it('ranks the most expensive per day and the cheapest per day', () => {
    const { priciest, cheapest } = costPerDayRollup(priced, warranties, { now });
    expect(priciest.map((r) => r.device.id)).toEqual(['short', 'long']);
    expect(cheapest.map((r) => r.device.id)).toEqual(['long', 'short']);
    expect(priciest[0].cost.perDay).toBe(1_100_000);
    expect(cheapest[0].cost.perDay).toBeLessThan(priciest[0].cost.perDay);
  });

  it('reports why rows were left out instead of ranking them', () => {
    const { priciest, skipped } = costPerDayRollup(priced, warranties, { now });
    expect(priciest).toHaveLength(2);
    expect(skipped).toEqual({ noPurchaseDate: 1, noRecordedCost: 1 });
  });

  it('breaks ties deterministically and honours the limit', () => {
    const ties = [
      device({ id: 'b', name: 'Beta', purchaseDate: '2026-06-15T00:00:00', purchasePrice: 100 }),
      device({ id: 'a', name: 'Alpha', purchaseDate: '2026-06-15T00:00:00', purchasePrice: 100 }),
    ];
    const { priciest } = costPerDayRollup(ties, new Map(), { now, limit: 1 });
    expect(priciest.map((r) => r.device.id)).toEqual(['a']);
  });

  it('accepts devices in any order without mutating the input array', () => {
    const input = [...priced];
    costPerDayRollup(input, warranties, { now });
    expect(input.map((d) => d.id)).toEqual(priced.map((d) => d.id));
  });
});
