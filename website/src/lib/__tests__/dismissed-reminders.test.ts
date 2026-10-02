import { describe, expect, it } from 'vitest';
import {
  dismissedRemindersFromBackup,
  type DismissedReminderSource,
} from '@/lib/dismissed-reminders';

function source(): DismissedReminderSource {
  return {
    devices: [
      {
        id: 'd1',
        name: 'MacBook Pro',
        category: 'LAPTOP',
        status: 'ACTIVE',
        warranties: [
          {
            id: 'w1',
            type: 'STANDARD',
            provider: 'Apple',
            endDate: '2026-01-10T00:00:00Z',
            reminders: [{ isDismissed: true }],
          },
          {
            id: 'w2',
            type: 'EXTENDED',
            provider: null,
            endDate: '2027-01-10T00:00:00Z',
            reminders: [{ isDismissed: false }],
          },
        ],
      },
      {
        id: 'd2',
        name: 'iPhone',
        category: 'PHONE',
        status: 'SOLD',
        warranties: [
          {
            id: 'w3',
            type: 'THIRD_PARTY',
            provider: 'CellphoneS',
            endDate: '2025-12-31T00:00:00Z',
            // dismissed AND restored over time → still one entry per warranty.
            reminders: [{ isDismissed: false }, { isDismissed: true }],
          },
        ],
      },
      {
        id: 'd3',
        name: 'Máy giặt',
        category: 'WASHING',
        warranties: [
          {
            id: 'w4',
            type: 'STANDARD',
            provider: null,
            endDate: '2028-05-01T00:00:00Z',
            reminders: [],
          },
        ],
      },
    ],
  };
}

describe('dismissedRemindersFromBackup', () => {
  it('returns only warranties with a dismissed reminder, newest end date first', () => {
    const rows = dismissedRemindersFromBackup(source());
    expect(rows.map((r) => r.warrantyId)).toEqual(['w1', 'w3']);
  });

  it('carries the device + warranty fields the reminders list needs', () => {
    const [first] = dismissedRemindersFromBackup(source());
    expect(first).toEqual({
      warrantyId: 'w1',
      deviceId: 'd1',
      deviceName: 'MacBook Pro',
      deviceCategory: 'LAPTOP',
      deviceStatus: 'ACTIVE',
      warrantyType: 'STANDARD',
      warrantyProvider: 'Apple',
      endDate: '2026-01-10T00:00:00Z',
    });
  });

  it('keeps the device status so the UI can flag sold/broken devices', () => {
    const rows = dismissedRemindersFromBackup(source());
    expect(rows.map((r) => r.deviceStatus)).toEqual(['ACTIVE', 'SOLD']);
  });

  it('tolerates a partial payload (missing devices/warranties/reminders)', () => {
    expect(dismissedRemindersFromBackup({})).toEqual([]);
    expect(dismissedRemindersFromBackup({ devices: null })).toEqual([]);
    expect(
      dismissedRemindersFromBackup({
        devices: [{ id: 'd', name: 'X', category: 'OTHER' }],
      }),
    ).toEqual([]);
  });
});
