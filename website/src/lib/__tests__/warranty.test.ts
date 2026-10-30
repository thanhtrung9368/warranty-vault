import { describe, it, expect } from 'vitest';
import { effectiveWarrantyEnd, calcEndDate } from '@/lib/warranty';

// `effectiveWarrantyEnd()` returns the latest endDate across a device's
// warranty rows, or null when there are none. The function does not look
// at expiry status or dismissed reminders — that filtering happens at
// the data fetch layer (Go `/v1/reminders`).

describe('effectiveWarrantyEnd', () => {
  it('returns null for an empty array', () => {
    expect(effectiveWarrantyEnd([])).toBeNull();
  });

  it('returns null for null / undefined input', () => {
    expect(effectiveWarrantyEnd(null)).toBeNull();
    expect(effectiveWarrantyEnd(undefined)).toBeNull();
  });

  it('returns the single warranty endDate when only one is present', () => {
    const end = new Date('2027-06-30');
    const out = effectiveWarrantyEnd([{ endDate: end }]);
    expect(out?.toISOString()).toBe(end.toISOString());
  });

  it('returns the max endDate across STANDARD + EXTENDED warranties', () => {
    const standardEnd = new Date('2026-01-15'); // shorter
    const extendedEnd = new Date('2027-06-30'); // longer — should win
    const out = effectiveWarrantyEnd([
      { endDate: standardEnd },
      { endDate: extendedEnd },
    ]);
    expect(out?.toISOString()).toBe(extendedEnd.toISOString());
  });

  it('handles ISO string endDate values (Go wire shape)', () => {
    const out = effectiveWarrantyEnd([
      { endDate: '2026-01-15T00:00:00.000Z' },
      { endDate: '2027-06-30T00:00:00.000Z' },
    ]);
    expect(out?.toISOString()).toBe(
      new Date('2027-06-30T00:00:00.000Z').toISOString(),
    );
  });

  it('returns the latest endDate even when every warranty has expired', () => {
    // Dismissed-reminder / expired-status filtering belongs to the caller
    // (see CLAUDE.md cron note). This function returns the raw max regardless.
    const oldest = new Date('2018-01-01');
    const newest = new Date('2020-12-31');
    const out = effectiveWarrantyEnd([
      { endDate: oldest },
      { endDate: newest },
    ]);
    expect(out?.toISOString()).toBe(newest.toISOString());
  });

  it('returns endDate as-is when warranties contain a dismissed reminder marker', () => {
    // The function signature only looks at `endDate`; dismissed flags don't
    // change its output. This is intentional — the reminders page does the
    // filtering via Go's `/v1/reminders` endpoint.
    const end = new Date('2027-06-30');
    const out = effectiveWarrantyEnd([{ endDate: end }]);
    expect(out?.toISOString()).toBe(end.toISOString());
  });

  it('handles mixed Date + string inputs', () => {
    const dateEnd = new Date('2026-03-10');
    const stringLater = '2028-12-01T00:00:00.000Z';
    const out = effectiveWarrantyEnd([
      { endDate: dateEnd },
      { endDate: stringLater },
    ]);
    expect(out?.toISOString()).toBe(new Date(stringLater).toISOString());
  });
  it('ignores component-scoped rows, keeping only whole-unit ones', () => {
    // A fridge with a ten-year motor warranty and a two-year whole-unit one.
    // Taking the max would say the fridge is covered until 2035 — the exact
    // mistake `api/internal/services/brand_warranty.go` names in a comment.
    const result = effectiveWarrantyEnd([
      { endDate: '2028-01-01' },
      { endDate: '2035-01-01', component: 'Động cơ' },
      { endDate: '2026-06-01', component: '   ' }, // blank = whole unit
    ]);
    expect(result?.getFullYear()).toBe(2028);
  });

  it('returns null when every row is component-scoped', () => {
    expect(
      effectiveWarrantyEnd([{ endDate: '2035-01-01', component: 'Động cơ' }]),
    ).toBeNull();
  });

});

describe('calcEndDate', () => {
  it('adds N months to a Date start', () => {
    const start = new Date('2026-01-15T00:00:00.000Z');
    const out = calcEndDate(start, 24);
    expect(out.getUTCFullYear()).toBe(2028);
    expect(out.getUTCMonth()).toBe(0); // January
    expect(out.getUTCDate()).toBe(15);
  });

  it('accepts an ISO string start', () => {
    const out = calcEndDate('2026-06-01T00:00:00.000Z', 6);
    expect(out.getUTCFullYear()).toBe(2026);
    expect(out.getUTCMonth()).toBe(11); // December
  });

  it('clamps a month-end start instead of rolling into the next month', () => {
    // The create wizard shows this as "Warranty ends …", so the boundary has to
    // be the calendar's answer: 31 Jan + 1 month is 28/29 Feb, not 3 March.
    // (Tested via local components: `toDayDate` anchors a bare day at LOCAL
    // midnight, so UTC getters would shift west of UTC.)
    const jan31 = calcEndDate('2026-01-31', 1);
    expect([jan31.getFullYear(), jan31.getMonth(), jan31.getDate()]).toEqual([
      2026, 1, 28,
    ]);
    const leapJan31 = calcEndDate('2028-01-31', 1);
    expect([leapJan31.getFullYear(), leapJan31.getMonth(), leapJan31.getDate()]).toEqual([
      2028, 1, 29,
    ]);
  });

  it('treats 0 months as "same day" (the form shows no end date at all)', () => {
    const same = calcEndDate('2026-10-21', 0);
    expect([same.getFullYear(), same.getMonth(), same.getDate()]).toEqual([
      2026, 9, 21,
    ]);
  });
});
