// FormData → Go `SubscriptionInput` wire shape.
//
// This lives outside `app/actions/subscriptions.ts` for two reasons:
//
//   1. A `'use server'` module may only export async functions, so the pure
//      builder cannot be exported from there; keeping it here makes it directly
//      unit-testable.
//   2. The shape is a contract, not an implementation detail. Go decodes every
//      write body with `DisallowUnknownFields`, so a key that is not in
//      `openapi.yaml`'s `SubscriptionInput` fails the WHOLE request with 400 —
//      exactly what the old unconditional `fromWishlistId` did to every create
//      and edit. The adjacent test pins the key set.
//
// Only create/update use the builder; the helpers are exported for the other
// FormData reads in the action (`logSubscriptionPayment`).

import type { SubscriptionInput } from '@/lib/api/subscriptions';
import { leadDaysFromFormData } from '@/lib/lead-days';

// Coerce a FormData entry (always string|File|null) into the JSON body shape
// the Go API expects. Empty strings become null so the Go-side validator
// doesn't see an empty `name`/`category`/etc. in optional fields.
export function subscriptionString(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

export function subscriptionNumber(formData: FormData, key: string): number | null {
  const raw = subscriptionString(formData, key);
  if (raw == null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(formData: FormData, key: string): boolean {
  const v = formData.get(key);
  return v === 'true' || v === 'on' || v === '1';
}

export function buildSubscriptionInput(formData: FormData): SubscriptionInput {
  const s = subscriptionString;
  const n = subscriptionNumber;
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
    autoRenew: bool(formData, 'autoRenew'),
    status: status ?? undefined,
    accountEmail: s(formData, 'accountEmail'),
    paymentMethod: s(formData, 'paymentMethod'),
    manageUrl: s(formData, 'manageUrl'),
    cancelUrl: s(formData, 'cancelUrl'),
    notes: s(formData, 'notes'),
    // Repeated `leadDays` entries (the chip control) are parsed here, not with
    // `s()` — FormData has no scalar view of an array. An absent key is left
    // out so Go applies its create default / keeps the stored list on update;
    // an explicitly empty selection is rejected by the action before the request.
    ...(leadDays === undefined ? {} : { leadDays }),
    // Free trial (Feature B). Both keys are always sent so a cleared trial is an
    // explicit `{trialEndsAt: null, convertsToPrice: null}` rather than a key
    // silently going missing. The invalid half — `convertsToPrice` without
    // `trialEndsAt` — is prevented in the form (the price is only mounted once a
    // trial end exists) and still rejected by Go with
    // `fieldErrors.convertsToPrice` if any other client sends it.
    trialEndsAt: s(formData, 'trialEndsAt'),
    convertsToPrice: n(formData, 'convertsToPrice'),
  };
}
