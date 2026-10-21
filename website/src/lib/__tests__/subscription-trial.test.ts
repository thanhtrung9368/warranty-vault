import { describe, expect, it } from 'vitest';
import {
  conversionPriceLabel,
  trialLabel,
  trialPhase,
} from '@/lib/subscription-trial';
import { formatVND } from '@/lib/format';

// Feature B — the free trial.
//
// The display question this file pins is "trial vs renewal": while a trial is
// recorded, the trial end is the next moment money moves and it wins over the
// normal renewal date. With no trial, every helper returns null/`none` so the
// detail page keeps its existing "Gia hạn tới …" card instead of growing an
// empty trial row.

describe('trialPhase', () => {
  const now = new Date('2026-04-07T10:00:00');

  it('is "none" without a trial date', () => {
    expect(trialPhase({ trialEndsAt: null }, now)).toBe('none');
    expect(trialPhase({ trialEndsAt: undefined }, now)).toBe('none');
    expect(trialPhase({ trialEndsAt: '   ' }, now)).toBe('none');
  });

  it('is "trial" while the end is in the future', () => {
    expect(trialPhase({ trialEndsAt: '2026-04-20' }, now)).toBe('trial');
  });

  it('keeps the trial running THROUGH its end day, and ends it the next day', () => {
    // `trialEndsAt` is a calendar day, not an instant: a trial recorded as
    // ending on the 7th is still running at 10:00 on the 7th, and billing
    // starts on the 8th. Reading it as an instant ended the trial at the UTC
    // midnight before the day the user recorded.
    expect(trialPhase({ trialEndsAt: '2026-04-07' }, now)).toBe('trial');
    expect(trialPhase({ trialEndsAt: '2026-04-06' }, now)).toBe('ended');
    expect(trialPhase({ trialEndsAt: '2026-03-01' }, now)).toBe('ended');
  });

  it('treats an unreadable date as no trial rather than crashing', () => {
    expect(trialPhase({ trialEndsAt: 'không phải ngày' }, now)).toBe('none');
  });
});

describe('trialLabel', () => {
  const now = new Date('2026-04-07T10:00:00');

  it('leads with the trial end while the free period is running', () => {
    expect(trialLabel({ trialEndsAt: '2026-04-20' }, 'vi', now)).toBe(
      'Dùng thử đến 20/04/2026',
    );
    expect(trialLabel({ trialEndsAt: '2026-04-20' }, 'en', now)).toBe(
      'Trial until 20 Apr 2026',
    );
  });

  it('says the trial has ended once it converted', () => {
    expect(trialLabel({ trialEndsAt: '2026-03-01' }, 'vi', now)).toBe(
      'Đã hết dùng thử từ 01/03/2026',
    );
    expect(trialLabel({ trialEndsAt: '2026-03-01' }, 'en', now)).toBe(
      'Trial ended 1 Mar 2026',
    );
  });

  it('returns null without a trial, leaving the renewal label in place', () => {
    expect(trialLabel({ trialEndsAt: null }, 'vi', now)).toBeNull();
    expect(trialLabel({}, 'en', now)).toBeNull();
    expect(trialLabel({ trialEndsAt: 'không phải ngày' }, 'en', now)).toBeNull();
  });
});

describe('conversionPriceLabel', () => {
  it('formats the post-trial price per locale', () => {
    // Compared against `formatVND` rather than a literal: the Vietnamese
    // currency format uses a non-breaking space before ₫, and pinning that byte
    // here would test ICU's data instead of this sentence.
    expect(conversionPriceLabel(199000, 'vi')).toBe(
      `Giá sau dùng thử: ${formatVND(199000, 'vi')}`,
    );
    expect(conversionPriceLabel(199000, 'en')).toBe(
      `After the trial: ${formatVND(199000, 'en')}`,
    );
  });

  it('keeps a recorded 0 price rather than treating it as unknown', () => {
    // 0 is "free forever after the trial" — a different statement from "the
    // price is not known yet", which is null and gets no line at all.
    expect(conversionPriceLabel(0, 'vi')).toBe(`Giá sau dùng thử: ${formatVND(0, 'vi')}`);
    expect(conversionPriceLabel(0, 'en')).toBe(`After the trial: ${formatVND(0, 'en')}`);
  });

  it('returns null when the price is unknown or unusable', () => {
    expect(conversionPriceLabel(null, 'vi')).toBeNull();
    expect(conversionPriceLabel(undefined, 'en')).toBeNull();
    expect(conversionPriceLabel(Number.NaN, 'en')).toBeNull();
  });
});
