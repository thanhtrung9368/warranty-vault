// Pure helpers for the subscription free trial (Feature B):
// `Subscription.trialEndsAt` + `Subscription.convertsToPrice`.
//
// The two fields answer different questions and are deliberately NOT
// independent:
//   - `trialEndsAt`      — when the free period ends and billing starts.
//   - `convertsToPrice`  — what the plan costs after that conversion, in VND.
//
// A price without a trial end is the one invalid combination, and the server
// rejects it with `fieldErrors.convertsToPrice`. The form prevents it by
// construction (it only mounts the price input once a trial end exists, and
// clears the price when the date is cleared) rather than by copying the
// server's validator into the client.
//
// "Trial vs renewal" is a display decision made here: while a trial is
// recorded, "Dùng thử đến …" is the honest answer to "when does money move",
// and the normal "Gia hạn tới …" card must not compete with it. With no trial,
// these helpers return `null` and the page keeps its existing renewal copy.

import { daysUntil } from './api-day';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';
import { formatDate, formatVND } from './format';

/** Structural subset of `Subscription` the helpers need. */
export type TrialSource = {
  trialEndsAt?: string | null;
  convertsToPrice?: number | null;
};

export type TrialPhase = 'none' | 'trial' | 'ended';

/**
 * Which billing phase the recorded trial is in:
 *   `none`   — no trial date (or an unreadable one): the plan is a normal plan.
 *   `trial`  — the free period is still running (`trialEndsAt` today or later).
 *   `ended`  — the conversion date has passed; billing has started.
 *
 * `trialEndsAt` is a CALENDAR DAY (`format: date`), not an instant: a trial
 * recorded as ending on the 1st is still running through the 1st, and billing
 * starts on the 2nd. Comparing it as an instant (`new Date(day)` is UTC
 * midnight) ended the trial at 07:00 on the last day in UTC+7 and at 20:00 the
 * previous day in New York — before the day the user recorded.
 */
export function trialPhase(
  source: TrialSource,
  now: Date = new Date(),
): TrialPhase {
  const raw = source.trialEndsAt?.trim();
  if (!raw) return 'none';
  const days = daysUntil(raw, now);
  if (!Number.isFinite(days)) return 'none';
  return days >= 0 ? 'trial' : 'ended';
}

/**
 * "Dùng thử đến 01/04/2026" while the trial runs, "Đã hết dùng thử từ …" once
 * it has converted, and `null` when no trial was recorded — in which case the
 * detail page keeps showing the renewal date it always showed.
 */
export function trialLabel(
  source: TrialSource,
  locale: Locale,
  now: Date = new Date(),
): string | null {
  const raw = source.trialEndsAt?.trim();
  const phase = trialPhase(source, now);
  if (phase === 'none' || !raw) return null;
  const date = formatDate(raw, locale);
  return phase === 'trial'
    ? translate(locale, 'Dùng thử đến {date}', { date })
    : translate(locale, 'Đã hết dùng thử từ {date}', { date });
}

/**
 * "Giá sau dùng thử: 199.000 ₫" — the price that applies once the free period
 * ends. `null` when the price is unknown, which is a valid state (the user may
 * know the date but not the figure); the label is simply omitted, never
 * rendered as "0 ₫".
 */
export function conversionPriceLabel(
  price: number | null | undefined,
  locale: Locale,
): string | null {
  if (price == null || !Number.isFinite(price)) return null;
  return translate(locale, 'Giá sau dùng thử: {amount}', {
    amount: formatVND(price, locale),
  });
}
