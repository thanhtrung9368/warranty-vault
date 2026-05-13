// Typed wrappers around the Go service's /v1/warranties/* and
// /v1/devices/{id}/warranties endpoints.
//
// Mirrors api/internal/services/warranties.go::WarrantyInput and matches the
// Warranty/AttachmentMeta shapes exported from `./devices.ts`.

import { apiFetch, type ApiResult } from './client';
import type { Warranty, WarrantyType } from './devices';

export type { Warranty, WarrantyType };

// Mirrors api/internal/services/warranties.go::WarrantyInput.
export type WarrantyInput = {
  type: WarrantyType;
  provider?: string | null;
  // YYYY-MM-DD or full RFC3339; the Go server accepts either.
  startDate: string;
  months: number;
  cost?: number | null;
  address?: string | null;
  phone?: string | null;
  notes?: string | null;
};

// `GET /v1/devices/{id}/warranties` is auth + ownership-checked on Go side.
// Useful for places where we already have the deviceId and want a fresh list
// without fetching the entire device detail.
export async function listForDevice(deviceId: string): Promise<ApiResult<Warranty[]>> {
  const res = await apiFetch<{ warranties: Warranty[] }>(
    'GET',
    `/v1/devices/${encodeURIComponent(deviceId)}/warranties`,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.warranties ?? [] };
}

export async function create(
  deviceId: string,
  input: WarrantyInput,
): Promise<ApiResult<Warranty>> {
  const res = await apiFetch<{ warranty: Warranty }>(
    'POST',
    `/v1/devices/${encodeURIComponent(deviceId)}/warranties`,
    input,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.warranty };
}

export async function update(id: string, input: WarrantyInput): Promise<ApiResult<Warranty>> {
  const res = await apiFetch<{ warranty: Warranty }>(
    'PATCH',
    `/v1/warranties/${encodeURIComponent(id)}`,
    input,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.warranty };
}

export async function remove(id: string): Promise<ApiResult<{ ok: true }>> {
  return apiFetch<{ ok: true }>('DELETE', `/v1/warranties/${encodeURIComponent(id)}`);
}
