// Pure money rollups for the /stats page.
//
// The page pulls raw rows from Go (devices, each device's warranty packages,
// plus the `/v1/stats` subscription aggregate) and crunches them here so the
// number-crunching is unit-testable without a backend — same pattern as
// `warranty.ts` / `subscription-types.ts`.
//
// Attribution rules:
//   - a device's `purchasePriceVnd` counts in the month/year of `purchaseDate`;
//   - a warranty package's `cost` counts in the month/year of its `startDate`
//     (that's when the money was spent) and rolls up into the category of the
//     device it protects.
//
// ── Currency ──────────────────────────────────────────────────────────────
//
// Device money is stored in the device's own currency. The server computes
// `purchasePriceVnd` / `soldPriceVnd` on every read and those are the ONLY
// values summed here — the web must never multiply by `fxRate` itself (the
// server owns the historical lock and the rounding).
//
// `Warranty.cost` is also in the device currency, but the frozen contract has
// no `costVnd`. For a VND device the raw cost is already đồng and is included;
// for a foreign-currency device it is EXCLUDED from the VND totals and
// `countUnconvertedWarrantyCosts` reports it, so the page can say the number is
// incomplete instead of quietly converting it client-side.
//
// ── Language ──────────────────────────────────────────────────────────────
//
// Every function that renders a value the reader sees — a month label, a
// category name, a "12.500 ₫/ngày" figure, a "15/03/2026" day — takes a
// `locale: Locale`. It is required, never defaulted, for the reason in
// `format.ts`: a default would let a missed call site render Vietnamese inside
// an English page and report nothing (docs/I18N_PLAN.md §4.3).

import { startOfMonth, subMonths, format } from 'date-fns';
import { enUS, vi } from 'date-fns/locale';
import type { DeviceListItem, Warranty } from '@/lib/api/devices';
import { daysUntil, toDayDate } from '@/lib/api-day';
import { translate } from '@/lib/i18n/catalog';
import { categoryLabel } from '@/lib/i18n/labels';
import type { Locale } from '@/lib/i18n/locale';
import { formatVND } from '@/lib/format';
import { needsFxRate } from '@/lib/currency';

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
      // Server-computed VND, never the raw device-currency figure. A `null`
      // value means the server could not know it (a foreign row with no stored
      // rate): it contributes 0 and `countUnknownPurchaseVnd` reports it, so the
      // page never quietly treats the raw number as đồng.
      amount: d.purchasePriceVnd ?? 0,
      // `purchaseDate` is a calendar day. `new Date(day)` is UTC midnight, so a
      // purchase on the 1st of a month landed in the previous month (and year)
      // for every reader west of UTC; `toDayDate` anchors a day at local
      // midnight and still accepts the pre-contract Z-less shape.
      date: toDayDate(d.purchaseDate),
      category: d.category,
      kind: 'device',
    });
    for (const w of warrantiesByDevice.get(d.id) ?? []) {
      if (w.cost == null || w.cost <= 0) continue;
      // No `costVnd` in the frozen contract: a foreign-currency package cannot
      // be added to a VND total without a conversion the client is forbidden to
      // perform. `countUnconvertedWarrantyCosts` surfaces the gap instead.
      if (needsFxRate(d.currency)) continue;
      entries.push({
        amount: w.cost,
        date: toDayDate(w.startDate),
        category: d.category,
        kind: 'warranty',
      });
    }
  }
  return entries;
}

/**
 * Number of paid warranty packages that are denominated in a foreign currency
 * and therefore cannot be included in the VND totals yet (the API returns no
 * `Warranty.costVnd`). The stats page renders a warning when this is > 0.
 */
export function countUnconvertedWarrantyCosts(
  devices: readonly DeviceListItem[],
  warrantiesByDevice: Map<string, Warranty[]>,
): number {
  let count = 0;
  for (const d of devices) {
    if (!needsFxRate(d.currency)) continue;
    for (const w of warrantiesByDevice.get(d.id) ?? []) {
      if (w.cost != null && w.cost > 0) count += 1;
    }
  }
  return count;
}

/**
 * Devices whose server-computed `purchasePriceVnd` is `null` — a foreign row
 * with no stored rate, reachable only through hand-edited data. Their purchase
 * price is unknown, not zero; the stats page says the total is incomplete
 * instead of adding the raw figure at par.
 */
export function countUnknownPurchaseVnd(devices: readonly DeviceListItem[]): number {
  return devices.filter((d) => d.purchasePriceVnd == null).length;
}

export function monthlySpendBuckets(entries: SpendEntry[], months = 12, locale: Locale) {
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
  const dateLocale = locale === 'vi' ? vi : enUS;
  return Array.from(buckets.entries()).map(([k, total]) => {
    const [y, m] = k.split('-').map(Number);
    const dateObj = new Date(y, m - 1, 1);
    return {
      month: format(dateObj, 'MM/yy', { locale: dateLocale }),
      total,
    };
  });
}

// Device count stays per-category (the pie tooltip reads "N món"); `total`
// includes the warranty packages bought for devices in that category.
export function spendByCategoryRollup(
  devices: DeviceListItem[],
  entries: SpendEntry[],
  locale: Locale,
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
    // `catalog.categories[].name` from the database is left alone; this is the
    // static 20-code mirror in `lib/types.ts`, which the dictionary does cover.
    label: categoryLabel(category, locale),
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
// device's server-computed VND purchase price — warranties are a service, not
// an asset.
export function activeAssetValue(devices: DeviceListItem[]) {
  const now = new Date();
  const active = devices.filter(
    (d) =>
      d.status === 'ACTIVE' &&
      d.effectiveWarrantyEnd != null &&
      // `effectiveWarrantyEnd` is a server-derived instant at UTC midnight of
      // the last covered DAY, so read it as a day (`daysUntil` does) instead of
      // comparing the UTC instant to `now` — the latter retires a device one day
      // early in any negative-offset zone.
      daysUntil(d.effectiveWarrantyEnd, now) >= 0,
  );
  return {
    total: active.reduce((sum, d) => sum + (d.purchasePriceVnd ?? 0), 0),
    count: active.length,
  };
}

// Ranked by the server's VND value, not the raw numeric price: a $999 phone
// (25,000,000 ₫) is more expensive than a 20,000,000 ₫ one even though 999 <
// 20,000,000. A null (unknown) VND value sorts as 0 rather than being compared
// as if it were a price.
export function topExpensiveRollup(devices: DeviceListItem[], limit = 5): DeviceListItem[] {
  return [...devices]
    .sort((a, b) => (b.purchasePriceVnd ?? 0) - (a.purchasePriceVnd ?? 0))
    .slice(0, limit);
}

export function yearsWithData(devices: DeviceListItem[]): number[] {
  const set = new Set<number>();
  // Local midnight of the purchase DAY; `new Date('2026-01-01')` is UTC midnight
  // and would report the previous year in any negative-offset timezone.
  for (const d of devices) set.add(toDayDate(d.purchaseDate).getFullYear());
  set.add(new Date().getFullYear());
  return Array.from(set).sort((a, b) => b - a);
}

// ---- Cost of ownership per day (đ/ngày, FEATURE_IDEAS #7) --------------------
//
// The one number every cumulative rollup above cannot answer: "món này có đáng
// tiền không". `(purchasePriceVnd + Σ converted warranty cost − soldPriceVnd) ÷
// days owned`.
//
// Currency rule: only the server's `…Vnd` device values are used. A foreign
// warranty package has no `costVnd` in the frozen contract, so it is left out
// and `hasUnconvertedWarrantyCost` tells the card to present the figure as
// incomplete — it is never multiplied by `fxRate` in this file.
//
// Decisions this file owns (all of them unit-tested, none of them invented at
// the render site):
//
// 1. DAYS ARE CALENDAR DAYS, NOT 24h WINDOWS. `purchaseDate` is a Z-less
//    timestamp (`"2026-03-15T00:00:00"`), so the day is sliced out of the
//    string — the same convention as `csvDate` / `device-resale` — and the
//    difference is computed on UTC midnight of those two days. A device bought
//    at 23:30 and read at 00:30 the next day is "1 ngày", and the figure does
//    not shift with DST or with the machine's timezone.
//
// 2. DIVISION BY ZERO: A DEVICE BOUGHT TODAY COUNTS AS 1 DAY, NEVER 0.
//    `days = max(1, today − purchaseDate)`. A same-day device therefore reads
//    its full price per day and decays from there — the honest answer for "what
//    has this cost me per day so far", and never Infinity/NaN.
//
// 3. NO USABLE `purchaseDate` ⇒ `null` (`costPerDay` returns nothing). The
//    server requires the field, so this is bad legacy data; the UI must say
//    "chưa tính được" instead of printing a number derived from a guess.
//
// 4. UNRECORDED WARRANTY COST (`cost == null`) IS UNKNOWN, NOT ZERO. It adds
//    nothing to the total but sets `hasUnrecordedWarrantyCost`, so the figure is
//    presented as a lower bound. `cost: 0` is a *recorded* free package and does
//    not set the flag. A negative or non-finite cost is treated as unrecorded
//    (it must never make a device look cheaper than it was).
//
// 5. A SOLD DEVICE STOPS THE CLOCK AT `soldAt` AND SUBTRACTS THE PROCEEDS. A
//    `soldAt` earlier than `purchaseDate` is bad data that would otherwise give
//    a negative day count and therefore a negative figure: the day count is
//    clamped to 1 and `soldBeforePurchase` is set so the UI can say the data is
//    suspect. A recorded sale price with no usable `soldAt` still has its money
//    subtracted (the money is real) but is flagged `hasUndatedSale`, because the
//    end of ownership is unknown and the period defaults to "until today".
//
// 6. THE FIGURE IS NEVER NEGATIVE AND NEVER INFINITE. When a resale recovered
//    more than everything spent, `net` is negative, `fullyRecovered` is set, and
//    `perDay` is 0 — "chi phí" cannot be a negative cost. Rounding is to whole
//    đồng (VND has no subunit in practice), so ranking and display agree.
//
// 7. `0 ₫` SPENT MEANS "CHƯA GHI GIÁ", NOT "FREE". `hasNoRecordedCost` marks it
//    and the ranking excludes those rows (a 0 ₫/ngày winner would be noise).

/** Minimal structural input — the detail page's `DeviceDetail` also fits. */
export type CostPerDayDevice = Pick<
  DeviceListItem,
  'purchaseDate' | 'currency' | 'purchasePriceVnd' | 'soldAt' | 'soldPriceVnd'
>;

export type DeviceCostPerDay = {
  /** đồng per day: whole đồng, ≥ 0, always finite. */
  perDay: number;
  /** Same number, ready to render: "12.500 ₫/ngày". */
  perDayLabel: string;
  /** `purchasePart + warrantyPart` — money actually recorded as spent. */
  spent: number;
  /** `spent − soldPart`. Negative only when a resale recovered everything. */
  net: number;
  purchasePart: number;
  warrantyPart: number;
  soldPart: number;
  /** Days owned: always ≥ 1. */
  days: number;
  /** `YYYY-MM-DD` the device was bought. */
  fromDay: string;
  /** `YYYY-MM-DD` the clock stopped: `soldAt`, or today. */
  toDay: string;
  /** "15/03/2026" — for the "N ngày kể từ …" line. */
  fromDayLabel: string;
  toDayLabel: string;
  /** True when `toDay` is `soldAt` rather than today. */
  endedBySale: boolean;
  /** A resale covered everything spent: `perDay` is 0, not negative. */
  fullyRecovered: boolean;
  /** ≥1 package has no recorded cost ⇒ `spent` is a lower bound. */
  hasUnrecordedWarrantyCost: boolean;
  /** ≥1 package is in a foreign currency and has no server `costVnd` yet. */
  hasUnconvertedWarrantyCost: boolean;
  /** How many packages were left out for that reason. */
  unconvertedWarrantyCount: number;
  /** The server could not compute `purchasePriceVnd` (hand-edited row). */
  hasUnknownPurchaseValue: boolean;
  /** `soldAt` < `purchaseDate`: days clamped to 1, data is suspect. */
  soldBeforePurchase: boolean;
  /** A sale price is recorded but `soldAt` is missing/unusable. */
  hasUndatedSale: boolean;
  /** Nothing recorded at all (no purchase price, no warranty cost). */
  hasNoRecordedCost: boolean;
  warrantyCount: number;
  /** Packages with `cost > 0`. */
  pricedWarrantyCount: number;
};

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const MS_PER_DAY = 86_400_000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Calendar day (`YYYY-MM-DD`) of a wire timestamp, sliced rather than
 * round-tripped through UTC — see the file header, decision 1. Returns `null`
 * for empty/unparseable input so callers can refuse to invent a date.
 */
function dayKey(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = value.trim();
  if (raw === '') return null;
  const match = ISO_DAY.exec(raw);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
}

/** Local calendar day of "now" — read as the user sees it, not as UTC. */
function todayKey(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Whole days between two `YYYY-MM-DD` keys, timezone-free. */
function daysBetween(fromDay: string, toDay: string): number {
  const [fy, fm, fd] = fromDay.split('-').map(Number);
  const [ty, tm, td] = toDay.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / MS_PER_DAY);
}

function nonNegative(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * Render a `YYYY-MM-DD` key the way the rest of the app shows dates:
 * `15/03/2026` in Vietnamese, `03/15/2026` in English.
 *
 * Deliberately does NOT go through `new Date()`: a date-only string parses as
 * UTC midnight, which `formatDate` then renders as the *previous* day for a
 * reader west of UTC. The calendar day is sliced out of the string instead —
 * the same rule as `lib/device-resale.ts::saleDayLabel`, which this replaces
 * because that helper is Vietnamese-order only.
 */
function dayLabel(day: string, locale: Locale): string {
  const [year, month, date] = day.split('-');
  return locale === 'vi' ? `${date}/${month}/${year}` : `${month}/${date}/${year}`;
}

/**
 * Đồng-per-day for one device, or `null` when `purchaseDate` is missing or
 * unreadable (decision 3). Never throws, never returns NaN/Infinity/negative —
 * see the decisions in the file header above.
 *
 * `locale` is required and sits before the optional `now`, matching
 * `formatVND` / `formatDate` in `format.ts`. There is no Vietnamese default:
 * a default would let the device detail card (a file this change does not own)
 * keep rendering Vietnamese money into an English page and report nothing.
 */
export function costPerDay(
  device: CostPerDayDevice,
  warranties: readonly Warranty[],
  locale: Locale,
  now: Date = new Date(),
): DeviceCostPerDay | null {
  const fromDay = dayKey(device.purchaseDate);
  if (fromDay == null) return null;

  const purchasePart = nonNegative(device.purchasePriceVnd);
  const hasUnknownPurchaseValue = device.purchasePriceVnd == null;
  const foreignCurrency = needsFxRate(device.currency);

  let warrantyPart = 0;
  let pricedWarrantyCount = 0;
  let hasUnrecordedWarrantyCost = false;
  let unconvertedWarrantyCount = 0;
  for (const w of warranties) {
    if (w.cost == null || !Number.isFinite(w.cost) || w.cost < 0) {
      // "chưa ghi giá" (null) and bad data (negative / NaN) are both unknown.
      hasUnrecordedWarrantyCost = true;
      continue;
    }
    if (w.cost > 0) pricedWarrantyCount += 1;
    if (foreignCurrency) {
      // No server-side `costVnd` in the frozen contract. Excluding the package
      // is honest; multiplying by fxRate here would be a client-side conversion
      // and could disagree with the API's rounding.
      if (w.cost > 0) unconvertedWarrantyCount += 1;
      continue;
    }
    warrantyPart += w.cost;
  }

  const soldDay = dayKey(device.soldAt);
  const soldPriceVnd = device.soldPriceVnd;
  const hasSalePrice =
    soldPriceVnd != null && Number.isFinite(soldPriceVnd) && soldPriceVnd > 0;
  const soldPart = hasSalePrice ? (soldPriceVnd as number) : 0;
  // Money came back but we cannot tell when ownership ended.
  const hasUndatedSale = hasSalePrice && soldDay == null;

  const toDay = soldDay ?? todayKey(now);
  const rawDays = daysBetween(fromDay, toDay);
  // Decision 5: a sale dated before the purchase cannot yield a negative day
  // count (and therefore a negative figure) — clamp to one day and flag it.
  const soldBeforePurchase = rawDays < 0;
  const days = soldBeforePurchase ? 1 : Math.max(1, rawDays);

  const spent = purchasePart + warrantyPart;
  const net = spent - soldPart;
  const perDay = Math.round(Math.max(0, net) / days);

  return {
    perDay,
    perDayLabel: `${formatVND(perDay, locale)}${translate(locale, '/ngày')}`,
    spent,
    net,
    purchasePart,
    warrantyPart,
    soldPart,
    days,
    fromDay,
    toDay,
    // Same day the resale block shows, sliced out of the wire string rather
    // than round-tripped through `new Date()` — a date-only ISO value parses as
    // UTC midnight, which `formatDate` would render as the PREVIOUS day for
    // anyone west of UTC. Only the field ORDER follows the language.
    fromDayLabel: dayLabel(fromDay, locale),
    toDayLabel: dayLabel(toDay, locale),
    endedBySale: soldDay != null,
    fullyRecovered: net <= 0,
    hasUnrecordedWarrantyCost,
    hasUnconvertedWarrantyCost: unconvertedWarrantyCount > 0,
    unconvertedWarrantyCount,
    hasUnknownPurchaseValue,
    soldBeforePurchase,
    hasUndatedSale,
    // A foreign package with a recorded cost is NOT "nothing recorded" just
    // because its VND value could not be included. Neither is an unknown
    // purchase value.
    hasNoRecordedCost:
      spent <= 0 && unconvertedWarrantyCount === 0 && !hasUnknownPurchaseValue,
    warrantyCount: warranties.length,
    pricedWarrantyCount,
  };
}

export type CostPerDayRankRow = {
  device: DeviceListItem;
  cost: DeviceCostPerDay;
};

export type CostPerDayRanking = {
  /** Most expensive per day first — the inverse story of "đắt nhất". */
  priciest: CostPerDayRankRow[];
  /** Cheapest per day first. */
  cheapest: CostPerDayRankRow[];
  /** Devices the ranking had to leave out, with the reason split out. */
  skipped: {
    /** No usable `purchaseDate` (decision 3). */
    noPurchaseDate: number;
    /** `0 ₫` recorded — "chưa ghi giá", not a free device (decision 7). */
    noRecordedCost: number;
    /** The server could not compute `purchasePriceVnd` (no stored rate). */
    unknownPurchaseValue: number;
  };
};

/**
 * Both directions of the đ/ngày ranking in one pass. Deterministic: ties break
 * on name (vi collation) and then id, so the same data always renders the same
 * list. Devices with nothing recorded are counted, not ranked (decision 7).
 */
export function costPerDayRollup(
  devices: readonly DeviceListItem[],
  warrantiesByDevice: Map<string, Warranty[]>,
  opts: { now?: Date; limit?: number; locale: Locale },
): CostPerDayRanking {
  const limit = opts.limit ?? 5;
  const rows: CostPerDayRankRow[] = [];
  let noPurchaseDate = 0;
  let noRecordedCost = 0;
  let unknownPurchaseValue = 0;

  for (const d of devices) {
    const cost = costPerDay(d, warrantiesByDevice.get(d.id) ?? [], opts.locale, opts.now);
    if (cost == null) {
      noPurchaseDate += 1;
      continue;
    }
    // An unknown VND purchase price would otherwise rank as a 0 ₫/ngày
    // "winner" — the opposite of the truth. Leave it out and say why.
    if (cost.hasUnknownPurchaseValue) {
      unknownPurchaseValue += 1;
      continue;
    }
    if (cost.hasNoRecordedCost) {
      noRecordedCost += 1;
      continue;
    }
    rows.push({ device: d, cost });
  }

  const tieBreak = (a: CostPerDayRankRow, b: CostPerDayRankRow) =>
    a.device.name.localeCompare(b.device.name, 'vi') ||
    a.device.id.localeCompare(b.device.id);

  return {
    priciest: [...rows]
      .sort((a, b) => b.cost.perDay - a.cost.perDay || tieBreak(a, b))
      .slice(0, limit),
    cheapest: [...rows]
      .sort((a, b) => a.cost.perDay - b.cost.perDay || tieBreak(a, b))
      .slice(0, limit),
    skipped: { noPurchaseDate, noRecordedCost, unknownPurchaseValue },
  };
}
