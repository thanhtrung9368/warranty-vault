import webpush from 'web-push';

let configured = false;

function configure() {
  if (configured) return;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com';
  if (!publicKey || !privateKey) {
    throw new Error(
      'VAPID keys chưa được set. Tạo bằng: npx web-push generate-vapid-keys',
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function sendPush(
  subscription: {
    endpoint: string;
    p256dh: string | null;
    auth: string | null;
    platform?: string | null;
  },
  payload: PushPayload,
): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  // Native (APNs/FCM) subs don't have web crypto keys — they should be
  // dispatched via the multi-platform fanout in Phase 0.5. For now, skip.
  if (!subscription.p256dh || !subscription.auth) {
    return { ok: false, error: 'non-web subscription' };
  }
  configure();
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
    );
    return { ok: true };
  } catch (e: unknown) {
    const err = e as { statusCode?: number; body?: string };
    // 404/410 = subscription expired or unsubscribed → caller should delete it
    if (err.statusCode === 404 || err.statusCode === 410) {
      return { ok: false, gone: true, error: err.body ?? 'gone' };
    }
    return { ok: false, error: err.body ?? String(e) };
  }
}
