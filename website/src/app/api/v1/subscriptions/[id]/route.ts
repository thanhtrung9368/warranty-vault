import { requireApiUser } from '@/lib/auth';
import { rateLimitUserWrite } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import {
  deleteSubscription,
  updateSubscription,
  subscriptionInputSchema,
} from '@/lib/services/subscriptions';
import { isDomainError, statusForCode } from '@/lib/services/errors';
import {
  apiBadInput,
  apiError,
  apiNotFound,
  apiOk,
  apiRateLimited,
  apiUnauthorized,
} from '@/lib/api-response';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();
  const { id } = await ctx.params;
  const sub = await prisma.subscription.findFirst({
    where: { id, userId: user.id },
    include: { payments: { orderBy: { paidAt: 'desc' } } },
  });
  if (!sub) return apiNotFound('Không tìm thấy gói');
  return apiOk({ subscription: sub });
}

export async function PATCH(req: Request, ctx: Ctx) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return apiRateLimited(rl.retryAfterSec);

  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiBadInput(undefined, 'Body phải là JSON hợp lệ');
  }
  const parsed = subscriptionInputSchema.safeParse(body);
  if (!parsed.success) return apiBadInput(parsed.error.flatten().fieldErrors);

  try {
    const subscription = await updateSubscription(user.id, id, parsed.data);
    return apiOk({ subscription });
  } catch (e) {
    if (isDomainError(e)) {
      return apiError(statusForCode(e.code), e.code.toLowerCase(), {
        message: e.message,
        fieldErrors: e.fieldErrors,
      });
    }
    throw e;
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return apiRateLimited(rl.retryAfterSec);

  const { id } = await ctx.params;
  try {
    await deleteSubscription(user.id, id);
    return apiOk({ ok: true });
  } catch (e) {
    if (isDomainError(e)) {
      return apiError(statusForCode(e.code), e.code.toLowerCase(), { message: e.message });
    }
    throw e;
  }
}
