// The day-count → pill-label mapping, in a module with NO date library.
//
// Why this is separate from `format.ts`: `format.ts` imports `date-fns` (its
// date formatting, currency formatting and relative-time helpers need it), and
// importing anything from that module therefore puts `date-fns` in the client
// graph. The landing page's product shot is a client component that only ever
// needs "days left → sentence", so it imports this file and stays free of
// `date-fns` — measured as ~6 KB gzipped of the landing's client bundle.
//
// `warrantyState` (which has to read the clock and parse a date) stays in
// `format.ts` and delegates here.

import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

export type WarrantyState = {
  daysLeft: number;
  label: string;
  tone: 'safe' | 'warn' | 'danger' | 'expired';
};

/**
 * The label and tone for an ALREADY-COMPUTED calendar-day count.
 *
 * Split out of `warrantyState` for the landing page's product shot, which is a
 * client component: it receives the day count from the server (`daysBetween`)
 * instead of re-deriving "today" in the browser. `new Date()` on the server and
 * on the client can disagree across midnight, and `Date` arithmetic can
 * disagree across time zones; either would make hydration rewrite the demo's
 * pills after first paint. A number has no timezone — the label is then pure.
 */
export function warrantyStateFromDays(days: number, locale: Locale): WarrantyState {
  if (days < 0) {
    const n = Math.abs(days);
    return {
      daysLeft: days,
      label: translate(locale, 'Đã hết {days} ngày', { days: n, count: n }),
      tone: 'expired',
    };
  }
  if (days === 0) return { daysLeft: 0, label: translate(locale, 'Hết hôm nay'), tone: 'danger' };
  if (days <= 15)
    return {
      daysLeft: days,
      label: translate(locale, 'Còn {days} ngày', { days, count: days }),
      tone: 'danger',
    };
  if (days <= 30)
    return {
      daysLeft: days,
      label: translate(locale, 'Còn {days} ngày', { days, count: days }),
      tone: 'warn',
    };
  if (days <= 90)
    return {
      daysLeft: days,
      label: translate(locale, 'Còn {days} ngày', { days, count: days }),
      tone: 'safe',
    };
  // > 90 days, render as months for compactness
  const months = Math.floor(days / 30);
  return {
    daysLeft: days,
    label: translate(locale, 'Còn {months} tháng', { months, count: months }),
    tone: 'safe',
  };
}
