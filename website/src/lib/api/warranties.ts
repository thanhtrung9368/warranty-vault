// Typed wrappers around the Go service's /v1/warranties/* and
// /v1/devices/{id}/warranties endpoints.
//
// Mirrors api/internal/services/warranties.go::WarrantyInput and matches the
// Warranty/AttachmentMeta shapes exported from `./devices.ts`.

import { apiFetch, type ApiError, type ApiResult } from './client';
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
  // Contract terms. All are nullable/omittable; `claimsUsed` defaults to 0 on
  // the server. The Go validator owns the rules (non-negative integers, and
  // `claimsUsed > claimsAllowed` → 400 on `fieldErrors.claimsUsed`), so this
  // client passes whatever the form parsed instead of clamping it.
  component?: string | null;
  scope?: string | null;
  cap?: number | null;
  deductible?: number | null;
  exclusions?: string | null;
  region?: string | null;
  transferable?: boolean | null;
  claimsAllowed?: number | null;
  claimsUsed?: number;
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

// The bulk read caps one call at 500 ids AFTER de-duplication (Go answers 400
// otherwise), and an absent/empty list is a 400 rather than "all devices". The
// ids are therefore trimmed, de-duplicated and chunked here before they reach
// the wire. 200 keeps each URL comfortably short while staying under the cap;
// the server-side ceiling itself is not `deviceCount`-dependent.
const LIST_FOR_DEVICES_BATCH = 200;

/**
 * Result of `GET /v1/warranties?deviceIds=` across one or more batches.
 *
 * `complete: false` is the partial-read signal the /stats page renders a warning
 * for: at least one batch failed, so the merged rows are real but the caller
 * must not present them as the whole account. Successful batches are still
 * merged — the old per-device fan-out kept the devices that answered and only
 * lost the ones that did not, and that behaviour is preserved.
 */
export type WarrantiesForDevices = {
  warranties: Warranty[];
  complete: boolean;
};

// `GET /v1/warranties?deviceIds=` — one read for many devices, replacing the
// per-device calls `/stats` used to fan out. Every row carries its `deviceId`,
// so the caller groups the flat list locally.
export async function listForDevices(
  deviceIds: readonly string[],
): Promise<ApiResult<WarrantiesForDevices>> {
  const ids = Array.from(
    new Set(deviceIds.map((id) => id.trim()).filter((id) => id !== '')),
  );
  if (ids.length === 0) {
    // No ids to ask about is a complete, empty answer — not a 400, which is what
    // sending an empty `deviceIds=` would get.
    return { ok: true, data: { warranties: [], complete: true } };
  }

  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += LIST_FOR_DEVICES_BATCH) {
    batches.push(ids.slice(i, i + LIST_FOR_DEVICES_BATCH));
  }

  const results = await Promise.all(
    batches.map((batch) =>
      apiFetch<{ warranties: Warranty[] }>(
        'GET',
        `/v1/warranties?deviceIds=${encodeURIComponent(batch.join(','))}`,
      ),
    ),
  );

  const warranties: Warranty[] = [];
  const failures: ApiError[] = [];
  for (const res of results) {
    if (res.ok) {
      warranties.push(...(res.data.warranties ?? []));
    } else {
      failures.push(res);
    }
  }

  // Every batch failed: surface the real error instead of a misleading "ok,
  // empty" answer. A partial failure stays a success with `complete: false` so
  // the successful rows survive and the caller can still warn about the gap.
  if (failures.length === results.length) return failures[0];
  return { ok: true, data: { warranties, complete: failures.length === 0 } };
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
