import { format, differenceInCalendarDays } from 'date-fns';
import { enUS, vi } from 'date-fns/locale';
import {
  dayKey,
  formatDay,
  isApiDay,
  parseDayValue,
  toDayDate,
} from '@/lib/api-day';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';
import {
  warrantyStateFromDays,
  type WarrantyState,
} from './warranty-state';

// Locale-aware value formatting. These are not sentences but they do reach the
// user, and both of them are ambiguous across the two languages:
//
//   dates  — a pure `dd/MM/yyyy` form is right for Vietnamese, but English is
//            the default language and a slash date cannot tell an English
//            reader whether `11/12/2026` is 11 December or 12 November. So the
//            English form spells the month (`12 Nov 2026`). The ONE definition
//            of that pair lives in `api-day.ts::formatDayParts`; `formatDate`
//            only turns a `Date` into a calendar day and delegates, so a
//            second formatter cannot creep in and drift.
//   money  — Vietnamese đồng is not denominated in a foreign currency, so only
//            its position and the thousands separator change:
//            `1.200.000 ₫` / `₫1,200,000` (mirrors `i18n.FormatMoney`).
//
// `locale` is a REQUIRED parameter on every function here. That is deliberate:
// an optional locale defaulting to Vietnamese would let an unconverted call site
// render Vietnamese formatting inside an English page and report nothing —
// exactly the class of silent failure this work exists to remove. Required turns
// every missed call site into a compile error.

const CURRENCY_FORMAT: Record<Locale, Intl.NumberFormat> = {
  // Constructing an Intl.NumberFormat is not free, and there are only two.
  vi: new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }),
  en: new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }),
};

const NUMBER_FORMAT: Record<Locale, Intl.NumberFormat> = {
  vi: new Intl.NumberFormat('vi-VN'),
  en: new Intl.NumberFormat('en-US'),
};

const DATE_LONG: Record<Locale, { pattern: string; locale: typeof vi }> = {
  vi: { pattern: "EEEE, dd 'tháng' MM, yyyy", locale: vi },
  en: { pattern: 'EEEE, MMMM d, yyyy', locale: enUS },
};

export function formatVND(amount: number | null | undefined, locale: Locale): string {
  if (amount == null || isNaN(amount)) return CURRENCY_FORMAT[locale].format(0);
  return CURRENCY_FORMAT[locale].format(amount);
}

export function formatNumber(amount: number | null | undefined, locale: Locale): string {
  if (amount == null || isNaN(amount)) return NUMBER_FORMAT[locale].format(0);
  return NUMBER_FORMAT[locale].format(amount);
}

export function parseVNDInput(input: string): number {
  // Digits only, locale-independent: "15.000.000 ₫" and "15,000,000 ₫" must land
  // on the same number whichever language the person typing is reading.
  const cleaned = input.replace(/[^\d]/g, '');
  return cleaned ? parseInt(cleaned, 10) : 0;
}

export function formatDate(date: Date | string, locale: Locale): string {
  // Every day-bearing value converges on a `YYYY-MM-DD` day and one formatter:
  //   * a bare `YYYY-MM-DD` is a CALENDAR DAY, not an instant — pass it through
  //     untouched (`formatDay` slices, it never builds a `Date`);
  //   * anything else is an instant (or a `Date`), whose LOCAL calendar day is
  //     what the reader sees, so it is reduced to that day with `dayKey`.
  // `new Date('2026-11-12')` would be UTC midnight and render as the 11th west
  // of UTC — the bug `lib/api-day.ts` exists to remove.
  const day =
    typeof date === 'string' && isApiDay(date) ? date.trim() : dayKey(toDayDate(date));
  return formatDay(day, locale);
}

export function formatDateLong(date: Date | string, locale: Locale): string {
  const d = toDayDate(date);
  const { pattern, locale: dateLocale } = DATE_LONG[locale];
  return format(d, pattern, { locale: dateLocale });
}

// Relative time, day-resolution. Anchored to "now" so:
//   today → "hôm nay" / "today", yesterday → "hôm qua" / "yesterday",
//   N≥2 ngày → "N ngày trước" / "N days ago", week+ → weeks, month+ → months.
// Future dates flip to "trong …" / "in …". English carries a singular form for
// every count (docs/I18N_PLAN.md §4.6); Vietnamese does not inflect.
export function formatRelativeDay(
  date: Date | string,
  locale: Locale,
  now: Date = new Date(),
): string {
  const d = toDayDate(date);
  // Compare on day boundaries so a record at 23:59 yesterday reads "hôm qua",
  // not "vài giờ trước". `toDayDate` anchors a bare day at LOCAL midnight, so
  // the boundary is the reader's own day in every timezone.
  const startOf = (x: Date) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  const days = Math.round(
    (startOf(now).getTime() - startOf(d).getTime()) / 86_400_000,
  );
  if (days === 0) return translate(locale, 'hôm nay');
  if (days === 1) return translate(locale, 'hôm qua');
  if (days === -1) return translate(locale, 'ngày mai');
  if (days > 1 && days < 7)
    return translate(locale, '{days} ngày trước', { days, count: days });
  if (days < -1 && days > -7)
    return translate(locale, 'trong {days} ngày', { days: -days, count: -days });
  if (days >= 7 && days < 30) {
    const w = Math.round(days / 7);
    return translate(locale, '{weeks} tuần trước', { weeks: w, count: w });
  }
  if (days <= -7 && days > -30) {
    const w = Math.round(-days / 7);
    return translate(locale, 'trong {weeks} tuần', { weeks: w, count: w });
  }
  if (days >= 30 && days < 365) {
    const m = Math.round(days / 30);
    return translate(locale, '{months} tháng trước', { months: m, count: m });
  }
  if (days <= -30 && days > -365) {
    const m = Math.round(-days / 30);
    return translate(locale, 'trong {months} tháng', { months: m, count: m });
  }
  const y = Math.round(Math.abs(days) / 365);
  return days > 0
    ? translate(locale, '{years} năm trước', { years: y, count: y })
    : translate(locale, 'trong {years} năm', { years: y, count: y });
}

export { warrantyStateFromDays } from './warranty-state';
export type { WarrantyState } from './warranty-state';

export function warrantyState(warrantyEnd: Date | string, locale: Locale): WarrantyState {
  // Local midnight for a bare day (and for the server-derived day instant),
  // so `differenceInCalendarDays` compares the two local calendar dates. The
  // old `new Date('2026-10-28')` was UTC midnight, which is the 27th in New
  // York — "Còn 8 ngày" beside "Hết 28/10/2026" in the same card.
  const end =
    typeof warrantyEnd === 'string'
      ? (parseDayValue(warrantyEnd) ?? new Date(warrantyEnd))
      : warrantyEnd;
  // Calendar days, not elapsed 24-hour periods. At 18:00 on the 19th there are
  // 9 calendar days left but only 8 full days — the old `differenceInDays` said
  // "Còn 8 ngày" while the same page printed "Hết 28/10/2026".
  return warrantyStateFromDays(differenceInCalendarDays(end, new Date()), locale);
}

export function warrantyToneClass(tone: WarrantyState['tone']): string {
  switch (tone) {
    case 'safe':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'warn':
      return 'text-amber-600 dark:text-amber-400';
    case 'danger':
      return 'text-red-600 dark:text-red-400';
    case 'expired':
      return 'text-zinc-500 dark:text-zinc-500';
  }
}

export function warrantyBgClass(tone: WarrantyState['tone']): string {
  switch (tone) {
    case 'safe':
      return 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900';
    case 'warn':
      return 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900';
    case 'danger':
      return 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900';
    case 'expired':
      return 'bg-zinc-50 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800';
  }
}
