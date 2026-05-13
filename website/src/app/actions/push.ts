'use server';

// Thin proxy actions over the Go REST client. The Go service owns:
//   - the PushSubscription table,
//   - the per-platform fanout (web push / APNs / FCM),
//   - the test-push helper.

import { api } from '@/lib/api';
import type { PushInput } from '@/lib/api/push';

// Web subscribe — called from the browser via PushSettings client component.
export async function subscribePush(raw: unknown) {
  // The client posts a plain object with endpoint + p256dh + auth. We pass
  // it through; Go validates the shape with its own validator.
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: 'Payload không hợp lệ' };
  }
  const input = { ...(raw as Record<string, unknown>), platform: 'web' } as PushInput;
  const res = await api.push.register(input);
  if (!res.ok) return { ok: false, message: res.message ?? 'Không đăng ký được' };
  return { ok: true };
}

// Unsubscribe by endpoint — used by the in-browser flow which only knows
// the endpoint URL, not the DB id. We list, find by endpoint, then delete
// by id. Cheap (small N per user).
export async function unsubscribePush(endpoint: string) {
  const list = await api.push.list();
  if (!list.ok) return { ok: false };
  const target = list.data.subscriptions.find((s) => s.endpoint === endpoint);
  if (!target) return { ok: true }; // already gone
  const res = await api.push.unregister(target.id);
  if (!res.ok) return { ok: false };
  return { ok: true };
}

// TODO(Phase F): Go does not yet expose a `POST /v1/push/test` endpoint.
// For now we return a friendly message; the previous behaviour exercised
// web-push directly from the website using `web-push` lib + Prisma. Once
// the Go endpoint lands (or the cron handler can be invoked manually),
// this becomes another thin proxy.
export async function sendTestPush() {
  return {
    ok: false,
    message:
      'Test push tạm thời tắt — endpoint /v1/push/test sẽ có ở Phase F. Cron sẽ vẫn gửi thông báo bình thường.',
  };
}

export async function listMySubscriptions() {
  const res = await api.push.list();
  if (!res.ok) return [];
  return res.data.subscriptions;
}
