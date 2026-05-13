import { requireApiUser } from '@/lib/auth';
import { rateLimitUserWrite } from '@/lib/rate-limit';
import { prisma } from '@/lib/prisma';
import { createWishlistItem, wishlistInputSchema } from '@/lib/services/wishlist';
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
  const rows = await prisma.wishlistItem.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });
  return apiOk({ items: rows });
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
  const parsed = wishlistInputSchema.safeParse(body);
  if (!parsed.success) return apiBadInput(parsed.error.flatten().fieldErrors);

  try {
    const item = await createWishlistItem(user.id, parsed.data);
    return apiOk({ item }, { status: 201 });
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
