// The subscription form's wire payload, pinned against Go's strict decoder.
//
// `openapi.yaml`'s `SubscriptionInput` is the whole contract, and
// `api`'s handler decodes with `DisallowUnknownFields`: one extra key is a 400
// for the ENTIRE request. The builder used to add `fromWishlistId` — a field
// the Go subscription service simply does not have (`services/subscriptions.go`
// contains no wishlist code) — and because it was added unconditionally it
// broke every create AND every edit. Nothing in the UI could have caught that:
// the unit tests were green and the only symptom was a form error at submit
// time.
//
// The allow-list below is copied from `SubscriptionInput` on purpose: importing
// `openapi.yaml` from a vitest run would reach outside `website/` and would not
// exist in that package's Docker build context.

import { describe, expect, it } from 'vitest';
import { buildSubscriptionInput } from '@/lib/subscription-input';

const GO_SUBSCRIPTION_INPUT_KEYS = new Set([
  'name',
  'category',
  'brand',
  'plan',
  'billingCycle',
  'intervalDays',
  'price',
  'startedAt',
  'renewalDate',
  'autoRenew',
  'status',
  'accountEmail',
  'paymentMethod',
  'manageUrl',
  'cancelUrl',
  'notes',
  'leadDays',
  'trialEndsAt',
  'convertsToPrice',
]);

function baseForm(): FormData {
  const fd = new FormData();
  fd.set('name', 'Netflix Standard');
  fd.set('billingCycle', 'MONTHLY');
  fd.set('price', '260000');
  fd.set('startedAt', '2026-10-01');
  fd.set('autoRenew', 'on');
  return fd;
}

describe('buildSubscriptionInput', () => {
  it('never sends a key outside openapi SubscriptionInput (strict decoder)', () => {
    const fd = baseForm();
    // A stale form/URL could still carry this; it must be dropped, not forwarded.
    fd.set('fromWishlistId', 'wish_123');

    const input = buildSubscriptionInput(fd);

    for (const key of Object.keys(input)) {
      expect(GO_SUBSCRIPTION_INPUT_KEYS.has(key), `unexpected wire key: ${key}`).toBe(true);
    }
    expect(input).not.toHaveProperty('fromWishlistId');
    expect(JSON.stringify(input)).not.toContain('fromWishlistId');
  });

  it('keeps the required create fields intact', () => {
    const input = buildSubscriptionInput(baseForm());
    expect(input.name).toBe('Netflix Standard');
    expect(input.billingCycle).toBe('MONTHLY');
    expect(input.price).toBe(260000);
    expect(input.startedAt).toBe('2026-10-01');
    expect(input.autoRenew).toBe(true);
  });

  it('omits leadDays when the form did not render the chip control', () => {
    const input = buildSubscriptionInput(baseForm());
    expect(input).not.toHaveProperty('leadDays');
  });

  it('parses repeated leadDays entries into the numeric array', () => {
    const fd = baseForm();
    fd.append('leadDays', '30');
    fd.append('leadDays', '7');
    const input = buildSubscriptionInput(fd);
    expect(input.leadDays).toEqual([30, 7]);
  });
});
