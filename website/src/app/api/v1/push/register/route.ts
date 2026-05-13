import { requireApiUser } from '@/lib/auth';
import { rateLimitUserWrite } from '@/lib/rate-limit';
import { pushInputSchema, subscribePush } from '@/lib/services/push';
import {
  apiBadInput,
  apiOk,
  apiRateLimited,
  apiUnauthorized,
} from '@/lib/api-response';

// Accepts either web push (endpoint + p256dh + auth) or native push
// (platform: 'apns'|'fcm', token). One unified endpoint for all clients.
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
  const parsed = pushInputSchema.safeParse(body);
  if (!parsed.success) return apiBadInput(parsed.error.flatten().fieldErrors);

  await subscribePush(user.id, parsed.data);
  return apiOk({ ok: true }, { status: 201 });
}
