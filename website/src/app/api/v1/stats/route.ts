import { requireApiUser } from '@/lib/auth';
import { getUserStats } from '@/lib/services/stats';
import { apiOk, apiUnauthorized } from '@/lib/api-response';

export async function GET() {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();
  const stats = await getUserStats(user.id);
  return apiOk(stats);
}
