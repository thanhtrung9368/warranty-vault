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
  createdAt: string;
  updatedAt: string;
};

// `GET /v1/devices` row — Device + `attachmentCount` + `effectiveWarrantyEnd`.
// Mirrors services.DeviceListItem.
export type DeviceListItem = Device & {
  attachmentCount: number;
  // Null when no warranties exist on the device.
  effectiveWarrantyEnd: string | null;
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
export type AttachmentMeta = {
  id: string;
  deviceId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
  description: string | null;
  uploadedAt: string;
  // Internal encryption fields — included by Go but unused by the web UI.
  storagePath?: string;
  iv?: string;
  wrappedKey?: string;
};

// `GET /v1/devices/{id}` returns `{ device: DeviceDetail }`.
// Go embeds the Device fields directly + appends warranties + attachments.
export type DeviceDetail = Device & {
  warranties: WarrantyWithReminders[];
  attachments: AttachmentMeta[];
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

export async function create(input: DeviceInput): Promise<ApiResult<Device>> {
  const res = await apiFetch<{ device: Device }>('POST', '/v1/devices', input);
  if (!res.ok) return res;
  return { ok: true, data: res.data.device };
}

export async function update(
  id: string,
  input: DeviceInput | Partial<DeviceInput>,
): Promise<ApiResult<Device>> {
  const res = await apiFetch<{ device: Device }>(
    'PATCH',
    `/v1/devices/${encodeURIComponent(id)}`,
    input,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.device };
}

export async function remove(id: string): Promise<ApiResult<{ ok: true }>> {
  return apiFetch<{ ok: true }>('DELETE', `/v1/devices/${encodeURIComponent(id)}`);
}
