import { describe, it, expect } from 'vitest';
import { monthlyEquivalent, nextRenewalDate } from '@/lib/subscription-types';

describe('monthlyEquivalent', () => {
  it('returns the price unchanged for MONTHLY', () => {
    expect(monthlyEquivalent(100_000, 'MONTHLY')).toBe(100_000);
  });

  it('normalizes QUARTERLY over ~91 days', () => {
    // round(300000 * 30 / 91) = round(98901.09) = 98901
    expect(monthlyEquivalent(300_000, 'QUARTERLY')).toBe(98_901);
  });

  it('normalizes YEARLY over 365 days', () => {
    // round(1200000 * 30 / 365) = round(98630.1) = 98630
    expect(monthlyEquivalent(1_200_000, 'YEARLY')).toBe(98_630);
  });

  it('treats LIFETIME as zero monthly cost', () => {
    expect(monthlyEquivalent(5_000_000, 'LIFETIME')).toBe(0);
  });

  it('uses intervalDays for CUSTOM', () => {
    // round(60000 * 30 / 15) = 120000
    expect(monthlyEquivalent(60_000, 'CUSTOM', 15)).toBe(120_000);
  });

  it('returns null for CUSTOM without a positive intervalDays', () => {
    expect(monthlyEquivalent(60_000, 'CUSTOM')).toBeNull();
    expect(monthlyEquivalent(60_000, 'CUSTOM', 0)).toBeNull();
    expect(monthlyEquivalent(60_000, 'CUSTOM', -5)).toBeNull();
  });
});

describe('nextRenewalDate', () => {
  // Build dates in local time to match the function's local-time mutations.
  const from = new Date(2026, 0, 15); // 2026-01-15

  function ymd(d: Date) {
    return [d.getFullYear(), d.getMonth(), d.getDate()];
  }

  it('adds one month for MONTHLY', () => {
    expect(ymd(nextRenewalDate(from, 'MONTHLY'))).toEqual([2026, 1, 15]);
  });

  it('adds three months for QUARTERLY', () => {
    expect(ymd(nextRenewalDate(from, 'QUARTERLY'))).toEqual([2026, 3, 15]);
  });

  it('adds one year for YEARLY', () => {
    expect(ymd(nextRenewalDate(from, 'YEARLY'))).toEqual([2027, 0, 15]);
  });

  it('adds intervalDays for CUSTOM', () => {
    expect(ymd(nextRenewalDate(from, 'CUSTOM', 10))).toEqual([2026, 0, 25]);
  });

  it('pushes LIFETIME 100 years out (sentinel)', () => {
    expect(nextRenewalDate(from, 'LIFETIME').getFullYear()).toBe(2126);
  });

  it('does not mutate the input date', () => {
    const original = new Date(2026, 0, 15);
    nextRenewalDate(original, 'YEARLY');
    expect(ymd(original)).toEqual([2026, 0, 15]);
  });
});
