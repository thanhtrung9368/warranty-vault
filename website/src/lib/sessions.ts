// Pure helpers for the per-session management surface
// (`GET/DELETE /api/v1/auth/sessions`, openapi `SessionSummary` /
// `SessionRevokeResult`).
//
// Two independent jobs live here, both unit-testable without a backend:
//
//   1. Turning a session row into display copy in the request's language —
//      including the documented `deviceLabel: null` fallback
//      ("Không rõ thiết bị").
//   2. Deriving the `deviceLabel` we SEND at login from the User-Agent, which is
//      the root cause of those nulls: the web login/register actions used to
//      send no label at all, so every web session rendered the fallback.
//
// Nothing in here touches cookies / headers, so it stays importable from a
// client component (the settings list) as well as from a server action.
//
// Display copy is resolved through the dictionary. `locale` is a REQUIRED
// parameter on every label helper — an optional one with a Vietnamese default
// would let a missed call site render Vietnamese inside an English page and
// report nothing.

import { translate } from '@/lib/i18n/catalog';
import { labelOf } from '@/lib/i18n/labels';
import type { Locale } from '@/lib/i18n/locale';

/**
 * The fallback openapi.yaml documents for `SessionSummary.deviceLabel: null`
 * ("`null` với client cũ không gửi nhãn — hiện 'Không rõ thiết bị'").
 *
 * We render this instead of hiding the row: a session with no label is still a
 * live session and the user must be able to revoke it.
 */
export const UNKNOWN_DEVICE_LABEL = 'Không rõ thiết bị';

/** Fallback shown when `platform` is null (or a value we don't know yet). */
export const UNKNOWN_PLATFORM_LABEL = 'Không rõ nền tảng';

/**
 * `Session.platform` is a three-value enum plus null: Go's
 * `normalizePlatform` accepts only `web` / `ios` / `android` and maps everything
 * else to nil (openapi `SessionSummary.platform`). So these three are the only
 * values that can arrive, and `sessionPlatformLabel` still falls back to the raw
 * code for anything unexpected rather than pretending to know it.
 *
 * The map stays Vietnamese on purpose: it is the original text and the catalog
 * key. `labelOf(PLATFORM_LABELS, code, locale)` resolves it.
 *
 * (Not to be confused with `PushSubscription.platform`, which is the
 * `web | apns | fcm` vocabulary of a different entity.)
 */
export const PLATFORM_LABELS: Record<string, string> = {
  web: 'Trình duyệt web',
  ios: 'iPhone / iPad',
  android: 'Android',
};

/** Label for a session's `platform`, in `locale`, never empty. */
export function sessionPlatformLabel(
  platform: string | null | undefined,
  locale: Locale,
): string {
  const v = (platform ?? '').trim();
  if (v === '') return translate(locale, UNKNOWN_PLATFORM_LABEL);
  return labelOf(PLATFORM_LABELS, v, locale);
}

/** Label for a session's `deviceLabel` in `locale`, applying the null fallback. */
export function sessionDeviceLabel(
  deviceLabel: string | null | undefined,
  locale: Locale,
): string {
  const v = (deviceLabel ?? '').trim();
  // A label the user's own client sent ('Chrome · macOS') is not a catalog key
  // and passes through untouched; the documented fallback is.
  return translate(locale, v === '' ? UNKNOWN_DEVICE_LABEL : v);
}

// ---- login-time label ------------------------------------------------------

/**
 * `LoginInput.deviceLabel` cap in openapi.yaml (`maxLength: 80`). Go truncates
 * to 80 BYTES (`ptrIfNotEmptyOrPassthrough`), which can split a multi-byte
 * character, so we truncate on code-point boundaries ourselves and stay well
 * inside the limit instead of letting the server cut mid-character.
 */
export const MAX_DEVICE_LABEL_BYTES = 80;

/** UTF-8 byte length without relying on Node's Buffer (this also runs in the browser). */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Truncate to at most `maxBytes` UTF-8 bytes without splitting a character. */
export function truncateDeviceLabel(
  label: string,
  maxBytes: number = MAX_DEVICE_LABEL_BYTES,
): string {
  let out = '';
  let bytes = 0;
  for (const ch of label) {
    const size = utf8ByteLength(ch);
    if (bytes + size > maxBytes) break;
    out += ch;
    bytes += size;
  }
  return out;
}

/** Shown when the User-Agent carries nothing we can name. */
export const DEFAULT_DEVICE_LABEL = 'Trình duyệt web';

function detectBrowser(ua: string): string {
  // Order matters: Edge and Opera both claim to be Chrome, and Chrome on iOS
  // uses CriOS while Firefox uses FxiOS.
  if (/\bEdg[A-Z]?\//.test(ua)) return 'Edge';
  if (/\bOPR\/|\bOpera[ /]/.test(ua)) return 'Opera';
  if (/\bCriOS\//.test(ua)) return 'Chrome';
  if (/\bChrome\//.test(ua)) return 'Chrome';
  if (/\bFxiOS\//.test(ua)) return 'Firefox';
  if (/\bFirefox\//.test(ua)) return 'Firefox';
  // Safari only identifies itself when it also carries a Version/ token.
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return 'Safari';
  return '';
}

function detectPlatform(ua: string): string {
  if (/\biPhone\b/.test(ua)) return 'iPhone';
  if (/\biPad\b/.test(ua)) return 'iPad';
  if (/\biPod\b/.test(ua)) return 'iPod';
  // Android before Linux: every Android UA also contains "Linux".
  if (/\bAndroid\b/.test(ua)) return 'Android';
  if (/\bWindows\b/.test(ua)) return 'Windows';
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) return 'macOS';
  if (/\bLinux\b/.test(ua)) return 'Linux';
  if (/\bCrOS\b/.test(ua)) return 'ChromeOS';
  return '';
}

/**
 * Sensible `deviceLabel` for a web login, derived from the request's
 * User-Agent. Examples: `Chrome · macOS`, `Safari · iPhone`,
 * `Chrome · Android`, and `Trình duyệt web` when the UA is missing or
 * unrecognisable.
 *
 * The label is PERSISTED on the session row at login time, so it is deliberately
 * NOT translated here: there is no request whose language it belongs to, and the
 * screen that renders it resolves the two constants below through the catalog
 * (`sessionDeviceLabel`), so an English reader still sees "Web browser".
 *
 * The point is not precision — it is that the settings screen can tell two
 * sessions apart instead of showing "Không rõ thiết bị" for all of them (which
 * is what happened while the web sent no label at all).
 */
export function deviceLabelFromUserAgent(userAgent: string | null | undefined): string {
  const ua = (userAgent ?? '').trim();
  if (ua === '') return DEFAULT_DEVICE_LABEL;
  const parts = [detectBrowser(ua), detectPlatform(ua)].filter(Boolean);
  if (parts.length === 0) return DEFAULT_DEVICE_LABEL;
  return truncateDeviceLabel(parts.join(' · '));
}

// ---- revoke outcome --------------------------------------------------------

export type SessionRevokeResult = {
  ok: boolean;
  current: boolean;
  alreadyRevoked: boolean;
  message: string;
};

export type SessionRevokeOutcome =
  // The row we revoked IS the session making the call. The API allows this on
  // purpose (it is what POST /auth/logout does) and flags it with
  // `current: true`; the local bearer is dead, so the caller must drop the
  // cookie and send the user to /login.
  | { kind: 'current'; message: string }
  // Already revoked before this call — an idempotent SUCCESS, not an error.
  | { kind: 'already'; message: string }
  | { kind: 'revoked'; message: string };

/**
 * Map a `DELETE /v1/auth/sessions/{id}` response onto the three outcomes the UI
 * cares about, keeping the API's own `message` whenever it sent one (the Go
 * message is already in the request's language — the call carried `?lang=`).
 *
 * `current` wins over `alreadyRevoked`: that combination should not happen
 * (RequireUser rejects a revoked bearer before the handler runs), but if it ever
 * did, the caller's token is dead and logging out is the only safe reading.
 */
export function sessionRevokeOutcome(
  result: SessionRevokeResult,
  locale: Locale,
): SessionRevokeOutcome {
  const message = (result.message ?? '').trim();
  if (result.current) {
    return {
      kind: 'current',
      message: message || translate(locale, 'Đã thu hồi phiên đăng nhập. Hãy đăng nhập lại.'),
    };
  }
  if (result.alreadyRevoked) {
    return {
      kind: 'already',
      message:
        message || translate(locale, 'Phiên đăng nhập này đã được thu hồi trước đó.'),
    };
  }
  return {
    kind: 'revoked',
    message: message || translate(locale, 'Đã thu hồi phiên đăng nhập.'),
  };
}
