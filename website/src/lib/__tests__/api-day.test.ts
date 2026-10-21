import { describe, expect, it } from 'vitest';
import {
  dayKey,
  dayToInputValue,
  daysBetween,
  daysUntil,
  formatDay,
  formatDayValue,
  isApiDay,
  parseDay,
  parseDayValue,
  toDayDate,
  todayDay,
  tryParseDay,
} from '@/lib/api-day';

// The calendar-day parser, pinned WITHOUT a timezone.
//
// Every assertion here reads the components of the returned `Date`
// (`getFullYear` / `getMonth` / `getDate`) or the rendered string — never
// `toISOString()` and never `getTime()`. That matters: a test that passed in
// Asia/Saigon is exactly the test that let this bug ship, because
// `new Date('2025-11-20')` looks correct at UTC+7 and is the 19th in
// America/New_York. These assertions pass in ANY zone; the suite is also run
// under `TZ=America/New_York` and `TZ=Asia/Saigon` to prove it.
//
// What the bug was: `new Date('2025-11-20')` is defined to be UTC midnight, so
// a negative-offset machine renders a warranty end date (or a return deadline,
// or a renewal date) one day early, silently. `parseDay` anchors the same day at
// LOCAL midnight, so its local calendar date is the day in every zone.

describe('isApiDay', () => {
  it('accepts only an exact calendar day', () => {
    expect(isApiDay('2025-11-20')).toBe(true);
    expect(isApiDay('2025-11-20 ')).toBe(false);
    expect(isApiDay('2025-11-20T00:00:00')).toBe(false);
    expect(isApiDay('2025-11-20T00:00:00Z')).toBe(false);
    expect(isApiDay('2025-1-1')).toBe(false);
    expect(isApiDay('')).toBe(false);
    expect(isApiDay(null)).toBe(false);
    expect(isApiDay(20251120)).toBe(false);
  });
});

describe('parseDay', () => {
  it('anchors the day at local midnight, with the same calendar components', () => {
    const parsed = parseDay('2025-11-20');
    expect(parsed.getFullYear()).toBe(2025);
    expect(parsed.getMonth()).toBe(10); // zero-based: November
    expect(parsed.getDate()).toBe(20);
    expect(parsed.getHours()).toBe(0);
    expect(parsed.getMinutes()).toBe(0);
    // The day the parser was given is the day the reader sees, in any zone.
    expect(dayKey(parsed)).toBe('2025-11-20');
  });

  it('keeps the day across month and year boundaries', () => {
    for (const day of ['2025-01-01', '2026-03-01', '2026-12-31', '2028-02-29']) {
      expect(dayKey(parseDay(day))).toBe(day);
    }
  });

  it('refuses an instant, loudly', () => {
    // Passing a timestamp here is the exact mistake the module prevents; it
    // must not be silently coerced.
    for (const bad of ['2025-11-20T00:00:00', '2025-11-20T00:00:00Z', '2025-11-20T07:00:00+07:00']) {
      expect(() => parseDay(bad)).toThrow(TypeError);
    }
  });

  it('refuses impossible and malformed dates instead of rolling over', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '20-11-2025', '']) {
      expect(() => parseDay(bad)).toThrow(TypeError);
    }
  });

  it('tryParseDay never throws', () => {
    expect(tryParseDay('2025-11-20')).toBeInstanceOf(Date);
    expect(tryParseDay('nope')).toBeNull();
    expect(tryParseDay(null)).toBeNull();
    expect(tryParseDay(undefined)).toBeNull();
  });
});

describe('formatDay', () => {
  it('renders the day in each language, unambiguously', () => {
    expect(formatDay('2025-11-20', 'vi')).toBe('20/11/2025');
    // English is the default language and a slash date cannot say whether
    // `11/12` is 11 December or 12 November, so the month is spelled.
    expect(formatDay('2025-11-20', 'en')).toBe('20 Nov 2025');
    expect(formatDay('2025-12-11', 'en')).toBe('11 Dec 2025');
  });

  it('does not shift the day for dates near a month boundary', () => {
    // `new Date('2025-11-01')` formats as 10/31 on a negative-offset machine.
    expect(formatDay('2025-11-01', 'en')).toBe('1 Nov 2025');
    expect(formatDay('2026-01-01', 'vi')).toBe('01/01/2026');
    expect(formatDay('2026-01-01', 'en')).toBe('1 Jan 2026');
  });

  it('returns an empty string for a value that is not a day', () => {
    expect(formatDay('2025-11-20T05:40:25.551Z', 'en')).toBe('');
    expect(formatDay('garbage', 'vi')).toBe('');
  });
});

describe('dayToInputValue', () => {
  it('round-trips a day and never shifts it', () => {
    expect(dayToInputValue('2025-11-20')).toBe('2025-11-20');
    expect(dayToInputValue(' 2026-03-01 ')).toBe('2026-03-01');
  });

  it('is empty for absent or malformed input', () => {
    expect(dayToInputValue(null)).toBe('');
    expect(dayToInputValue(undefined)).toBe('');
    expect(dayToInputValue('')).toBe('');
    expect(dayToInputValue('2025-11-20T00:00:00Z')).toBe('');
  });
});

describe('day arithmetic', () => {
  it('counts whole calendar days, signed', () => {
    expect(daysBetween('2025-11-20', '2025-11-25')).toBe(5);
    expect(daysBetween('2025-11-25', '2025-11-20')).toBe(-5);
    expect(daysBetween('2025-11-20', '2025-11-20')).toBe(0);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1); // non-leap February
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2); // leap February
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
  });

  it('daysUntil is 0 on the day and 1 the day before, whatever the clock time', () => {
    // 23:59 local is still "today" for a day-resolution deadline; an instant
    // comparison against UTC midnight would already say the day had passed.
    const lateNight = new Date(2025, 10, 20, 23, 59, 0);
    const earlyMorning = new Date(2025, 10, 20, 0, 1, 0);
    expect(daysUntil('2025-11-20', lateNight)).toBe(0);
    expect(daysUntil('2025-11-20', earlyMorning)).toBe(0);
    expect(daysUntil('2025-11-21', lateNight)).toBe(1);
    expect(daysUntil('2025-11-19', earlyMorning)).toBe(-1);
  });

  it('todayDay is the reader’s local day', () => {
    expect(todayDay(new Date(2025, 10, 20, 23, 59))).toBe('2025-11-20');
    expect(todayDay(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });
});

describe('parseDayValue / formatDayValue — server-derived day instants', () => {
  // `effectiveWarrantyEnd`, `returnDeadline` and the forecast rows are computed
  // on the server from `format: date` columns and serialised at UTC midnight.
  // Their calendar day is the UTC day; reading them as local instants is the
  // same one-day-early bug in a different disguise.
  it('reads the UTC day of a derived instant', () => {
    const parsed = parseDayValue('2026-10-28T00:00:00Z');
    expect(parsed).not.toBeNull();
    expect(dayKey(parsed!)).toBe('2026-10-28');
    expect(dayKey(parsed!)).toBe('2026-10-28');
  });

  it('accepts a plain day too, so a contract change cannot break the call site', () => {
    expect(dayKey(parseDayValue('2026-10-28')!)).toBe('2026-10-28');
  });

  it('formats a derived instant as the day it stands for', () => {
    expect(formatDayValue('2026-10-28T00:00:00Z', 'vi')).toBe('28/10/2026');
    expect(formatDayValue('2026-10-28T00:00:00Z', 'en')).toBe('28 Oct 2026');
    expect(formatDayValue('2026-01-01T00:00:00Z', 'en')).toBe('1 Jan 2026');
    expect(formatDayValue('2026-10-28', 'en')).toBe('28 Oct 2026');
  });

  it('refuses a real instant — those are rendered in the reader’s own zone', () => {
    expect(parseDayValue('2026-10-19T05:40:25.551Z')).toBeNull();
    expect(formatDayValue('2026-10-19T05:40:25.551Z', 'en')).toBe('');
    expect(parseDayValue(null)).toBeNull();
  });
});

describe('toDayDate', () => {
  it('anchors a bare day at local midnight', () => {
    const d = toDayDate('2025-11-20');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(20);
  });

  it('leaves a real instant alone', () => {
    const instant = '2026-10-19T05:40:25.551Z';
    expect(toDayDate(instant).getTime()).toBe(new Date(instant).getTime());
  });

  it('passes a Date through', () => {
    const date = new Date(2025, 10, 20, 15, 0);
    expect(toDayDate(date)).toBe(date);
  });
});

// ── The guard: no new call site may parse a day as an instant ────────────────
//
// `parseDay` fixes the sites that exist; this scan keeps the next one from
// being added. It reads the source (the same technique as
// `i18n-coverage.test.ts`) and fails on `new Date(<a calendar-day field>)` or
// `new Date('YYYY-MM-DD')`. Those are precisely the two shapes the API's day
// contract forbids a client from interpreting as an instant; a real instant
// (`createdAt`, `paidAt`) is not matched, and comments are skipped because they
// describe the bug rather than commit it.
describe('calendar days are never parsed with new Date()', () => {
  const DAY_FIELDS = [
    'purchaseDate',
    'soldAt',
    'receivedAt',
    'activatedAt',
    'extendedCoverBuyBy',
    'brandWarrantyStart',
    'brandWarrantyEnd',
    'startDate',
    'endDate',
    'startedAt',
    'renewalDate',
    'trialEndsAt',
    'targetDate',
    'expectedReturnAt',
  ];
  // `new Date(row.purchaseDate)` / `new Date('2025-11-20')` / `new Date("…")`.
  const OFFENDER = new RegExp(
    String.raw`new Date\(\s*(?:[A-Za-z_$][\w$]*\.)*(?:${DAY_FIELDS.join('|')})\b|new Date\(\s*['"]\d{4}-\d{2}-\d{2}['"]`,
  );

  it('finds no offender under src/ (comments excluded)', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { dirname, join, relative } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (/\.(ts|tsx)$/.test(path)) out.push(path);
      }
      return out;
    };
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      // The parser itself is the one file allowed to construct Dates from days.
      if (file.endsWith('lib/api-day.ts')) continue;
      if (file.includes('__tests__')) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
            return;
          }
          if (OFFENDER.test(line)) offenders.push(`${relative(SRC, file)}:${index + 1} ${trimmed}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});
