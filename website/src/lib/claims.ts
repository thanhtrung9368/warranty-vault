// Warranty claims / repair cases — the pure half.
//
// A `WarrantyClaim` (openapi / the frozen contract this client was built
// against) records one trip to a repair shop or warranty centre: where the
// device is, the ticket number, what the shop said, what it cost and whether
// the warranty paid. It belongs to a DEVICE (`deviceId`), with an optional
// `warrantyId` that must belong to that same device.
//
// This module is deliberately free of React, `next/*` and the API client, so
// the same rules are usable from the server action, the RSC pages and the
// client form — and can be unit-tested under `src/lib/__tests__/`. Go owns
// validation (one-open-claim-per-device is a 409, `cost` bounds, warranty
// ownership). What lives here is only:
//
//   * the status vocabulary and its open/closed partition,
//   * the tri-state `coveredByWarranty` rendering,
//   * money/FormData parsing for the client's own pre-flight check,
//   * the 409 `limit_reached` detection,
//   * the selectors behind the two UI surfaces (the device card and the
//     "broken with no open claim" nudge).
//
// `locale` is required on every rendering helper: an optional default would let
// an unconverted call site print Vietnamese inside an English page.

import { formatVND } from '@/lib/format';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

// ---- Status ----------------------------------------------------------------

export const CLAIM_STATUSES = [
  'OPEN',
  'IN_REPAIR',
  'RESOLVED',
  'REJECTED',
  'CANCELLED',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/**
 * The two statuses the server treats as "still at the shop". At most one claim
 * per device may be in either of them; a second write is a 409 whose wire code
 * is `limit_reached` (lowercase, but compared case-insensitively — see
 * `isClaimLimitReached`).
 */
export const OPEN_CLAIM_STATUSES = ['OPEN', 'IN_REPAIR'] as const;
export type OpenClaimStatus = (typeof OPEN_CLAIM_STATUSES)[number];

/** The three statuses that end a claim. `closedAt` is set by the server. */
export const CLOSED_CLAIM_STATUSES = ['RESOLVED', 'REJECTED', 'CANCELLED'] as const;
export type ClosedClaimStatus = (typeof CLOSED_CLAIM_STATUSES)[number];

/**
 * Vietnamese labels. These are catalog keys, not display strings: callers go
 * through `claimStatusLabel` so the active language is applied. The map is
 * listed in `__tests__/i18n-coverage.test.ts`, which is what forces every
 * value to be registered in both languages.
 */
export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  OPEN: 'Đang mở',
  IN_REPAIR: 'Đang sửa',
  RESOLVED: 'Đã xử lý xong',
  REJECTED: 'Bị từ chối',
  CANCELLED: 'Đã huỷ',
};

/** Soft pill classes, matching the design tokens used by the device badges. */
export const CLAIM_STATUS_TONE: Record<ClaimStatus, string> = {
  OPEN: 'bg-sky-soft text-sky-ink',
  IN_REPAIR: 'bg-amber-soft text-amber-ink',
  RESOLVED: 'bg-emerald-soft text-emerald-ink',
  REJECTED: 'bg-rose-soft text-rose-ink',
  CANCELLED: 'bg-zinc-soft text-ink-2',
};

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return (
    typeof value === 'string' &&
    (CLAIM_STATUSES as readonly string[]).includes(value)
  );
}

export function isOpenClaimStatus(value: unknown): value is OpenClaimStatus {
  return (
    typeof value === 'string' &&
    (OPEN_CLAIM_STATUSES as readonly string[]).includes(value)
  );
}

export function isClosedClaimStatus(value: unknown): value is ClosedClaimStatus {
  return (
    typeof value === 'string' &&
    (CLOSED_CLAIM_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Status → label in the active language. An unknown code (a status a newer
 * server added) falls through to the code itself rather than to an empty pill.
 */
export function claimStatusLabel(status: string, locale: Locale): string {
  const key = (CLAIM_STATUS_LABELS as Record<string, string>)[status] ?? status;
  return translate(locale, key);
}

/**
 * What a status change means, without forbidding any of them.
 *
 * The client deliberately does not hide statuses: Go accepts a PATCH with any
 * of the five, and someone correcting a mis-filed closed case must be able to.
 * This classifier exists so the concept is written down and testable — the form
 * only uses it to decide whether to explain that the server owns `closedAt`.
 */
export type ClaimStatusTransition =
  | 'same'
  | 'advance'
  | 'close'
  | 'reopen'
  | 'correct';

export function claimStatusTransition(
  from: ClaimStatus,
  to: ClaimStatus,
): ClaimStatusTransition {
  if (from === to) return 'same';
  if (isOpenClaimStatus(from) && isOpenClaimStatus(to)) return 'advance';
  if (isOpenClaimStatus(from) && isClosedClaimStatus(to)) return 'close';
  if (isClosedClaimStatus(from) && isOpenClaimStatus(to)) return 'reopen';
  return 'correct';
}

/** Structural subset of the wire `Claim` this module needs. */
export type ClaimStatusLike = { status: string };

export function claimIsOpen(claim: ClaimStatusLike): boolean {
  return isOpenClaimStatus(claim.status);
}

export function claimIsClosed(claim: ClaimStatusLike): boolean {
  return isClosedClaimStatus(claim.status);
}

export function openClaims<T extends ClaimStatusLike>(claims: readonly T[]): T[] {
  return claims.filter(claimIsOpen);
}

export function closedClaims<T extends ClaimStatusLike>(claims: readonly T[]): T[] {
  return claims.filter(claimIsClosed);
}

/**
 * The single open claim for a device, or `null`.
 *
 * Used for two things: the link shown when a create is rejected with 409, and
 * the "broken but no case" nudge. Unknown statuses are not open: the server's
 * limit covers only OPEN/IN_REPAIR, so treating a typo as open would hide the
 * nudge on a device that really needs one.
 */
export function findOpenClaimForDevice<T extends ClaimStatusLike & { deviceId: string }>(
  claims: readonly T[],
  deviceId: string,
): T | null {
  return claims.find((claim) => claim.deviceId === deviceId && claimIsOpen(claim)) ?? null;
}

/**
 * Open claims first, then newest `openedAt`. Stable for equal timestamps and
 * never mutates the input (the RSC payload may be shared).
 *
 * The standalone `/claims` page and the device card both use this so the case
 * the user is waiting on cannot disappear below a year of resolved history.
 */
export function sortClaimsForDisplay<
  T extends ClaimStatusLike & { openedAt: string },
>(claims: readonly T[]): T[] {
  const timestamp = (value: string): number => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return [...claims].sort((a, b) => {
    const aClosed = claimIsClosed(a) ? 1 : 0;
    const bClosed = claimIsClosed(b) ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    return timestamp(b.openedAt) - timestamp(a.openedAt);
  });
}

/**
 * Devices that are marked BROKEN but have no OPEN/IN_REPAIR claim.
 *
 * This is the dead end the feature exists to remove: "Hỏng" with nowhere to put
 * what happens next. A device with only resolved/rejected history still counts
 * — the old repair does not describe the current fault. Non-BROKEN devices are
 * never returned, so the dashboard callout cannot grow into a wall of alerts.
 */
export function brokenDevicesWithoutOpenClaim<
  D extends { id: string; status: string },
  C extends { deviceId: string; status: string },
>(devices: readonly D[], claims: readonly C[]): D[] {
  const covered = new Set(
    claims.filter(claimIsOpen).map((claim) => claim.deviceId),
  );
  return devices.filter(
    (device) => device.status === 'BROKEN' && !covered.has(device.id),
  );
}

// ---- Warranty coverage (tri-state) ----------------------------------------

/**
 * `coveredByWarranty` is tri-state: `true` (the warranty paid / will pay),
 * `false` (explicitly refused) and `null` ("not known yet"), which is NOT the
 * same answer as `false`. The form submits the literals `'true'`/`'false'`/
 * `'unset'`; anything else stays null.
 */
export const CLAIM_COVERAGE_LABELS = {
  covered: 'Có bảo hành',
  notCovered: 'Không được bảo hành',
  unknown: 'Chưa xác định',
} as const;

export type ClaimCoverage = keyof typeof CLAIM_COVERAGE_LABELS;

export function claimCoverageValue(
  value: boolean | null | undefined,
): ClaimCoverage {
  if (value === true) return 'covered';
  if (value === false) return 'notCovered';
  return 'unknown';
}

export function claimCoverageLabel(
  value: boolean | null | undefined,
  locale: Locale,
): string {
  return translate(locale, CLAIM_COVERAGE_LABELS[claimCoverageValue(value)]);
}

/**
 * Parse the tri-state select. Only the two exact literals (or real booleans)
 * produce a boolean; `'unset'`, a blank and a missing key all mean `null`.
 */
export function coveredByWarrantyFromInput(raw: unknown): boolean | null {
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return null;
}

// ---- Money ----------------------------------------------------------------

/**
 * A recorded cost as money, or `null` when nothing was recorded.
 *
 * `null` is not "0 ₫": a free repair (`cost: 0`) must render as a real zero,
 * while an unrecorded cost must render nothing at all. The server accepts a
 * non-negative integer only; this formatter does not clamp — showing a negative
 * the server somehow stored would at least be honest.
 */
export function formatClaimCost(
  cost: number | null | undefined,
  locale: Locale,
): string | null {
  if (cost == null || !Number.isFinite(cost)) return null;
  return formatVND(cost, locale);
}

/** The Vietnamese catalog key for the client's one cost pre-flight failure. */
export const CLAIM_COST_INVALID_MESSAGE = 'Chi phí phải là số nguyên không âm.';

export type ClaimCostParse =
  | { ok: true; cost: number | null }
  | { ok: false; messageKey: string };

/**
 * Parse the form's cost field without duplicating Go's validator.
 *
 * Empty/absent is `null` (not recorded). A non-finite, fractional or negative
 * value is refused BEFORE the request because the form cannot express it
 * correctly — the input strips non-digits — and a tampered payload should not
 * reach Go as `NaN`. Everything else (maximums, business rules) stays Go's.
 */
export function parseClaimCost(raw: unknown): ClaimCostParse {
  if (raw === null || raw === undefined) return { ok: true, cost: null };
  if (typeof raw === 'string' && raw.trim() === '') return { ok: true, cost: null };

  const value =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number(raw.trim())
        : Number.NaN;

  if (!Number.isFinite(value)) {
    return { ok: false, messageKey: CLAIM_COST_INVALID_MESSAGE };
  }
  if (!Number.isInteger(value) || value < 0) {
    return { ok: false, messageKey: CLAIM_COST_INVALID_MESSAGE };
  }
  return { ok: true, cost: value };
}

// ---- The 409 ---------------------------------------------------------------

/**
 * Is this response the one-open-claim-per-device rejection?
 *
 * The contract spells the wire code lowercase (`limit_reached`), but the
 * comparison is case-insensitive on purpose: a server that serialises an enum
 * constant in upper case must not turn the most actionable error in this
 * feature into a generic "limit reached" toast. A 409 with a different code is
 * NOT treated as this error.
 */
export function isClaimLimitReached(res: {
  status: number;
  error?: string | null;
}): boolean {
  return (
    res.status === 409 &&
    typeof res.error === 'string' &&
    res.error.trim().toLowerCase() === 'limit_reached'
  );
}

// ---- Links / anchors -------------------------------------------------------

/** DOM id for one claim row/card; also the 409 link target. */
export function claimAnchorId(claimId: string): string {
  return `claim-${claimId}`;
}

/**
 * Where "the device already has an open claim" points. With a known claim id it
 * jumps straight to that row; without one (the follow-up read failed) it still
 * lands on the claims card rather than on a dead end.
 */
export function openClaimHref(
  deviceId: string,
  claimId?: string | null,
): string {
  return claimId
    ? `/devices/${deviceId}#${claimAnchorId(claimId)}`
    : `/devices/${deviceId}#claims`;
}
