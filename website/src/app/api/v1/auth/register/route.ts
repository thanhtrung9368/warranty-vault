import { z } from 'zod';
import { hash } from 'bcrypt-ts';
import { prisma } from '@/lib/prisma';
import { BCRYPT_ROUNDS } from '@/lib/auth';
import { rateLimitAuth } from '@/lib/rate-limit';
import { issueToken, type Platform } from '@/lib/api-auth';
import { apiBadInput, apiOk, apiRateLimited } from '@/lib/api-response';

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  name: z.string().trim().max(80).optional().nullable(),
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(200),
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
  const { email, name, password, deviceLabel, platform } = parsed.data;

  const rl = await rateLimitAuth('register', email);
  if (!rl.ok) return apiRateLimited(rl.retryAfterSec);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Burn equivalent hash time so response latency does not leak existence.
    await hash(password, BCRYPT_ROUNDS);
    return apiOk({
      ok: true,
      message:
        'Nếu email chưa đăng ký, tài khoản đã được tạo. Nếu đã có, vào đăng nhập hoặc quên mật khẩu.',
    });
  }

  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { email, name: name || null, passwordHash },
    select: { id: true, email: true, name: true },
  });

  const token = await issueToken(user.id, {
    deviceLabel: deviceLabel ?? null,
    platform: (platform as Platform | null) ?? null,
  });

  return apiOk(
    {
      accessToken: token.accessToken,
      expiresAt: token.expiresAt.toISOString(),
      user,
    },
    { status: 201 },
  );
}
