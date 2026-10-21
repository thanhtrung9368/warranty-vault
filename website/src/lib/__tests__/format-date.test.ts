import { describe, expect, it } from 'vitest';
import { formatDate } from '@/lib/format';
import { formatDay, formatDayValue } from '@/lib/api-day';

// Date display, pinned per language.
//
// English is the product default, and a slash date cannot say whether
// `11/12/2026` is 11 December or 12 November to an English reader. The chosen
// rule is:
//   vi → `12/11/2026`  (dd/MM/yyyy, the Vietnamese convention)
//   en → `12 Nov 2026` (month spelled out, unambiguous to everyone)
//
// `formatDate` is the surface almost every screen uses; `formatDay` /
// `formatDayValue` are the day-string half. All three must be the SAME
// formatter, or the app drifts into two date shapes — which is what this file
// pins. Storage and wire values are untouched: these functions only render.

describe('formatDate — locale-aware day display', () => {
  it('renders dd/MM/yyyy in Vietnamese', () => {
    expect(formatDate('2026-11-12', 'vi')).toBe('12/11/2026');
    expect(formatDate('2026-01-02', 'vi')).toBe('02/01/2026');
  });

  it('renders a spelled month in English (never a slash date)', () => {
    expect(formatDate('2026-11-12', 'en')).toBe('12 Nov 2026');
    expect(formatDate('2026-01-02', 'en')).toBe('2 Jan 2026');
    // `11/12` in both directions would be ambiguous; the month name is not.
    expect(formatDate('2026-12-11', 'en')).toBe('11 Dec 2026');
    expect(formatDate('2026-12-11', 'en')).not.toContain('/');
  });

  it('is exactly formatDay for a bare calendar day — one helper, no drift', () => {
    for (const day of ['2026-11-12', '2024-02-29', '2026-01-01', '2027-10-21']) {
      expect(formatDate(day, 'vi')).toBe(formatDay(day, 'vi'));
      expect(formatDate(day, 'en')).toBe(formatDay(day, 'en'));
    }
  });

  it('agrees with formatDayValue on the server-derived day-instant shape', () => {
    // `effectiveWarrantyEnd` / `returnDeadline` arrive as `…T00:00:00Z` and are
    // rendered through formatDayValue; the same day through formatDate must not
    // differ by a day or by a shape.
    expect(formatDate('2026-10-28', 'en')).toBe('28 Oct 2026');
    expect(formatDayValue('2026-10-28T00:00:00Z', 'en')).toBe('28 Oct 2026');
    expect(formatDate('2026-10-28', 'vi')).toBe(formatDayValue('2026-10-28T00:00:00Z', 'vi'));
  });

  it('uses the LOCAL calendar day of a Date or instant', () => {
    // 23:59 local is still that calendar day for a reader; a UTC-midnight
    // round-trip would move it west of UTC. `new Date(y, m, d)` is local, so
    // this assertion is timezone-independent.
    expect(formatDate(new Date(2026, 10, 12, 23, 59), 'en')).toBe('12 Nov 2026');
    expect(formatDate(new Date(2026, 10, 12, 0, 1), 'vi')).toBe('12/11/2026');
  });

  it('renders an unreadable value as an empty string, not "Invalid Date"', () => {
    expect(formatDate('not-a-day', 'en')).toBe('');
  });
});
