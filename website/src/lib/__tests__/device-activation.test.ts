import { describe, expect, it } from 'vitest';
import {
  activationStateLabel,
  extendedCoverBuyByNote,
} from '@/lib/device-activation';

// Feature A — warranty activation + the extended-cover deadline.
//
// Two rules are pinned here because they are easy to "fix" into a bug:
//
//   * a device with neither setting must render NOTHING (most devices do not
//     require activation, and a "Chưa kích hoạt" row on all of them would train
//     users to ignore the one that matters);
//   * an activation date earlier than the purchase date is legal — a shop can
//     pre-activate — so the label renders it as recorded.

describe('activationStateLabel', () => {
  it('renders the activation date when one is recorded', () => {
    expect(activationStateLabel({ activatedAt: '2026-03-01' }, 'vi')).toBe(
      'Đã kích hoạt ngày 01/03/2026',
    );
    expect(activationStateLabel({ activatedAt: '2026-03-01' }, 'en')).toBe(
      'Activated on 03/01/2026',
    );
  });

  it('does not require the "activation required" flag for that date', () => {
    // A device can be activated without the app knowing it was ever required.
    expect(
      activationStateLabel(
        { activationRequired: false, activatedAt: '2026-03-01' },
        'en',
      ),
    ).toBe('Activated on 03/01/2026');
  });

  it('warns "not activated" when activation is required but no date exists', () => {
    expect(
      activationStateLabel({ activationRequired: true, activatedAt: null }, 'vi'),
    ).toBe('Chưa kích hoạt');
    expect(
      activationStateLabel({ activationRequired: true, activatedAt: '' }, 'en'),
    ).toBe('Not activated');
  });

  it('says nothing when the device neither requires activation nor has a date', () => {
    expect(activationStateLabel({}, 'vi')).toBeNull();
    expect(
      activationStateLabel({ activationRequired: false, activatedAt: null }, 'en'),
    ).toBeNull();
  });

  it('renders a pre-activation date (before the purchase date) verbatim', () => {
    // The server explicitly allows `activatedAt < purchaseDate` — a retailer can
    // activate before handing the device over. The label must not flag it.
    const device = {
      activationRequired: true,
      activatedAt: '2026-01-05',
      purchaseDate: '2026-02-10',
    };
    expect(activationStateLabel(device, 'vi')).toBe('Đã kích hoạt ngày 05/01/2026');
    expect(activationStateLabel(device, 'en')).toBe('Activated on 01/05/2026');
  });
});

describe('extendedCoverBuyByNote', () => {
  // Fixed "now" so the test cannot drift with the machine clock: 7 Apr 2026,
  // 15:00 local.
  const now = new Date(2026, 3, 7, 15, 0, 0);

  it('counts the days left', () => {
    expect(extendedCoverBuyByNote('2026-04-10', 'vi', now)).toBe(
      'Còn 3 ngày để mua gói mở rộng',
    );
    expect(extendedCoverBuyByNote('2026-04-10', 'en', now)).toBe(
      '3 days left to buy extended cover',
    );
  });

  it('uses the singular English form for one day', () => {
    expect(extendedCoverBuyByNote('2026-04-08', 'en', now)).toBe(
      '1 day left to buy extended cover',
    );
  });

  it('says the last day is today instead of "0 days left"', () => {
    expect(extendedCoverBuyByNote('2026-04-07', 'vi', now)).toBe(
      'Hôm nay là ngày cuối mua gói mở rộng',
    );
    expect(extendedCoverBuyByNote('2026-04-07', 'en', now)).toBe(
      'Today is the last day to buy extended cover',
    );
  });

  it('stays past-tense once the window has closed', () => {
    expect(extendedCoverBuyByNote('2026-04-05', 'vi', now)).toBe(
      'Đã hết hạn mua gói mở rộng (2 ngày trước)',
    );
    expect(extendedCoverBuyByNote('2026-04-05', 'en', now)).toBe(
      'The extended-cover deadline passed 2 days ago',
    );
  });

  it('returns null instead of "NaN days" for a missing or unparseable value', () => {
    expect(extendedCoverBuyByNote(null, 'vi', now)).toBeNull();
    expect(extendedCoverBuyByNote(undefined, 'vi', now)).toBeNull();
    expect(extendedCoverBuyByNote('   ', 'vi', now)).toBeNull();
    expect(extendedCoverBuyByNote('không phải ngày', 'en', now)).toBeNull();
  });
});
