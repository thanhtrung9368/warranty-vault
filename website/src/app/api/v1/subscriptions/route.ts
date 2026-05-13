import { requireApiUser } from '@/lib/auth';
import { rateLimitUserWrite } from '@/lib/rate-limit';
import {
  createSubscription,
  listSubscriptions,
  subscriptionInputSchema,
} from '@/lib/services/subscriptions';
import { isDomainError, statusForCode } from '@/lib/services/errors';
import {
  apiBadInput,
  apiError,
  apiOk,
  apiRateLimited,
  apiUnauthorized,
} from '@/lib/api-response';

export async function GET() {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();
  const rows = await listSubscriptions(user.id);
  return apiOk({ subscriptions: rows });
}

export async function POST(req: Request) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return apiRateLimited(rl.retryAfterSec);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiBadInput(undefined, 'Body phải là JSON hợp lệ');
  }
  const parsed = subscriptionInputSchema.safeParse(body);
  if (!parsed.success) return apiBadInput(parsed.error.flatten().fieldErrors);

  const fromWishlistId =
    body && typeof body === 'object' && 'fromWishlistId' in body
      ? (body as { fromWishlistId?: unknown }).fromWishlistId
      : null;

  try {
    const subscription = await createSubscription(user.id, parsed.data, {
      fromWishlistId: typeof fromWishlistId === 'string' ? fromWishlistId : null,
    });
    return apiOk({ subscription }, { status: 201 });
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
