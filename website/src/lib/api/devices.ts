// Typed wrappers around the Go service's /v1/devices/* endpoints.
//
// Wire shapes mirror the Go service in `api/internal/services/devices.go`
// (which itself mirrors the OpenAPI schema). Notable differences from the
// previous Prisma-backed types:
//   - All timestamps are ISO strings (RFC3339), not `Date`.
//   - `pgtype.Timestamp` from pgx/v5 marshals as a plain ISO string when
//     valid; null when invalid. We type them as `string | null` accordingly.
//   - `attachmentCount` replaces the Prisma `_count.attachments` projection.
//
// The Vietnamese error copy on validation failures comes from the Go side;
// callers don't rewrite it.
//
// Auth: every call goes through `apiFetch` which attaches the bearer token
// from the iron-session cookie automatically.
//
// Co-located helpers (`listFilterToParams`) live here so server actions and
// pages share the same querystring logic.

import { apiFetch, type ApiResult } from './client';
import { normalizeDeviceWarnings } from '@/lib/device-warnings';
import type { Claim } from './claims';
// Brand warranty lookup (frozen contract). The wire types live in
// `@/lib/brand-warranty` next to the pure copy/date logic; they are re-exported
// from here because this module is the device contract's home.
import type {
  BrandWarrantyStatus,
  BrandWarrantyValues,
  WarrantyMismatch,
  WarrantyMismatchKind,
} from '@/lib/brand-warranty';

export type {
  BrandWarrantyStatus,
  BrandWarrantyValues,
  WarrantyMismatch,
  WarrantyMismatchKind,
};

// ---- Filter / input shapes ---------------------------------------------------

// Mirrors api/internal/services/devices.go::DeviceFilter. Field names align
// with the openapi `GET /v1/devices` query parameters.
export type DeviceListFilter = {
  q?: string;
  category?: string;
  status?: string;
  sort?: 'purchaseDate' | 'warrantyEndDate' | 'price' | 'name';
  dir?: 'asc' | 'desc';
};

// Mirrors api/internal/services/devices.go::DeviceInput.
// Optional/null fields use `string | null` (server normalizes blanks to null).
export type DeviceInput = {
  name: string;
  category: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  // YYYY-MM-DD or full RFC3339 — the Go server accepts both.
  purchaseDate: string;
  /** In `currency`, not necessarily đồng. */
  purchasePrice?: number;
  // Currency of `purchasePrice`, `soldPrice` and every `Warranty.cost` on this
  // device. ISO-4217, defaults to VND on the server. The form always sends it,
  // including on PATCH (which replaces the whole device).
  currency?: string;
  // VND per ONE unit of `currency`, locked when the device is entered. Must be
  // null for VND and is required for every other currency; the action rejects a
  // missing rate before the request. Also always sent on PATCH.
  fxRate?: number | null;
  purchasePlace?: string | null;
  status?: 'ACTIVE' | 'EXPIRED' | 'SOLD' | 'BROKEN' | 'LOST';
  notes?: string | null;
  // Resale pair (migration 0006). Both or neither: sending exactly one is a
  // 400 from Go (`fieldErrors.soldAt` / `fieldErrors.soldPrice`), and sending
  // both as null clears a previously recorded sale. `soldAt` accepts
  // `YYYY-MM-DD` (what the device form's date input gives us) or full RFC3339.
  // Independent of `status` — `status: 'SOLD'` needs no figures.
  soldAt?: string | null;
  soldPrice?: number | null;
  // Return window (migration 0010). Independent of each other — a user may know
  // one and not the other. `returnWindowDays: null` = chưa biết, `0` = cửa hàng
  // không cho đổi trả (the two are NOT the same answer), `> 0` = số ngày.
  // `receivedAt` accepts `YYYY-MM-DD` or full ISO.
  //
  // ⚠️ PATCH is a FULL REPLACEMENT: omitting either key CLEARS a recorded
  // window. Every save from the web must therefore send both keys, which is what
  // `lib/device-return-window.ts` + `app/actions/devices.ts` do — see the note
  // there. This pass adds no input that sets a window.
  returnWindowDays?: number | null;
  receivedAt?: string | null;
  warrantyMonths?: number;
  warrantyProvider?: string | null;
  warrantyAddress?: string | null;
  warrantyPhone?: string | null;
  warrantyNotes?: string | null;
  // Reminder lead days (1..5 integers, each 0..365, no duplicates). The server
  // sorts descending, rejects an empty array and defaults to [30, 7] on create
  // when this key is absent. On PATCH an absent/null value leaves the stored
  // list unchanged; the device form always sends the selected list, and
  // `lib/lead-days.ts` normalises it (sort/dedupe/clamp/cap) without trying to
  // replace Go's validation.
  leadDays?: number[];
  // Warranty activation (Feature A). `activationRequired` defaults to false on
  // the server. `activatedAt` is when the retailer/account activation happened
  // — it may legitimately be EARLIER than `purchaseDate` (a shop can
  // pre-activate before handing the device over), so no client may block that
  // pair; the server does not either.
  activationRequired?: boolean;
  // Accepts `YYYY-MM-DD` (what the device form's date input gives us) or a
  // full date-time, like `purchaseDate` / `soldAt`. `null` clears it.
  activatedAt?: string | null;
  // Last day to BUY extended cover (AppleCare+, Samsung Care+). After this day
  // the option is gone forever, which is why the detail page shows a countdown.
  extendedCoverBuyBy?: string | null;
  // ── Brand warranty answer (the frozen five) ────────────────────────────
  //
  // What the BRAND's own system said, recorded by the owner from the brand's
  // lookup page. All nullable: null means "not checked / brand had no answer".
  //
  // Rules enforced by Go (`fieldErrors.brandWarrantyStatus` etc.):
  //   * status is required whenever any of the other four is set;
  //   * `brandWarrantyEnd` may not precede `brandWarrantyStart`;
  //   * `brandLookupUrl` must be an absolute http/https URL.
  //
  // PATCH replaces the whole device, so the device form always ships these five
  // through hidden/controlled inputs even when the owner never touched them —
  // otherwise editing the device name would silently erase a recorded check.
  // `brandCheckedAt` is the moment the check happened; the record action stamps
  // "now", the device form preserves the stored value unless the owner edits the
  // answer. Dates accept `YYYY-MM-DD` or full RFC3339, like `purchaseDate`.
  brandWarrantyStatus?: BrandWarrantyStatus | null;
  brandWarrantyStart?: string | null;
  brandWarrantyEnd?: string | null;
  brandCheckedAt?: string | null;
  brandLookupUrl?: string | null;
  // Server marks the wishlist item as PURCHASED when set.
  fromWishlistId?: string | null;
};

// ---- Response shapes ---------------------------------------------------------

export type DeviceStatus = 'ACTIVE' | 'EXPIRED' | 'SOLD' | 'BROKEN' | 'LOST';

// Wire shape from `store.Device`. Timestamps are ISO strings.
export type Device = {
  id: string;
  userId: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  purchaseDate: string;
  purchasePrice: number;
  // Money on the device is denominated in `currency`, not đồng. `fxRate` is the
  // locked VND-per-unit rate (null exactly when the currency is VND).
  currency: string;
  fxRate: number | null;
  // Computed by the server. These are the ONLY device-money values a total may
  // sum: do not multiply `purchasePrice` by `fxRate` in the web client (the
  // server owns the rounding and the historical lock).
  //
  // `purchasePriceVnd` is ALWAYS present but nullable: `null` means "cannot be
  // known" (a non-VND row with no stored rate, only reachable via hand-edited
  // data). Such a row must not be added to a VND total at par.
  purchasePriceVnd: number | null;
  // Absent (not `null`) on the wire when the device is not sold, because Go
  // tags it `omitempty`; optional handles both.
  soldPriceVnd?: number | null;
  purchasePlace: string | null;
  status: string;
  notes: string | null;
  // Resale record. `soldAt` serialises like `purchaseDate`
  // (`"2026-03-01T00:00:00"`, no `Z`, no offset) — never `new Date()` it into a
  // UTC round-trip; see `@/lib/device-resale`. Both are null until a sale is
  // recorded, and the write path refuses half a record.
  soldAt: string | null;
  soldPrice: number | null;
  // Return window (migration 0010). `returnWindowDays` is per-device store
  // policy, not a server default: `null` = chưa biết, `0` = không cho đổi trả.
  // `receivedAt` is the day the device actually arrived — when set it, not
  // `purchaseDate`, anchors the window. Both round-trip through the device form
  // unchanged (see `lib/device-return-window.ts`).
  returnWindowDays: number | null;
  receivedAt: string | null;
  // Reminder lead times (the per-user replacement for the fixed 7/30 schedule):
  // 1..5 integers, each 0..365, no duplicates, sorted descending by the server.
  // `[30, 7]` is the create default.
  leadDays: number[];
  // Warranty activation (Feature A). `activatedAt` serialises like
  // `purchaseDate` — Z-less `YYYY-MM-DDTHH:MM:SS[.fff]` — and is null until the
  // warranty is actually activated. A device can require activation and still
  // have no date: that is exactly the "chưa kích hoạt" state the detail page
  // surfaces, because an unactivated device can be refused at the counter.
  activationRequired: boolean;
  activatedAt: string | null;
  // Last day to buy extended cover; null when the retailer never gave one.
  extendedCoverBuyBy: string | null;
  // ── Brand warranty answer (frozen contract) ────────────────────────────
  //
  // All five are nullable and describe what the BRAND's system said, plus when
  // it was checked and on which page. `null` means "not checked / no answer",
  // never "no warranty". `brandCheckedAt` is a timestamp; the two dates are
  // day-resolution strings. See `@/lib/brand-warranty` for the copy and the
  // validation rules.
  brandWarrantyStatus: BrandWarrantyStatus | null;
  brandWarrantyStart: string | null;
  brandWarrantyEnd: string | null;
  brandCheckedAt: string | null;
  brandLookupUrl: string | null;
  // COMPUTED, read-only, present on every device read. `null` means the two
  // sides agree (or there is nothing comparable). It is never a write input —
  // never send it back in a PATCH. Use `normalizeWarrantyMismatch()` before
  // rendering: the shape is the server's, and a missing field must degrade to
  // "nothing to show", not crash the page.
  warrantyMismatch: WarrantyMismatch | null;
  // Cron de-duplication stamp for the "sắp hết hạn đổi trả" push. Operational
  // detail with no web surface, so it is optional here.
  returnWindowNotifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

// `GET /v1/devices` row — Device + `attachmentCount` + `effectiveWarrantyEnd`.
// Mirrors services.DeviceListItem.
export type DeviceListItem = Device & {
  attachmentCount: number;
  // Null when no warranties exist on the device.
  effectiveWarrantyEnd: string | null;
  // Return-window deadline, computed server-side:
  // `COALESCE(receivedAt, purchaseDate) + returnWindowDays ngày`. Null when the
  // day count is unknown, is 0, or there is no purchase date at all.
  returnDeadline: string | null;
};

export type WarrantyType = 'STANDARD' | 'EXTENDED' | 'THIRD_PARTY';

// Wire shape from `store.Warranty`. `createdAt`/`updatedAt` come from the DB.
//
// The nine contract-term fields are nullable on purpose: `null` means "not
// recorded", which is different from a recorded zero (`cap: 0`, `deductible: 0`)
// and from an explicit `transferable: false`. `claimsUsed` is the one exception
// — the server defaults it to 0, so it is non-null on every row. See
// `lib/warranty-terms.ts` for the "has terms" rule that depends on that.
export type Warranty = {
  id: string;
  deviceId: string;
  type: WarrantyType;
  provider: string | null;
  startDate: string;
  endDate: string;
  months: number;
  /**
   * Price paid for this package, in the DEVICE's currency (not necessarily
   * VND). The frozen contract exposes no `costVnd`, so a foreign-currency
   * package cannot be added to a VND total in the web client — see
   * `lib/stats-rollup.ts`, which excludes it and says so in the UI.
   */
  cost: number | null;
  address: string | null;
  phone: string | null;
  notes: string | null;
  /** What part this row covers; null = whole unit. */
  component: string | null;
  /** What is covered. */
  scope: string | null;
  /** Maximum payout, VND. */
  cap: number | null;
  /** VND the user pays per claim. */
  deductible: number | null;
  /** What is excluded. */
  exclusions: string | null;
  /** Where the cover applies. */
  region: string | null;
  /** Whether the cover survives resale. */
  transferable: boolean | null;
  /** How many claims the contract allows. */
  claimsAllowed: number | null;
  /** How many have been used. Server default: 0. */
  claimsUsed: number;
  createdAt: string;
  updatedAt: string;
};

// Wire shape from `store.Reminder` — embedded inside warranties on the
// detail endpoint.
export type WarrantyReminder = {
  id: string;
  warrantyId: string;
  isDismissed: boolean;
  createdAt: string;
};

export type WarrantyWithReminders = Warranty & {
  reminders: WarrantyReminder[];
};

// Wire shape from `store.Attachment` minus the encryption-internal fields
// (Go embeds them but we only ever consume metadata on the web).
// The public attachment shape (openapi `AttachmentMeta`). Go strips the
// internal columns — storagePath / iv / wrappedKey — before serialising, so
// this type no longer declares them.
export type AttachmentMeta = {
  id: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  description: string | null;
  uploadedAt: string;
  // OCR transcript (migration 0019), searchable through `GET /v1/search`.
  // Absent — not `null` — for a file that was never scanned (openapi
  // `AttachmentMeta.extractedText` is `omitempty`), hence the optional key.
  extractedText?: string | null;
};

// `GET /v1/devices/{id}` returns `{ device: DeviceDetail }`.
// Go embeds the Device fields directly + appends warranties + attachments.
export type DeviceDetail = Device & {
  // Same derived value as `DeviceListItem.returnDeadline`; null when the window
  // is unknown / not applicable.
  returnDeadline: string | null;
  warranties: WarrantyWithReminders[];
  attachments: AttachmentMeta[];
  // Repair cases for this device, newest/open first (server order). The
  // contract says the key is always present; it is typed optional so an older
  // server cannot crash a page that already has the rest of the detail.
  claims?: Claim[];
};

// Advisory, NON-BLOCKING findings attached to a serial number (openapi
// `DeviceWarning`, FEATURE_IDEAS #6). A warning never means "rejected": the
// device was created/updated and the value was kept. `message` is Vietnamese
// copy meant to be shown as-is, which is why the UI prefers it over its own
// wording; `code` is the stable machine-readable key.
export type DeviceWarningCode = 'IMEI_CHECKSUM' | 'IMEI_LENGTH' | 'SERIAL_DUPLICATE';

export type DeviceWarning = {
  code: DeviceWarningCode | string;
  // The request/draft field the warning points at — currently always
  // "serialNumber" (services.SerialField).
  field: string;
  message: string;
};

// What POST /v1/devices (201) and PATCH /v1/devices/{id} (200) return: the saved
// device plus any advisories about the serial that was just stored. `warnings` is
// always present on the wire (and always `[]` when there is nothing to flag);
// `normalizeDeviceWarnings` keeps that true even against an older server.
export type DeviceWriteResult = {
  device: Device;
  warnings: DeviceWarning[];
};

// ── Bulk create (POST /v1/devices/bulk) ─────────────────────────────────────
//
// The frozen contract:
//
//   POST /api/v1/devices/bulk
//   body   { devices: DeviceInput[] }   — at most 50 rows
//   200    { created: Device[], failed: BulkDeviceFailure[] }
//   409    LIMIT_REACHED — the whole batch is refused and nothing is created
//
// This endpoint is deliberately NOT all-or-nothing for validation: a bad row is
// reported in `failed` while the other rows are created. `created` carries no
// index, because a created device already has everything a caller needs; the
// `index` on each failure is the position in the request array, which is what
// lets a client put the error back on the row that produced it
// (`lib/device-bulk.ts::reconcileBulkRows`).
//
// `fieldErrors` uses the same keys as the single-device endpoint (`name`,
// `category`, `purchaseDate`, `purchasePrice`, …), so a bulk row can render the
// server's field-level copy exactly like the full device form does.
export type BulkDeviceFailure = {
  /** Position in the request's `devices` array. */
  index: number;
  /** `validation`, `category_invalid`, … (lower-case on the wire). */
  code: string;
  /** Already localised by Go — render as-is. */
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type BulkDeviceResponse = {
  created: Device[];
  failed: BulkDeviceFailure[];
};

// ---- Methods -----------------------------------------------------------------

function toQueryString(filter: DeviceListFilter | undefined): string {
  if (!filter) return '';
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.category && filter.category !== 'ALL') params.set('category', filter.category);
  if (filter.status && filter.status !== 'ALL') params.set('status', filter.status);
  if (filter.sort) params.set('sort', filter.sort);
  if (filter.dir) params.set('dir', filter.dir);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export async function list(filter?: DeviceListFilter): Promise<ApiResult<DeviceListItem[]>> {
  const qs = toQueryString(filter);
  const res = await apiFetch<{ devices: DeviceListItem[] }>('GET', `/v1/devices${qs}`);
  if (!res.ok) return res;
  return { ok: true, data: res.data.devices ?? [] };
}

export async function get(id: string): Promise<ApiResult<DeviceDetail>> {
  const res = await apiFetch<{ device: DeviceDetail }>('GET', `/v1/devices/${encodeURIComponent(id)}`);
  if (!res.ok) return res;
  return { ok: true, data: res.data.device };
}

export async function create(input: DeviceInput): Promise<ApiResult<DeviceWriteResult>> {
  const res = await apiFetch<{ device: Device; warnings?: unknown }>(
    'POST',
    '/v1/devices',
    input,
  );
  if (!res.ok) return res;
  return {
    ok: true,
    data: { device: res.data.device, warnings: normalizeDeviceWarnings(res.data.warnings) },
  };
}

/**
 * `POST /v1/devices/bulk` — up to 50 devices in one request, partial success.
 *
 * The row cap is enforced before the call (`lib/device-bulk.ts`), but the server
 * is still the authority: a batch over the cap answers 400 with
 * `fieldErrors.devices`. A batch that would break the account's device quota is
 * refused whole with 409 `LIMIT_REACHED` — see `isBulkLimitFailure`.
 *
 * `created` and `failed` are normalised to arrays so a malformed/older server
 * cannot make the UI crash on iteration. The created devices intentionally carry
 * no `warnings`: the bulk contract returns `Device`, not `DeviceWriteResult`.
 */
export async function bulkCreate(
  devices: DeviceInput[],
): Promise<ApiResult<BulkDeviceResponse>> {
  const res = await apiFetch<BulkDeviceResponse>('POST', '/v1/devices/bulk', { devices });
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      created: res.data.created ?? [],
      failed: res.data.failed ?? [],
    },
  };
}

export async function update(
  id: string,
  input: DeviceInput | Partial<DeviceInput>,
): Promise<ApiResult<DeviceWriteResult>> {
  const res = await apiFetch<{ device: Device; warnings?: unknown }>(
    'PATCH',
    `/v1/devices/${encodeURIComponent(id)}`,
    input,
  );
  if (!res.ok) return res;
  return {
    ok: true,
    data: { device: res.data.device, warnings: normalizeDeviceWarnings(res.data.warnings) },
  };
}

export async function remove(id: string): Promise<ApiResult<{ ok: true }>> {
  return apiFetch<{ ok: true }>('DELETE', `/v1/devices/${encodeURIComponent(id)}`);
}
