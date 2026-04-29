'use server';

import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hash } from 'bcrypt-ts';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { BCRYPT_ROUNDS } from '@/lib/auth';
import { rateLimitAuth, formatRetry } from '@/lib/rate-limit';

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

const RESET_TTL_MIN = 30;

export async function requestPasswordReset(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }
  const email = parsed.data.email;

  const rl = await rateLimitAuth('login', email); // reuse login bucket — same threat model
  if (!rl.ok) {
    return {
      ok: false,
      message: `Thử quá nhiều lần. Đợi ${formatRetry(rl.retryAfterSec)} rồi thử lại.`,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Always return success to prevent user enumeration
  if (!user) {
    return { ok: true, message: 'Nếu email tồn tại, link đặt lại đã được gửi.' };
  }

  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TTL_MIN * 60 * 1000);

  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  const link = `${appUrl}/reset/${token}`;

  await sendEmail({
    to: user.email,
    subject: 'Đặt lại mật khẩu AssetVault',
    text:
      `Chào ${user.name || user.email},\n\n` +
      `Có yêu cầu đặt lại mật khẩu cho tài khoản này.\n\n` +
      `Bấm link dưới (hiệu lực ${RESET_TTL_MIN} phút):\n${link}\n\n` +
      `Nếu không phải bạn, bỏ qua email này.`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; margin: auto; padding: 24px;">
        <h2 style="color:#1e40af;">Đặt lại mật khẩu</h2>
        <p>Chào <strong>${user.name || user.email}</strong>,</p>
        <p>Có yêu cầu đặt lại mật khẩu cho tài khoản AssetVault này.</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="display:inline-block;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">
            Đặt lại mật khẩu
          </a>
        </p>
        <p style="color:#666;font-size:13px;">Link có hiệu lực trong ${RESET_TTL_MIN} phút. Nếu không phải bạn, bỏ qua email này.</p>
      </div>
    `,
  });

  return { ok: true, message: 'Nếu email tồn tại, link đặt lại đã được gửi.' };
}

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
    // invalidate any other outstanding resets for safety
    prisma.passwordReset.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: new Date() },
    }),
  ]);

  return { ok: true, message: 'Đã đổi mật khẩu. Vào /login để đăng nhập.' };
}
