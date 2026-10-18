// Reminder lead days — `Device.leadDays` + `Subscription.leadDays`.
//
// Server contract (frozen): an array of 1..5 integers, each 0..365, no
// duplicates. The server sorts descending, rejects an empty array with
// `fieldErrors.leadDays`, defaults to `[30, 7]` on create when the key is
// absent, and leaves the value unchanged on update when it is absent/null.
//
// The web is a thin proxy and does NOT re-implement that validation. What this
// module does is the small amount of normalisation that keeps an obviously
// invalid payload off the wire:
//   * sort descending (the order both the form and the detail page show),
//   * dedupe,
//   * clamp each value into 0..365,
//   * cap the list at five entries.
// Everything else is still Go's call.
//
// Parsing lives here rather than in the server actions so it can be unit-tested
// exactly as the FormData arrives (see `__tests__/lead-days.test.ts`) — the
// same split as `lib/device-return-window.ts`. The controls submit repeated
// `leadDays` entries, and a comma-separated value is accepted too; the empty
// marker input the component always mounts is what distinguishes "the user
// removed every day" (present but empty ⇒ the action rejects) from an older
// form that never had the field (absent ⇒ default/unchanged).
//
// Kept free of React / server-only imports so it is usable from the client
// form, the server action and the RSC detail page.

import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

export const LEAD_DAY_MIN = 0;
export const LEAD_DAY_MAX = 365;
export const LEAD_DAYS_MAX_ENTRIES = 5;

/** What the server uses when create omits the field; also the form's default. */
/**
 * Server default per subject. They differ on purpose: the old device cron fired
 * at 7/30 days, the old subscription cron at 3/1/0, and one default cannot
 * preserve both without changing behaviour for existing users.
 */
export const LEAD_DAYS_DEFAULT_DEVICE: readonly number[] = [30, 7];
export const LEAD_DAYS_DEFAULT_SUBSCRIPTION: readonly number[] = [3, 1, 0];

/** Preset chips. `0` means "on the due date". */
export const LEAD_DAY_PRESETS: readonly number[] = [60, 30, 14, 7, 1, 0];

/**
 * The Vietnamese sentence the action returns when the form submits zero days.
 * It is a catalog key (see `lib/i18n/messages/lead-days.ts`), so the error is
 * rendered in the active language while the same sentence stays available to
 * Go for its own `fieldErrors.leadDays`.
 */
export const LEAD_DAYS_REQUIRED_MESSAGE = 'Cần chọn ít nhất một mốc nhắc';

function toDay(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

/**
 * Sort/denormalise but keep every distinct day — used by display, where hiding
 * a sixth day the server somehow returned would be worse than showing it.
 */
function orderedLeadDays(input: readonly unknown[] | null | undefined): number[] {
  if (!input) return [];
  const seen = new Set<number>();
  const days: number[] = [];
  for (const raw of input) {
    const day = toDay(raw);
    if (day === null) continue;
    const clamped = Math.min(LEAD_DAY_MAX, Math.max(LEAD_DAY_MIN, day));
    if (seen.has(clamped)) continue;
    seen.add(clamped);
    days.push(clamped);
  }
  return days.sort((a, b) => b - a);
}

/**
 * The shape this client is willing to send: descending, deduped, clamped and no
 * more than five entries. Non-numeric input is dropped rather than coerced to
 * `NaN`.
 */
export function normalizeLeadDays(
  input: readonly unknown[] | null | undefined,
): number[] {
  return orderedLeadDays(input).slice(0, LEAD_DAYS_MAX_ENTRIES);
}

/**
 * `leadDays` from a submitted form, or `undefined` when the key is absent.
 *
 * `undefined` is meaningful: create lets Go apply `[30, 7]`, update leaves the
 * stored value untouched. An empty array is also meaningful — the field was
 * present and the user selected nothing — and is rejected before the request.
 */
export function leadDaysFromFormData(
  formData: FormData,
  key = 'leadDays',
): number[] | undefined {
  if (!formData.has(key)) return undefined;

  const values: string[] = [];
  for (const entry of formData.getAll(key)) {
    if (typeof entry !== 'string') continue;
    // Accept a single comma-separated value as well as repeated entries, so a
    // plain text field and the chip control both parse the same way.
    values.push(...entry.split(','));
  }
  return normalizeLeadDays(values);
}

/**
 * The action's pre-flight check. Returns the Vietnamese catalog key when the
 * form explicitly selected zero days; `undefined` lets the request through
 * (including when the key was absent, which the server defines as
 * default/unchanged).
 */
export function leadDaysError(
  days: readonly number[] | undefined,
): string | undefined {
  return days !== undefined && days.length === 0
    ? LEAD_DAYS_REQUIRED_MESSAGE
    : undefined;
}

function joinWithAnd(parts: string[], locale: Locale): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return translate(locale, '{head} và {last}', {
    head: parts.slice(0, -1).join(', '),
    last: parts[parts.length - 1],
  });
}

/**
 * The schedule as a sentence: `[30, 7]` ⇒ "Nhắc trước 30 và 7 ngày" /
 * "Remind 30 and 7 days before".
 *
 * `0` is rendered separately ("đúng ngày" / "on the day") because
 * "nhắc trước 0 ngày" is not how anyone says it. The value is sorted and
 * deduped first, so callers can pass the raw wire value.
 *
 * `locale` is required on purpose (same rule as `lib/format.ts`): a caller that
 * forgets it becomes a compile error instead of an untranslated fragment.
 */
export function leadDaysLabel(
  days: readonly number[] | null | undefined,
  locale: Locale,
): string {
  const ordered = orderedLeadDays(days);
  const onTheDay = ordered.includes(0);
  const positive = ordered.filter((day) => day > 0);

  if (positive.length === 0) {
    return onTheDay
      ? translate(locale, 'Nhắc đúng ngày')
      : translate(locale, 'Chưa đặt mốc nhắc');
  }

  const joined = joinWithAnd(
    positive.map((day) => String(day)),
    locale,
  );
  // English inflects "day"; a list is plural unless it is exactly `[1]`.
  const count = positive.length === 1 && positive[0] === 1 ? 1 : 2;

  return onTheDay
    ? translate(locale, 'Nhắc trước {days} ngày và đúng ngày', { days: joined, count })
    : translate(locale, 'Nhắc trước {days} ngày', { days: joined, count });
}
