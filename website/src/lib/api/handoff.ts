// Typed wrappers around the Go service's resale-handoff endpoints (Warrly 2.0).
//
// Contract (frozen for the 2.0 sprint):
//
//   POST   /v1/devices/{id}/handoff      { attachmentIds?: string[] }
//          → 201 { handoff: { id, deviceId, code, claimPath, status, createdAt, expiresAt } }
//   GET    /v1/devices/{id}/handoff      → 200 { handoff | null, nextAllowedAt? } (no code)
//   DELETE /v1/devices/{id}/handoff      → 200 { ok: true }
//   GET    /v1/public/handoff/{code}     → 200 { handoff: { …safe projection… } }
//   POST   /v1/handoff/{code}/claim      → 200 { handoff, device }
//
// The 6-character code is a credential. Like the handover-certificate share
// token it is returned EXACTLY ONCE, from the create call; `Handoff` (the
// owner-facing read) deliberately has no `code` field, so there is no "fetch my
// code again" call to write. `claimPath` is a path on THIS SITE
// (`/handoff/<code>`), not on the API origin — the claim page is a Next route,
// which is the one structural difference from the Go-served share certificate.
//
// The public projection is assembled by the server and carries no userId,
// email, price, notes or full serial. This module does not compose it and the
// UI must never fetch a private device and redact it client-side — the fields
// simply do not exist on `PublicHandoff`.

import { apiFetch, type ApiResult } from './client';

// ── Shared enums ──────────────────────────────────────────────────────────

export type HandoffStatus = 'PENDING' | 'CLAIMED' | 'EXPIRED' | 'CANCELLED';

// ── Owner-facing shapes ───────────────────────────────────────────────────

/** `GET /v1/devices/{id}/handoff` — the live/terminal handoff for one device. */
export type Handoff = {
  id: string;
  deviceId: string;
  status: HandoffStatus;
  createdAt: string;
  expiresAt: string;
  claimedAt: string | null;
};

/**
 * `POST /v1/devices/{id}/handoff` response. The ONLY shape that carries the
 * raw code and the claim path; after this response the code exists nowhere the
 * web can read it again.
 */
export type CreatedHandoff = Handoff & {
  code: string;
  claimPath: string;
};

/**
 * `GET /v1/devices/{id}/handoff` — the device's current (or last) handoff plus
 * the cooldown clock. `nextAllowedAt` is the server's answer for when this
 * device may mint another code; it is present even when `handoff` is null
 * (e.g. a cancelled code still inside the 30-day window).
 */
export type DeviceHandoffState = {
  handoff: Handoff | null;
  nextAllowedAt: string | null;
};

export type CreateHandoffInput = {
  /**
   * Attachment ids the seller chose to carry. Omitted / `[]` = NO documents
   * travel — the safe default. The server validates every id belongs to the
   * device.
   */
  attachmentIds?: string[];
};

// ── Public projection (unauthenticated preview) ───────────────────────────

export type PublicHandoffWarranty = {
  type: string;
  provider: string | null;
  startDate: string | null;
  endDate: string | null;
  /** A component-scoped row ("Pin", "Động cơ") is not whole-unit cover. */
  component?: string | null;
};

export type PublicHandoffAttachment = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

/**
 * The safe repair fact set. Money (`cost`), free-text diagnosis and notes are
 * NOT part of the projection; the page renders only what is typed here.
 */
export type PublicHandoffClaim = {
  // Optional keys on purpose: the server owns this projection's exact shape and
  // the page must degrade to "no repair facts" rather than crash if a field is
  // absent. Nothing here is money or free text — the projection excludes those.
  status?: string | null;
  openedAt?: string | null;
  closedAt?: string | null;
};

export type PublicHandoffDevice = {
  name: string;
  brand: string | null;
  model: string | null;
  category: string;
  purchaseDate: string;
  /** Already masked by the server — the web never receives the full serial. */
  serialMasked: string | null;
};

export type PublicHandoff = {
  code: string;
  status: HandoffStatus;
  expiresAt: string;
  /** Optional, self-declared by the seller. Warrly does not verify identity. */
  sellerName?: string | null;
  device: PublicHandoffDevice;
  warranties: PublicHandoffWarranty[];
  attachments: PublicHandoffAttachment[];
  claims: PublicHandoffClaim[];
};

// ── Claim response ────────────────────────────────────────────────────────

/**
 * `POST /v1/handoff/{code}/claim`. The server creates a brand-new `Device` in
 * the buyer's account (tagged with `handoffSellerName` / `handoffReceivedAt`)
 * and returns it in full. The web only needs the id/name for the "open it"
 * link, so the device is typed structurally instead of importing the whole
 * `Device` shape.
 *
 * Status meaning: 200 = claimed now OR the same buyer retrying (idempotent,
 * still a success), 403 = the seller trying to claim their own code, 409 = a
 * different buyer already claimed it, 410 = expired, 429 = too many attempts.
 */
export type ClaimedHandoff = {
  handoff: {
    id: string;
    status: 'CLAIMED';
    claimedAt: string | null;
  };
  device: {
    id: string;
    name: string;
    handoffSellerName?: string | null;
    handoffReceivedAt?: string | null;
  };
};

// ── Methods ───────────────────────────────────────────────────────────────

export async function forDevice(deviceId: string): Promise<ApiResult<DeviceHandoffState>> {
  const res = await apiFetch<{ handoff?: Handoff | null; nextAllowedAt?: string | null }>(
    'GET',
    `/v1/devices/${encodeURIComponent(deviceId)}/handoff`,
  );
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      handoff: res.data.handoff ?? null,
      nextAllowedAt: res.data.nextAllowedAt ?? null,
    },
  };
}

export async function create(
  deviceId: string,
  input: CreateHandoffInput,
): Promise<ApiResult<CreatedHandoff>> {
  const res = await apiFetch<{ handoff?: CreatedHandoff }>(
    'POST',
    `/v1/devices/${encodeURIComponent(deviceId)}/handoff`,
    input,
  );
  if (!res.ok) return res;
  if (!res.data.handoff) {
    return { ok: false, status: 502, error: 'bad_response' };
  }
  return { ok: true, data: res.data.handoff };
}

/** Cancels the device's current pending handoff (the code becomes useless). */
export async function cancel(deviceId: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>(
    'DELETE',
    `/v1/devices/${encodeURIComponent(deviceId)}/handoff`,
  );
}

/**
 * The unauthenticated preview. `auth: false` is explicit: a signed-out buyer
 * must be able to read the summary, and sending a stale cookie must not turn
 * this read into a 401.
 *
 * Every non-PENDING state — unknown, expired, cancelled, already claimed — is
 * the SAME 404 from the server. The page must therefore not try to tell them
 * apart; only the claim POST (403/409/410) can name a reason, and only to a
 * signed-in visitor who is actually trying to claim.
 */
export async function preview(code: string): Promise<ApiResult<PublicHandoff>> {
  const res = await apiFetch<{ handoff?: PublicHandoff }>(
    'GET',
    `/v1/public/handoff/${encodeURIComponent(code)}`,
    undefined,
    { auth: false },
  );
  if (!res.ok) return res;
  if (!res.data.handoff) {
    return { ok: false, status: 502, error: 'bad_response' };
  }
  return { ok: true, data: res.data.handoff };
}

/** Auth-gated, empty body — the code in the path is the only input. */
export async function claim(code: string): Promise<ApiResult<ClaimedHandoff>> {
  return apiFetch<ClaimedHandoff>(
    'POST',
    `/v1/handoff/${encodeURIComponent(code)}/claim`,
  );
}
