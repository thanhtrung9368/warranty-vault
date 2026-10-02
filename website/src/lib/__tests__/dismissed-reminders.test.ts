import { describe, expect, it } from 'vitest';
import {
  dismissedReminders,
  type DismissedReminderRow,
} from '@/lib/dismissed-reminders';

// Fixture mirrors what `GET /v1/reminders?includeDismissed=true` returns:
// `services.ReminderRow` rows (Warranty fields + embedded device projection),
// with the hidden ones flagged `isDismissed: true` and the still-active ones
// riding along unflagged.
function feed(): DismissedReminderRow[] {
  return [
    {
      id: 'w1',
      type: 'STANDARD',
      provider: 'Apple',
      endDate: '2026-01-10T00:00:00Z',
      isDismissed: true,
      device: { id: 'd1', name: 'MacBook Pro', category: 'LAPTOP', status: 'ACTIVE' },
    },
    {
      // Dismissed and later restored → the same feed still carries it as an
      // active row, so it must not show up under “Đã ẩn”.
      id: 'w2',
      type: 'EXTENDED',
      provider: null,
      endDate: '2027-01-10T00:00:00Z',
      isDismissed: false,
      device: { id: 'd1', name: 'MacBook Pro', category: 'LAPTOP', status: 'ACTIVE' },
    },
    {
      id: 'w3',
      type: 'THIRD_PARTY',
      provider: 'CellphoneS',
      endDate: '2025-12-31T00:00:00Z',
      isDismissed: true,
      device: { id: 'd2', name: 'iPhone', category: 'PHONE', status: 'SOLD' },
    },
    {
      // Device projection without `status` — the original feed's device ref is
      // `{id, name, category}` only.
      id: 'w4',
      type: 'STANDARD',
      provider: null,
      endDate: '2028-05-01T00:00:00Z',
      isDismissed: true,
      device: { id: 'd3', name: 'Máy giặt', category: 'WASHING' },
    },
  ];
}

function rowById(rows: DismissedReminderRow[], id: string): DismissedReminderRow {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`fixture row ${id} missing`);
  return row;
}

describe('dismissedReminders', () => {
  it('returns only the rows flagged isDismissed, newest end date first', () => {
    const rows = dismissedReminders(feed());
    // w2 (dismissed then restored) is in the payload but stays active; the
    // three hidden rows come back sorted by endDate desc.
    expect(rows.map((r) => r.warrantyId)).toEqual(['w4', 'w1', 'w3']);
  });

  it('carries the device + warranty fields the reminders list needs', () => {
    const rows = dismissedReminders(feed());
    expect(rows.find((r) => r.warrantyId === 'w3')).toEqual({
      warrantyId: 'w3',
      deviceId: 'd2',
      deviceName: 'iPhone',
      deviceCategory: 'PHONE',
      deviceStatus: 'SOLD',
      warrantyType: 'THIRD_PARTY',
      warrantyProvider: 'CellphoneS',
      endDate: '2025-12-31T00:00:00Z',
    });
  });

  it('keeps the device status so the UI can flag sold/broken devices', () => {
    const status = new Map(
      dismissedReminders(feed()).map((r) => [r.warrantyId, r.deviceStatus]),
    );
    expect(status.get('w1')).toBe('ACTIVE');
    expect(status.get('w3')).toBe('SOLD');
  });

  it('reads a device projection without `status` as ACTIVE', () => {
    const fixture = feed();
    expect(rowById(fixture, 'w4').device).not.toHaveProperty('status');
    const hidden = dismissedReminders(fixture).find((r) => r.warrantyId === 'w4');
    expect(hidden?.deviceStatus).toBe('ACTIVE');
  });

  it('tolerates a partial payload (no rows, unflagged rows, no device)', () => {
    expect(dismissedReminders(null)).toEqual([]);
    expect(dismissedReminders(undefined)).toEqual([]);
    expect(dismissedReminders([])).toEqual([]);
    // Default (non-widened) feed: no isDismissed field at all → nothing hidden.
    expect(
      dismissedReminders([
        { id: 'w', type: 'STANDARD', provider: null, endDate: '2026-01-01T00:00:00Z' },
      ]),
    ).toEqual([]);
    // A dismissed row without the embedded device can't be linked or rendered.
    expect(
      dismissedReminders([
        {
          id: 'w',
          type: 'STANDARD',
          provider: null,
          endDate: '2026-01-01T00:00:00Z',
          isDismissed: true,
          device: null,
        },
      ]),
    ).toEqual([]);
  });
});
