import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { rateLimitAuth, formatRetry } from '@/lib/rate-limit';

// Pure service for password-reset request flow. Wrapped by:
//   - Web server action: src/app/actions/password-reset.ts
//   - Mobile REST handler: src/app/api/v1/auth/forgot/route.ts
//
// Behaviour: never leaks whether an email exists. Returns ok=true unless rate
// limited.

export const RESET_TTL_MIN = 30;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type RequestPasswordResetResult =
  | { ok: true }
  | { ok: false; rateLimited: true; retryAfterSec: number; message: string };

export async function requestPasswordResetService(
  rawEmail: string,
): Promise<RequestPasswordResetResult> {
  const email = rawEmail.trim().toLowerCase();

  const rl = await rateLimitAuth('forgot', email);
  if (!rl.ok) {
    return {
      ok: false,
      rateLimited: true,
      retryAfterSec: rl.retryAfterSec,
      message: `Thử quá nhiều lần. Đợi ${formatRetry(rl.retryAfterSec)} rồi thử lại.`,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Don't leak existence — bail out silently with ok=true.
  if (!user) return { ok: true };

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

  return { ok: true };
}
