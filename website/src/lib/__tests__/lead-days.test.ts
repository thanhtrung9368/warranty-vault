import { describe, expect, it } from 'vitest';
import {
  LEAD_DAY_MAX,
  LEAD_DAY_MIN,
  LEAD_DAYS_MAX_ENTRIES,
  LEAD_DAYS_REQUIRED_MESSAGE,
  leadDaysError,
  leadDaysFromFormData,
  leadDaysLabel,
  normalizeLeadDays,
} from '@/lib/lead-days';

// Reminder lead days (`Device.leadDays` + `Subscription.leadDays`).
//
// The server contract is the authority: 1..5 integers, each 0..365, no
// duplicates, sorted descending, `[30, 7]` on create when absent, empty array
// rejected. These tests pin the client's smaller job — normalise what the form
// submits (sort, dedupe, clamp, cap) and refuse to send the one obviously
// invalid payload (zero days) — plus the Vietnamese/English schedule sentence.
//
// The FormData cases submit the same shape the chip control produces: an
// always-present marker (so "present but empty" is distinguishable from "this
// form never had the field") followed by one entry per selected day.

/** The hidden inputs `LeadDaysField` mounts for the given selection. */
function submittedForm(days: readonly (string | number)[]): FormData {
  const fd = new FormData();
  // The marker: present even when the user removed every chip.
  fd.set('leadDays', '');
  for (const day of days) fd.append('leadDays', String(day));
  return fd;
}

describe('normalizeLeadDays', () => {
  it('sorts descending, which is the order both the form and the API show', () => {
    expect(normalizeLeadDays([7, 30, 14])).toEqual([30, 14, 7]);
    expect(normalizeLeadDays([0, 1, 60])).toEqual([60, 1, 0]);
  });

  it('dedupes without changing the surviving order', () => {
    expect(normalizeLeadDays([7, 30, 7, 30, 14])).toEqual([30, 14, 7]);
    // Clamping happens before dedupe, so -1 and 0 collapse into one 0.
    expect(normalizeLeadDays([-1, 0])).toEqual([0]);
  });

  it('clamps every value into 0..365', () => {
    expect(normalizeLeadDays([-5, 366, 1000])).toEqual([LEAD_DAY_MAX, LEAD_DAY_MIN]);
    expect(normalizeLeadDays([365, 0])).toEqual([365, 0]);
  });

  it('truncates a fractional value instead of sending it', () => {
    expect(normalizeLeadDays([7.9, 1.2])).toEqual([7, 1]);
  });

  it('drops non-numeric input rather than coercing it to NaN', () => {
    expect(
      normalizeLeadDays(['abc', Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}, '']),
    ).toEqual([]);
    expect(normalizeLeadDays(['30', ' 7 '])).toEqual([30, 7]);
  });

  it('caps the list at five entries, dropping the smallest after sorting', () => {
    expect(normalizeLeadDays([1, 2, 3, 4, 5, 6])).toEqual([6, 5, 4, 3, 2]);
    expect(normalizeLeadDays([1, 2, 3, 4, 5, 6]).length).toBe(LEAD_DAYS_MAX_ENTRIES);
  });

  it('treats absent and empty input as no days', () => {
    expect(normalizeLeadDays(undefined)).toEqual([]);
    expect(normalizeLeadDays(null)).toEqual([]);
    expect(normalizeLeadDays([])).toEqual([]);
  });
});

describe('leadDaysFromFormData', () => {
  it('returns undefined when the key is absent, meaning default/unchanged', () => {
    // `undefined` is load-bearing: create lets Go apply [30, 7] and update
    // leaves the stored list alone. It is NOT the same as an empty selection.
    expect(leadDaysFromFormData(new FormData())).toBeUndefined();
  });

  it('treats the marker alone as an explicit empty selection', () => {
    expect(leadDaysFromFormData(submittedForm([]))).toEqual([]);
    expect(leadDaysError(leadDaysFromFormData(submittedForm([])))).toBe(
      LEAD_DAYS_REQUIRED_MESSAGE,
    );
  });

  it('reads the repeated hidden entries the chip control submits', () => {
    expect(leadDaysFromFormData(submittedForm([7, 30, 14]))).toEqual([30, 14, 7]);
  });

  it('accepts a single comma-separated value too', () => {
    const fd = new FormData();
    fd.set('leadDays', '30,7,14');
    expect(leadDaysFromFormData(fd)).toEqual([30, 14, 7]);
  });

  it('normalises duplicates, out-of-range and blank entries from a crafted form', () => {
    // A user (or a stale client) can submit anything; the client only promises
    // to send a syntactically valid array, not to replace Go's validator.
    expect(leadDaysFromFormData(submittedForm([7, 7, 400, -3, '', 30]))).toEqual([365, 30, 7, 0]);
  });

  it('drops a non-string entry and still parses the rest', () => {
    const fd = new FormData();
    fd.set('leadDays', '');
    fd.append('leadDays', new Blob(['x']), 'lead.txt');
    fd.append('leadDays', '7');
    expect(leadDaysFromFormData(fd)).toEqual([7]);
  });

  it('uses the key argument so one helper can parse both entities', () => {
    const fd = new FormData();
    fd.set('leadDaysCustom', '30');
    expect(leadDaysFromFormData(fd, 'leadDaysCustom')).toEqual([30]);
    expect(leadDaysFromFormData(fd)).toBeUndefined();
  });
});

describe('leadDaysError', () => {
  it('lets an absent list through (server default / unchanged)', () => {
    expect(leadDaysError(undefined)).toBeUndefined();
  });

  it('lets a populated list through and leaves further validation to Go', () => {
    expect(leadDaysError([30, 7])).toBeUndefined();
    expect(leadDaysError([0])).toBeUndefined();
  });

  it('rejects zero selected days with the catalog key', () => {
    expect(leadDaysError([])).toBe(LEAD_DAYS_REQUIRED_MESSAGE);
  });
});

describe('leadDaysLabel', () => {
  // Language is pinned explicitly, matching the rest of the suite. Vietnamese
  // is the original, so its assertions read the contract's own example.
  it('renders the contract example in Vietnamese', () => {
    expect(leadDaysLabel([30, 7], 'vi')).toBe('Nhắc trước 30 và 7 ngày');
  });

  it('renders the same schedule in English', () => {
    expect(leadDaysLabel([30, 7], 'en')).toBe('Remind 30 and 7 days before');
  });

  it('sorts and dedupes before formatting', () => {
    expect(leadDaysLabel([7, 30, 7], 'vi')).toBe('Nhắc trước 30 và 7 ngày');
    expect(leadDaysLabel([7, 60, 30, 14], 'vi')).toBe(
      'Nhắc trước 60, 30, 14 và 7 ngày',
    );
  });

  it('renders 0 as "on the day" instead of "0 days before"', () => {
    expect(leadDaysLabel([0], 'vi')).toBe('Nhắc đúng ngày');
    expect(leadDaysLabel([0], 'en')).toBe('Remind on the day');
    expect(leadDaysLabel([0, 7], 'vi')).toBe('Nhắc trước 7 ngày và đúng ngày');
    expect(leadDaysLabel([0, 7], 'en')).toBe(
      'Remind 7 days before and on the day',
    );
  });

  it('uses the English singular only for a lone 1-day lead', () => {
    expect(leadDaysLabel([1], 'en')).toBe('Remind 1 day before');
    // Descending order means the 7 comes first even though 1 was passed first.
    expect(leadDaysLabel([1, 7], 'en')).toBe('Remind 7 and 1 days before');
    // Vietnamese does not inflect; same sentence either way.
    expect(leadDaysLabel([1], 'vi')).toBe('Nhắc trước 1 ngày');
  });

  it('clamps out-of-range wire values rather than printing them', () => {
    expect(leadDaysLabel([400, -1], 'vi')).toBe(
      'Nhắc trước 365 ngày và đúng ngày',
    );
  });

  it('explains the absence of a schedule instead of rendering an empty line', () => {
    expect(leadDaysLabel([], 'vi')).toBe('Chưa đặt mốc nhắc');
    expect(leadDaysLabel([], 'en')).toBe('No reminder days set');
    expect(leadDaysLabel(undefined, 'vi')).toBe('Chưa đặt mốc nhắc');
    expect(leadDaysLabel(null, 'en')).toBe('No reminder days set');
  });
});
