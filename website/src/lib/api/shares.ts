// Typed wrappers around the Go service's share-link endpoints
// (FEATURE_IDEAS #2, openapi `shares` tag):
//
//   POST   /v1/devices/{id}/shares   → 201 { share: CreatedDeviceShare }
//   GET    /v1/devices/{id}/shares   → 200 { shares: DeviceShare[] }
//   DELETE /v1/shares/{id}           → 200 { ok: true }
//
// The token is a credential: it appears ONLY in the POST response, and the
// server stores nothing but its sha256. `DeviceShare` therefore has no token
// field at all — there is deliberately no "fetch my link again" call to write.
// `GET /v1/public/shares/{token}` (the certificate itself) is NOT wrapped here:
// it is an unauthenticated HTML page on the API origin, and the web app's job
// is to link to it, not to proxy it.
//
// Timestamps are RFC3339 UTC strings (`services.tsString`), unlike the
// DB-local stamps on Device; callers use `@/lib/share-links` for the maths.

import { apiFetch, type ApiResult } from './client';

// Wire shape from `services.DeviceShare` — the OWNER-facing projection.
export type DeviceShare = {
  id: string;
  deviceId: string;
  expiresAt: string;
  revokedAt: string | null;
  includeSerial: boolean;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
};

// POST response: DeviceShare + the ONE-TIME raw token and the path to append to
// the API base. After this response the token exists nowhere on the server.
export type CreatedDeviceShare = DeviceShare & {
  token: string;
  sharePath: string;
};

export type CreateShareInput = {
  // 1..90. Omit for the server default (30).
  expiresInDays?: number;
  // false (default) = masked serial only; true = full serial/IMEI in the
  // certificate. See the openapi description of POST .../shares.
  includeSerial?: boolean;
};

// ---- Methods -----------------------------------------------------------------

export async function list(deviceId: string): Promise<ApiResult<DeviceShare[]>> {
  const res = await apiFetch<{ shares: DeviceShare[] }>(
    'GET',
    `/v1/devices/${encodeURIComponent(deviceId)}/shares`,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.shares ?? [] };
}

export async function create(
  deviceId: string,
  input: CreateShareInput,
): Promise<ApiResult<CreatedDeviceShare>> {
  const res = await apiFetch<{ share: CreatedDeviceShare }>(
    'POST',
    `/v1/devices/${encodeURIComponent(deviceId)}/shares`,
    input,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.share };
}

// Idempotent on the server: revoking an already-revoked link is a 200, a
// foreign or unknown id is a 404. Both answers are handled by the action.
export async function revoke(shareId: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>('DELETE', `/v1/shares/${encodeURIComponent(shareId)}`);
}
