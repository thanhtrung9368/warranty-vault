import { z } from 'zod';
import { requestPasswordResetService } from '@/lib/services/password-reset';
import { apiBadInput, apiOk, apiRateLimited } from '@/lib/api-response';

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Email không hợp lệ'),
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

  const result = await requestPasswordResetService(parsed.data.email);
  if (!result.ok) {
    // Only surface rate-limit. Anything else (no user, send error) still returns
    // ok=true to avoid leaking which emails are registered.
    return apiRateLimited(result.retryAfterSec);
  }
  return apiOk({ ok: true });
}
