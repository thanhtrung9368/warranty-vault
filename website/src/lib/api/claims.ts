// Typed wrappers around the Go service's /v1/claims endpoints.
//
// The contract is frozen while a parallel Go agent implements it:
//
//   GET    /v1/claims[?deviceId=&status=]  → { claims: Claim[] }
//   POST   /v1/claims                      → 201 { claim: Claim }
//   GET    /v1/claims/{id}                 → { claim: Claim }
//   PATCH  /v1/claims/{id}                 → { claim: Claim }
//   DELETE /v1/claims/{id}                 → { ok: true }
//
// and `GET /v1/devices/{id}` gains `claims: Claim[]` (see `./devices.ts`).
//
// Two things are intentionally NOT sent:
//   * `closedAt` is set by the server when the status closes. It lives on the
//     response type only; there is no input field for it, so no client can
//     disagree with the server about when a case ended.
//   * `id`/`createdAt`/`updatedAt` are server-owned.
//
// A second OPEN/IN_REPAIR claim for one device is 409 `limit_reached`
// (lowercase on the wire). `lib/claims.ts::isClaimLimitReached` owns the
// case-insensitive comparison; callers should branch on that, not on
// `status === 409` alone.
//
// All requests go through `apiFetch`, which attaches the bearer token from the
// iron-session cookie and appends `?lang=` for the server's own messages.

import { apiFetch, type ApiResult } from './client';
import type { ClaimStatus } from '@/lib/claims';

export type { ClaimStatus };

// Mirrors the frozen `WarrantyClaim` schema. Timestamps are ISO strings; Go
// serialises them without a `Z` (the DB columns are `timestamp without time
// zone`), so callers must not round-trip them through UTC — `formatDate` and
// string slicing are both fine.
export type Claim = {
  id: string;
  deviceId: string;
  /** Nullable: a repair can be out of warranty, or the plan unknown. */
  warrantyId: string | null;
  status: ClaimStatus;
  openedAt: string;
  expectedReturnAt: string | null;
  /** Server-owned. Never part of `ClaimInput`. */
  closedAt: string | null;
  ticketNumber: string | null;
  serviceCenter: string | null;
  diagnosis: string | null;
  outcome: string | null;
  issue: string;
  /** VND, non-negative integer. Null = not recorded (not the same as 0). */
  cost: number | null;
  /** Tri-state: true / false / null (not known yet). */
  coveredByWarranty: boolean | null;
  createdAt: string;
  updatedAt: string;
};

// What POST and PATCH accept. PATCH is built as a FULL replacement from the
// form (every key is always sent, blanks as null), matching the approach the
// device/warranty actions use — Go still owns which combinations are legal.
export type ClaimInput = {
  deviceId: string;
  warrantyId?: string | null;
  status?: ClaimStatus;
  /** `YYYY-MM-DD` (what the date input produces) or a full RFC3339 stamp. */
  openedAt: string;
  expectedReturnAt?: string | null;
  ticketNumber?: string | null;
  serviceCenter?: string | null;
  diagnosis?: string | null;
  outcome?: string | null;
  /** Required by the contract. The action passes '' so Go returns its own 400. */
  issue: string;
  /** VND, non-negative integer; null = not recorded. */
  cost?: number | null;
  coveredByWarranty?: boolean | null;
};

export type ClaimListFilter = {
  deviceId?: string;
  /** `ALL` (or an empty value) is dropped — the server has no such enum. */
  status?: ClaimStatus | 'ALL' | '';
};

function toQueryString(filter: ClaimListFilter | undefined): string {
  if (!filter) return '';
  const params = new URLSearchParams();
  if (filter.deviceId) params.set('deviceId', filter.deviceId);
  if (filter.status && filter.status !== 'ALL') params.set('status', filter.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export async function list(
  filter?: ClaimListFilter,
): Promise<ApiResult<Claim[]>> {
  const res = await apiFetch<{ claims: Claim[] }>(
    'GET',
    `/v1/claims${toQueryString(filter)}`,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.claims ?? [] };
}

/** Every claim for one device. Thin wrapper over the `?deviceId=` filter. */
export async function listForDevice(
  deviceId: string,
): Promise<ApiResult<Claim[]>> {
  return list({ deviceId });
}

export async function get(id: string): Promise<ApiResult<Claim>> {
  const res = await apiFetch<{ claim: Claim }>(
    'GET',
    `/v1/claims/${encodeURIComponent(id)}`,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.claim };
}

export async function create(input: ClaimInput): Promise<ApiResult<Claim>> {
  const res = await apiFetch<{ claim: Claim }>('POST', '/v1/claims', input);
  if (!res.ok) return res;
  return { ok: true, data: res.data.claim };
}

export async function update(
  id: string,
  input: ClaimInput,
): Promise<ApiResult<Claim>> {
  const res = await apiFetch<{ claim: Claim }>(
    'PATCH',
    `/v1/claims/${encodeURIComponent(id)}`,
    input,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.claim };
}

export async function remove(id: string): Promise<ApiResult<{ ok: true }>> {
  return apiFetch<{ ok: true }>(
    'DELETE',
    `/v1/claims/${encodeURIComponent(id)}`,
  );
}
