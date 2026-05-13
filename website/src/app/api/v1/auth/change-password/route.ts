import { NextRequest } from 'next/server';
import { z } from 'zod';
import { hash, compare } from 'bcrypt-ts';
import { prisma } from '@/lib/prisma';
import { requireApiUser, BCRYPT_ROUNDS } from '@/lib/auth';
import { rateLimitAuth } from '@/lib/rate-limit';
import {
  apiOk,
  apiUnauthorized,
  apiBadInput,
  apiRateLimited,
  apiError,
} from '@/lib/api-response';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
    newPassword: z.string().min(8, 'Mật khẩu mới tối thiểu 8 ký tự').max(200),
    confirmPassword: z.string().min(1),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Xác nhận mật khẩu không khớp',
    path: ['confirmPassword'],
  });

export async function POST(req: NextRequest) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();

  const rl = await rateLimitAuth('change-password', user.id);
  if (!rl.ok) return apiRateLimited(rl.retryAfterSec);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiBadInput(parsed.error.flatten().fieldErrors);
  }
  const { currentPassword, newPassword } = parsed.data;

  const row = await prisma.user.findUnique({ where: { id: user.id } });
  if (!row) return apiError(404, 'user_not_found');

  const ok = await compare(currentPassword, row.passwordHash);
  if (!ok) {
    return apiBadInput({ currentPassword: ['Mật khẩu hiện tại không đúng'] });
  }

  const passwordHash = await hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordChangedAt: new Date() },
  });

  return apiOk({ ok: true, message: 'Đã đổi mật khẩu thành công' });
}
