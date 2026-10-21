import { describe, expect, it } from 'vitest';
import { isColdStartAccount } from '@/lib/first-run';

// The predicate behind the dashboard's first-run panel. It must be true ONLY
// for an account that has saved nothing — every other combination falls back to
// the normal dashboard, which can explain itself with real data.

describe('isColdStartAccount', () => {
  it('is true for an account with no devices, no subscriptions and no wishlist', () => {
    expect(
      isColdStartAccount({ devices: 0, subscriptions: 0, wishlist: 0 }),
    ).toBe(true);
  });

  it('is false as soon as any one of the three has a row', () => {
    expect(isColdStartAccount({ devices: 1, subscriptions: 0, wishlist: 0 })).toBe(false);
    expect(isColdStartAccount({ devices: 0, subscriptions: 1, wishlist: 0 })).toBe(false);
    expect(isColdStartAccount({ devices: 0, subscriptions: 0, wishlist: 1 })).toBe(false);
  });

  it('is false for a sold-only device account', () => {
    // The caller passes RAW row counts: a device that was sold is still
    // something the user saved, and the dashboard must not greet them as new.
    expect(isColdStartAccount({ devices: 1, subscriptions: 0, wishlist: 0 })).toBe(false);
  });

  it('treats a broken count as not-cold rather than congratulating the account', () => {
    // A failed read is not a first run. NaN / Infinity / a negative count fall
    // back to the normal dashboard, which renders its own error surface.
    expect(isColdStartAccount({ devices: NaN, subscriptions: 0, wishlist: 0 })).toBe(false);
    expect(isColdStartAccount({ devices: Infinity, subscriptions: 0, wishlist: 0 })).toBe(false);
    expect(isColdStartAccount({ devices: -1, subscriptions: 0, wishlist: 0 })).toBe(false);
  });
});
