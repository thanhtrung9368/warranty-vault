// The pure day-count → pill label mapping, with the translator supplied by the
// caller.
//
// This module exists so a CLIENT component can render the pill without importing
// the full message catalog. `warranty-state.ts` keeps the old
// `(days, locale)` signature for server pages and app client components, which
// are allowed to translate against the full map; the landing page passes its
// provider's `t` here instead, so `/` no longer pulls `i18n/catalog.ts` (and
// therefore `messages/index.ts`) into first-load JS.
//
// Nothing here may import `./i18n/catalog` or `./i18n/messages`.

import type { Translator } from './i18n/types';

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
export function warrantyStateFromDaysWith(t: Translator, days: number): WarrantyState {
  if (days < 0) {
    const n = Math.abs(days);
    return {
      daysLeft: days,
      label: t('Đã hết {days} ngày', { days: n, count: n }),
      tone: 'expired',
    };
  }
  if (days === 0) return { daysLeft: 0, label: t('Hết hôm nay'), tone: 'danger' };
  if (days <= 15) {
    return {
      daysLeft: days,
      label: t('Còn {days} ngày', { days, count: days }),
      tone: 'danger',
    };
  }
  if (days <= 30) {
    return {
      daysLeft: days,
      label: t('Còn {days} ngày', { days, count: days }),
      tone: 'warn',
    };
  }
  if (days <= 90) {
    return {
      daysLeft: days,
      label: t('Còn {days} ngày', { days, count: days }),
      tone: 'safe',
    };
  }
  // > 90 days, render as months for compactness
  const months = Math.floor(days / 30);
  return {
    daysLeft: days,
    label: t('Còn {months} tháng', { months, count: months }),
    tone: 'safe',
  };
}
