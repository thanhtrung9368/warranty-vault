// Multi-currency device helpers.
//
// The API contract (frozen, implemented by the Go service in parallel):
//
//   - `Device.currency` is an ISO-4217 code, default `VND`.
//   - `Device.fxRate` is VND per ONE unit of `currency`, locked when the device
//     is entered. `NULL` for VND; required for every other currency.
//   - `purchasePrice`, `soldPrice` and each `Warranty.cost` are in the DEVICE's
//     currency — not in đồng.
//   - Every device read also returns `purchasePriceVnd` / `soldPriceVnd`,
//     computed by the server. Those are the only values totals may sum: this
//     module exposes a display-only preview for the form, never a client-side
//     conversion used in a rollup.
//
// Everything here is pure so it is unit-testable without a backend — the same
// pattern as `lib/format.ts` / `lib/stats-rollup.ts`.

import { formatVND } from './format';
import type { Locale } from './i18n/locale';

/** The server default and the only currency whose rate must be null. */
export const DEFAULT_DEVICE_CURRENCY = 'VND';

/**
 * Currencies offered by the device form's picker.
 *
 * A curated list rather than `Intl.supportedValuesOf('currency')`: that API is
 * not available in every browser this app supports, and a list that differs
 * between the server render and the client hydration would be a mismatch. A
 * code outside this list can still be stored by another client — display goes
 * through `Intl`, which accepts any well-formed ISO code.
 */
export const DEVICE_CURRENCIES = [
  'VND',
  'USD',
  'EUR',
  'GBP',
  'CHF',
  'JPY',
  'KRW',
  'CNY',
  'TWD',
  'HKD',
  'SGD',
  'THB',
  'MYR',
  'IDR',
  'PHP',
  'INR',
  'AUD',
  'NZD',
  'CAD',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'RUB',
  'TRY',
  'AED',
  'BRL',
  'MXN',
  'ZAR',
] as const;

/**
 * Normalize a wire/form value to an uppercase ISO-4217-shaped code.
 *
 * A missing/blank value means "the server default", exactly like the API: it
 * does NOT mean "invalid". A value that is not three letters falls back to VND
 * as well; the form's select only ever ships a code from the list above, so this
 * is a defensive path rather than a validation rule (Go remains the authority).
 */
export function normalizeCurrency(value: string | null | undefined): string {
  const code = (value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : DEFAULT_DEVICE_CURRENCY;
}

/** True when the currency needs a locked rate (i.e. is not VND). */
export function needsFxRate(currency: string | null | undefined): boolean {
  return normalizeCurrency(currency) !== DEFAULT_DEVICE_CURRENCY;
}

/** The rate to send: VND never carries one, even if a stale field had a value. */
export function fxRateForCurrency(
  currency: string | null | undefined,
  rate: number | null | undefined,
): number | null {
  return needsFxRate(currency) ? (rate ?? null) : null;
}

export type FxRateProblem = 'required' | 'invalid';

/**
 * Client-side mirror of the frozen API rule:
 *
 *   - VND            ⇒ no rate (a supplied one is dropped, not an error)
 *   - non-VND        ⇒ a positive INTEGER is required; missing ⇒ `required`
 *
 * Go remains the authority for everything else (and produces the final 400
 * `fieldErrors.fxRate`); this exists so the form does not spend a round-trip
 * on a payload we already know is invalid.
 */
export function fxRateProblem(
  currency: string | null | undefined,
  rate: number | null | undefined,
): FxRateProblem | null {
  if (!needsFxRate(currency)) return null;
  if (rate == null) return 'required';
  if (!Number.isInteger(rate) || rate <= 0) return 'invalid';
  return null;
}

/** Parse the rate input's display string; blank is `null`, not `0`. */
export function parseFxRateInput(input: string | null | undefined): number | null {
  if (input == null) return null;
  const digits = input.replace(/[^\d]/g, '');
  return digits === '' ? null : parseInt(digits, 10);
}

/**
 * Display-only VND preview for the device form.
 *
 * This is deliberately NOT used by any total: the API returns the authoritative
 * `purchasePriceVnd` / `soldPriceVnd` for every read. Here we are only showing
 * the person typing what their rate will store.
 */
export function vndEquivalent(
  amount: number | null | undefined,
  currency: string | null | undefined,
  rate: number | null | undefined,
): number | null {
  const value = amount ?? 0;
  if (normalizeCurrency(currency) === DEFAULT_DEVICE_CURRENCY) return Math.round(value);
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(value * rate);
}

/** Suffix used inside a money input: `₫` for VND, the ISO code otherwise. */
export function currencySuffix(currency: string | null | undefined): string {
  const code = normalizeCurrency(currency);
  return code === DEFAULT_DEVICE_CURRENCY ? '₫' : code;
}

const MONEY_FORMATTERS = new Map<string, Intl.NumberFormat>();

function moneyFormatter(locale: Locale, currency: string): Intl.NumberFormat {
  const key = `${locale}:${currency}`;
  const cached = MONEY_FORMATTERS.get(key);
  if (cached) return cached;
  const formatter = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
    style: 'currency',
    currency,
    // Đồng has no subunit in practice, so VND keeps the app's existing
    // whole-number rendering. Every other currency shows cents.
    minimumFractionDigits: currency === DEFAULT_DEVICE_CURRENCY ? 0 : 2,
    maximumFractionDigits: currency === DEFAULT_DEVICE_CURRENCY ? 0 : 2,
  });
  MONEY_FORMATTERS.set(key, formatter);
  return formatter;
}

/**
 * Format an amount in the currency it is actually denominated in.
 *
 * `formatVND` is still the right function for a value the server has already
 * converted (`…Vnd`); this one is for a raw device/currency amount, so a $999
 * phone can never be rendered with a ₫ sign. VND goes through `formatVND` so
 * its existing output is byte-identical to the rest of the app.
 */
export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined,
  locale: Locale,
): string {
  const code = normalizeCurrency(currency);
  const value = amount == null || Number.isNaN(amount) ? 0 : amount;
  if (code === DEFAULT_DEVICE_CURRENCY) return formatVND(value, locale);
  try {
    return moneyFormatter(locale, code).format(value);
  } catch {
    // A malformed code from legacy data must not take a page down. Fall back to
    // VND formatting rather than printing `NaN` or an Intl exception.
    return formatVND(value, locale);
  }
}
