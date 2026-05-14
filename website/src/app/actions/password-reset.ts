'use server';

import { z } from 'zod';
import { api } from '@/lib/api';

export type ResetRequestState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
};

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
});

const resetSchema = z
  .object({
    token: z.string().min(1),
    newPassword: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(200),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Xác nhận mật khẩu không khớp',
    path: ['confirmPassword'],
  });

// `requestPasswordReset` posts to Go's `POST /v1/auth/forgot`. The Go
// handler always returns `{ ok: true }` to avoid user enumeration, sending
// the email + creating the `PasswordReset` row internally.
export async function requestPasswordReset(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const res = await api.auth.forgot(parsed.data.email);
  if (!res.ok) {
    return { ok: false, message: res.message ?? 'Có lỗi xảy ra, thử lại sau' };
  }
  return { ok: true, message: 'Nếu email tồn tại, link đặt lại đã được gửi.' };
}

// Thin proxy over the Go `POST /v1/auth/reset-password` handler. The Go
// service finds the PasswordReset by sha256(token), updates the user's
// password hash, marks every outstanding reset row used, and revokes all
// of the user's Sessions in a single transaction.
export async function resetPassword(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = resetSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const res = await api.auth.resetPassword(parsed.data.token, parsed.data.newPassword);
  if (!res.ok) {
    if (res.status === 400 && res.error === 'invalid_reset_token') {
      return {
        ok: false,
        message: res.message ?? 'Link không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.',
      };
    }
    if (res.status === 429) {
      return { ok: false, message: res.message ?? 'Thao tác quá nhanh, thử lại sau' };
    }
    return {
      ok: false,
      errors: res.fieldErrors,
      message: res.message ?? 'Không đổi được mật khẩu',
    };
  }
  return { ok: true, message: res.data.message ?? 'Đã đổi mật khẩu. Vào /login để đăng nhập.' };
}
