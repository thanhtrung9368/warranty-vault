// Typed client for /v1/subscriptions on the Go service.
//
// Mirrors the OpenAPI shapes (`Subscription`, `SubscriptionInput`, `Payment`).
// Date fields come back as ISO strings — callers that render dates should
// `new Date(...)` at the boundary.

import { apiFetch, type ApiResult } from './client';

export type Subscription = {
  id: string;
  userId?: string;
  name: string;
  category: string | null;
  brand: string | null;
  plan: string | null;
  billingCycle: 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'LIFETIME' | 'CUSTOM';
  intervalDays: number | null;
  price: number;
  currency: string;
  startedAt: string;
  renewalDate: string;
  autoRenew: boolean;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELED' | 'EXPIRED';
  accountEmail: string | null;
  paymentMethod: string | null;
  manageUrl: string | null;
  cancelUrl: string | null;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type Payment = {
  id: string;
  subscriptionId: string;
  amount: number;
  paidAt: string;
  note: string | null;
};

export type SubscriptionDetail = Subscription & {
  payments: Payment[];
};

export type SubscriptionInput = {
  name: string;
  category?: string | null;
  brand?: string | null;
  plan?: string | null;
  billingCycle: Subscription['billingCycle'];
  intervalDays?: number | null;
  price: number;
  startedAt: string;
  renewalDate?: string | null;
  autoRenew: boolean;
  status?: Subscription['status'];
  accountEmail?: string | null;
  paymentMethod?: string | null;
  manageUrl?: string | null;
  cancelUrl?: string | null;
  notes?: string | null;
  // Web-only convenience: when set, Go will mark the matching wishlist item
  // as PURCHASED in the same transaction.
  fromWishlistId?: string | null;
};

export type PaymentInput = {
  amount: number;
  paidAt: string;
  note?: string | null;
};

export type SubscriptionFilter = {
  q?: string;
  category?: string;
  status?: string;
  billingCycle?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
};

function buildQuery(filter: SubscriptionFilter | undefined): string {
  if (!filter) return '';
  const sp = new URLSearchParams();
  if (filter.q) sp.set('q', filter.q);
  if (filter.category) sp.set('category', filter.category);
  if (filter.status) sp.set('status', filter.status);
  if (filter.billingCycle) sp.set('billingCycle', filter.billingCycle);
  if (filter.sort) sp.set('sort', filter.sort);
  if (filter.dir) sp.set('dir', filter.dir);
  const q = sp.toString();
  return q ? `?${q}` : '';
}

export async function list(
  filter?: SubscriptionFilter,
): Promise<ApiResult<{ subscriptions: Subscription[] }>> {
  return apiFetch<{ subscriptions: Subscription[] }>(
    'GET',
    `/v1/subscriptions${buildQuery(filter)}`,
  );
}

export async function get(
  id: string,
): Promise<ApiResult<{ subscription: SubscriptionDetail }>> {
  return apiFetch<{ subscription: SubscriptionDetail }>(
    'GET',
    `/v1/subscriptions/${encodeURIComponent(id)}`,
  );
}

export async function create(
  input: SubscriptionInput,
): Promise<ApiResult<{ subscription: Subscription }>> {
  return apiFetch<{ subscription: Subscription }>('POST', '/v1/subscriptions', input);
}

export async function update(
  id: string,
  input: SubscriptionInput,
): Promise<ApiResult<{ subscription: Subscription }>> {
  return apiFetch<{ subscription: Subscription }>(
    'PATCH',
    `/v1/subscriptions/${encodeURIComponent(id)}`,
    input,
  );
}

export async function remove(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>(
    'DELETE',
    `/v1/subscriptions/${encodeURIComponent(id)}`,
  );
}

export async function logPayment(
  id: string,
  body: PaymentInput,
): Promise<ApiResult<{ payment: Payment }>> {
  return apiFetch<{ payment: Payment }>(
    'POST',
    `/v1/subscriptions/${encodeURIComponent(id)}/payments`,
    body,
  );
}

export async function renew(id: string): Promise<ApiResult<{ ok: boolean }>> {
  return apiFetch<{ ok: boolean }>(
    'POST',
    `/v1/subscriptions/${encodeURIComponent(id)}/renew`,
  );
}
