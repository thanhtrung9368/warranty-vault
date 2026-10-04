'use server';

import { z } from 'zod';
import { api } from '@/lib/api';
import { getI18n } from '@/lib/i18n/server';
import type { Translator } from '@/lib/i18n/catalog';

export type ResetRequestState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
};

// Same shape as `app/actions/auth.ts`: a module-scope zod schema cannot see the
// request's language, so each schema is built inside its action from that
// request's translator. These messages land in the `errors` slot the form
// renders verbatim, alongside Go's own Vietnamese/English fieldErrors.
function requestSchema(t: Translator) {
  return z.object({
    email: z.string().trim().toLowerCase().email(t('Email không hợp lệ')),
  });
}

function resetSchema(t: Translator) {
  return z
    .object({
      token: z.string().min(1),
      newPassword: z.string().min(8, t('Mật khẩu tối thiểu 8 ký tự')).max(200),
      confirmPassword: z.string().min(1),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: t('Xác nhận mật khẩu không khớp'),
      path: ['confirmPassword'],
    });
}

// `requestPasswordReset` posts to Go's `POST /v1/auth/forgot`. The Go
// handler always returns `{ ok: true }` to avoid user enumeration, sending
// the email + creating the `PasswordReset` row internally. It also sends no
// `message` (there is nothing truthful to say about whether the address
// exists), so the success sentence below only ever comes from here.
export async function requestPasswordReset(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const { t } = await getI18n();
  const raw = Object.fromEntries(formData.entries());
  const parsed = requestSchema(t).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const res = await api.auth.forgot(parsed.data.email);
  if (!res.ok) {
    return { ok: false, message: res.message ?? t('Có lỗi xảy ra, thử lại sau') };
  }
  return { ok: true, message: t('Nếu email tồn tại, link đặt lại đã được gửi.') };
}

// Thin proxy over the Go `POST /v1/auth/reset-password` handler. The Go
// service finds the PasswordReset by sha256(token), updates the user's
// password hash, marks every outstanding reset row used, and revokes all
// of the user's Sessions in a single transaction.
export async function resetPassword(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const { t } = await getI18n();
  const raw = Object.fromEntries(formData.entries());
  const parsed = resetSchema(t).safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const res = await api.auth.resetPassword(parsed.data.token, parsed.data.newPassword);
  if (!res.ok) {
    if (res.status === 400 && res.error === 'invalid_reset_token') {
      return {
        ok: false,
        message: res.message ?? t('Link không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.'),
      };
    }
    if (res.status === 429) {
      return { ok: false, message: res.message ?? t('Thao tác quá nhanh, thử lại sau') };
    }
    return {
      ok: false,
      errors: res.fieldErrors,
      message: res.message ?? t('Không đổi được mật khẩu'),
    };
  }
  return { ok: true, message: res.data.message ?? t('Đã đổi mật khẩu. Vào /login để đăng nhập.') };
}
