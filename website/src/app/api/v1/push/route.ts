import { requireApiUser } from '@/lib/auth';
import { listMySubscriptions } from '@/lib/services/push';
import { apiOk, apiUnauthorized } from '@/lib/api-response';

export async function GET() {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();
  const subs = await listMySubscriptions(user.id);
  return apiOk({ subscriptions: subs });
}
