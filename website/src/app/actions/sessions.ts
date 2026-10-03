'use server';

// Thin proxy actions over the Go session endpoints. The Go service owns the
// Session table, the ownership check and the idempotency rule; the web only
// parses, forwards, and reacts to `current`.

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import type { SessionSummary } from '@/lib/api/auth';
import { destroyAuthCookie } from '@/lib/auth-cookie';
import { sessionRevokeOutcome, type SessionRevokeOutcome } from '@/lib/sessions';

// Active sessions for the Settings list. `ok: false` when the Go read failed so
// the UI can say "không tải được" instead of rendering an empty list that looks
// like "no other device is signed in".
export async function listMySessions(): Promise<{
  ok: boolean;
  sessions: SessionSummary[];
}> {
  const res = await api.auth.listSessions();
  if (!res.ok) return { ok: false, sessions: [] };
  return { ok: true, sessions: res.data.sessions ?? [] };
}

export type RevokeSessionState = {
  ok: boolean;
  kind?: SessionRevokeOutcome['kind'];
  message: string;
};

// Revoke one session (`DELETE /v1/auth/sessions/{id}`). Revoking the CURRENT
// session is allowed by the API and is exactly what "đăng xuất khỏi thiết bị
// này" means, so it is not treated as an error here: we drop the local cookie
// first, because the bearer in it is dead the moment the call returns and every
// later Go request would 401 (the (app) layout would bounce the user anyway —
// doing it here makes the trip to /login deliberate instead of an error path).
export async function revokeMySession(id: string): Promise<RevokeSessionState> {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return { ok: false, message: 'Thiếu id phiên đăng nhập' };

  const res = await api.auth.revokeSession(trimmed);
  if (!res.ok) {
    return { ok: false, message: res.message ?? 'Không gỡ được phiên đăng nhập' };
  }

  const outcome = sessionRevokeOutcome(res.data);

  if (outcome.kind === 'current') {
    await destroyAuthCookie();
    revalidatePath('/', 'layout');
    return { ok: true, kind: outcome.kind, message: outcome.message };
  }

  // The list is rendered by the (dynamic) Settings RSC; refresh it so the row
  // disappears without a full reload.
  revalidatePath('/settings');
  return { ok: true, kind: outcome.kind, message: outcome.message };
}
