'use server';

// Thin proxy actions over the Go REST client. No Prisma, no rate-limit
// (Go owns both). Each action:
//   - parses FormData with the existing Vietnamese coercion behavior,
//   - forwards to `api.subscriptions.*`,
//   - either redirects (form-submit) or returns FormState (in-place forms).
//
// No revalidatePath: every page that reads subscription/wishlist/dashboard
// data is `export const dynamic = 'force-dynamic'`, so path revalidation
// would be a no-op. The caller's redirect / router.refresh() re-renders.

import { redirect } from 'next/navigation';
import { api, toFormState, type FormState } from '@/lib/api';
import type { SubscriptionInput, PaymentInput } from '@/lib/api/subscriptions';
import { leadDaysError, leadDaysFromFormData } from '@/lib/lead-days';
import { getI18n } from '@/lib/i18n/server';

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
  const leadDays = leadDaysFromFormData(formData);
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
    // Repeated `leadDays` entries (the chip control) are parsed here, not with
    // `s()` — FormData has no scalar view of an array. An absent key is left
    // out so Go applies its create default / keeps the stored list on update;
    // an explicitly empty selection is rejected below before the request.
    ...(leadDays === undefined ? {} : { leadDays }),
    // Free trial (Feature B). Both keys are always sent so a cleared trial is an
    // explicit `{trialEndsAt: null, convertsToPrice: null}` rather than a key
    // silently going missing. The invalid half — `convertsToPrice` without
    // `trialEndsAt` — is prevented in the form (the price is only mounted once a
    // trial end exists) and still rejected by Go with
    // `fieldErrors.convertsToPrice` if any other client sends it.
    trialEndsAt: s(formData, 'trialEndsAt'),
    convertsToPrice: n(formData, 'convertsToPrice'),
    fromWishlistId: s(formData, 'fromWishlistId'),
  };
}

// Zero selected days is the one invalid payload the client refuses to send
// (Go's 400 is the authority for everything else). The message is a catalog
// key, so an English reader gets it in English just like Go's own
// `fieldErrors.leadDays`.
async function leadDaysFormState(
  input: SubscriptionInput,
): Promise<SubscriptionFormState | null> {
  const key = leadDaysError(input.leadDays);
  if (!key) return null;
  const { t } = await getI18n();
  return { ok: false, errors: { leadDays: [t(key)] } };
}

export async function createSubscription(
  _prev: SubscriptionFormState,
  formData: FormData,
): Promise<SubscriptionFormState> {
  const input = buildSubscriptionInput(formData);
  const invalid = await leadDaysFormState(input);
  if (invalid) return invalid;
  const res = await api.subscriptions.create(input);
  if (!res.ok) return toFormState(res);

  redirect(`/subscriptions/${res.data.subscription.id}`);
}

export async function updateSubscription(
  id: string,
  _prev: SubscriptionFormState,
  formData: FormData,
): Promise<SubscriptionFormState> {
  const input = buildSubscriptionInput(formData);
  const invalid = await leadDaysFormState(input);
  if (invalid) return invalid;
  const res = await api.subscriptions.update(id, input);
  if (!res.ok) return toFormState(res);

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
    // Carry the user's schedule through the full-shape PATCH. Omitting it
    // would also be legal (absent = unchanged), but sending the read value
    // keeps this quick action visibly lossless.
    leadDays: s.leadDays,
    // Same reasoning for the trial: a status pill must not erase a recorded
    // conversion date/price. Sending both read values is lossless by
    // construction (a stored `convertsToPrice` always came with a
    // `trialEndsAt`, because the server rejects it otherwise).
    trialEndsAt: s.trialEndsAt,
    convertsToPrice: s.convertsToPrice,
  });
  if (!res.ok) return { ok: false };
  return { ok: true };
}

export async function deleteSubscription(id: string) {
  const res = await api.subscriptions.remove(id);
  if (!res.ok) redirect('/subscriptions');
  redirect('/subscriptions');
}

export async function renewSubscriptionNow(id: string): Promise<SubscriptionFormState> {
  const res = await api.subscriptions.renew(id);
  if (!res.ok) return toFormState(res);
  return { ok: true };
}
