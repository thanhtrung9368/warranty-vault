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
//
// This module keeps the `(days, locale)` signature for the server pages and the
// signed-in app's client components. Those may translate against the full map.
// The public landing page instead imports `warranty-state-core.ts` and passes
// its provider's translator, so the marketing surface does not drag the whole
// dictionary into first-load JS just to render three demo pills.

import { translatorFor } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';
import { warrantyStateFromDaysWith, type WarrantyState } from './warranty-state-core';

export type { WarrantyState };

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
  return warrantyStateFromDaysWith(translatorFor(locale), days);
}
