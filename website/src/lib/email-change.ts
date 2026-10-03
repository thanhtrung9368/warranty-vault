// Pure copy + mapping for the two-step email-change flow (roadmap #10):
//
//   step 1  POST /api/v1/auth/change-email          (authenticated, needs the
//           current password) → mails a single-use token to the NEW address
//   step 2  POST /api/v1/auth/confirm-email-change  (UNAUTHENTICATED — the
//           token is the credential) → moves the account to the new address
//
// Kept free of React / server-only imports so it can be unit-tested under
// `src/lib/__tests__/` and reused by the settings form, the confirm page and
// the server actions.
//
// Two honesty rules this module encodes, both taken from the Go handlers
// (`api/internal/handlers/auth.go`) and openapi.yaml:
//
//  1. The request half is DELIBERATELY neutral. "Token sent" and "address
//     already belongs to another account" produce the same 200 and the same
//     message, so there is nothing to interpret: whatever the server said is
//     what the user sees. There is no "this email is taken" branch anywhere.
//
//  2. The confirm half cannot distinguish an expired token from an
//     already-used one — `GetEmailChangeByTokenHash` filters `usedAt` and
//     `expiresAt` in the same query, so both (and an unknown token, and a
//     password-reset token) answer 400 `invalid_email_change_token` with one
//     message. We surface that message verbatim and add a hint that names both
//     possibilities instead of inventing a distinction the server never made.

/** Fallback for the request half, used only when Go sent no `message` at all. */
export const EMAIL_CHANGE_NEUTRAL_FALLBACK =
  'Nếu địa chỉ mới hợp lệ và chưa được dùng cho tài khoản khác, một email xác nhận đã được gửi tới địa chỉ mới. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận.';

/**
 * The server's neutral message, passed through untouched.
 *
 * The contract (openapi.yaml `POST /api/v1/auth/change-email`) is that this
 * string is byte-identical for "a confirmation email was sent" and "that
 * address already has an account", so the only correct thing a client can do
 * with it is display it. A missing/blank message means the transport or the
 * envelope failed — the fallback is the server's own wording, mirrored here so
 * the UI still never says anything the API does not stand behind.
 */
export function emailChangeRequestMessage(serverMessage?: string | null): string {
  const trimmed = typeof serverMessage === 'string' ? serverMessage.trim() : '';
  return trimmed.length > 0 ? trimmed : EMAIL_CHANGE_NEUTRAL_FALLBACK;
}

/**
 * Where to look for the confirmation link. The token only ever goes to the
 * NEW address, and it is single-use with a 30-minute TTL
 * (openapi.yaml: "hết hạn sau 30 phút"), while the old address keeps working
 * until step 2 succeeds — so the hint names the new inbox and both facts.
 */
export function newEmailInboxHint(newEmail: string): string {
  const address = newEmail.trim();
  const where = address.length > 0 ? `hộp thư của ${address}` : 'hộp thư của địa chỉ mới';
  return `Kiểm tra ${where} (cả mục Spam / Quảng cáo) để bấm link xác nhận. Link chỉ dùng được một lần và hết hạn sau 30 phút; email hiện tại vẫn đăng nhập được cho tới khi bạn xác nhận.`;
}

/** Shown after a successful confirm. Sessions are revoked server-side. */
export const EMAIL_CHANGE_SUCCESS_HINT =
  'Vì lý do bảo mật, mọi phiên đăng nhập trên tất cả thiết bị đã bị thu hồi — hãy đăng nhập lại bằng địa chỉ mới.';

export const CONFIRM_EMAIL_COPY = {
  title: 'Xác nhận đổi email',
  intro:
    'Link này xác nhận địa chỉ email mới cho tài khoản WarrantyVault của bạn. Bạn có thể mở link trên điện thoại — không cần đăng nhập trước.',
  button: 'Xác nhận đổi email',
  pending: 'Đang xác nhận…',
} as const;

/** Failure envelope shape shared by `apiFetch` and the server action. */
export type ConfirmEmailChangeFailure = {
  status: number;
  error: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export type ConfirmEmailChangeFailureCopy = {
  /** Short heading for the error block. */
  title: string;
  /** The server's Vietnamese message (fallback only when it sent none). */
  message: string;
  /** Extra guidance: what the failure means and how to get a new link. */
  hint?: string;
};

// Mirrors of the Go strings (api/internal/handlers/auth.go). Used only when the
// response carried no `message` — the live server always sends one.
const FALLBACK_INVALID_TOKEN = 'Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.';
const FALLBACK_EMAIL_IN_USE =
  'Email này đã được dùng cho một tài khoản khác. Yêu cầu đổi sang địa chỉ khác.';
const FALLBACK_RATE_LIMITED = 'Thao tác quá nhanh, thử lại sau ít phút.';
const FALLBACK_GENERIC = 'Không xác nhận được đổi email. Thử lại sau.';
const FALLBACK_NETWORK = 'Mất kết nối tới máy chủ, thử lại sau nhé.';

const HINT_INVALID_TOKEN =
  'Token đổi email chỉ dùng được một lần và hết hạn sau 30 phút, nên token đã dùng, token quá cũ và token sai đều báo giống nhau. Đăng nhập rồi vào Cài đặt → Hồ sơ để yêu cầu link mới.';

const HINT_EMAIL_IN_USE =
  'Địa chỉ này đã thuộc một tài khoản khác trong lúc chờ xác nhận. Đăng nhập rồi vào Cài đặt → Hồ sơ để đổi sang địa chỉ khác.';

const HINT_RATE_LIMITED =
  'Máy chủ giới hạn số lần thử xác nhận trong một khoảng thời gian. Chờ một lát rồi thử lại.';

/**
 * Map a failed confirm call to Vietnamese copy.
 *
 * Codes the Go handler actually produces for this endpoint:
 *   - 400 `invalid_email_change_token` — unknown, expired, already used, or a
 *     password-reset token (the two kinds are kept disjoint by `pendingEmail`).
 *   - 400 `email_in_use` — someone registered the new address meanwhile.
 *   - 400 `bad_input` + `fieldErrors.token` — missing token.
 *   - 429 rate limited, 500 `internal_error`.
 * Anything else (including `status: 0` from a transport failure) falls back to
 * a generic message, still preferring whatever the server said.
 */
export function describeConfirmEmailChangeFailure(
  failure: ConfirmEmailChangeFailure,
): ConfirmEmailChangeFailureCopy {
  const serverMessage = typeof failure.message === 'string' ? failure.message.trim() : '';
  const withServer = (fallback: string) => (serverMessage.length > 0 ? serverMessage : fallback);

  if (failure.error === 'invalid_email_change_token') {
    return {
      title: 'Link không dùng được',
      message: withServer(FALLBACK_INVALID_TOKEN),
      hint: HINT_INVALID_TOKEN,
    };
  }
  if (failure.error === 'email_in_use') {
    return {
      title: 'Email đã có người dùng',
      message: withServer(FALLBACK_EMAIL_IN_USE),
      hint: HINT_EMAIL_IN_USE,
    };
  }
  if (failure.status === 429) {
    return {
      title: 'Thử lại sau',
      message: withServer(FALLBACK_RATE_LIMITED),
      hint: HINT_RATE_LIMITED,
    };
  }
  if (failure.status === 400) {
    // Missing token is the only other 400 this endpoint returns; the server's
    // "Thiếu token" (fieldErrors.token) is preferred when present.
    const fieldMessage = failure.fieldErrors?.token?.[0]?.trim();
    return {
      title: 'Thiếu token xác nhận',
      message: fieldMessage && fieldMessage.length > 0 ? fieldMessage : withServer(FALLBACK_GENERIC),
      hint: 'Mở lại link đầy đủ trong email xác nhận, hoặc yêu cầu link mới trong Cài đặt → Hồ sơ.',
    };
  }
  if (failure.status === 0 || failure.error === 'network_error') {
    return { title: 'Mất kết nối', message: withServer(FALLBACK_NETWORK) };
  }
  return { title: 'Không xác nhận được', message: withServer(FALLBACK_GENERIC) };
}
