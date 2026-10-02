import { describe, it, expect } from 'vitest';
import {
  SOLD_AT_REQUIRED_MESSAGE,
  SOLD_PRICE_INVALID_MESSAGE,
  SOLD_PRICE_REQUIRED_MESSAGE,
  hasSaleRecorded,
  saleDayLabel,
  saleProfitLoss,
  soldAtToInputValue,
  soldPriceFromInput,
  validateSale,
  validateSaleToggled,
} from '@/lib/device-resale';

// The resale pair (`Device.soldAt` / `Device.soldPrice`, migration 0006).
// `soldAt` serialises exactly like `purchaseDate`: `YYYY-MM-DDTHH:MM:SS[.fff]`
// with no `Z` and no offset. Everything below is written so that a naive
// `new Date(value).toISOString()` implementation would fail — see the
// "+07:00" case, whose UTC calendar day is the day before.

describe('soldAtToInputValue', () => {
  it('maps the unset states to an empty date input', () => {
    expect(soldAtToInputValue(null)).toBe('');
    expect(soldAtToInputValue(undefined)).toBe('');
    expect(soldAtToInputValue('')).toBe('');
    expect(soldAtToInputValue('   ')).toBe('');
  });

  it('slices the calendar day out of the Go wire shape (no Z, no offset)', () => {
    expect(soldAtToInputValue('2026-03-01T00:00:00')).toBe('2026-03-01');
    expect(soldAtToInputValue('2026-03-01T00:00:00.000')).toBe('2026-03-01');
    expect(soldAtToInputValue('2026-03-01T23:59:59')).toBe('2026-03-01');
  });

  it('accepts the plain YYYY-MM-DD form the date input itself produces', () => {
    expect(soldAtToInputValue('2026-03-01')).toBe('2026-03-01');
  });

  it('does not shift the day through a UTC round-trip', () => {
    // `new Date('2026-03-01T00:00:00+07:00').toISOString()` is 2026-02-28T17:00Z,
    // so a naive implementation would hand the user the previous day.
    expect(soldAtToInputValue('2026-03-01T00:00:00+07:00')).toBe('2026-03-01');
    // …and a value already in UTC keeps its own calendar day rather than
    // drifting forward in a positive-offset timezone.
    expect(soldAtToInputValue('2026-02-28T17:00:00Z')).toBe('2026-02-28');
  });

  it('falls back to the purchaseDate handling for other parseable input', () => {
    expect(soldAtToInputValue('March 1, 2026')).toBe('2026-03-01');
  });

  it('returns an empty input for unparseable input', () => {
    expect(soldAtToInputValue('31/03/2026')).toBe('');
    expect(soldAtToInputValue('không phải ngày')).toBe('');
  });
});

describe('saleDayLabel', () => {
  it('renders a YYYY-MM-DD day as dd/MM/yyyy without a Date round-trip', () => {
    expect(saleDayLabel('2026-03-01')).toBe('01/03/2026');
    expect(saleDayLabel('2026-03-01T00:00:00')).toBe('01/03/2026');
    expect(saleDayLabel(' 2026-12-31 ')).toBe('31/12/2026');
  });

  it('is empty for the unset states and unchanged for non-days', () => {
    expect(saleDayLabel(null)).toBe('');
    expect(saleDayLabel(undefined)).toBe('');
    expect(saleDayLabel('')).toBe('');
    expect(saleDayLabel('hôm qua')).toBe('hôm qua');
  });
});

describe('soldPriceFromInput', () => {
  it('treats blank as "not recorded" (null, not 0)', () => {
    expect(soldPriceFromInput('')).toBeNull();
    expect(soldPriceFromInput('   ')).toBeNull();
    expect(soldPriceFromInput(null)).toBeNull();
    expect(soldPriceFromInput(undefined)).toBeNull();
  });

  it('keeps 0 as a real price (cho tặng)', () => {
    expect(soldPriceFromInput('0')).toBe(0);
  });

  it('parses the grouped display string the money input shows', () => {
    expect(soldPriceFromInput('7.500.000')).toBe(7_500_000);
    expect(soldPriceFromInput('7.500.000 ₫')).toBe(7_500_000);
    expect(soldPriceFromInput('12abc')).toBe(12);
  });
});

describe('validateSale', () => {
  it('accepts "not sold" (both sides absent)', () => {
    expect(validateSale({ soldAt: null, soldPrice: null })).toEqual({});
    expect(validateSale({ soldAt: '', soldPrice: null })).toEqual({});
    expect(validateSale({ soldAt: '   ', soldPrice: null })).toEqual({});
  });

  it('accepts a complete sale, including a 0 price', () => {
    expect(validateSale({ soldAt: '2026-03-01', soldPrice: 7_500_000 })).toEqual({});
    expect(validateSale({ soldAt: '2026-03-01', soldPrice: 0 })).toEqual({});
  });

  it('rejects a price with no date using the server wording', () => {
    expect(validateSale({ soldAt: null, soldPrice: 7_500_000 })).toEqual({
      soldAt: [SOLD_AT_REQUIRED_MESSAGE],
    });
    expect(validateSale({ soldAt: '   ', soldPrice: 7_500_000 })).toEqual({
      soldAt: [SOLD_AT_REQUIRED_MESSAGE],
    });
  });

  it('rejects a date with no price using the server wording', () => {
    expect(validateSale({ soldAt: '2026-03-01', soldPrice: null })).toEqual({
      soldPrice: [SOLD_PRICE_REQUIRED_MESSAGE],
    });
  });

  it('rejects a negative price', () => {
    expect(validateSale({ soldAt: '2026-03-01', soldPrice: -1 })).toEqual({
      soldPrice: [SOLD_PRICE_INVALID_MESSAGE],
    });
  });

  it('reports both sides for a negative price with no date (Go order)', () => {
    expect(validateSale({ soldAt: null, soldPrice: -1 })).toEqual({
      soldAt: [SOLD_AT_REQUIRED_MESSAGE],
      soldPrice: [SOLD_PRICE_INVALID_MESSAGE],
    });
  });
});

describe('validateSaleToggled', () => {
  it('has nothing to check while the toggle is off', () => {
    expect(validateSaleToggled({ soldAt: '', soldPrice: null }, false)).toEqual({});
    expect(validateSaleToggled({ soldAt: '2026-03-01', soldPrice: 5 }, false)).toEqual({});
  });

  it('requires at least a date once the user declares a sale', () => {
    expect(validateSaleToggled({ soldAt: '', soldPrice: null }, true)).toEqual({
      soldAt: [SOLD_AT_REQUIRED_MESSAGE],
    });
    expect(validateSaleToggled({ soldAt: '   ', soldPrice: null }, true)).toEqual({
      soldAt: [SOLD_AT_REQUIRED_MESSAGE],
    });
  });

  it('falls through to the pair rule once one side is filled', () => {
    expect(validateSaleToggled({ soldAt: '2026-03-01', soldPrice: null }, true)).toEqual({
      soldPrice: [SOLD_PRICE_REQUIRED_MESSAGE],
    });
    expect(validateSaleToggled({ soldAt: '', soldPrice: 5_000_000 }, true)).toEqual({
      soldAt: [SOLD_AT_REQUIRED_MESSAGE],
    });
  });

  it('accepts a complete sale, including a 0 price', () => {
    expect(validateSaleToggled({ soldAt: '2026-03-01', soldPrice: 0 }, true)).toEqual({});
    expect(validateSaleToggled({ soldAt: '2026-03-01', soldPrice: 1 }, true)).toEqual({});
  });
});

describe('hasSaleRecorded', () => {
  it('is false when nothing was recorded', () => {
    expect(hasSaleRecorded({})).toBe(false);
    expect(hasSaleRecorded({ soldAt: null, soldPrice: null })).toBe(false);
    expect(hasSaleRecorded({ soldAt: '', soldPrice: null })).toBe(false);
  });

  it('is true for a complete sale — a 0 price still counts', () => {
    expect(hasSaleRecorded({ soldAt: '2026-03-01', soldPrice: 0 })).toBe(true);
    expect(hasSaleRecorded({ soldAt: '2026-03-01', soldPrice: 7_500_000 })).toBe(true);
  });

  it('is true when only one half is present (legacy/half data stays visible)', () => {
    expect(hasSaleRecorded({ soldAt: '2026-03-01', soldPrice: null })).toBe(true);
    expect(hasSaleRecorded({ soldAt: null, soldPrice: 7_500_000 })).toBe(true);
  });
});

describe('saleProfitLoss', () => {
  it('reports a profit as soldPrice − purchasePrice', () => {
    const pl = saleProfitLoss(10_000_000, 12_000_000);
    expect(pl).not.toBeNull();
    expect(pl!.amount).toBe(2_000_000);
    expect(pl!.tone).toBe('profit');
    expect(pl!.label.startsWith('Lãi ')).toBe(true);
    expect(pl!.label).toContain('2.000.000');
  });

  it('reports a loss as a positive magnitude', () => {
    const pl = saleProfitLoss(10_000_000, 8_000_000);
    expect(pl!.amount).toBe(-2_000_000);
    expect(pl!.tone).toBe('loss');
    expect(pl!.label.startsWith('Lỗ ')).toBe(true);
    expect(pl!.label).toContain('2.000.000');
  });

  it('reports a break-even sale', () => {
    const pl = saleProfitLoss(10_000_000, 10_000_000);
    expect(pl!.amount).toBe(0);
    expect(pl!.tone).toBe('even');
    expect(pl!.label).toBe('Hoà vốn');
  });

  it('is null when there is no sale price', () => {
    expect(saleProfitLoss(10_000_000, null)).toBeNull();
    expect(saleProfitLoss(10_000_000, undefined)).toBeNull();
  });

  it('treats a missing purchase price as 0', () => {
    const pl = saleProfitLoss(null, 5_000_000);
    expect(pl!.amount).toBe(5_000_000);
    expect(pl!.tone).toBe('profit');
  });
});
