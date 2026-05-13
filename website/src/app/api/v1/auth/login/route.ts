import { z } from 'zod';
import { compare } from 'bcrypt-ts';
import { prisma } from '@/lib/prisma';
import { rateLimitAuth } from '@/lib/rate-limit';
import { issueToken, type Platform } from '@/lib/api-auth';
import { apiBadInput, apiError, apiOk, apiRateLimited } from '@/lib/api-response';

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  password: z.string().min(1, 'Nhập mật khẩu'),
  deviceLabel: z.string().trim().max(80).optional().nullable(),
  platform: z.enum(['ios', 'android', 'web']).optional().nullable(),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiBadInput(undefined, 'Body phải là JSON hợp lệ');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return apiBadInput(parsed.error.flatten().fieldErrors);
  const { email, password, deviceLabel, platform } = parsed.data;

  const rl = await rateLimitAuth('login', email);
  if (!rl.ok) return apiRateLimited(rl.retryAfterSec);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return apiError(401, 'invalid_credentials', { message: 'Email hoặc mật khẩu không đúng' });
  }
  const ok = await compare(password, user.passwordHash);
  if (!ok) {
    return apiError(401, 'invalid_credentials', { message: 'Email hoặc mật khẩu không đúng' });
  }

  const token = await issueToken(user.id, {
    deviceLabel: deviceLabel ?? null,
    platform: (platform as Platform | null) ?? null,
  });

  return apiOk({
    accessToken: token.accessToken,
    expiresAt: token.expiresAt.toISOString(),
    user: { id: user.id, email: user.email, name: user.name },
  });
}
