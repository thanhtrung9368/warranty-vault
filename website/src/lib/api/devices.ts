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
  purchasePrice?: number;
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
export type Warranty = {
  id: string;
  deviceId: string;
  type: WarrantyType;
  provider: string | null;
  startDate: string;
  endDate: string;
  months: number;
  cost: number | null;
  address: string | null;
  phone: string | null;
  notes: string | null;
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
};

// `GET /v1/devices/{id}` returns `{ device: DeviceDetail }`.
// Go embeds the Device fields directly + appends warranties + attachments.
export type DeviceDetail = Device & {
  // Same derived value as `DeviceListItem.returnDeadline`; null when the window
  // is unknown / not applicable.
  returnDeadline: string | null;
  warranties: WarrantyWithReminders[];
  attachments: AttachmentMeta[];
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
