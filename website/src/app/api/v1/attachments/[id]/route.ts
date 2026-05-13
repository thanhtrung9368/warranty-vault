import { requireApiUser } from '@/lib/auth';
import { rateLimitUserWrite } from '@/lib/rate-limit';
import { deleteAttachment } from '@/lib/services/attachments';
import { isDomainError, statusForCode } from '@/lib/services/errors';
import {
  apiError,
  apiOk,
  apiRateLimited,
  apiUnauthorized,
} from '@/lib/api-response';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();

  const rl = await rateLimitUserWrite(user.id);
  if (!rl.ok) return apiRateLimited(rl.retryAfterSec);

  const { id } = await ctx.params;
  try {
    await deleteAttachment(user.id, id);
    return apiOk({ ok: true });
  } catch (e) {
    if (isDomainError(e)) {
      return apiError(statusForCode(e.code), e.code.toLowerCase(), { message: e.message });
    }
    throw e;
  }
}
