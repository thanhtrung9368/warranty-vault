// The reminder-schedule sentence, with the translator supplied by the caller.
//
// Why this is a separate module: `lead-days.ts` also owns the FormData parsing,
// and it translates through `i18n/catalog.ts` (the full map). The landing page's
// product shot needs only this one sentence, and importing `lead-days.ts` would
// pull the full dictionary into `/`'s client bundle. The parsing helpers stay in
// `lead-days.ts`; the label logic lives here so a client component can pass its
// provider's `t` and ship only the few keys the sentence needs.
//
// Nothing here may import `./i18n/catalog` or `./i18n/messages`.

import type { Translator } from './i18n/types';

// Same bounds as `lead-days.ts`. Duplicated rather than imported because that
// module reaches the full catalog; the display path only needs to clamp, and a
// future change to the wire contract would land in both files together.
const LEAD_DAY_MIN = 0;
const LEAD_DAY_MAX = 365;

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
export function orderedLeadDays(input: readonly unknown[] | null | undefined): number[] {
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

function joinWithAnd(t: Translator, parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return t('{head} và {last}', {
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
 * The translator is required on purpose: a caller that forgets it becomes a
 * compile error instead of an untranslated fragment.
 */
export function leadDaysLabelWith(
  t: Translator,
  days: readonly number[] | null | undefined,
): string {
  const ordered = orderedLeadDays(days);
  const onTheDay = ordered.includes(0);
  const positive = ordered.filter((day) => day > 0);

  if (positive.length === 0) {
    return onTheDay ? t('Nhắc đúng ngày') : t('Chưa đặt mốc nhắc');
  }

  const joined = joinWithAnd(t, positive.map((day) => String(day)));
  // English inflects "day"; a list is plural unless it is exactly `[1]`.
  const count = positive.length === 1 && positive[0] === 1 ? 1 : 2;

  return onTheDay
    ? t('Nhắc trước {days} ngày và đúng ngày', { days: joined, count })
    : t('Nhắc trước {days} ngày', { days: joined, count });
}
