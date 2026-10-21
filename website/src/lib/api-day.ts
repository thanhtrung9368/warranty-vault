// The ONE way to turn an API calendar day into a `Date` or a rendered string.
//
// ── Why this module exists ────────────────────────────────────────────────
//
// The Go API emits calendar days as exactly `YYYY-MM-DD` (`format: date`):
// `Device.purchaseDate` / `soldAt` / `receivedAt` / `activatedAt` /
// `extendedCoverBuyBy` / `brandWarrantyStart` / `brandWarrantyEnd`,
// `Warranty.startDate` / `endDate`, `Subscription.startedAt` / `renewalDate` /
// `trialEndsAt`, `WishlistItem.targetDate`, `Claim.expectedReturnAt`.
//
// A day has no timezone, but `new Date('2025-11-20')` is *defined by the
// language* to be UTC midnight. In the product's own market (UTC+7) that
// renders as the 20th and looks fine; west of UTC it renders as the 19th — a
// warranty end date, a return deadline and a renewal date all one day early,
// silently. The API was changed specifically so a client cannot move a day this
// way, so the web needs a parser that never consults a timezone.
//
// Rules:
//   * `parseDay` anchors at LOCAL midnight (`new Date(y, m - 1, d)`), which is
//     the only instant whose local calendar date is always that day.
//   * `formatDay` does not build a `Date` at all — it slices the day out of the
//     string — so formatting cannot shift it either.
//   * Arithmetic (`daysBetween`, `daysUntil`) is done on `Date.UTC` numbers of
//     the day *components*, which are timezone-free integers.
//
// `src/lib/format.ts` delegates a bare-day string to `formatDay` as a safety
// net, but arithmetic and `<input type="date">` values must come through here:
// format.ts cannot help a caller that already did `new Date(day).getTime()`.
//
// ── Instants that stand for a day ─────────────────────────────────────────
//
// A few server-COMPUTED fields are still serialised as instants at UTC
// midnight of a calendar day: `DeviceListItem.effectiveWarrantyEnd` /
// `returnDeadline`, and `Forecast.upcomingWarranties[].endDate` /
// `upcomingWishlist[].targetDate` (`…T00:00:00Z`). They are derived from
// `format: date` columns on the server, so their calendar day is their **UTC**
// day — `parseDayValue` / `formatDayValue` read those, and nothing else. Never
// pass a real user-visible instant (`createdAt`, `paidAt`) to them: an instant
// means "this moment", and its local date is the correct rendering.

import type { Locale } from '@/lib/i18n/locale';

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `<day>T00:00:00[.000]Z` — the shape a server-derived day instant has. */
const DAY_INSTANT_PATTERN = /^(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?Z$/;

const MS_PER_DAY = 86_400_000;

/**
 * True only for an exact `YYYY-MM-DD`. Deliberately strict: `2026-03-01T…`
 * is an instant, not a day, and callers must decide which one they have.
 */
export function isApiDay(value: unknown): value is string {
  return typeof value === 'string' && DAY_PATTERN.test(value);
}

function components(day: string): [number, number, number] | null {
  const match = DAY_PATTERN.exec(day.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * A calendar day as a `Date` at LOCAL midnight.
 *
 * Throws on anything that is not an exact, real `YYYY-MM-DD` — an instant
 * reaching this function is a programming error (use `new Date()` for an
 * instant, `parseDayValue` for a server-derived day instant), and failing loud
 * here is what stops the UTC-midnight bug coming back one call site at a time.
 * Wire data of unknown validity goes through `tryParseDay`.
 */
export function parseDay(day: string): Date {
  const parts = components(day);
  if (!parts) {
    throw new TypeError(`parseDay: ${JSON.stringify(day)} is not a YYYY-MM-DD calendar day`);
  }
  const [year, month, date] = parts;
  const parsed = new Date(year, month - 1, date);
  // `new Date(2026, 1, 31)` silently rolls over to 3 March; reject that rather
  // than rendering a day the API never sent.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== date
  ) {
    throw new TypeError(`parseDay: ${JSON.stringify(day)} is not a real calendar date`);
  }
  return parsed;
}

/** `parseDay` that never throws — `null` for anything that is not a real day. */
export function tryParseDay(value: string | null | undefined): Date | null {
  if (value == null) return null;
  try {
    return parseDay(value.trim());
  } catch {
    return null;
  }
}

// English month names, spelled out here rather than pulled from `date-fns`'
// locale data: this module is deliberately dependency-free, and the English
// display form must be one fixed spelling ("12 Nov 2026"), not whatever the
// bundled locale data happens to say.
const ENGLISH_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * The ONE place a calendar day becomes display text.
 *
 *   vi → `20/11/2025`  (dd/MM/yyyy — the Vietnamese convention, unambiguous
 *                       to the reader the app is written for)
 *   en → `20 Nov 2025` (month name — a slash date cannot say whether `11/12`
 *                       is 11 December or 12 November, and the app is English
 *                       by default, so the English form has to be explicit)
 *
 * `formatDay` / `formatDayValue` / `format.ts::formatDate` all delegate here, so
 * the two languages cannot drift into two different date shapes on two screens.
 * Never build a `Date` for this: the day already is one, and a `Date` would put
 * the rendering back at the mercy of the machine's timezone.
 */
export function formatDayParts(
  year: number,
  month: number,
  date: number,
  locale: Locale,
): string {
  if (locale === 'vi') {
    return `${String(date).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  }
  return `${date} ${ENGLISH_MONTHS[month - 1]} ${year}`;
}

/**
 * Render a calendar day in the reader's convention (`formatDayParts`).
 *
 * Sliced, never `new Date()`d: the whole point of this module is that
 * rendering a day cannot depend on the machine's timezone. `''` for malformed
 * input so a bad wire value renders as an empty cell rather than "Invalid
 * Date" or a silently shifted day.
 */
export function formatDay(day: string, locale: Locale): string {
  const parts = components(day);
  if (!parts) return '';
  const [year, month, date] = parts;
  return formatDayParts(year, month, date, locale);
}

/**
 * `yyyy-MM-dd` for an `<input type="date">`; `''` when absent/malformed.
 *
 * Accepts a `Date` as well because several form props are typed
 * `Date | string`; a `Date` is rendered by its LOCAL components (it was already
 * parsed by the caller), a string must be an exact day.
 */
export function dayToInputValue(value: Date | string | null | undefined): string {
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : dayKey(value);
  return tryParseDay(value) ? value.trim() : '';
}

/** Local calendar day of `date` as `YYYY-MM-DD` (the app's day key). */
export function dayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dateOfMonth = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${dateOfMonth}`;
}

/** Today in the reader's calendar, as `YYYY-MM-DD`. */
export function todayDay(now: Date = new Date()): string {
  return dayKey(now);
}

/** Whole calendar days from `fromDay` to `toDay`; negative when `toDay` is earlier. */
export function daysBetween(fromDay: string, toDay: string): number {
  const from = components(fromDay);
  const to = components(toDay);
  if (!from || !to || !tryParseDay(fromDay) || !tryParseDay(toDay)) {
    throw new TypeError('daysBetween: both arguments must be YYYY-MM-DD calendar days');
  }
  const fromMs = Date.UTC(from[0], from[1] - 1, from[2]);
  const toMs = Date.UTC(to[0], to[1] - 1, to[2]);
  return Math.round((toMs - fromMs) / MS_PER_DAY);
}

/**
 * Whole calendar days from `now` to `value` — `0` when it is today, negative
 * once it has passed. `NaN` for an unreadable value (the caller guards).
 *
 * `value` may be:
 *   * a plain `YYYY-MM-DD` day;
 *   * a server-derived day instant (`…T00:00:00Z`), whose UTC day is the day it
 *     stands for;
 *   * a real instant, whose LOCAL calendar day is what the reader sees.
 *
 * That order matters: it lets one helper serve a warranty end (day), the action
 * queue's server-computed `dueDate` (derived instant) and a snooze deadline
 * (real instant) without any of them being read on the wrong clock.
 */
export function daysUntil(value: string, now: Date = new Date()): number {
  const day = parseDayValue(value);
  if (day) return daysBetween(todayDay(now), dayKey(day));
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return Number.NaN;
  return daysBetween(todayDay(now), dayKey(instant));
}

/**
 * The UTC calendar day of a server-derived day instant (`…T00:00:00Z`), or of
 * a plain `YYYY-MM-DD`. `null` for anything else.
 *
 * Only for the computed fields listed in the module header. Reading the UTC
 * day is correct for them because the server itself stored/derived the value at
 * UTC midnight; reading it as a local instant is what moves it a day.
 */
export function parseDayValue(value: string | null | undefined): Date | null {
  if (value == null) return null;
  const raw = value.trim();
  const direct = tryParseDay(raw);
  if (direct) return direct;
  const match = DAY_INSTANT_PATTERN.exec(raw);
  return match ? tryParseDay(match[1]) : null;
}

/** `formatDay` for a day or a server-derived day instant (see `parseDayValue`). */
export function formatDayValue(value: string | null | undefined, locale: Locale): string {
  if (value == null) return '';
  const raw = value.trim();
  const direct = components(raw);
  if (direct) return formatDay(raw, locale);
  const match = DAY_INSTANT_PATTERN.exec(raw);
  return match ? formatDay(match[1], locale) : '';
}

/**
 * Coerce a `Date | string` that a pure helper received into a `Date` used for
 * DAY arithmetic.
 *
 * A bare day becomes local midnight via `parseDay`; anything else keeps
 * `new Date(value)` semantics (it is an instant, and its local calendar day is
 * what the reader sees). This is the single place a helper may consume an
 * untyped date argument — do not open-code the branch at the call site.
 */
export function toDayDate(value: Date | string): Date {
  return typeof value === 'string' ? (tryParseDay(value) ?? new Date(value)) : value;
}
