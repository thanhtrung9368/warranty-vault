import { describe, expect, it } from 'vitest';
import {
  SNOOZE_CHOICES,
  SNOOZE_DAYS_DEFAULT,
  SNOOZE_DAYS_MAX,
  actionHref,
  badgeCount,
  daysUntil,
  dueDateNote,
  entityLabel,
  groupBySeverity,
  isSnoozed,
  isValidSnoozeDays,
  severityOf,
  snoozeNote,
  splitQueue,
} from '@/lib/action-queue';
// Type-only: importing the API client at runtime needs SESSION_SECRET.
import type { ActionItem } from '@/lib/api/actions';

// Fixtures for the "Việc cần xử lý" payload (openapi `ActionItem`). Only the
// fields the display logic reads are filled in; everything else mimics the Go
// service's `omitempty` behaviour (absent, not null).
function item(over: Partial<ActionItem> & { itemKey: string }): ActionItem {
  return {
    kind: 'DEVICE_NO_WARRANTY',
    severity: 'MEDIUM',
    title: 'Thiết bị chưa có gói bảo hành',
    detail: '«Máy giặt LG» chưa có gói bảo hành nào.',
    ...over,
  };
}

describe('severityOf', () => {
  it('keeps the three server codes', () => {
    expect(severityOf({ severity: 'HIGH' })).toBe('HIGH');
    expect(severityOf({ severity: 'MEDIUM' })).toBe('MEDIUM');
    expect(severityOf({ severity: 'LOW' })).toBe('LOW');
  });

  it('buckets an unknown code as LOW instead of dropping the row', () => {
    expect(severityOf({ severity: 'URGENT' })).toBe('LOW');
    expect(severityOf({ severity: '' })).toBe('LOW');
  });
});

describe('isSnoozed', () => {
  it('is true only when snoozedUntil carries a date', () => {
    expect(isSnoozed({ snoozedUntil: '2026-06-01T00:00:00' })).toBe(true);
    // Absent / null / empty = actionable (openapi: "Vắng mặt = việc đang cần xử lý").
    expect(isSnoozed({})).toBe(false);
    expect(isSnoozed({ snoozedUntil: null })).toBe(false);
    expect(isSnoozed({ snoozedUntil: '' })).toBe(false);
  });
});

describe('splitQueue', () => {
  it('splits on snoozedUntil and preserves the server order in both lists', () => {
    const a = item({ itemKey: 'A:1' });
    const b = item({ itemKey: 'B:2', snoozedUntil: '2026-06-01T00:00:00' });
    const c = item({ itemKey: 'C:3' });
    const d = item({ itemKey: 'D:4', snoozedUntil: '2026-07-01T00:00:00' });

    const { active, snoozed } = splitQueue([a, b, c, d]);
    expect(active.map((i) => i.itemKey)).toEqual(['A:1', 'C:3']);
    expect(snoozed.map((i) => i.itemKey)).toEqual(['B:2', 'D:4']);
  });

  it('tolerates a missing payload', () => {
    expect(splitQueue(null)).toEqual({ active: [], snoozed: [] });
    expect(splitQueue(undefined)).toEqual({ active: [], snoozed: [] });
  });
});

describe('groupBySeverity', () => {
  it('orders HIGH → MEDIUM → LOW and keeps the server order inside a group', () => {
    const items = [
      item({ itemKey: 'W1', severity: 'HIGH', kind: 'WARRANTY_EXPIRED' }),
      item({ itemKey: 'M1', severity: 'MEDIUM' }),
      item({ itemKey: 'H2', severity: 'HIGH', kind: 'RETURN_WINDOW_CLOSING' }),
      item({ itemKey: 'L1', severity: 'LOW' }),
    ];
    const groups = groupBySeverity(items);
    expect(groups.map((g) => g.section.severity)).toEqual(['HIGH', 'MEDIUM', 'LOW']);
    expect(groups[0].items.map((i) => i.itemKey)).toEqual(['W1', 'H2']);
    expect(groups[1].items.map((i) => i.itemKey)).toEqual(['M1']);
    expect(groups[2].items.map((i) => i.itemKey)).toEqual(['L1']);
  });

  it('drops empty groups', () => {
    const groups = groupBySeverity([item({ itemKey: 'M1', severity: 'MEDIUM' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].section.severity).toBe('MEDIUM');
  });

  it('puts an unknown severity in the LOW group', () => {
    const groups = groupBySeverity([item({ itemKey: 'X1', severity: 'WHATEVER' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].section.severity).toBe('LOW');
  });
});

describe('badgeCount', () => {
  it('uses counts.total and never folds snoozed rows in', () => {
    // `snoozedCount` is deliberately larger than `total` here: the server counts
    // snoozed rows separately and they must not reach the sidebar badge.
    expect(badgeCount({ total: 3, high: 1, medium: 1, low: 1 })).toBe(3);
    expect(badgeCount({ total: 0, high: 0, medium: 0, low: 0 })).toBe(0);
  });

  it('tolerates a missing counts object', () => {
    expect(badgeCount(null)).toBe(0);
    expect(badgeCount(undefined)).toBe(0);
  });
});

describe('actionHref', () => {
  it('links device kinds to the device', () => {
    const device = { deviceId: 'dev-1', warrantyId: 'war-1' };
    expect(actionHref({ kind: 'WARRANTY_EXPIRED', ...device })).toBe('/devices/dev-1');
    expect(actionHref({ kind: 'DEVICE_NO_WARRANTY', ...device })).toBe('/devices/dev-1');
    expect(actionHref({ kind: 'DEVICE_STATUS_STALE', ...device })).toBe('/devices/dev-1');
    expect(actionHref({ kind: 'DEVICE_MISSING_SERIAL', ...device })).toBe('/devices/dev-1');
    expect(actionHref({ kind: 'DEVICE_MISSING_RECEIPT', ...device })).toBe('/devices/dev-1');
    expect(actionHref({ kind: 'RETURN_WINDOW_CLOSING', ...device })).toBe('/devices/dev-1');
    expect(actionHref({ kind: 'RETURN_WINDOW_UNKNOWN', ...device })).toBe('/devices/dev-1');
  });

  it('links subscription kinds to the subscription', () => {
    expect(
      actionHref({
        kind: 'SUBSCRIPTION_RENEWING_NO_CANCEL_URL',
        subscriptionId: 'sub-9',
      }),
    ).toBe('/subscriptions/sub-9');
    expect(
      actionHref({ kind: 'SUBSCRIPTION_PAID_NOT_ADVANCED', subscriptionId: 'sub-9' }),
    ).toBe('/subscriptions/sub-9');
  });

  it('links the wishlist kind to the wishlist item', () => {
    expect(actionHref({ kind: 'WISHLIST_TARGET_PASSED', wishlistItemId: 'wl-4' })).toBe(
      '/wishlist/wl-4',
    );
  });

  it('returns null when the kind has no id on the row', () => {
    expect(actionHref({ kind: 'WARRANTY_EXPIRED' })).toBeNull();
    expect(actionHref({ kind: 'WISHLIST_TARGET_PASSED' })).toBeNull();
  });

  it('falls back to whichever id an unknown kind carries', () => {
    expect(actionHref({ kind: 'SOMETHING_NEW', subscriptionId: 'sub-1' })).toBe(
      '/subscriptions/sub-1',
    );
    expect(actionHref({ kind: 'SOMETHING_NEW' })).toBeNull();
  });
});

describe('entityLabel', () => {
  it('names the linked entity', () => {
    expect(entityLabel({ kind: 'DEVICE_NO_WARRANTY', deviceId: 'd' })).toBe('Thiết bị');
    expect(
      entityLabel({ kind: 'SUBSCRIPTION_PAID_NOT_ADVANCED', subscriptionId: 's' }),
    ).toBe('Gói đăng ký');
    expect(entityLabel({ kind: 'WISHLIST_TARGET_PASSED', wishlistItemId: 'w' })).toBe(
      'Món đang thèm',
    );
    expect(entityLabel({ kind: 'DEVICE_NO_WARRANTY' })).toBeNull();
  });
});

describe('date notes', () => {
  const now = new Date('2026-04-10T09:00:00');

  it('counts whole calendar days', () => {
    expect(daysUntil('2026-04-13T00:00:00', now)).toBe(3);
    expect(daysUntil('2026-04-10T00:00:00', now)).toBe(0);
    expect(daysUntil('2026-04-08T00:00:00', now)).toBe(-2);
  });

  it('reads a deadline in Vietnamese', () => {
    expect(dueDateNote('2026-04-13T00:00:00', 'vi', now)).toBe('còn 3 ngày');
    // 0 = today is the last day (matches ReturnWindow.daysLeft semantics).
    expect(dueDateNote('2026-04-10T00:00:00', 'vi', now)).toBe('hôm nay');
    expect(dueDateNote('2026-04-08T00:00:00', 'vi', now)).toBe('đã qua 2 ngày');
  });

  it('reads a snooze deadline in Vietnamese', () => {
    expect(snoozeNote('2026-07-09T00:00:00', 'vi', now)).toBe('Hiện lại sau 90 ngày');
    expect(snoozeNote('2026-04-11T00:00:00', 'vi', now)).toBe('Hiện lại ngày mai');
    expect(snoozeNote('2026-04-10T00:00:00', 'vi', now)).toBe('Hiện lại hôm nay');
    expect(snoozeNote('2026-04-09T00:00:00', 'vi', now)).toBe('Đã tới hạn hiện lại');
  });
});

describe('snooze choices', () => {
  it('offers only durations inside the server range', () => {
    expect(SNOOZE_CHOICES.length).toBeGreaterThan(1);
    for (const choice of SNOOZE_CHOICES) {
      expect(isValidSnoozeDays(choice.days)).toBe(true);
      expect(choice.days).toBeGreaterThanOrEqual(1);
      expect(choice.days).toBeLessThanOrEqual(365);
    }
  });

  it('includes the server default so one tap matches an empty body', () => {
    expect(SNOOZE_CHOICES.some((c) => c.days === SNOOZE_DAYS_DEFAULT)).toBe(true);
    expect(SNOOZE_DAYS_DEFAULT).toBe(90);
  });

  it('validates the 1..365 window', () => {
    expect(isValidSnoozeDays(1)).toBe(true);
    expect(isValidSnoozeDays(SNOOZE_DAYS_MAX)).toBe(true);
    expect(isValidSnoozeDays(0)).toBe(false);
    expect(isValidSnoozeDays(366)).toBe(false);
    expect(isValidSnoozeDays(1.5)).toBe(false);
    expect(isValidSnoozeDays(Number.NaN)).toBe(false);
  });
});
