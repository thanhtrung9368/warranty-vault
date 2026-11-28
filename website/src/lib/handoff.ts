// Pure helpers for the 2.0 resale handoff ("chuyển chủ").
//
// Three jobs, all unit-testable without a backend:
//
//   1. the code/link arithmetic: what a 6-character code looks like, how to
//      normalise whatever arrived in the URL, and where the public claim page
//      lives (the server returns `claimPath`, but an old link or a hand-typed
//      code still has to be accepted);
//   2. the lifecycle: PENDING / CLAIMED / EXPIRED / CANCELLED, the 14-day
//      window, the 30-day per-device cooldown (`nextAllowedAt` from the server)
//      and the unique seller/buyer badges driven by the Device's
//      `handoffSentAt` / `handoffReceivedAt` / `handoffSellerName`;
//   3. the content contract, as copy: exactly what travels and what NEVER
//      travels. A seller has to be able to read that before minting a code, and
//      the same sentences are what the public page promises the buyer.
//
// Nothing here touches cookies / headers / the network, so it imports from both
// client components and server components. `translate(locale, …)` is used for
// every sentence and each literal is registered in `messages/handoff.ts`.

import { formatDate, formatNumber } from '@/lib/format';
import { HANDOFF_FAILURE_BODIES, HANDOFF_FAILURE_TITLES, type HandoffFailureReason } from './handoff-failure';
import { translate } from '@/lib/i18n/catalog';
import { labelOf } from '@/lib/i18n/labels';
import type { Locale } from '@/lib/i18n/locale';
import type { Handoff, HandoffStatus, PublicHandoff } from '@/lib/api/handoff';

// ── Bounds (mirror the server) ────────────────────────────────────────────

/** The code a buyer types or opens in a link. Uppercase alphanumeric. */
export const HANDOFF_CODE_LENGTH = 6;
/** `HandoffTTL` — a code dies 14 days after it was minted. */
export const HANDOFF_TTL_DAYS = 14;
/** `HandoffCooldown` — one code per device per 30 days. */
export const HANDOFF_COOLDOWN_DAYS = 30;

const DAY_MS = 86_400_000;

// ── Code / link ───────────────────────────────────────────────────────────

/**
 * Normalise a code from a URL segment, a pasted link or a human reading it
 * aloud: trim, uppercase, drop spaces and hyphens. `null` means "this can never
 * be a code", so the page can render the honest not-found state without a round
 * trip.
 *
 * The alphabet is deliberately `[A-Z0-9]`, not a narrower base32 set: the server
 * owns the alphabet, and rejecting a genuinely valid code here would be a bug
 * no server fix could reach.
 */
export function normalizeHandoffCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== HANDOFF_CODE_LENGTH) return null;
  return /^[A-Z0-9]+$/.test(code) ? code : null;
}

/** The public page path for a code (`claimPath` has the same shape). */
export function handoffPath(code: string): string {
  return `/handoff/${encodeURIComponent(code)}`;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

type HandoffLike = Pick<Handoff, 'status' | 'expiresAt' | 'createdAt'>;

/**
 * The state the UI should render.
 *
 * A PENDING row whose expiry has passed is EXPIRED even if the server has not
 * swept it yet: the buyer must never be shown a claim button for a dead code.
 * CLAIMED and CANCELLED are terminal and win over the clock. An unparseable
 * expiry is treated as expired — the safe direction for a credential.
 */
export function effectiveHandoffStatus(
  handoff: HandoffLike | null | undefined,
  now: Date = new Date(),
): HandoffStatus {
  if (!handoff) return 'EXPIRED';
  if (handoff.status === 'CLAIMED' || handoff.status === 'CANCELLED') {
    return handoff.status;
  }
  if (handoff.status !== 'PENDING') return 'EXPIRED';
  const expiry = Date.parse(handoff.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) return 'EXPIRED';
  return 'PENDING';
}

export function handoffIsLive(
  handoff: HandoffLike | null | undefined,
  now: Date = new Date(),
): boolean {
  return effectiveHandoffStatus(handoff, now) === 'PENDING';
}

/**
 * Whether the PUBLIC preview may offer a claim button.
 *
 * The server answers a uniform 404 for every non-PENDING state, but a clock
 * check is still needed: a page cached or rendered a moment before expiry must
 * not keep showing a button the POST would refuse. Anything other than PENDING
 * plus a future expiry is "not claimable", and the page renders the one honest
 * "no longer valid" state — it must never name expired/claimed/cancelled.
 */
export function publicHandoffIsOpen(
  handoff: Pick<PublicHandoff, 'status' | 'expiresAt'> | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!handoff || handoff.status !== 'PENDING') return false;
  const expiry = Date.parse(handoff.expiresAt);
  return Number.isFinite(expiry) && expiry > now.getTime();
}

/**
 * Status → Vietnamese label. The map is the SOURCE TEXT (and the dictionary
 * key); `handoffStatusLabel` resolves it with `labelOf`, so an unknown status
 * falls through to the code itself.
 */
const HANDOFF_STATUS_LABELS: Record<HandoffStatus, string> = {
  PENDING: 'Đang chờ người nhận',
  CLAIMED: 'Đã có người nhận',
  EXPIRED: 'Đã hết hạn',
  CANCELLED: 'Đã huỷ mã',
};

export function handoffStatusLabel(
  status: HandoffStatus,
  locale: Locale,
): string {
  return labelOf(HANDOFF_STATUS_LABELS, status, locale);
}

/** Badge tone for the status (matches the `Badge` variants in ui/badge.tsx). */
export function handoffStatusTone(
  status: HandoffStatus,
): 'emerald' | 'amber' | 'zinc' | 'rose' {
  switch (status) {
    case 'PENDING':
      return 'amber';
    case 'CLAIMED':
      return 'emerald';
    case 'CANCELLED':
      return 'rose';
    default:
      return 'zinc';
  }
}

/** `Hết hạn {date}` — shared key with the share-link rows. */
export function handoffExpiryLabel(expiresAt: string, locale: Locale): string {
  return translate(locale, 'Hết hạn {date}', {
    date: formatDate(expiresAt, locale),
  });
}

/**
 * Countdown for a live code. `null` when it is not live (the status badge
 * already says why). Sub-day precision is deliberately avoided: "Còn dưới 1
 * ngày" is honest, "Còn 0 ngày" is not.
 */
export function handoffRemainingLabel(
  expiresAt: string,
  locale: Locale,
  now: Date = new Date(),
): string | null {
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return null;
  const left = expiry - now.getTime();
  if (left <= 0) return null;
  if (left < DAY_MS) return translate(locale, 'Còn dưới 1 ngày');
  const days = Math.floor(left / DAY_MS);
  return translate(locale, 'Còn {days} ngày', { days, count: days });
}

/**
 * The 30-day cooldown between two codes for one device, as the server stated it
 * (`nextAllowedAt`). `null` means a code can be minted now.
 *
 * This is only a pre-check so the button is not offered for a round trip that
 * is guaranteed to fail; the server remains the authority. `nextAllowedAt` in
 * the past is the same as no cooldown.
 */
export function handoffCooldown(
  nextAllowedAt: string | null | undefined,
  now: Date = new Date(),
): { availableAt: Date; days: number } | null {
  if (!nextAllowedAt) return null;
  const at = Date.parse(nextAllowedAt);
  if (!Number.isFinite(at)) return null;
  const left = at - now.getTime();
  if (left <= 0) return null;
  return {
    availableAt: new Date(at),
    days: Math.max(1, Math.ceil(left / DAY_MS)),
  };
}

// ── Device badges (buyer tag + seller "đã chuyển" mark) ───────────────────

type HandoffDeviceFields = {
  handoffSentAt?: string | null;
  handoffReceivedAt?: string | null;
  handoffSellerName?: string | null;
};

/**
 * The tag shown on a device detail page.
 *
 * `received` is the buyer's row: "Chuyển từ người bán <date>" (plus the name
 * when the seller typed one). `sent` is the seller's: "Đã chuyển ngày <date>".
 * The buyer tag is checked first — a device that was received can itself be
 * sold later, and the row the user is looking at should describe how THEY got
 * it, while the sale record is already the SOLD card's job.
 */
export function handoffDeviceTag(
  device: HandoffDeviceFields,
  locale: Locale,
): { kind: 'received' | 'sent'; label: string } | null {
  const name = device.handoffSellerName?.trim() ?? '';
  if (device.handoffReceivedAt) {
    const date = formatDate(device.handoffReceivedAt, locale);
    return {
      kind: 'received',
      label: name
        ? translate(locale, 'Chuyển từ người bán {name} ngày {date}', { name, date })
        : translate(locale, 'Chuyển từ người bán ngày {date}', { date }),
    };
  }
  if (device.handoffSentAt) {
    return {
      kind: 'sent',
      label: translate(locale, 'Đã chuyển ngày {date}', {
        date: formatDate(device.handoffSentAt, locale),
      }),
    };
  }
  return null;
}

// ── Byte size (the preview lists documents, not downloads) ───────────────

export function handoffFileSizeLabel(
  bytes: number | null | undefined,
  locale: Locale,
): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  if (bytes >= 1024 * 1024) {
    const mb = Math.round((bytes / (1024 * 1024)) * 10) / 10;
    return `${formatNumber(mb, locale)} MB`;
  }
  return `${formatNumber(Math.max(1, Math.round(bytes / 1024)), locale)} KB`;
}

// ── Content contract: what travels, and what never does ──────────────────

/**
 * The sentences are constants (not inlined at each render site) so the dialog,
 * the public page and any future native client can be compared against the
 * same list. They stay Vietnamese: that IS the catalog key, and each call site
 * wraps it in `t(...)`.
 */
export const HANDOFF_TRAVELS: readonly string[] = [
  'Tên máy, loại, hãng và model',
  'Ngày mua và nơi mua',
  'Serial/IMEI — chỉ phần đã che, không phải số đầy đủ',
  'Các gói bảo hành còn lại: loại, nhà bảo hành, thời hạn',
  'Tài liệu bạn chọn gửi kèm',
  'Tình trạng máy và lịch sử sửa chữa đã ghi',
];

export const HANDOFF_NEVER_TRAVELS: readonly string[] = [
  'Giá mua, giá bán, lãi/lỗ',
  'Ghi chú riêng của bạn',
  'Tài liệu bạn không chọn',
  'Các thiết bị khác, gói đăng ký và wishlist trong tài khoản',
  'Email, mật khẩu, phiên đăng nhập và thông tin thanh toán',
];

/** The one sentence every surface must state: data, not a legal document. */
export const HANDOFF_IS_DATA_ONLY =
  'Warrly chỉ chuyển dữ liệu, không phải giấy tờ pháp lý và không xác nhận quyền sở hữu.';

/** The other half: this feature moves no money. */
export const HANDOFF_NO_PAYMENT =
  'Không có thanh toán, đặt cọc hay trung gian. Warrly không giữ tiền và không bán thiết bị.';

export const HANDOFF_ONE_TIME_NOTE =
  'Mã chỉ dùng một lần và hết hạn sau {days} ngày.';

export const HANDOFF_COOLDOWN_NOTE =
  'Mỗi thiết bị chỉ tạo được một mã trong {days} ngày.';

export const HANDOFF_UNCLAIMED_NOTE =
  'Nếu không ai nhận, mã hết hạn và dữ liệu vẫn nằm nguyên trong tài khoản bạn.';

/**
 * The one-time reveal, pinned as a constant for the same reason the share-link
 * warning is: the server stores only the code hash, so a lost code cannot be
 * shown again and the only remedy is waiting out the cooldown.
 */
export const HANDOFF_CODE_ONE_TIME =
  'Mã chỉ hiện một lần, ngay sau khi bạn bấm tạo. Máy chủ chỉ lưu mã băm nên không ai — kể cả bạn — xem lại được. Hãy sao chép hoặc chia sẻ trước khi đóng.';

export const HANDOFF_ACK_LABEL =
  'Tôi đã sao chép hoặc lưu mã và link này và hiểu rằng không xem lại được.';

export const HANDOFF_CLOSE_BLOCKED_HINT =
  'Mã chưa được lưu. Hãy sao chép hoặc chia sẻ, hoặc tick xác nhận, rồi mới đóng.';

/**
 * The public page's disclaimer. Deliberately says the seller supplied the facts
 * — the app moves a record, it does not inspect a device.
 */
export const HANDOFF_PUBLIC_NOT_VERIFIED =
  'Thông tin do người bán gửi. Warrly không kiểm tra tình trạng máy hay giấy tờ, và lời mời này không có giá, ghi chú riêng hay thông tin thanh toán.';

// ── Failure copy ──────────────────────────────────────────────────────────

// The failure codes and their copy live in `handoff-failure.ts` so the public
// claim page can import them without pulling this module (and the full catalog)
// into its client bundle. Re-exported here so the existing server imports keep
// working.
export type { HandoffFailureReason } from './handoff-failure';

export function handoffFailureTitle(
  reason: HandoffFailureReason,
  locale: Locale,
): string {
  return translate(locale, HANDOFF_FAILURE_TITLES[reason]);
}

export function handoffFailureBody(
  reason: HandoffFailureReason,
  locale: Locale,
): string {
  return translate(locale, HANDOFF_FAILURE_BODIES[reason]);
}

/**
 * HTTP status → failure code. 200 is not handled here (it is success, including
 * the same buyer retrying). 404 is the uniform "not claimable any more" answer;
 * 409 means a DIFFERENT buyer won the race; 403 is the seller's own code.
 */
export function handoffFailureReason(status: number): HandoffFailureReason {
  switch (status) {
    case 401:
      return 'auth';
    case 403:
      return 'forbidden';
    case 404:
      return 'unavailable';
    case 409:
      return 'claimed';
    case 410:
      return 'expired';
    case 429:
      return 'rate_limited';
    default:
      return 'error';
  }
}
