'use server';

// Thin proxy actions over the Go REST client. No Prisma, no rate-limit
// (Go owns both). Each action:
//   - parses FormData with the existing Vietnamese coercion behavior,
//   - forwards to `api.subscriptions.*`,
//   - revalidatePaths the affected pages,
//   - either redirects (form-submit) or returns FormState (in-place forms).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { api, toFormState, type FormState } from '@/lib/api';
import type { SubscriptionInput, PaymentInput } from '@/lib/api/subscriptions';

export type SubscriptionFormState = FormState;

// Coerce a FormData entry (always string|File|null) into the JSON body shape
// the Go API expects. Empty strings become null so the Go-side validator
// doesn't see an empty `name`/`category`/etc. in optional fields.
function s(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function n(formData: FormData, key: string): number | null {
  const raw = s(formData, key);
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function b(formData: FormData, key: string): boolean {
  const v = formData.get(key);
  return v === 'true' || v === 'on' || v === '1';
}

function buildSubscriptionInput(formData: FormData): SubscriptionInput {
  const billingCycle = (s(formData, 'billingCycle') ??
    'MONTHLY') as SubscriptionInput['billingCycle'];
  const status = s(formData, 'status') as SubscriptionInput['status'] | null;
  return {
    name: s(formData, 'name') ?? '',
    category: s(formData, 'category'),
    brand: s(formData, 'brand'),
    plan: s(formData, 'plan'),
    billingCycle,
    intervalDays: n(formData, 'intervalDays'),
    price: n(formData, 'price') ?? 0,
    startedAt: s(formData, 'startedAt') ?? '',
    renewalDate: s(formData, 'renewalDate'),
    autoRenew: b(formData, 'autoRenew'),
    status: status ?? undefined,
    accountEmail: s(formData, 'accountEmail'),
    paymentMethod: s(formData, 'paymentMethod'),
    manageUrl: s(formData, 'manageUrl'),
    cancelUrl: s(formData, 'cancelUrl'),
    notes: s(formData, 'notes'),
    fromWishlistId: s(formData, 'fromWishlistId'),
  };
}

export async function createSubscription(
  _prev: SubscriptionFormState,
  formData: FormData,
): Promise<SubscriptionFormState> {
  const input = buildSubscriptionInput(formData);
  const res = await api.subscriptions.create(input);
  if (!res.ok) return toFormState(res);

  if (input.fromWishlistId) {
    revalidatePath('/wishlist');
    revalidatePath(`/wishlist/${input.fromWishlistId}`);
  }
  revalidatePath('/dashboard');
  revalidatePath('/subscriptions');
  redirect(`/subscriptions/${res.data.subscription.id}`);
}

export async function updateSubscription(
  id: string,
  _prev: SubscriptionFormState,
  formData: FormData,
): Promise<SubscriptionFormState> {
  const input = buildSubscriptionInput(formData);
  const res = await api.subscriptions.update(id, input);
  if (!res.ok) return toFormState(res);

  revalidatePath('/subscriptions');
  revalidatePath(`/subscriptions/${id}`);
  revalidatePath('/dashboard');
  redirect(`/subscriptions/${id}`);
}

export async function logSubscriptionPayment(
  id: string,
  formData: FormData,
): Promise<SubscriptionFormState> {
  const body: PaymentInput = {
    amount: n(formData, 'amount') ?? 0,
    paidAt: s(formData, 'paidAt') ?? '',
    note: s(formData, 'note'),
  };
  const res = await api.subscriptions.logPayment(id, body);
  if (!res.ok) return toFormState(res);
  revalidatePath(`/subscriptions/${id}`);
  return { ok: true };
}

// Quick status flip — used by the inline status buttons on the detail page.
// Go's PATCH validator is full-shape (name + billingCycle required), so we
// fetch first, merge in the new status, and submit the merged body.
export async function setSubscriptionStatus(id: string, status: string) {
  const cur = await api.subscriptions.get(id);
  if (!cur.ok) return { ok: false };
  const s = cur.data.subscription;
  const res = await api.subscriptions.update(id, {
    name: s.name,
    category: s.category,
    brand: s.brand,
    plan: s.plan,
    billingCycle: s.billingCycle,
    intervalDays: s.intervalDays,
    price: s.price,
    startedAt: s.startedAt,
    renewalDate: s.renewalDate,
    autoRenew: s.autoRenew,
    status: status as SubscriptionInput['status'],
    accountEmail: s.accountEmail,
    paymentMethod: s.paymentMethod,
    manageUrl: s.manageUrl,
    cancelUrl: s.cancelUrl,
    notes: s.notes,
  });
  if (!res.ok) return { ok: false };
  revalidatePath('/subscriptions');
  revalidatePath(`/subscriptions/${id}`);
  revalidatePath('/dashboard');
  return { ok: true };
}

export async function deleteSubscription(id: string) {
  const res = await api.subscriptions.remove(id);
  if (!res.ok) redirect('/subscriptions');
  revalidatePath('/subscriptions');
  revalidatePath('/dashboard');
  redirect('/subscriptions');
}

export async function renewSubscriptionNow(id: string): Promise<SubscriptionFormState> {
  const res = await api.subscriptions.renew(id);
  if (!res.ok) return toFormState(res);
  revalidatePath('/subscriptions');
  revalidatePath(`/subscriptions/${id}`);
  revalidatePath('/dashboard');
  return { ok: true };
}
