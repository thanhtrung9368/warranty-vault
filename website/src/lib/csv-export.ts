// Pure "dataset → CSV table" builders for the spreadsheet export.
//
// Everything here is a pure function over the plain JSON rows the web already
// fetches (`api.devices.list()`, `api.subscriptions.list()`,
// `api.wishlist.list()`) — no fetch, no DB, no server-only import, so it is
// unit-tested in `src/lib/__tests__/csv-export.test.ts` and can also be
// imported by a client component.
//
// Column labels are Vietnamese and match the adjacent UI wording (`types.ts`,
// `subscription-types.ts`, `wishlist-types.ts`) so the spreadsheet reads like
// the app. Money columns go through `csvNumber()` — bare numbers, no `₫` and
// no thousands separators — so Excel/Sheets treat them as numeric; the
// Vietnamese currency formatting stays in the UI (`formatVND`).
//
// Types are imported with `import type` on purpose: `@/lib/api/*` reaches the
// server-only auth cookie, and a value import would drag it into a client
// bundle.

import { format } from 'date-fns';
import type { DeviceListItem } from '@/lib/api/devices';
import type { Subscription } from '@/lib/api/subscriptions';
import type { WishlistItem } from '@/lib/api/wishlist';
import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
  monthlyEquivalent,
  type BillingCycle,
  type SubscriptionStatus,
} from '@/lib/subscription-types';
import { STATUS_LABELS, categoryLabel, type Status } from '@/lib/types';
import {
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_STATUS_LABELS,
  type WishlistPriority,
  type WishlistStatus,
} from '@/lib/wishlist-types';
import {
  csvBool,
  csvDate,
  csvNumber,
  csvText,
  tableToCsv,
  type CsvDelimiter,
  type CsvRow,
  type CsvTable,
} from '@/lib/csv';

export type CsvDataset = 'devices' | 'subscriptions' | 'wishlist';

export const CSV_DATASETS: readonly CsvDataset[] = ['devices', 'subscriptions', 'wishlist'];

export function isCsvDataset(value: unknown): value is CsvDataset {
  return (
    typeof value === 'string' && (CSV_DATASETS as readonly string[]).includes(value)
  );
}

// UI metadata: the file-name slug is ASCII so the download works on every OS
// (Vietnamese diacritics in a filename are legal but get mangled by some
// unzip/mail round-trips).
export const CSV_DATASET_META: Record<
  CsvDataset,
  { label: string; fileSlug: string; description: string }
> = {
  devices: {
    label: 'Thiết bị',
    fileSlug: 'thiet-bi',
    description:
      'Tên, danh mục, hãng, model, số seri, ngày mua, giá mua, nơi mua, trạng thái, ngày hết bảo hành (muộn nhất) và ghi chú.',
  },
  subscriptions: {
    label: 'Gói đăng ký',
    fileSlug: 'goi-dang-ky',
    description:
      'Tên gói, chu kỳ, giá, tiền tệ, chi phí tương đương mỗi tháng, ngày bắt đầu, ngày gia hạn, trạng thái và ghi chú.',
  },
  wishlist: {
    label: 'Wishlist',
    fileSlug: 'wishlist',
    description:
      'Tên món, danh mục, hãng, ưu tiên, trạng thái, giá ban đầu, giá hiện tại, ngày mục tiêu và ghi chú.',
  },
};

// Look up a Vietnamese label for a wire code, falling back to the raw code so
// a newly added enum value shows up instead of disappearing.
function labelOf<T extends string>(
  labels: Record<T, string>,
  code: string | null | undefined,
): string {
  if (!code) return '';
  return labels[code as T] ?? code;
}

function categoryOf(code: string | null | undefined): string {
  return code ? categoryLabel(code) : '';
}

// ---- Devices ----------------------------------------------------------------

export const DEVICE_CSV_HEADER: CsvRow = [
  'Tên thiết bị',
  'Danh mục',
  'Hãng',
  'Model',
  'Số seri',
  'Ngày mua',
  'Giá mua',
  'Nơi mua',
  'Trạng thái',
  'Hết bảo hành',
  'Ghi chú',
];

export function deviceCsvRows(devices: readonly DeviceListItem[]): CsvRow[] {
  return devices.map((d) => [
    csvText(d.name),
    categoryOf(d.category),
    csvText(d.brand),
    csvText(d.model),
    csvText(d.serialNumber),
    csvDate(d.purchaseDate),
    csvNumber(d.purchasePrice),
    csvText(d.purchasePlace),
    labelOf(STATUS_LABELS, d.status as Status),
    csvDate(d.effectiveWarrantyEnd),
    csvText(d.notes),
  ]);
}

export function devicesCsvTable(devices: readonly DeviceListItem[]): CsvTable {
  return { header: DEVICE_CSV_HEADER, rows: deviceCsvRows(devices) };
}

// ---- Subscriptions ----------------------------------------------------------

export const SUBSCRIPTION_CSV_HEADER: CsvRow = [
  'Tên gói',
  'Danh mục',
  'Hãng',
  'Gói',
  'Chu kỳ',
  'Giá',
  'Tiền tệ',
  'Tương đương mỗi tháng',
  'Bắt đầu',
  'Gia hạn tiếp theo',
  'Tự động gia hạn',
  'Trạng thái',
  'Email tài khoản',
  'Thanh toán',
  'Ghi chú',
];

export function subscriptionCsvRows(subscriptions: readonly Subscription[]): CsvRow[] {
  return subscriptions.map((s) => [
    csvText(s.name),
    categoryOf(s.category),
    csvText(s.brand),
    csvText(s.plan),
    labelOf(BILLING_CYCLE_LABELS, s.billingCycle as BillingCycle),
    csvNumber(s.price),
    csvText(s.currency),
    // Mirrors the dashboard's "chi phí mỗi tháng" maths (Go parity helper), so
    // the spreadsheet total agrees with the app for the same rows.
    csvNumber(monthlyEquivalent(s.price, s.billingCycle, s.intervalDays)),
    csvDate(s.startedAt),
    csvDate(s.renewalDate),
    csvBool(s.autoRenew),
    labelOf(SUBSCRIPTION_STATUS_LABELS, s.status as SubscriptionStatus),
    csvText(s.accountEmail),
    csvText(s.paymentMethod),
    csvText(s.notes),
  ]);
}

export function subscriptionsCsvTable(
  subscriptions: readonly Subscription[],
): CsvTable {
  return { header: SUBSCRIPTION_CSV_HEADER, rows: subscriptionCsvRows(subscriptions) };
}

// ---- Wishlist ---------------------------------------------------------------

export const WISHLIST_CSV_HEADER: CsvRow = [
  'Tên món',
  'Danh mục',
  'Hãng',
  'Ưu tiên',
  'Trạng thái',
  'Giá ban đầu',
  'Giá hiện tại',
  'Ngày mục tiêu',
  'Link mua',
  'Ghi chú',
];

export function wishlistCsvRows(items: readonly WishlistItem[]): CsvRow[] {
  return items.map((i) => [
    csvText(i.name),
    categoryOf(i.category),
    csvText(i.brand),
    labelOf(WISHLIST_PRIORITY_LABELS, i.priority as WishlistPriority),
    labelOf(WISHLIST_STATUS_LABELS, i.status as WishlistStatus),
    csvNumber(i.initialPrice),
    csvNumber(i.currentPrice),
    csvDate(i.targetDate),
    csvText(i.buyUrl),
    csvText(i.notes),
  ]);
}

export function wishlistCsvTable(items: readonly WishlistItem[]): CsvTable {
  return { header: WISHLIST_CSV_HEADER, rows: wishlistCsvRows(items) };
}

// ---- Shared helpers ---------------------------------------------------------

/** Serialise one built table. BOM stays on (see `lib/csv.ts`). */
export function csvTableToString(
  table: CsvTable,
  delimiter: CsvDelimiter,
): string {
  return tableToCsv(table, { delimiter, bom: true });
}

/**
 * Download file name, e.g. `warrantyvault-thiet-bi-20250115-1030.csv`.
 * Mirrors the JSON backup naming (`backup-tools.tsx`). `now` is injectable so
 * the name is deterministic under test.
 */
export function csvFileName(dataset: CsvDataset, now: Date = new Date()): string {
  return `warrantyvault-${CSV_DATASET_META[dataset].fileSlug}-${format(now, 'yyyyMMdd-HHmm')}.csv`;
}
