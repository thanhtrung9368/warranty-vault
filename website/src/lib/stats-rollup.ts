// Pure money rollups for the /stats page.
//
// The page pulls raw rows from Go (devices, each device's warranty packages,
// plus the `/v1/stats` subscription aggregate) and crunches them here so the
// number-crunching is unit-testable without a backend — same pattern as
// `warranty.ts` / `subscription-types.ts`.
//
// Attribution rules:
//   - a device's `purchasePrice` counts in the month/year of `purchaseDate`;
//   - a warranty package's `cost` counts in the month/year of its `startDate`
//     (that's when the money was spent) and rolls up into the category of the
//     device it protects.

import { startOfMonth, subMonths, format } from 'date-fns';
import { vi } from 'date-fns/locale';
import type { DeviceListItem, Warranty } from '@/lib/api/devices';
import { CATEGORY_LABELS, type Category } from '@/lib/types';

export type SpendEntry = {
  amount: number;
  date: Date;
  category: string;
  kind: 'device' | 'warranty';
};

export type SpendTotals = {
  total: number;
  deviceCount: number;
  warrantyCount: number;
};

export type CategorySpend = {
  category: string;
  label: string;
  total: number;
  count: number;
};

function isValidDate(d: Date): boolean {
  return !Number.isNaN(d.getTime());
}

export function buildSpendEntries(
  devices: DeviceListItem[],
  warrantiesByDevice: Map<string, Warranty[]>,
): SpendEntry[] {
  const entries: SpendEntry[] = [];
  for (const d of devices) {
    entries.push({
      amount: d.purchasePrice,
      date: new Date(d.purchaseDate),
      category: d.category,
      kind: 'device',
    });
    for (const w of warrantiesByDevice.get(d.id) ?? []) {
      if (w.cost == null || w.cost <= 0) continue;
      entries.push({
        amount: w.cost,
        date: new Date(w.startDate),
        category: d.category,
        kind: 'warranty',
      });
    }
  }
  return entries;
}

export function monthlySpendBuckets(entries: SpendEntry[], months = 12) {
  const start = startOfMonth(subMonths(new Date(), months - 1));
  const buckets = new Map<string, number>();
  for (let i = 0; i < months; i++) {
    const d = startOfMonth(subMonths(new Date(), months - 1 - i));
    buckets.set(format(d, 'yyyy-MM'), 0);
  }
  for (const e of entries) {
    if (!isValidDate(e.date) || e.date < start) continue;
    const key = format(startOfMonth(e.date), 'yyyy-MM');
    if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + e.amount);
  }
  return Array.from(buckets.entries()).map(([k, total]) => {
    const [y, m] = k.split('-').map(Number);
    const dateObj = new Date(y, m - 1, 1);
    return {
      month: format(dateObj, 'MM/yy', { locale: vi }),
      total,
    };
  });
}

// Device count stays per-category (the pie tooltip reads "N món"); `total`
// includes the warranty packages bought for devices in that category.
export function spendByCategoryRollup(
  devices: DeviceListItem[],
  entries: SpendEntry[],
): CategorySpend[] {
  const map = new Map<string, { total: number; count: number }>();
  for (const d of devices) {
    const cur = map.get(d.category) ?? { total: 0, count: 0 };
    cur.count += 1;
    map.set(d.category, cur);
  }
  for (const e of entries) {
    const cur = map.get(e.category) ?? { total: 0, count: 0 };
    cur.total += e.amount;
    map.set(e.category, cur);
  }
  return Array.from(map.entries()).map(([category, v]) => ({
    category,
    label: CATEGORY_LABELS[category as Category] ?? category,
    total: v.total,
    count: v.count,
  }));
}

export function yearlySpend(entries: SpendEntry[], year: number): SpendTotals {
  let total = 0;
  let deviceCount = 0;
  let warrantyCount = 0;
  for (const e of entriesForYear(entries, year)) {
    total += e.amount;
    if (e.kind === 'device') deviceCount += 1;
    else warrantyCount += 1;
  }
  return { total, deviceCount, warrantyCount };
}

// Same attribution as `yearlySpend` — used for the year-scoped category list.
export function entriesForYear(entries: SpendEntry[], year: number): SpendEntry[] {
  return entries.filter((e) => isValidDate(e.date) && e.date.getFullYear() === year);
}

export function allTimeSpend(entries: SpendEntry[]): SpendTotals {
  let total = 0;
  let deviceCount = 0;
  let warrantyCount = 0;
  for (const e of entries) {
    total += e.amount;
    if (e.kind === 'device') deviceCount += 1;
    else warrantyCount += 1;
  }
  return { total, deviceCount, warrantyCount };
}

// Devices still covered by *some* warranty that hasn't ended yet. Value is the
// device purchase price — the warranties are a service, not an asset.
export function activeAssetValue(devices: DeviceListItem[]) {
  const now = new Date();
  const active = devices.filter(
    (d) =>
      d.status === 'ACTIVE' &&
      d.effectiveWarrantyEnd != null &&
      new Date(d.effectiveWarrantyEnd) > now,
  );
  return {
    total: active.reduce((sum, d) => sum + d.purchasePrice, 0),
    count: active.length,
  };
}

export function topExpensiveRollup(devices: DeviceListItem[], limit = 5): DeviceListItem[] {
  return [...devices]
    .sort((a, b) => b.purchasePrice - a.purchasePrice)
    .slice(0, limit);
}

export function yearsWithData(devices: DeviceListItem[]): number[] {
  const set = new Set<number>();
  for (const d of devices) set.add(new Date(d.purchaseDate).getFullYear());
  set.add(new Date().getFullYear());
  return Array.from(set).sort((a, b) => b - a);
}
