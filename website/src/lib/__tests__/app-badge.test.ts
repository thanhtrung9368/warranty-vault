import { describe, expect, it, vi } from 'vitest';
import {
  applyAppBadge,
  dueBadgeCount,
  type AppBadgeNavigator,
} from '@/lib/app-badge';

// The Badging API is an enhancement, and the two ways it fails are silent:
//
//   * a browser without it (Safari, Firefox) must not throw — a badge is not
//     worth breaking a page;
//   * a stale count must be cleared when the new count is zero, because a
//     stuck "3 due" icon is worse than no badge at all.
//
// `applyAppBadge` takes the navigator-shaped object as an argument precisely
// so the unsupported/broken cases can be tested here instead of a browser.

function fakeNavigator() {
  return {
    setAppBadge: vi.fn<NonNullable<AppBadgeNavigator['setAppBadge']>>(
      () => Promise.resolve(),
    ),
    clearAppBadge: vi.fn<NonNullable<AppBadgeNavigator['clearAppBadge']>>(
      () => Promise.resolve(),
    ),
  };
}

describe('dueBadgeCount', () => {
  it('counts the rows the 30-day feed returned', () => {
    expect(dueBadgeCount([{}, {}, {}])).toBe(3);
    expect(dueBadgeCount([{ isDismissed: false }])).toBe(1);
  });

  it('is zero for an empty or failed read, never NaN/undefined', () => {
    expect(dueBadgeCount([])).toBe(0);
    expect(dueBadgeCount(null)).toBe(0);
    expect(dueBadgeCount(undefined)).toBe(0);
  });

  it('does not count a dismissed row if a widened feed is passed by mistake', () => {
    expect(dueBadgeCount([{ isDismissed: true }, {}, { isDismissed: true }])).toBe(1);
    expect(dueBadgeCount([{ isDismissed: true }])).toBe(0);
  });
});

describe('applyAppBadge', () => {
  it('sets the badge to the due count when it is positive', () => {
    const nav = fakeNavigator();
    expect(applyAppBadge(nav, 3)).toBe(true);
    expect(nav.setAppBadge).toHaveBeenCalledTimes(1);
    expect(nav.setAppBadge).toHaveBeenCalledWith(3);
    expect(nav.clearAppBadge).not.toHaveBeenCalled();
  });

  it('CLEARS the badge when the count is zero, instead of setting 0', () => {
    const nav = fakeNavigator();
    expect(applyAppBadge(nav, 0)).toBe(true);
    expect(nav.clearAppBadge).toHaveBeenCalledTimes(1);
    expect(nav.setAppBadge).not.toHaveBeenCalled();
  });

  it('clears for a failed read expressed as 0/negative/NaN', () => {
    for (const value of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const nav = fakeNavigator();
      expect(applyAppBadge(nav, value), String(value)).toBe(true);
      expect(nav.clearAppBadge, String(value)).toHaveBeenCalledTimes(1);
      expect(nav.setAppBadge, String(value)).not.toHaveBeenCalled();
    }
  });

  it('floors a fractional count rather than sending a non-integer', () => {
    const nav = fakeNavigator();
    applyAppBadge(nav, 2.9);
    expect(nav.setAppBadge).toHaveBeenCalledWith(2);
  });

  it('feature-detects: Safari/Firefox with no methods is a silent no-op', () => {
    expect(() => applyAppBadge(null, 4)).not.toThrow();
    expect(applyAppBadge(null, 4)).toBe(false);
    expect(() => applyAppBadge({}, 0)).not.toThrow();
    expect(applyAppBadge({}, 0)).toBe(false);
  });

  it('falls back to setAppBadge(0) only if clearAppBadge is missing', () => {
    const setAppBadge = vi.fn<NonNullable<AppBadgeNavigator['setAppBadge']>>(
      () => Promise.resolve(),
    );
    expect(applyAppBadge({ setAppBadge }, 0)).toBe(true);
    expect(setAppBadge).toHaveBeenCalledWith(0);
  });

  it('swallows a rejected API call (permission/policy refusal)', async () => {
    const nav = {
      setAppBadge: vi.fn(() => Promise.reject(new Error('not installed'))),
      clearAppBadge: vi.fn(() => Promise.reject(new Error('not installed'))),
    };
    expect(() => applyAppBadge(nav, 2)).not.toThrow();
    expect(() => applyAppBadge(nav, 0)).not.toThrow();
    // Both rejections are already handled by `applyAppBadge`; let the microtask
    // queue drain so an unhandled rejection would fail this test if it existed.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('swallows a synchronous throw from an exotic implementation', () => {
    const nav = {
      setAppBadge: () => {
        throw new Error('boom');
      },
      clearAppBadge: () => {
        throw new Error('boom');
      },
    };
    expect(applyAppBadge(nav, 1)).toBe(false);
    expect(applyAppBadge(nav, 0)).toBe(false);
  });
});
