// Pure "dataset → CSV table" builders for the spreadsheet export.
//
// Everything here is a pure function over the plain JSON rows the web already
// fetches (`api.devices.list()`, `api.subscriptions.list()`,
// `api.wishlist.list()`) — no fetch, no DB, no server-only import, so it is
// unit-tested in `src/lib/__tests__/csv-export.test.ts` and can also be
// imported by a client component.
//
// Column labels are the ORIGINAL Vietnamese sentences and go through the
// dictionary, so the spreadsheet reads like the screen the user is looking at.
// Money columns go through `csvNumber()` — bare numbers, no `₫` and no
// thousands separators — so Excel/Sheets treat them as numeric; the currency
// formatting stays in the UI (`formatVND`). Dates stay `dd/MM/yyyy` in BOTH
// languages: that is the format `csvDate` writes, what the device form and
// `services.parseDate` accept, and what the paste importer reads back — a
// language-dependent date column would make the app's own export change
// meaning (03/04 is 3 April to a Vietnamese reader, 4 March to an American
// one), which is worse than one stable machine-readable format.
//
// Types are imported with `import type` on purpose: `@/lib/api/*` reaches the
// server-only auth cookie, and a value import would drag it into a client
// bundle.

import { format } from 'date-fns';
import type { DeviceListItem } from '@/lib/api/devices';
import type { Subscription } from '@/lib/api/subscriptions';
import type { WishlistItem } from '@/lib/api/wishlist';
import { translate } from '@/lib/i18n/catalog';
import type { Status } from '@/lib/types';
import {
  billingCycleLabel,
  categoryLabel,
  statusLabel,
  subscriptionStatusLabel,
  wishlistPriorityLabel,
  wishlistStatusLabel,
} from '@/lib/i18n/labels';
import type { Locale } from '@/lib/i18n/locale';
import { monthlyEquivalent } from '@/lib/subscription-types';
import {
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

function categoryOf(code: string | null | undefined, locale: Locale): string {
  return code ? categoryLabel(code, locale) : '';
}

/** Header row in the requested language, keyed by the Vietnamese original. */
function headerRow(locale: Locale, columns: CsvRow): CsvRow {
  return columns.map((key) => translate(locale, String(key)));
}

/** `Có`/`Không` for boolean columns, in the requested language. */
function boolOf(value: boolean | null | undefined, locale: Locale): string {
  if (value == null) return '';
  return translate(locale, value ? 'Có' : 'Không');
}

// ---- Devices ----------------------------------------------------------------

/**
 * Device columns, in the Vietnamese source wording. Exported unchanged because
 * it is the canonical column list; render it with {@link deviceCsvTable} (or
 * `headerRow`) to get the language the user is reading.
 */
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

export function deviceCsvRows(
  devices: readonly DeviceListItem[],
  locale: Locale,
): CsvRow[] {
  return devices.map((d) => [
    csvText(d.name),
    categoryOf(d.category, locale),
    csvText(d.brand),
    csvText(d.model),
    csvText(d.serialNumber),
    csvDate(d.purchaseDate),
    csvNumber(d.purchasePrice),
    csvText(d.purchasePlace),
    d.status ? statusLabel(d.status as Status, locale) : '',
    csvDate(d.effectiveWarrantyEnd),
    csvText(d.notes),
  ]);
}

export function devicesCsvTable(
  devices: readonly DeviceListItem[],
  locale: Locale,
): CsvTable {
  return { header: headerRow(locale, DEVICE_CSV_HEADER), rows: deviceCsvRows(devices, locale) };
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

export function subscriptionCsvRows(
  subscriptions: readonly Subscription[],
  locale: Locale,
): CsvRow[] {
  return subscriptions.map((s) => [
    csvText(s.name),
    categoryOf(s.category, locale),
    csvText(s.brand),
    csvText(s.plan),
    s.billingCycle ? billingCycleLabel(s.billingCycle, locale) : '',
    csvNumber(s.price),
    csvText(s.currency),
    // Mirrors the dashboard's "chi phí mỗi tháng" maths (Go parity helper), so
    // the spreadsheet total agrees with the app for the same rows.
    csvNumber(monthlyEquivalent(s.price, s.billingCycle, s.intervalDays)),
    csvDate(s.startedAt),
    csvDate(s.renewalDate),
    boolOf(s.autoRenew, locale),
    s.status ? subscriptionStatusLabel(s.status, locale) : '',
    csvText(s.accountEmail),
    csvText(s.paymentMethod),
    csvText(s.notes),
  ]);
}

export function subscriptionsCsvTable(
  subscriptions: readonly Subscription[],
  locale: Locale,
): CsvTable {
  return {
    header: headerRow(locale, SUBSCRIPTION_CSV_HEADER),
    rows: subscriptionCsvRows(subscriptions, locale),
  };
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

export function wishlistCsvRows(
  items: readonly WishlistItem[],
  locale: Locale,
): CsvRow[] {
  return items.map((i) => [
    csvText(i.name),
    categoryOf(i.category, locale),
    csvText(i.brand),
    i.priority ? wishlistPriorityLabel(i.priority, locale) : '',
    i.status ? wishlistStatusLabel(i.status, locale) : '',
    csvNumber(i.initialPrice),
    csvNumber(i.currentPrice),
    csvDate(i.targetDate),
    csvText(i.buyUrl),
    csvText(i.notes),
  ]);
}

export function wishlistCsvTable(
  items: readonly WishlistItem[],
  locale: Locale,
): CsvTable {
  return { header: headerRow(locale, WISHLIST_CSV_HEADER), rows: wishlistCsvRows(items, locale) };
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
