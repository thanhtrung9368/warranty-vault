import { requireApiUser } from '@/lib/auth';
import { rateLimitUserWrite } from '@/lib/rate-limit';
import { createDevice, deviceInputSchema, listDevices } from '@/lib/services/devices';
import { isDomainError, statusForCode } from '@/lib/services/errors';
import {
  apiBadInput,
  apiError,
  apiOk,
  apiRateLimited,
  apiUnauthorized,
} from '@/lib/api-response';

export async function GET(req: Request) {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();

  const url = new URL(req.url);
  const filter = {
    q: url.searchParams.get('q') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    sort: (url.searchParams.get('sort') ?? undefined) as
      | 'purchaseDate'
      | 'warrantyEndDate'
      | 'price'
      | 'name'
      | undefined,
    dir: (url.searchParams.get('dir') ?? undefined) as 'asc' | 'desc' | undefined,
  };

  const rows = await listDevices(user.id, filter);
  return apiOk({ devices: rows });
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
  const parsed = deviceInputSchema.safeParse(body);
  if (!parsed.success) return apiBadInput(parsed.error.flatten().fieldErrors);

  const fromWishlistId =
    body && typeof body === 'object' && 'fromWishlistId' in body
      ? (body as { fromWishlistId?: unknown }).fromWishlistId
      : null;

  try {
    const device = await createDevice(user.id, parsed.data, {
      fromWishlistId: typeof fromWishlistId === 'string' ? fromWishlistId : null,
    });
    return apiOk({ device }, { status: 201 });
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
