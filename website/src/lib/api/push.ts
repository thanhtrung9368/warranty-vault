// Typed client for /v1/push on the Go service.
//
// The same `register` endpoint accepts both web (W3C Push API) and native
// (APNs / FCM) payloads — discriminated by `platform`.

import { apiFetch, type ApiResult } from './client';

export type PushSubscriptionMeta = {
  id: string;
  endpoint: string;
  platform: 'web' | 'apns' | 'fcm';
  userAgent: string | null;
  createdAt: string;
};

export type WebPushInput = {
  platform?: 'web';
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
};

export type NativePushInput = {
  platform: 'apns' | 'fcm';
  token: string;
  userAgent?: string | null;
};

export type PushInput = WebPushInput | NativePushInput;

export async function list(): Promise<ApiResult<{ subscriptions: PushSubscriptionMeta[] }>> {
  return apiFetch<{ subscriptions: PushSubscriptionMeta[] }>('GET', '/v1/push');
}

export async function register(input: PushInput): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>('POST', '/v1/push/register', input);
}

export async function unregister(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>('DELETE', `/v1/push/${encodeURIComponent(id)}`);
}
