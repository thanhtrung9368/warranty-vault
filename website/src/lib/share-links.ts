// Pure helpers for the handover-certificate share links (FEATURE_IDEAS #2,
// openapi `DeviceShare` / `CreatedDeviceShare` / `GET /api/v1/devices/{id}/shares`).
//
// Three jobs live here, all unit-testable without a backend:
//
//   1. Turning a `sharePath` into the absolute URL a seller can actually send.
//      The server deliberately returns a PATH (`/api/v1/public/shares/<token>`)
//      and never an absolute URL — it does not know which host the caller
//      reached it through. `GO_API_URL` already carries the `/api` prefix, so
//      naively concatenating it to `sharePath` produces `/api/api/v1/...`.
//   2. The lifecycle arithmetic: live vs expired vs revoked, remaining days,
//      the 10-live-link cap, and the Vietnamese copy for each.
//   3. The content contract of the certificate — which fields the buyer sees
//      and which NEVER leave the account. That copy is shown before creating a
//      link, because a seller must know what they are handing over.
//
// Nothing here touches cookies / headers / the network, so it is importable
// from a client component, a server action and a unit test alike.
//
// ── Bilingual ─────────────────────────────────────────────────────────────
//
// Pure module: no React, so no `useT()`. Every sentence-producing helper takes a
// `locale: Locale` and renders through `translate()` (I18N.md). The Vietnamese
// literal is the dictionary KEY and stays byte-for-byte the original.
//
// The exported `SHARE_*` / `CERTIFICATE_*` constants keep their Vietnamese
// values for the same reason: they ARE the source text, and the components wrap
// them in `t(...)` at the point of render. `SHARE_STATUS_LABELS` is looked up
// with `labelOf(...)` instead, since a status is a code, not a sentence.

import { translate } from '@/lib/i18n/catalog';
import { labelOf } from '@/lib/i18n/labels';
import type { Locale } from '@/lib/i18n/locale';

// ---- Wire shape (structural) -------------------------------------------------

// The smallest shape these helpers need. `DeviceShare` from `@/lib/api/shares`
// satisfies it, so callers pass the real type and tests pass literals.
export type ShareLike = {
  id?: string;
  expiresAt: string;
  revokedAt?: string | null;
  includeSerial?: boolean;
  viewCount?: number;
  lastViewedAt?: string | null;
  createdAt?: string;
};

// ---- Bounds (mirror api/internal/services/shares.go) -------------------------

/** `ShareTTLDefault` — applied when the client asks for no specific lifetime. */
export const SHARE_TTL_DEFAULT_DAYS = 30;
/** `ShareTTLMin` — there is no "expires never" value. */
export const SHARE_TTL_MIN_DAYS = 1;
/** `ShareTTLMax`. */
export const SHARE_TTL_MAX_DAYS = 90;
/** `MaxActiveSharesPerDevice` — creating an 11th live link is a 409 from Go. */
export const MAX_ACTIVE_SHARES_PER_DEVICE = 10;

/**
 * Expiry choices offered in the create dialog, all inside [1, 90]. 30 days is
 * the server default and is preselected, so the common case needs no decision.
 *
 * `label` stays Vietnamese (the dictionary key); the dialog renders it through
 * `t(choice.label)`.
 */
export const SHARE_EXPIRY_CHOICES: readonly { days: number; label: string }[] = [
  { days: 7, label: '7 ngày' },
  { days: SHARE_TTL_DEFAULT_DAYS, label: '30 ngày (mặc định)' },
  { days: 90, label: '90 ngày' },
];

/**
 * Coerce whatever a form/action argument carries into a valid `expiresInDays`.
 *
 * Anything unusable falls back to the documented default rather than erroring:
 * the Go server has the real validator (1..90, unknown fields rejected), and an
 * unparseable value here means the client sent nothing meaningful — the same
 * thing as omitting the field.
 */
export function normalizeShareExpiryDays(value: unknown): number {
  const n = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return SHARE_TTL_DEFAULT_DAYS;
  const days = Math.trunc(n);
  if (days < SHARE_TTL_MIN_DAYS || days > SHARE_TTL_MAX_DAYS) {
    return SHARE_TTL_DEFAULT_DAYS;
  }
  return days;
}

// ---- Absolute URL ------------------------------------------------------------

/** The `/api`-prefixed public route Go serves (`services.SharePath`). */
export const PUBLIC_SHARE_PATH_PREFIX = '/api/v1/public/shares/';

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * Build the absolute certificate URL to hand to the buyer.
 *
 * `sharePath` is `/api/v1/public/shares/<token>` (path only, no host). The
 * public page is served by the API itself — it is not a Next.js route — so the
 * caller's API base decides the host:
 *
 *   - `sharePath` is already absolute → returned untouched (a future server may
 *     build one; we must not mangle it).
 *   - `sharePath` starts with `/api/` → the API base with its own trailing
 *     `/api` dropped, plus the path. The path already carries the prefix the
 *     base also carries, which is exactly why plain concatenation is wrong
 *     (`/api/api/v1/...`); any deployment prefix before that `/api` survives.
 *   - anything else (`/v1/...`) → API base + path, adding the `/api` prefix when
 *     the base is missing it (the documented value ends with `/api`, but the
 *     code's fallback does not).
 *   - no usable base at all → the raw path, so the UI can at least show
 *     something honest instead of a broken absolute URL.
 */
export function shareCertificateUrl(apiBaseUrl: string | null | undefined, sharePath: string): string {
  const path = (sharePath ?? '').trim();
  if (path === '') return '';
  if (isAbsoluteUrl(path)) return path;

  const base = (apiBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (base === '' || !isAbsoluteUrl(base)) return path;

  if (path.startsWith('/api/')) {
    // Drop the base's own `/api` suffix (and ONLY that) before appending a path
    // that already carries it. Anything before the suffix is a real deployment
    // prefix (a reverse proxy in front of Go) and has to survive.
    const withoutApi = base.replace(/\/api$/i, '');
    return withoutApi + path;
  }

  const baseHasApiPrefix = /\/api$/i.test(base);
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const needsPrefix = !baseHasApiPrefix && /^\/v1(\/|$)/.test(withSlash);
  return base + (needsPrefix ? '/api' : '') + withSlash;
}

/**
 * The token is the last path segment. Used only to show *that* a credential is
 * in the URL (never to log it); the UI shows the whole URL to the owner, which
 * is the point of the one-time dialog.
 */
export function shareTokenFromPath(sharePath: string): string {
  const path = (sharePath ?? '').trim().replace(/[?#].*$/, '');
  const parts = path.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : '';
}

// ---- Lifecycle ---------------------------------------------------------------

export type ShareStatus = 'live' | 'expired' | 'revoked';

function toTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * `revoked` wins over `expired`: a link the owner killed stays labelled as
 * revoked even after its expiry passes, because that is the action they took
 * (and the API keeps the row, so the list would otherwise silently mutate).
 * An unparseable expiry is treated as expired — the safe direction for a
 * credential. An unparseable `revokedAt` that is non-null still means revoked.
 */
export function shareStatus(share: ShareLike, now: Date = new Date()): ShareStatus {
  if (share.revokedAt != null && String(share.revokedAt).trim() !== '') return 'revoked';
  const expiry = toTime(share.expiresAt);
  if (expiry == null) return 'expired';
  return expiry > now.getTime() ? 'live' : 'expired';
}

export function shareIsLive(share: ShareLike, now: Date = new Date()): boolean {
  return shareStatus(share, now) === 'live';
}

/**
 * Status → Vietnamese label. The map is the SOURCE TEXT (and the dictionary
 * key); `shareStatusLabel` resolves it with `labelOf`, so an unmapped status
 * falls through to the code itself.
 *
 * `live` is `'Đang hoạt động'`, which `messages/subscriptions.ts` already
 * registers as "Active" — same words, same meaning, one entry.
 */
const SHARE_STATUS_LABELS: Record<ShareStatus, string> = {
  live: 'Đang hoạt động',
  expired: 'Đã hết hạn',
  revoked: 'Đã thu hồi',
};

/**
 * The status in words. `locale` sits second — before the injectable `now` — so
 * the component's call is `shareStatusLabel(share, locale)`; a test that pins
 * the clock passes it third.
 */
export function shareStatusLabel(
  share: ShareLike,
  locale: Locale,
  now: Date = new Date(),
): string {
  return labelOf(SHARE_STATUS_LABELS, shareStatus(share, now), locale);
}

/** Badge tone for the status (matches the `Badge` variants in ui/badge.tsx). */
export function shareStatusTone(share: ShareLike, now: Date = new Date()): 'emerald' | 'zinc' | 'rose' {
  const status = shareStatus(share, now);
  if (status === 'live') return 'emerald';
  return status === 'revoked' ? 'rose' : 'zinc';
}

/**
 * Split the API list (newest first, dead rows included) into live links — the
 * ones that count against the 10-link cap — and everything else. Order is
 * preserved inside both groups.
 */
export function splitShares<T extends ShareLike>(
  shares: readonly T[],
  now: Date = new Date(),
): { live: T[]; dead: T[] } {
  const live: T[] = [];
  const dead: T[] = [];
  for (const s of shares) (shareIsLive(s, now) ? live : dead).push(s);
  return { live, dead };
}

/**
 * How many more links this device may create. Go answers a `409` past the cap;
 * the UI disables the button and explains why instead of letting the round-trip
 * fail.
 */
export function shareCapacity(
  shares: readonly ShareLike[],
  now: Date = new Date(),
): { liveCount: number; remaining: number; full: boolean } {
  const liveCount = splitShares(shares, now).live.length;
  const remaining = Math.max(0, MAX_ACTIVE_SHARES_PER_DEVICE - liveCount);
  return { liveCount, remaining, full: remaining === 0 };
}

const DAY_MS = 86_400_000;

/**
 * Countdown for a live link. `null` for a link that is not live (the status
 * badge already says why). Sub-day precision is deliberately avoided: "Còn dưới
 * 1 ngày" is honest, "Còn 0 ngày" is not.
 */
export function shareRemainingLabel(
  share: ShareLike,
  locale: Locale,
  now: Date = new Date(),
): string | null {
  if (!shareIsLive(share, now)) return null;
  const expiry = toTime(share.expiresAt);
  if (expiry == null) return null;
  const left = expiry - now.getTime();
  if (left <= 0) return null;
  if (left < DAY_MS) return translate(locale, 'Còn dưới 1 ngày');
  const days = Math.floor(left / DAY_MS);
  // Reuses `warranties.ts`'s countdown key — one sentence, one English ("{days}
  // days left" / "{days} day left"), whether it counts down a warranty or a link.
  return translate(locale, 'Còn {days} ngày', { days, count: days });
}

/** Whether the owner has ever seen this link opened. */
export function shareViewLabel(
  viewCount: number | null | undefined,
  locale: Locale,
): string {
  const n = typeof viewCount === 'number' && Number.isFinite(viewCount) ? Math.max(0, Math.trunc(viewCount)) : 0;
  if (n === 0) return translate(locale, 'Chưa ai mở');
  return translate(locale, 'Đã mở {count} lần', { count: n });
}

/** What the link exposes about the serial, in the owner's own words. */
export function shareSerialExposureLabel(
  includeSerial: boolean | undefined,
  locale: Locale,
): string {
  return includeSerial
    ? translate(locale, 'Kèm serial/IMEI đầy đủ')
    : translate(locale, 'Chỉ serial che giữa');
}

// ---- Copy: what the certificate is, and what it never contains ----------------
//
// These constants stay Vietnamese: they ARE the source sentences, and the
// component wraps each one in `t(...)`. Keeping them as constants (rather than
// inlining the sentences at each render site) is what lets a test pin the
// wording, and what lets the openapi content contract be compared with the UI.

/**
 * The single sentence the UI must state BEFORE the link exists and again while
 * it is on screen. Pinned here (and asserted by a test) so no screen can
 * quietly soften it: the server stores only a hash, so a lost token is
 * unrecoverable and the only remedy is a new link.
 */
export const SHARE_ONE_TIME_WARNING =
  'Link chỉ hiện MỘT LẦN, ngay sau khi bạn bấm tạo. Máy chủ chỉ lưu mã băm của token nên không ai — kể cả bạn — xem lại được link này. Hãy sao chép và gửi cho người nhận trước khi đóng; nếu lỡ đóng mà chưa sao chép, bạn phải tạo link mới.';

/** Shown when the owner tries to dismiss the dialog without acknowledging. */
export const SHARE_CLOSE_BLOCKED_HINT =
  'Link chưa được lưu. Hãy bấm “Sao chép link”, hoặc tick xác nhận rằng bạn đã lưu, rồi mới đóng.';

/** The confirmation that gates closing the one-time dialog. */
export const SHARE_ACK_LABEL = 'Tôi đã sao chép hoặc lưu link này và hiểu rằng không xem lại được.';

/** Short version used in the section header, before any dialog is opened. */
export const SHARE_SECTION_HINT =
  'Link chia sẻ là phiếu bàn giao cho người mua: mở được không cần đăng nhập, không có giá, ghi chú hay ảnh hoá đơn. Token chỉ hiện một lần lúc tạo.';

/**
 * The cap and the bounds, as a sentence. A template rather than a constant
 * because the numbers are interpolated by `translate` at render time (the
 * Vietnamese `{max}`/`{min}`/`{maxDays}` placeholders are the key).
 */
export const SHARE_LIMIT_NOTE =
  'Tối đa {max} link còn hiệu lực cho mỗi thiết bị. Link luôn có hạn ({min}–{maxDays} ngày) và thu hồi được — không có link vĩnh viễn.';

/** Serial off (default) — what the buyer still gets. */
export const SHARE_SERIAL_OFF_NOTE =
  'Mặc định TẮT: phiếu chỉ hiện serial che giữa (giữ đầu và cuối, che phần giữa) — vẫn đủ để người mua đối chiếu tem trên máy.';

/** Serial on — exactly what turning it on exposes. */
export const SHARE_SERIAL_ON_NOTE =
  'BẬT: phiếu hiện serial/IMEI đầy đủ. Cần khi trung tâm bảo hành tra cứu theo IMEI, nhưng nghĩa là bất kỳ ai có link (kể cả khi bị chuyển tiếp) đều thấy định danh đầy đủ của máy.';

export const SHARE_SERIAL_LABEL = 'Kèm serial/IMEI đầy đủ trong phiếu';

/** What the buyer can read in the certificate. */
export const CERTIFICATE_SHOWS: readonly string[] = [
  'Tên máy, loại, hãng, model',
  'Ngày mua, nơi mua, trạng thái thiết bị (kể cả ngày bán nếu bạn có ghi)',
  'Serial che giữa — hoặc serial đầy đủ nếu bạn bật lựa chọn bên trên',
  'Từng gói bảo hành: loại, nhà bảo hành, thời hạn, địa chỉ/số điện thoại do bạn tự ghi cho gói đó',
  'Ngày hết hạn bảo hành xa nhất và ngày hết hạn của chính link',
];

/** What the certificate NEVER contains — the reason a seller can send it. */
export const CERTIFICATE_NEVER_SHOWN: readonly string[] = [
  'Giá mua, giá bán, lãi/lỗ',
  'Chi phí từng gói bảo hành',
  'Ghi chú của thiết bị và ghi chú của gói bảo hành',
  'Ảnh hoá đơn và mọi file đính kèm',
  'Các thiết bị khác trong tài khoản của bạn',
];

/**
 * Headline for the create dialog's "what am I handing over" block. Kept as a
 * constant so the openapi content contract and the UI copy are easy to compare.
 */
export const CERTIFICATE_PROJECTION_TITLE = 'Người nhận đọc được gì';

export const SHARE_PREVIEW_NOTE =
  'Phiếu do máy chủ API dựng và mở trong tab mới — không cần đăng nhập. Đây cũng là thứ người nhận sẽ thấy, nên hãy mở xem trước khi gửi.';
