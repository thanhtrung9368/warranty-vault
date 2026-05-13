import { headers } from 'next/headers';
import { revokeToken } from '@/lib/api-auth';
import { apiOk, apiUnauthorized } from '@/lib/api-response';

export async function POST() {
  const h = await headers();
  const auth = h.get('authorization') ?? h.get('Authorization');
  if (!auth) return apiUnauthorized();
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return apiUnauthorized();
  const raw = m[1].trim();
  if (!raw) return apiUnauthorized();

  // Idempotent: returns true if a session was revoked, false if the token
  // was already invalid. Either way, the client should drop it locally.
  await revokeToken(raw);
  return apiOk({ ok: true });
}
