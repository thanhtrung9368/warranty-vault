// The "how long is left" pill must count CALENDAR days, not completed 24-hour
// periods. Warranty end dates are date-only (`2026-10-28T00:00:00Z`), so at
// 18:00 on the 19th there are nine days left but only eight full days. The old
// `differenceInDays` truncated the partial day and printed "Còn 8 ngày" right
// next to "Hết 28/10/2026" — the same page disagreeing with itself, and with
// the action queue (which already used `differenceInCalendarDays`).
//
// This is a fixed-clock test on purpose: the bug only appears when "now" is
// later in the day than the midnight end timestamp, so a real clock would make
// it pass or fail depending on what time the suite runs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warrantyState } from '@/lib/format';

describe('warrantyState day counting', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 19 Oct 2026, 18:00 local — well after the midnight end timestamp.
    vi.setSystemTime(new Date(2026, 9, 19, 18, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts calendar days to a date-only warranty end (9, not 8)', () => {
    // The seeded iPhone 15 Pro: ends 2026-10-28, nine calendar days away.
    // Passed as the WIRE value (a `YYYY-MM-DD` day), not a `Date`: a Date built
    // from `'2026-10-28T00:00:00Z'` is an INSTANT and is correctly the 27th in
    // New York. The bug was parsing the day itself as that instant.
    const state = warrantyState('2026-10-28', 'vi');
    expect(state.daysLeft).toBe(9);
    expect(state.label).toBe('Còn 9 ngày');
    expect(state.tone).toBe('danger');
  });

  it('keeps an expired date at the same full-day count the action queue shows', () => {
    // The seeded fridge: ended 2025-03-10 = 588 days before 2026-10-19.
    const state = warrantyState(new Date(2025, 2, 10), 'vi');
    expect(state.daysLeft).toBe(-588);
    expect(state.label).toBe('Đã hết 588 ngày');
    expect(state.tone).toBe('expired');
  });

  it('reads a warranty ending today as "Hết hôm nay"', () => {
    const state = warrantyState(new Date(2026, 9, 19), 'vi');
    expect(state.daysLeft).toBe(0);
    expect(state.label).toBe('Hết hôm nay');
  });

  it('reads tomorrow as "Còn 1 ngày"', () => {
    const state = warrantyState(new Date(2026, 9, 20), 'vi');
    expect(state.daysLeft).toBe(1);
    expect(state.label).toBe('Còn 1 ngày');
  });
});
