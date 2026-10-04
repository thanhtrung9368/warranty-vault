// Sign-in, registration, password reset, email change.
//
// Keys are the Vietnamese originals (see `../types.ts`). Every sentence the Go
// auth handlers can produce for this domain already exists in
// `api/internal/i18n/catalog.go` — those English strings are copied verbatim
// here rather than re-phrased, so a validator message and the label next to it
// cannot disagree. `'Đăng nhập'` / `'Đăng ký'` live in `common.ts`; the generic
// `'Email'` label is in `public.ts` (the legal pages need it too).

import { defineMessages } from '../types';

export const auth = defineMessages({
  // ── Auth form (`components/auth-form.tsx`, login + register) ────────────
  'Chào mừng quay lại 👋': 'Welcome back 👋',
  'Đăng nhập để xem thiết bị, gói đăng ký và wishlist của bạn.':
    'Sign in to see your devices, subscriptions and wishlist.',
  'Đăng ký mất 30 giây. Không thẻ tín dụng, không quảng cáo.':
    'Signing up takes 30 seconds. No credit card, no ads.',
  'Tên hiển thị': 'Display name',
  'Để trống cũng được': 'You can leave this blank',
  'Mật khẩu': 'Password',
  'Quên mật khẩu?': 'Forgot your password?',
  'Tối thiểu 8 ký tự': 'At least 8 characters',
  'Tạo tài khoản': 'Create an account',
  'Chưa có tài khoản?': 'No account yet?',
  'Đã có tài khoản?': 'Already have an account?',

  // ── Forgot password (`components/forgot-password-form.tsx`) ─────────────
  'Gửi link đặt lại': 'Send the reset link',
  'Lỡ tay quên mật khẩu hả?': 'Forgot your password?',
  'Nhập email tài khoản, bọn tao gửi link đặt lại trong vài giây.':
    'Enter your account email and we will send a reset link in seconds.',
  // Not in the Go catalog: `POST /auth/forgot` answers a bare `{ok: true}` on
  // purpose (no enumeration signal), so this sentence only ever comes from the
  // web action.
  'Nếu email tồn tại, link đặt lại đã được gửi.':
    'If that email exists, a reset link has been sent.',
  'Quay lại đăng nhập': 'Back to sign in',

  // ── Reset password (`components/reset-password-form.tsx`) ───────────────
  'Đổi mật khẩu': 'Change password',
  'Đặt lại mật khẩu': 'Reset password',
  'Chọn mật khẩu mới mạnh hơn nha — tối thiểu 8 ký tự.':
    'Pick a stronger new password — at least 8 characters.',
  'Mật khẩu mới': 'New password',
  'Xác nhận mật khẩu': 'Confirm password',
  'Nhập lại mật khẩu mới': 'Enter the new password again',
  'Đăng nhập ngay': 'Sign in now',

  // ── Confirm email change (`components/confirm-email-change.tsx`) ────────
  // `'Xác nhận đổi email'` is copied from the Go catalog (it is also the
  // subject line of the mailed link); the button reuses that same sentence, so
  // there is one entry rather than a second phrasing.
  'Đang xác nhận…': 'Confirming…',
  'Xác nhận đổi email': 'Confirm email change',
  // The Vietnamese original lives in `lib/email-change.ts`'s `CONFIRM_EMAIL_COPY`;
  // this is the same sentence, registered here so this screen can render it in
  // the active language without a locale-aware getter for that constant.
  'Link này xác nhận địa chỉ email mới cho tài khoản WarrantyVault của bạn. Bạn có thể mở link trên điện thoại — không cần đăng nhập trước.':
    'This link confirms a new email address for your WarrantyVault account. You can open it on your phone — no need to sign in first.',
  'Đăng nhập bằng email mới': 'Sign in with the new email',

  // ── Dev-only credentials hint (`components/dev-credentials-hint.tsx`) ────
  // "Dev only:" is an English label already; only the sentence after it is
  // Vietnamese. `{email}` / `{password}` are the constants in that file.
  'dùng {email} / {password} để vào nhanh.':
    'use {email} / {password} to sign in quickly.',

  // ── Validation copy (`app/actions/auth.ts`, `password-reset.ts`) ────────
  // These are zod messages, not API responses — but they land in the same
  // `fieldErrors` slot the Go validator writes to, so they must use the Go
  // catalog's wording for the sentences that exist there.
  'Email không hợp lệ': 'Invalid email address',
  'Mật khẩu tối thiểu 8 ký tự': 'Password must be at least 8 characters',
  'Nhập mật khẩu': 'Enter your password',
  'Xác nhận mật khẩu không khớp': 'Password confirmation does not match',
  'Nhập mật khẩu hiện tại': 'Enter your current password',
  'Mật khẩu mới tối thiểu 8 ký tự': 'New password must be at least 8 characters',
  'Nhập mật khẩu để xác nhận': 'Enter your password to confirm',
  'Gõ chính xác "{phrase}" để xác nhận': 'Type "{phrase}" exactly to confirm',

  // ── Server-action result copy (`app/actions/auth.ts`) ───────────────────
  // The Go envelope always carries its own sentence; these are the fallbacks
  // for the paths where it does not (a 401 with an empty message, an absent
  // form field). Same wording as the API where the API has one.
  'Email hoặc mật khẩu không đúng': 'Incorrect email or password',
  'Thiếu tên hiển thị': 'Display name is missing',
  'Đã cập nhật hồ sơ': 'Profile updated',
  'Đã đổi mật khẩu thành công': 'Password changed successfully',
  'Link không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.':
    'This link is invalid or has expired. Request a new one.',
  'Không đổi được mật khẩu': 'Could not change the password',
  'Đã đổi mật khẩu. Vào /login để đăng nhập.':
    'Password changed. Sign in again to continue.',
});
