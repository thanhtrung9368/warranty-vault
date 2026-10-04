'use server';

// Thin proxy actions over the Go REST client. The Go service owns:
//   - the PushSubscription table,
//   - the per-platform fanout (web push / APNs / FCM),
//   - the test-push helper.

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import type { PushInput, PushSubscriptionMeta } from '@/lib/api/push';
import { getI18n } from '@/lib/i18n/server';

// Web subscribe — called from the browser via PushSettings client component.
export async function subscribePush(raw: unknown) {
  const { t } = await getI18n();
  // The client posts a plain object with endpoint + p256dh + auth. We pass
  // it through; Go validates the shape with its own validator.
  if (!raw || typeof raw !== 'object') {
    return { ok: false, message: t('Payload không hợp lệ') };
  }
  const input = { ...(raw as Record<string, unknown>), platform: 'web' } as PushInput;
  const res = await api.push.register(input);
  if (!res.ok) return { ok: false, message: res.message ?? t('Không đăng ký được') };
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

// Sends a sample notification to every subscription the user has registered.
// Thin proxy over `POST /api/v1/push/test` on the Go service.
export async function sendTestPush() {
  const { t } = await getI18n();
  const res = await api.push.test();
  if (!res.ok) {
    return { ok: false, message: res.message ?? t('Không gửi được thông báo thử') };
  }
  const { sent, failed } = res.data;
  if (sent === 0 && failed === 0) {
    return { ok: true, message: t('Bạn chưa đăng ký thiết bị nào để nhận thông báo') };
  }
  if (failed > 0 && sent === 0) {
    return { ok: false, message: t('Gửi thất bại cho {count} thiết bị', { count: failed }) };
  }
  if (failed > 0) {
    return { ok: true, message: t('Đã gửi {sent} thông báo (lỗi: {failed})', { sent, failed }) };
  }
  return { ok: true, message: t('Đã gửi {count} thông báo thử', { count: sent }) };
}

// Registered devices for the Settings list. `ok: false` when the Go read
// failed so the UI can say "không tải được" instead of rendering an empty
// list that looks like "no devices".
export async function listMySubscriptions(): Promise<{
  ok: boolean;
  subscriptions: PushSubscriptionMeta[];
}> {
  const res = await api.push.list();
  if (!res.ok) return { ok: false, subscriptions: [] };
  return { ok: true, subscriptions: res.data.subscriptions ?? [] };
}

// Remove one registered device by id (`DELETE /v1/push/{id}`). The id comes
// from `listMySubscriptions`; Go checks ownership on delete.
export async function removePushSubscription(id: string) {
  const { t } = await getI18n();
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return { ok: false, message: t('Thiếu id thiết bị') };
  const res = await api.push.unregister(trimmed);
  if (!res.ok) return { ok: false, message: res.message ?? t('Không gỡ được thiết bị') };
  revalidatePath('/settings');
  return { ok: true };
}
