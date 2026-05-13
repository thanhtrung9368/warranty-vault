import { requireApiUser } from '@/lib/auth';
import { rateLimitUserWrite } from '@/lib/rate-limit';
import { createWarranty, warrantyInputSchema } from '@/lib/services/warranties';
import { isDomainError, statusForCode } from '@/lib/services/errors';
import {
  apiBadInput,
  apiError,
  apiOk,
  apiRateLimited,
  apiUnauthorized,
} from '@/lib/api-response';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return apiRateLimited(rl.retryAfterSec);

  const { id: deviceId } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiBadInput(undefined, 'Body phải là JSON hợp lệ');
  }
  const parsed = warrantyInputSchema.safeParse(body);
  if (!parsed.success) return apiBadInput(parsed.error.flatten().fieldErrors);

  try {
    const warranty = await createWarranty(user.id, deviceId, parsed.data);
    return apiOk({ warranty }, { status: 201 });
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
