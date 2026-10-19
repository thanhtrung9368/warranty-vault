// Pure helpers for the device resale pair (roadmap #12 / migration 0006):
// `Device.soldAt` + `Device.soldPrice`, and the profit/loss they imply.
//
// Kept free of React / server-only imports so it can be unit-tested under
// `src/lib/__tests__/` and reused by both the device form (client) and the
// device detail page (RSC).
//
// Wire format caution (openapi.yaml `Device.soldAt`): the Go service emits a
// CALENDAR DAY, `YYYY-MM-DD` (`format: date`) — the same shape as
// `purchaseDate`. The write path accepts `YYYY-MM-DD` or full RFC3339.
// Parsing/formatting goes through `lib/api-day.ts`; `new Date(day)` is UTC
// midnight and would move the day for a reader west of UTC.

import { dayToInputValue, formatDay, tryParseDay } from './api-day';
import { parseVNDInput } from './format';
import { formatMoney } from './currency';
import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

// The exact Vietnamese copy the Go validator writes into `fieldErrors` for the
// pair rule / negative price (api/internal/services/devices.go). Kept literally
// here — they are the dictionary keys (see the entry for each in
// `lib/i18n/messages/warranties.ts`), so the form can reject the same input
// *before* the round-trip while still telling the user exactly what the server
// would have said, in whichever language the request is being served in.
export const SOLD_AT_REQUIRED_MESSAGE = 'Thiếu ngày bán';
export const SOLD_PRICE_REQUIRED_MESSAGE = 'Thiếu giá bán';
export const SOLD_PRICE_INVALID_MESSAGE = 'Giá bán không hợp lệ';

/** Toast copy for a client-side sale validation failure, keyed by field. */
export const SALE_FIELD_MESSAGES: Record<'soldAt' | 'soldPrice', string> = {
  soldAt: SOLD_AT_REQUIRED_MESSAGE,
  soldPrice: SOLD_PRICE_REQUIRED_MESSAGE,
};

export type SaleFields = {
  /** `YYYY-MM-DD` from an `<input type="date">`, or blank/null when unset. */
  soldAt: string | null | undefined;
  /** Device currency. `0` is a legitimate price (cho tặng) — only null/undefined means unset. */
  soldPrice: number | null | undefined;
};

export type SaleFieldErrors = {
  soldAt?: string[];
  soldPrice?: string[];
};


/**
 * Format a `Device.soldAt` wire value for an `<input type="date">`.
 *
 * The contract value is `"2026-03-01"`; it is sliced rather than
 * `new Date(...)`d so it cannot shift by a day on a machine in another
 * timezone. A legacy pre-migration value (`"2026-03-01T00:00:00"`) keeps its
 * leading day too — leaving the input empty would silently clear the recorded
 * sale on the next save. Anything still unreadable yields `''`.
 */
export function soldAtToInputValue(value: string | null | undefined): string {
  const exact = dayToInputValue(value);
  if (exact || value == null) return exact;
  const trimmed = value.trim();
  if (trimmed === '') return '';
  const legacyPrefix = trimmed.slice(0, 10);
  return tryParseDay(legacyPrefix) ? legacyPrefix : '';
}

/**
 * Display a `YYYY-MM-DD` value (what the form's date input holds) as a plain
 * calendar day in the reader's convention — `dd/MM/yyyy` in Vietnamese,
 * `MM/dd/yyyy` in English.
 *
 * `formatDay` slices the day; `new Date(day)` would be UTC midnight and render
 * the *previous* day for anyone west of UTC. Empty for input that is not a day.
 */
export function saleDayLabel(day: string | null | undefined, locale: Locale): string {
  return day ? formatDay(day, locale) : '';
}

/**
 * Parse the money input's display string. Blank ⇒ `null` ("chưa ghi nhận"),
 * which is deliberately different from `0` ("bán cho tặng") — the pair rule
 * hinges on that distinction.
 */
export function soldPriceFromInput(display: string | null | undefined): number | null {
  if (display == null || display.trim() === '') return null;
  return parseVNDInput(display);
}

/**
 * Client-side mirror of the server's resale pair rule. Returns the same
 * `fieldErrors` shape Go produces — the messages already rendered in `locale`,
 * exactly as the API's own `fieldErrors` are — or `{}` when the sale is complete
 * / absent.
 *
 *   - both blank  ⇒ no sale (`{}`), which the write path treats as "clear it"
 *   - only a date ⇒ `Thiếu giá bán`
 *   - only a price ⇒ `Thiếu ngày bán`
 *   - negative price ⇒ `Giá bán không hợp lệ`
 */
export function validateSale(input: SaleFields, locale: Locale): SaleFieldErrors {
  const errors: SaleFieldErrors = {};
  const date = typeof input.soldAt === 'string' ? input.soldAt.trim() : '';
  const hasDate = date !== '';
  const hasPrice = input.soldPrice != null;

  if (hasPrice && (input.soldPrice as number) < 0) {
    // Same order as Go: the negative-price message is written first, then the
    // pair rule may add/replace keys. A complete-but-negative pair keeps this
    // message; a negative price with no date reports both fields.
    errors.soldPrice = [translate(locale, SOLD_PRICE_INVALID_MESSAGE)];
  }
  if (hasDate !== hasPrice) {
    if (!hasDate) errors.soldAt = [translate(locale, SOLD_AT_REQUIRED_MESSAGE)];
    else errors.soldPrice = [translate(locale, SOLD_PRICE_REQUIRED_MESSAGE)];
  }
  return errors;
}

/**
 * Form-level variant of {@link validateSale} for the "Ghi nhận đã bán" toggle.
 *
 * While the toggle is off there is nothing to record (`{}`), which is also what
 * the API sees — the form submits `{soldAt: null, soldPrice: null}`. While it is
 * on, "both absent" is no longer a valid answer: the user has declared a sale,
 * so the date becomes required and `validateSale` then reports whichever half is
 * still missing. Both messages are the server's own wording.
 */
export function validateSaleToggled(
  input: SaleFields,
  toggled: boolean,
  locale: Locale,
): SaleFieldErrors {
  if (!toggled) return {};
  const errors = validateSale(input, locale);
  if (Object.keys(errors).length > 0) return errors;
  const date = typeof input.soldAt === 'string' ? input.soldAt.trim() : '';
  if (date === '' && input.soldPrice == null) {
    return { soldAt: [translate(locale, SOLD_AT_REQUIRED_MESSAGE)] };
  }
  return {};
}

/**
 * True when the device carries a resale record, i.e. the "Bán lại" block on the
 * detail page should be rendered at all. The server enforces both-or-neither,
 * so the OR keeps the row visible (instead of silently hiding half a record)
 * if legacy data ever shows up with only one side populated.
 */
export function hasSaleRecorded(device: {
  soldAt?: string | null;
  soldPrice?: number | null;
}): boolean {
  return Boolean(device.soldAt) || device.soldPrice != null;
}

export type SaleProfitLoss = {
  /** soldPrice − purchasePrice, in the device's currency. Negative = loss. */
  amount: number;
  tone: 'profit' | 'loss' | 'even';
  /** Already money-formatted in the request's locale and device currency. */
  label: string;
};

/**
 * Profit/loss of a resale versus the purchase price. The API never returns
 * this (openapi: "Lãi/lỗ = soldPrice − purchasePrice (client tự tính)"), so it
 * is computed here and unit-tested. `null` when there is no sale price.
 *
 * `currency` defaults to VND so existing callers stay correct, but a device
 * bought in USD must render `Lãi $100.00` — not `Lãi 100 ₫`. The subtraction is
 * same-currency arithmetic, not a VND conversion: both figures come from the
 * device and the server's locked rate is deliberately not applied here.
 */
export function saleProfitLoss(
  purchasePrice: number | null | undefined,
  soldPrice: number | null | undefined,
  locale: Locale,
  currency: string = 'VND',
): SaleProfitLoss | null {
  if (soldPrice == null) return null;
  const cost = purchasePrice ?? 0;
  const amount = soldPrice - cost;
  if (amount > 0) {
    return {
      amount,
      tone: 'profit',
      label: translate(locale, 'Lãi {amount}', {
        amount: formatMoney(amount, currency, locale),
      }),
    };
  }
  if (amount < 0) {
    return {
      amount,
      tone: 'loss',
      label: translate(locale, 'Lỗ {amount}', {
        amount: formatMoney(-amount, currency, locale),
      }),
    };
  }
  return { amount: 0, tone: 'even', label: translate(locale, 'Hoà vốn') };
}
