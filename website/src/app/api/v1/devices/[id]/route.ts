import { requireApiUser } from '@/lib/auth';
import { rateLimitUserWrite } from '@/lib/rate-limit';
import { getDevice } from '@/lib/devices';
import {
  deleteDevice,
  updateDevice,
  deviceInputSchema,
} from '@/lib/services/devices';
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
  const device = await getDevice(user.id, id);
  if (!device) return apiNotFound('Không tìm thấy thiết bị');
  return apiOk({ device });
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
  const parsed = deviceInputSchema.safeParse(body);
  if (!parsed.success) return apiBadInput(parsed.error.flatten().fieldErrors);

  try {
    const device = await updateDevice(user.id, id, parsed.data);
    return apiOk({ device });
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
    await deleteDevice(user.id, id);
    return apiOk({ ok: true });
  } catch (e) {
    if (isDomainError(e)) {
      return apiError(statusForCode(e.code), e.code.toLowerCase(), { message: e.message });
    }
    throw e;
  }
}
