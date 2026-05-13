'use server';

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { hash } from 'bcrypt-ts';
import { prisma } from '@/lib/prisma';
import { BCRYPT_ROUNDS } from '@/lib/auth';
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

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

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
    // Rate-limited or network error — surface the message but don't reveal
    // whether the email is registered.
    return { ok: false, message: res.message ?? 'Có lỗi xảy ra, thử lại sau' };
  }
  return { ok: true, message: 'Nếu email tồn tại, link đặt lại đã được gửi.' };
}

// TODO(phase-F): Go does not yet expose `POST /v1/auth/reset`. The Go
// `Forgot` handler creates a `PasswordReset` row keyed by sha256(token), so
// the data is interoperable — we just need the consume-side endpoint.
// Until then this keeps using Prisma directly.
export async function resetPassword(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = resetSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const { token, newPassword } = parsed.data;
  const tokenHash = hashToken(token);

  const record = await prisma.passwordReset.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { ok: false, message: 'Link không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.' };
  }

  const passwordHash = await hash(newPassword, BCRYPT_ROUNDS);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    }),
    prisma.passwordReset.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.passwordReset.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: new Date() },
    }),
  ]);

  return { ok: true, message: 'Đã đổi mật khẩu. Vào /login để đăng nhập.' };
}
