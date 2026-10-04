import { format, differenceInDays } from 'date-fns';
import { enUS, vi } from 'date-fns/locale';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

// Locale-aware value formatting. These are not sentences but they do reach the
// user, and both of them are ambiguous across the two languages:
//
//   dates  — `07/05/2026` is 7 May to a Vietnamese reader and 5 July to an
//            American one. There is no "neutral" rendering, so the date has to
//            follow the language (mirrors `i18n.FormatDate` in the Go service).
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

const DATE_PATTERN: Record<Locale, string> = {
  vi: 'dd/MM/yyyy',
  en: 'MM/dd/yyyy',
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
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, DATE_PATTERN[locale], { locale: locale === 'vi' ? vi : enUS });
}

export function formatDateLong(date: Date | string, locale: Locale): string {
  const d = typeof date === 'string' ? new Date(date) : date;
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
  const d = typeof date === 'string' ? new Date(date) : date;
  // Compare on day boundaries so a record at 23:59 yesterday reads "hôm qua",
  // not "vài giờ trước".
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

export type WarrantyState = {
  daysLeft: number;
  label: string;
  tone: 'safe' | 'warn' | 'danger' | 'expired';
};

export function warrantyState(warrantyEnd: Date | string, locale: Locale): WarrantyState {
  const end = typeof warrantyEnd === 'string' ? new Date(warrantyEnd) : warrantyEnd;
  const days = differenceInDays(end, new Date());
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
