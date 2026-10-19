// Bulk device add — the pure half of `POST /v1/devices/bulk`.
//
// The screen edits a handful of rows in the browser, but every decision about
// what goes on the wire and how the answer maps back to a row lives here, so
// vitest covers the mapping/reconciliation/cap rules without rendering a form.
//
// ── The frozen contract ─────────────────────────────────────────────────────
//
//   POST /api/v1/devices/bulk
//   body   { devices: DeviceInput[] }          at most 50 rows
//   200    { created: Device[], failed: [{ index, code, message, fieldErrors }] }
//   409    LIMIT_REACHED                       whole batch refused, nothing created
//
// ── Why `created` is reconciled positionally ───────────────────────────────
//
// The 200 response does not put an index on a created device: only failures
// carry one. `failed.index` is the position in the request array, so the
// inverse is also positional — walk the submitted rows in order, put each
// failure on its own index, and consume `created` in order for every index the
// server did not report as failed. The server appends created devices in request
// order (the natural loop over the input), which is the only mapping the
// response shape allows.
//
// If the response is internally inconsistent — a row gets neither a created
// device nor a failure, or an index is out of range — that row is marked
// `unresolved` rather than guessed as created or failed. Resubmitting a row the
// server may already have written would duplicate a device, so the UI tells the
// user to check the device list first.
//
// ── What a bulk row deliberately is not ────────────────────────────────────
//
// A row is the minimum a device needs to exist: name, category, purchase date
// and price (VND). Everything else — brand, model, serial, purchase place, notes,
// status, currency/fxRate, warranty, resale, return window, activation, brand
// lookup, reminder lead days — is left to the device detail page. Omitting a key
// is meaningful: Go defaults status to ACTIVE, currency to VND, warrantyMonths to
// 0 (no inline warranty) and leadDays to [30, 7], which is exactly the "just
// unboxed it" state this screen creates.

import type {
  BulkDeviceFailure,
  BulkDeviceResponse,
  DeviceInput,
} from '@/lib/api/devices';
import type { UserStats } from '@/lib/api/stats';

export type { BulkDeviceFailure, BulkDeviceResponse };

/**
 * Maximum rows in one request. This is the contract's cap, not the account's
 * device quota: the quota is 50 ACTIVE devices, enforced server-side and only
 * knowable by counting the account (see {@link bulkDeviceQuotaFromStats}).
 */
export const BULK_DEVICE_MAX_ROWS = 50;

/**
 * The account's ACTIVE-device ceiling, mirrored from
 * `api/internal/services/devices.MaxDevicesPerUser`. Used only to turn the
 * stats snapshot into "how many slots are left" on a 409 — the server remains
 * the authority and no request is pre-blocked on this number.
 *
 * Sold devices do not occupy a slot (`status <> 'SOLD'` is the server predicate),
 * which is why the count comes from `total - byStatus.SOLD` rather than `total`.
 */
export const BULK_ACTIVE_DEVICE_LIMIT = 50;

/**
 * The storage backstop, mirrored from `MaxDevicesTotalPerUser`. Unlike the
 * active ceiling this counts sold devices too, so it is the other way a 409 can
 * happen — and the reason the banner reports the effective minimum of the two
 * remaining counts rather than assuming the active one is what ran out.
 */
export const BULK_TOTAL_DEVICE_LIMIT = 500;

/**
 * Registration key for the over-cap local error. Returned as a catalog key
 * rather than a rendered sentence so the caller translates it in the active
 * language, exactly like the Go validator's fieldErrors.
 */
export const BULK_ROW_CAP_KEY = 'Chỉ được thêm tối đa {max} thiết bị mỗi lần.';

/** The editable values of one row, before it becomes a `DeviceInput`. */
export type BulkDeviceDraft = {
  name: string;
  category: string;
  /** `YYYY-MM-DD` — what `<input type="date">` produces. */
  purchaseDate: string;
  /** Raw VND text; blank means "chưa ghi giá" (0), not "free". */
  purchasePrice: string;
};

/**
 * A draft plus its client-only identity. The id never reaches the Go API; it is
 * echoed back by the server action so the client can reconcile a response by
 * position even after a row has been added or removed between submissions.
 */
export type BulkDevicePayloadRow = BulkDeviceDraft & { id: string };

/**
 * Parse the hidden `rows` field a bulk submission carries.
 *
 * This is the trust boundary between the browser and the server action: it
 * accepts only an array of objects whose five members are strings, and returns
 * `null` for anything else. It deliberately does NOT validate device business
 * rules — Go owns those, and pre-rejecting here would stop one bad row from
 * receiving its own server-side fieldErrors.
 */
export function parseBulkDeviceRowsJson(
  raw: string | null | undefined,
): BulkDevicePayloadRow[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;

  const rows: BulkDevicePayloadRow[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const row = item as Record<string, unknown>;
    const id = row.id;
    const name = row.name;
    const category = row.category;
    const purchaseDate = row.purchaseDate;
    const purchasePrice = row.purchasePrice;
    if (typeof id !== 'string' || id === '') return null;
    if (
      typeof name !== 'string' ||
      typeof category !== 'string' ||
      typeof purchaseDate !== 'string' ||
      typeof purchasePrice !== 'string'
    ) {
      return null;
    }
    rows.push({ id, name, category, purchaseDate, purchasePrice });
  }
  return rows;
}

/** True when the user has not typed anything into this row. */
export function isBlankBulkDeviceDraft(row: BulkDeviceDraft): boolean {
  return (
    row.name.trim() === '' &&
    row.category.trim() === '' &&
    row.purchaseDate.trim() === '' &&
    row.purchasePrice.trim() === ''
  );
}

/**
 * Whole đồng from a row's price input. Dots/commas/spaces/₫ are grouping or
 * decoration and are dropped, matching `parseVNDInput` in `lib/format.ts`.
 * Blank is 0 ("chưa ghi giá"), which is the server's own default.
 */
export function parseBulkPrice(raw: string): number {
  const digits = raw.replace(/[^\d]/g, '');
  return digits === '' ? 0 : Number.parseInt(digits, 10);
}

/**
 * The exact `DeviceInput` a row sends. Kept small on purpose: four keys, none
 * of the device-detail fields. The returned object is asserted key-for-key in
 * `__tests__/device-bulk.test.ts`, so a future "just add brand here" cannot
 * silently widen the bulk form.
 *
 * `purchasePrice` is always present (0 when blank) so the wire shape is
 * predictable; `currency` is omitted, which means VND on create.
 */
export function bulkDeviceInputFromDraft(row: BulkDeviceDraft): DeviceInput {
  return {
    name: row.name.trim(),
    category: row.category.trim(),
    purchaseDate: row.purchaseDate.trim(),
    purchasePrice: parseBulkPrice(row.purchasePrice),
  };
}

/**
 * The local over-cap error key, or `null` when the batch is acceptable. This is
 * the same ceiling the Go handler enforces with `fieldErrors.devices`; the UI
 * also stops at 50 rows, so this is the server-action backstop.
 */
export function bulkRowCapErrorKey(count: number): string | null {
  return count > BULK_DEVICE_MAX_ROWS ? BULK_ROW_CAP_KEY : null;
}

export type BulkRowOutcome =
  | { status: 'created'; device: BulkDeviceResponse['created'][number] }
  | { status: 'failed'; failure: BulkDeviceFailure }
  | { status: 'unresolved' };

export type ReconciledBulkRow<T> = {
  /** Position in the submitted array — also the request's `devices` index. */
  index: number;
  row: T;
  outcome: BulkRowOutcome;
};

/**
 * Put each part of a 200 response back on the submitted row that produced it.
 *
 * `rows` must be exactly the array sent to the API, in order. The returned array
 * has the same length and order, so a caller can index it directly; `row` is the
 * caller's own object, untouched.
 */
export function reconcileBulkRows<T>(
  rows: readonly T[],
  result: Pick<BulkDeviceResponse, 'created' | 'failed'>,
): ReconciledBulkRow<T>[] {
  const failedByIndex = new Map<number, BulkDeviceFailure>();
  for (const failure of result.failed) {
    // Ignore an out-of-range index: it cannot belong to a row we sent. The
    // affected row then reaches the `unresolved` branch below rather than
    // silently borrowing another row's failure.
    if (
      Number.isInteger(failure.index) &&
      failure.index >= 0 &&
      failure.index < rows.length
    ) {
      failedByIndex.set(failure.index, failure);
    }
  }

  let createdCursor = 0;
  return rows.map((row, index) => {
    const failure = failedByIndex.get(index);
    if (failure) {
      return { index, row, outcome: { status: 'failed', failure } };
    }
    if (createdCursor < result.created.length) {
      const device = result.created[createdCursor];
      createdCursor += 1;
      return { index, row, outcome: { status: 'created', device } };
    }
    // The server neither failed this index nor returned a device for it. This
    // is not a normal shape; do not claim a success we cannot prove.
    return { index, row, outcome: { status: 'unresolved' } };
  });
}

/**
 * True for the whole-batch quota refusal. The bulk endpoint's only 409 is
 * `LIMIT_REACHED`, and the wire code's casing has drifted between `LIMIT_REACHED`
 * (the domain constant) and `limit_reached` (the Go envelope) before, so the
 * status is the stable thing to key on. Any other status is a row-level/normal
 * failure and must NOT be mistaken for "nothing was created".
 */
export function isBulkLimitFailure(result: { status: number }): boolean {
  return result.status === 409;
}

export type BulkDeviceQuota = {
  /** Devices with status <> SOLD. */
  active: number;
  /** Every device row, sold ones included. */
  total: number;
  maxActive: number;
  maxTotal: number;
  /** `maxActive - active`, never negative. */
  remainingActive: number;
  /** `maxTotal - total`, never negative. */
  remainingTotal: number;
  /**
   * The number of further rows the account can actually take: the tighter of
   * the two ceilings. This is the one number a 409 banner should show.
   */
  remaining: number;
};

/**
 * Turn the account-wide stats snapshot into the numbers the 409 banner shows.
 *
 * `active = total - sold` mirrors the server's `status <> 'SOLD'` predicate.
 * An account can legitimately sit above the active ceiling (un-selling a device
 * is deliberately not blocked), so both remainders are clamped at zero rather
 * than reported as negative numbers, and the effective remainder is the minimum
 * of the two.
 */
export function bulkDeviceQuotaFromStats(
  stats: Pick<UserStats, 'devices'>,
): BulkDeviceQuota {
  const total = Math.max(0, stats.devices.total ?? 0);
  const sold = Math.max(0, stats.devices.byStatus?.SOLD ?? 0);
  const active = Math.max(0, total - sold);
  const remainingActive = Math.max(0, BULK_ACTIVE_DEVICE_LIMIT - active);
  const remainingTotal = Math.max(0, BULK_TOTAL_DEVICE_LIMIT - total);
  return {
    active,
    total,
    maxActive: BULK_ACTIVE_DEVICE_LIMIT,
    maxTotal: BULK_TOTAL_DEVICE_LIMIT,
    remainingActive,
    remainingTotal,
    remaining: Math.min(remainingActive, remainingTotal),
  };
}
