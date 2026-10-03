// Pure helpers for the non-blocking serial/IMEI advisories (openapi
// `DeviceWarning`, FEATURE_IDEAS #6).
//
// The contract, in one line: **the device was saved**. `warnings` never mean
// "rejected" — they mean "we kept this value, but it looks wrong". Two things
// follow from that, and both are enforced here rather than in the components:
//
//   * the API's own Vietnamese `message` is what gets displayed (it is written
//     per code and per count, e.g. the duplicate warning names how many other
//     devices carry the serial) — we only add a short heading per code;
//   * nothing in this module can turn a warning into an error or drop the value.
//
// It also holds the codec for the short-lived "flash" cookie the device page
// reads after a save (`device-warnings-flash.ts` reads/writes the cookie; the
// encoding lives here so it is unit-testable).

import type { DeviceWarning } from '@/lib/api/devices';

/** Short Vietnamese headings, keyed by the stable `code`. */
export const DEVICE_WARNING_TITLES: Record<string, string> = {
  IMEI_CHECKSUM: 'IMEI có thể sai một chữ số',
  IMEI_LENGTH: 'Độ dài IMEI không chuẩn',
  SERIAL_DUPLICATE: 'Serial đã có ở thiết bị khác',
};

/** Heading for a warning; unknown codes still render, with a generic title. */
export function deviceWarningTitle(code: string | null | undefined): string {
  const c = (code ?? '').trim();
  return DEVICE_WARNING_TITLES[c] ?? 'Cảnh báo số serial/IMEI';
}

/** Vietnamese label for the field a warning points at (currently always serial). */
export function deviceWarningFieldLabel(field: string | null | undefined): string {
  const f = (field ?? '').trim();
  if (f === '' || f === 'serialNumber') return 'Serial / IMEI';
  return f;
}

/** Defensive caps — a hostile or buggy payload must not bloat a cookie/response. */
export const MAX_DEVICE_WARNINGS = 10;
export const MAX_DEVICE_WARNING_MESSAGE_CHARS = 400;

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Coerce whatever the API sent into a clean `DeviceWarning[]`.
 *
 * Always returns an array: `[]` for `undefined`/`null` (so an older server that
 * does not send the field yet renders nothing instead of crashing), and entries
 * without a message are dropped — the message is the thing we display, and the
 * UI deliberately does not invent its own copy.
 */
export function normalizeDeviceWarnings(raw: unknown): DeviceWarning[] {
  if (!Array.isArray(raw)) return [];
  const out: DeviceWarning[] = [];
  for (const item of raw) {
    if (out.length >= MAX_DEVICE_WARNINGS) break;
    if (!item || typeof item !== 'object') continue;
    const w = item as Record<string, unknown>;
    const message = asString(w.message).slice(0, MAX_DEVICE_WARNING_MESSAGE_CHARS);
    if (message === '') continue;
    out.push({
      code: asString(w.code) || 'UNKNOWN',
      field: asString(w.field) || 'serialNumber',
      message,
    });
  }
  return out;
}

/** True when there is at least one advisory to show. */
export function hasDeviceWarnings(warnings: DeviceWarning[] | null | undefined): boolean {
  return (warnings?.length ?? 0) > 0;
}

/** The API messages, verbatim and in order — what a banner or toast renders. */
export function deviceWarningMessages(warnings: DeviceWarning[] | null | undefined): string[] {
  return (warnings ?? []).map((w) => w.message).filter((m) => m !== '');
}

/** One-line summary (headings only) for a toast title or an aria description. */
export function deviceWarningSummary(warnings: DeviceWarning[] | null | undefined): string {
  return (warnings ?? []).map((w) => deviceWarningTitle(w.code)).join(' · ');
}

// ---- flash cookie codec ----------------------------------------------------

/**
 * What travels in the flash cookie: the advisories AND the device they belong to.
 * Carrying the id means the banner can only ever appear on the page of the device
 * that was just saved — a prefetched or later-visited sibling device cannot pick
 * up someone else's warning by accident.
 */
export type DeviceWarningsFlash = {
  deviceId: string;
  warnings: DeviceWarning[];
};

/**
 * Upper bound for the encoded payload. A browser silently drops cookies over
 * ~4KB, and a truncated cookie would be worse than no cookie at all, so an
 * oversized payload is skipped entirely (the save itself already succeeded).
 */
export const MAX_WARNINGS_FLASH_BYTES = 3000;

/** Encode for the post-save flash cookie. Returns `''` when there is nothing to show. */
export function encodeDeviceWarningsFlash(
  flash: DeviceWarningsFlash | null | undefined,
): string {
  const deviceId = (flash?.deviceId ?? '').trim();
  const clean = normalizeDeviceWarnings(flash?.warnings);
  if (deviceId === '' || clean.length === 0) return '';
  // `encodeURIComponent` because the value ends up in a `Set-Cookie` header;
  // Vietnamese characters are multi-byte in the percent-encoding, hence the
  // generous (but finite) cap.
  const value = encodeURIComponent(JSON.stringify({ deviceId, warnings: clean }));
  if (value.length > MAX_WARNINGS_FLASH_BYTES) return '';
  return value;
}

/**
 * Decode a flash cookie value. Garbage (a truncated cookie, an old format, a
 * hand-edited value) decodes to `null` — a banner is never worth an error page.
 */
export function decodeDeviceWarningsFlash(
  raw: string | null | undefined,
): DeviceWarningsFlash | null {
  const value = (raw ?? '').trim();
  if (value === '') return null;
  let json = value;
  try {
    json = decodeURIComponent(value);
  } catch {
    // Not percent-encoded (or truncated mid-sequence): try it as plain JSON.
  }
  try {
    const parsed = JSON.parse(json) as { deviceId?: unknown; warnings?: unknown };
    const deviceId = typeof parsed?.deviceId === 'string' ? parsed.deviceId.trim() : '';
    const warnings = normalizeDeviceWarnings(parsed?.warnings);
    if (deviceId === '' || warnings.length === 0) return null;
    return { deviceId, warnings };
  } catch {
    return null;
  }
}

/** The advisories for one device, or `[]` when the flash is missing/about another device. */
export function warningsForDevice(
  flash: DeviceWarningsFlash | null | undefined,
  deviceId: string,
): DeviceWarning[] {
  const id = (deviceId ?? '').trim();
  if (flash === null || flash === undefined || id === '') return [];
  return flash.deviceId === id ? flash.warnings : [];
}
