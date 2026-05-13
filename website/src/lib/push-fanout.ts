import { sendPush, type PushPayload } from '@/lib/push';
import { sendApnsPush } from '@/lib/push-apns';
import { sendFcmPush } from '@/lib/push-fcm';

// Single entry point for the cron handler. Picks the right transport based
// on the row's `platform` column and normalizes the result shape.
export type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  platform: string;
  p256dh: string | null;
  auth: string | null;
};

export type PushFanoutResult = { ok: boolean; gone?: boolean; error?: string };

function tokenFromEndpoint(endpoint: string, prefix: string): string | null {
  if (!endpoint.startsWith(prefix)) return null;
  return endpoint.slice(prefix.length);
}

export async function sendToSubscription(
  sub: PushSubscriptionRow,
  payload: PushPayload,
): Promise<PushFanoutResult> {
  switch (sub.platform) {
    case 'web':
      return sendPush(sub, payload);
    case 'apns': {
      const token = tokenFromEndpoint(sub.endpoint, 'apns://');
      if (!token) return { ok: false, error: 'invalid apns endpoint' };
      return sendApnsPush(token, payload);
    }
    case 'fcm': {
      const token = tokenFromEndpoint(sub.endpoint, 'fcm://');
      if (!token) return { ok: false, error: 'invalid fcm endpoint' };
      return sendFcmPush(token, payload);
    }
    default:
      return { ok: false, error: `unknown platform: ${sub.platform}` };
  }
}
