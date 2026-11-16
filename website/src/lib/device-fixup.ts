// The fix-up step — which saved rows are still missing the four fields the
// product actually needs, plus the counts the dashboard renders.
//
// The starter kit gets an empty vault to its first save. This module covers the
// second half of the same job: a row saved with only a name is a row Warrly
// cannot remind anyone about. The point of the fix-up step is to SAY that
// plainly, with real numbers, and to link straight to the form that fixes it.
//
// Two rules are load-bearing:
//
//   1. **Surface only real gaps.** A field is missing only when the data says
//      so: `null` effective warranty end = no warranty row; a price of 0 =
//      the price was never recorded; an invalid/absent purchase day = the day
//      was never recorded; `attachmentCount === 0` = nothing filed. An
//      UNREADABLE value (a field the payload did not carry at all) is treated as
//      "unknown", not as missing — nagging about a gap that may not exist is the
//      failure mode this module exists to avoid.
//
//   2. **Never fabricate a date.** Nothing here derives, estimates or back-fills
//      a purchase date or a warranty end. The fix-up step only reports and
//      links; the user (or the real receipt) supplies the value. Same for the
//      price — 0 is reported, never replaced by a category average.
//
// Rows that are history (SOLD) and rows that exist only as a demo (sample data,
// see `lib/starter-kit.ts`) are excluded: there is no reminder to fix for a
// sold device, and nagging someone about the receipt of a row Warrly itself
// created would be noise.

import type { DeviceListItem } from '@/lib/api/devices';
import { tryParseDay } from '@/lib/api-day';
import { isSampleDevice } from '@/lib/starter-kit';

/** The four gaps the fix-up step reports, in the order the card lists them. */
export const FIXUP_GAPS = ['purchaseDate', 'warrantyEnd', 'price', 'receipt'] as const;

export type FixupGap = (typeof FIXUP_GAPS)[number];

/**
 * Vietnamese catalog keys for the field names. Lower-case on purpose: they are
 * rendered inside a sentence ("Thiếu ngày mua"), never as a standalone heading.
 * Registered in `lib/i18n/messages/dashboard.ts`.
 */
export const FIXUP_GAP_LABEL_KEYS: Record<FixupGap, string> = {
  purchaseDate: 'ngày mua',
  warrantyEnd: 'hạn bảo hành',
  price: 'giá mua',
  receipt: 'hoá đơn',
};

export type FixupRow = {
  device: DeviceListItem;
  /** Non-empty by construction. */
  gaps: FixupGap[];
};

export type DeviceFixupSummary = {
  /** One entry per row that still needs something, in the API's sort order. */
  rows: FixupRow[];
  /** Per-gap row counts, so the card can show "thiếu giá 2 · thiếu hoá đơn 3". */
  counts: Record<FixupGap, number>;
};

/** The gaps on one row, without the sold/sample exclusion (that is the caller's job). */
export function deviceFixupGaps(device: DeviceListItem): FixupGap[] {
  const gaps: FixupGap[] = [];

  // `purchaseDate` is NOT NULL in the database and required by the write path,
  // so a gap here is a legacy/imported row whose day never landed. A value that
  // is not a real calendar day (empty string, `0001-01-01`, a bare instant) is
  // "we do not know the day" — not a day to guess at.
  if (tryParseDay(device.purchaseDate ?? null) === null) {
    gaps.push('purchaseDate');
  }

  // Strictly `null`: the list endpoint sends null exactly when the device has no
  // warranty row. An absent field (older payload / failed read) is unknown, and
  // is not reported as a gap.
  if (device.effectiveWarrantyEnd === null) {
    gaps.push('warrantyEnd');
  }

  // 0 is the server's "no price was supplied" default, so it is the one value
  // that means "missing". `purchasePriceVnd === null` is the other honest case:
  // a foreign-currency row with no locked rate, whose price cannot be totalled.
  const priceRecorded =
    typeof device.purchasePrice === 'number' && device.purchasePrice > 0;
  const priceTotals = device.purchasePriceVnd !== null;
  if (!priceRecorded || !priceTotals) {
    gaps.push('price');
  }

  // Only a real zero is a gap; a payload without `attachmentCount` is unknown.
  if (typeof device.attachmentCount === 'number' && device.attachmentCount === 0) {
    gaps.push('receipt');
  }

  return gaps;
}

/**
 * The dashboard's fix-up view: every row that still needs something, plus the
 * per-gap counts.
 *
 * Sold rows are skipped: their warranty picture is over, and the dashboard's own
 * stats already exclude them. Sample rows are skipped for the reason in the
 * module header — the demo must not manufacture errands.
 */
export function summarizeDeviceFixups(
  devices: readonly DeviceListItem[],
): DeviceFixupSummary {
  const rows: FixupRow[] = [];
  const counts: Record<FixupGap, number> = {
    purchaseDate: 0,
    warrantyEnd: 0,
    price: 0,
    receipt: 0,
  };

  for (const device of devices) {
    if (device.status === 'SOLD') continue;
    if (isSampleDevice(device)) continue;
    const gaps = deviceFixupGaps(device);
    if (gaps.length === 0) continue;
    for (const gap of gaps) counts[gap] += 1;
    rows.push({ device, gaps });
  }

  return { rows, counts };
}

/**
 * Where "fill this in" goes for a row.
 *
 * Date, warranty and price all live in the device form (the warranty step is
 * inside it), so any non-receipt gap links to the edit wizard. A row that is
 * only missing its receipt goes straight to the attachment section of the
 * detail page, where the uploader is.
 */
export function fixupHref(deviceId: string, gaps: readonly FixupGap[]): string {
  return gaps.some((gap) => gap !== 'receipt')
    ? `/devices/${deviceId}/edit`
    : `/devices/${deviceId}#attachments`;
}
