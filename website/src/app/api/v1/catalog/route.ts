import { requireApiUser } from '@/lib/auth';
import { getDeviceFormCatalog } from '@/lib/services/catalog';
import { apiOk, apiUnauthorized } from '@/lib/api-response';

export async function GET() {
  const user = await requireApiUser();
  if (!user) return apiUnauthorized();
  const data = await getDeviceFormCatalog();
  return apiOk(data);
}
