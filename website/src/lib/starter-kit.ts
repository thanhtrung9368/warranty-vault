// The first-run starter kit — sample data and the marker that identifies it.
//
// An empty vault is the most expensive screen in the product: the dashboard has
// nothing to explain, every reminder is silent, and the user has to trust a
// promise before seeing anything. The starter kit gives that account a short
// way in (checklist + import + a set of sample rows to look at), and this module
// owns the two decisions that need to stay outside the components:
//
//   1. what the sample rows ARE (a fixed seed, so they always demonstrate the
//      same three states: expiring soon, comfortably covered, and a large
//      appliance), and
//   2. how those rows are recognised later (a stable marker in `notes`), which
//      is what lets the dashboard offer "remove sample data" and lets the
//      fix-up panel skip rows that exist only to be looked at.
//
// The sample rows go through the SAME bulk endpoint the paste/bulk screens use
// (`POST /api/v1/devices/bulk` → `api.devices.bulkCreate`). There is no sample
// endpoint, no schema change and no server-side flag: a sample device is an
// ordinary device whose note carries a marker.

import type { DeviceInput } from '@/lib/api/devices';
import type { Translator } from '@/lib/i18n/catalog';
import { dayKey, parseDay } from '@/lib/api-day';

/**
 * Stable, language-independent marker written at the start of a sample row's
 * `notes`. Detection must not depend on the translated sentence next to it:
 * the note is written in the language the account used at creation time, and
 * an English account must still be able to remove Vietnamese-labelled samples
 * (and vice versa).
 */
export const SAMPLE_DEVICE_MARKER = 'warrly-sample';

/** The Vietnamese catalog key of the human-readable half of the sample note. */
export const SAMPLE_DEVICE_NOTE_KEY =
  'Thiết bị mẫu của Warrly — xoá bất cứ lúc nào.';

type SampleDeviceSeed = {
  /** Vietnamese catalog key; translated when the rows are written. */
  nameKey: string;
  /** Category code from `CATEGORY_LABELS` / migration 0004. */
  category: string;
  /** Days before "today" the device was bought; keeps the demo dates current. */
  purchasedDaysAgo: number;
  /** VND. */
  purchasePrice: number;
  /** Drives the server-computed warranty end date (`addMonths(purchaseDate)`). */
  warrantyMonths: number;
};

/**
 * Three rows chosen to show the product's three interesting states:
 *   * the phone is bought ~350 days ago with a 12-month warranty → expiring in
 *     about two weeks, so the dashboard has a real "sắp hết" row;
 *   * the laptop is ~300 days old with a 12-month warranty → still covered;
 *   * the washing machine has a 24-month warranty → comfortably covered.
 *
 * Prices are realistic VND figures, not placeholders like 1.000đ — a demo that
 * cannot produce a plausible total is not a demo of the spending screens.
 */
const SAMPLE_DEVICE_SEEDS: readonly SampleDeviceSeed[] = [
  {
    nameKey: 'iPhone 15 (mẫu)',
    category: 'PHONE',
    purchasedDaysAgo: 350,
    purchasePrice: 22_990_000,
    warrantyMonths: 12,
  },
  {
    nameKey: 'MacBook Air M3 (mẫu)',
    category: 'LAPTOP',
    purchasedDaysAgo: 300,
    purchasePrice: 27_990_000,
    warrantyMonths: 12,
  },
  {
    nameKey: 'Máy giặt cửa trước (mẫu)',
    category: 'WASHING',
    purchasedDaysAgo: 90,
    purchasePrice: 12_490_000,
    warrantyMonths: 24,
  },
];

/** How many rows the sample-data button creates. */
export const SAMPLE_DEVICE_COUNT = SAMPLE_DEVICE_SEEDS.length;

/** `today` minus `days`, as a wire `YYYY-MM-DD`, through the canonical day helpers. */
export function samplePurchaseDate(today: string, days: number): string {
  const date = parseDay(today);
  date.setDate(date.getDate() - days);
  return dayKey(date);
}

/**
 * Build the `DeviceInput` rows the bulk endpoint receives.
 *
 * The caller passes its translator so the row names and the human half of the
 * note match the account's language at creation time. The marker is always the
 * untranslated prefix, so `isSampleDevice` keeps working in either language.
 */
export function sampleDeviceInputs(today: string, t: Translator): DeviceInput[] {
  return SAMPLE_DEVICE_SEEDS.map((seed) => ({
    name: t(seed.nameKey),
    category: seed.category,
    purchaseDate: samplePurchaseDate(today, seed.purchasedDaysAgo),
    purchasePrice: seed.purchasePrice,
    warrantyMonths: seed.warrantyMonths,
    notes: `${SAMPLE_DEVICE_MARKER} · ${t(SAMPLE_DEVICE_NOTE_KEY)}`,
  }));
}

/**
 * True for a row created by the sample-data button.
 *
 * Deliberately tolerant (`includes`) rather than an exact match: the app writes
 * `"<marker> · <sentence>"`, but a user who edits the sentence in the notes
 * field should still be able to remove the row with one click. The marker
 * itself is not translated, so this works for both interface languages.
 */
export function isSampleDevice(device: { notes?: string | null }): boolean {
  const notes = device.notes ?? '';
  return notes.toLowerCase().includes(SAMPLE_DEVICE_MARKER);
}
