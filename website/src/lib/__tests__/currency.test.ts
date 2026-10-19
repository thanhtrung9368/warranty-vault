import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEVICE_CURRENCY,
  DEVICE_CURRENCIES,
  currencySuffix,
  formatMoney,
  fxRateForCurrency,
  fxRateProblem,
  needsFxRate,
  normalizeCurrency,
  parseFxRateInput,
  vndEquivalent,
} from '@/lib/currency';
import { formatVND } from '@/lib/format';
import { hasMessage } from '@/lib/i18n/catalog';

// Pure rules for the frozen multi-currency contract:
//   currency = VND ⇒ fxRate null; currency ≠ VND ⇒ a positive integer rate.
//   Raw amounts are formatted in their own currency, never as đồng.
//   The form's VND preview is display-only; totals use server `…Vnd` fields.

describe('normalizeCurrency', () => {
  it('defaults a missing value to VND and normalizes case', () => {
    expect(normalizeCurrency(undefined)).toBe('VND');
    expect(normalizeCurrency(null)).toBe('VND');
    expect(normalizeCurrency('')).toBe('VND');
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency(' eur ')).toBe('EUR');
  });

  it('refuses anything that is not a three-letter ISO-shaped code', () => {
    expect(normalizeCurrency('US')).toBe('VND');
    expect(normalizeCurrency('USDD')).toBe('VND');
    expect(normalizeCurrency('12$')).toBe('VND');
  });

  it('offers exactly the currencies the API accepts, VND first', () => {
    // Mirrors `api/internal/fx/fx.go::supportedCurrencies` and the openapi enum.
    // A picker entry outside this list would be a guaranteed 400
    // `fieldErrors.currency`; a missing one would hide a valid choice.
    expect([...DEVICE_CURRENCIES]).toEqual([
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
    ]);
    expect(DEVICE_CURRENCIES[0]).toBe(DEFAULT_DEVICE_CURRENCY);
  });
});

describe('the rate-required rule', () => {
  it('never requires a rate for VND, and drops a stale one', () => {
    expect(needsFxRate('VND')).toBe(false);
    expect(fxRateProblem('VND', null)).toBeNull();
    expect(fxRateProblem('VND', 25_400)).toBeNull();
    expect(fxRateForCurrency('VND', 25_400)).toBeNull();
  });

  it('requires a rate for every other currency', () => {
    expect(needsFxRate('USD')).toBe(true);
    expect(fxRateProblem('USD', null)).toBe('required');
    expect(fxRateProblem('USD', undefined)).toBe('required');
    expect(fxRateForCurrency('USD', null)).toBeNull();
  });

  it('accepts a positive integer and rejects zero, negatives and fractions', () => {
    expect(fxRateProblem('USD', 25_400)).toBeNull();
    expect(fxRateProblem('USD', 1)).toBeNull();
    expect(fxRateProblem('USD', 0)).toBe('invalid');
    expect(fxRateProblem('USD', -1)).toBe('invalid');
    expect(fxRateProblem('USD', 25_400.5)).toBe('invalid');
  });

  it('parses the display string back to an integer, blank ⇒ null', () => {
    expect(parseFxRateInput('')).toBeNull();
    expect(parseFxRateInput('25.400')).toBe(25_400);
    expect(parseFxRateInput('25,400')).toBe(25_400);
    expect(parseFxRateInput('0')).toBe(0);
  });

  it('registers both client-side rejection messages in both languages', () => {
    expect(hasMessage('Vui lòng nhập tỷ giá.')).toBe(true);
    expect(hasMessage('Tỷ giá phải là số nguyên lớn hơn 0.')).toBe(true);
  });
});

describe('formatMoney', () => {
  it('renders VND exactly like formatVND — the app’s existing money output', () => {
    expect(formatMoney(1_200_000, 'VND', 'vi')).toBe(formatVND(1_200_000, 'vi'));
    expect(formatMoney(1_200_000, 'VND', 'en')).toBe(formatVND(1_200_000, 'en'));
  });

  it('renders a USD amount with a dollar sign, never with ₫', () => {
    const en = formatMoney(999, 'USD', 'en');
    expect(en).toContain('$');
    expect(en).toContain('999.00');
    expect(en).not.toContain('₫');

    const vi = formatMoney(999, 'USD', 'vi');
    expect(vi).toContain('US$');
    expect(vi).toContain('999,00');
    expect(vi).not.toContain('₫');
  });

  it('shows cents for a foreign currency and none for đồng', () => {
    expect(formatMoney(999.5, 'USD', 'en')).toBe('$999.50');
    expect(formatMoney(999.5, 'VND', 'en')).toBe(formatVND(999.5, 'en'));
  });

  it('falls back to VND for a missing/legacy currency instead of throwing', () => {
    expect(formatMoney(1_000, undefined, 'en')).toBe(formatVND(1_000, 'en'));
    expect(formatMoney(1_000, 'nope', 'en')).toBe(formatVND(1_000, 'en'));
  });

  it('uses the ISO code as the input suffix for a foreign currency', () => {
    expect(currencySuffix('VND')).toBe('₫');
    expect(currencySuffix('USD')).toBe('USD');
    expect(currencySuffix('usd')).toBe('USD');
  });
});

describe('vndEquivalent (form preview only)', () => {
  it('multiplies a foreign amount by the locked rate', () => {
    expect(vndEquivalent(999, 'USD', 25_400)).toBe(25_374_600);
    expect(vndEquivalent(999.5, 'USD', 25_400)).toBe(25_387_300);
  });

  it('returns the amount unchanged for VND and null without a rate', () => {
    expect(vndEquivalent(25_000_000, 'VND', null)).toBe(25_000_000);
    expect(vndEquivalent(999, 'USD', null)).toBeNull();
    expect(vndEquivalent(999, 'USD', 0)).toBeNull();
  });
});
