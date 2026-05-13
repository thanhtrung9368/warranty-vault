import { requireApiUser } from '@/lib/auth';
import { apiOk, apiUnauthorized } from '@/lib/api-response';

export async function GET() {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();
  return apiOk({ user });
}
