import { describe, expect, it } from 'vitest';
import {
  WARRANTY_TERM_KEYS,
  claimsUsedLabel,
  hasWarrantyTermErrors,
  hasWarrantyTerms,
  termsExpandedByDefault,
  warrantyAmountLabel,
  warrantyComponentLabel,
  warrantyTransferableLabel,
} from '@/lib/warranty-terms';

// The nine contract-term fields (`Warranty.component` … `claimsUsed`).
//
// The rules pinned here are the ones the UI depends on:
//   * what counts as "a term is set" (the form's expanded default, and whether
//     a row grows a terms block at all);
//   * the money rendering of a cap/deductible;
//   * the claims budget sentence, including English singular;
//   * component vs whole-unit labelling.

describe('hasWarrantyTerms / termsExpandedByDefault', () => {
  it('is false for an empty, null or undefined row', () => {
    expect(hasWarrantyTerms({})).toBe(false);
    expect(hasWarrantyTerms(null)).toBe(false);
    expect(hasWarrantyTerms(undefined)).toBe(false);
    expect(termsExpandedByDefault({})).toBe(false);
  });

  it('ignores claimsUsed: 0, the server default that every row carries', () => {
    // If 0 counted as "set", every warranty would open the section expanded and
    // every row would render a terms block. This is the single most important
    // case in this file.
    expect(hasWarrantyTerms({ claimsUsed: 0 })).toBe(false);
    expect(termsExpandedByDefault({ claimsUsed: 0 })).toBe(false);
  });

  it('treats a used claim as set', () => {
    expect(hasWarrantyTerms({ claimsUsed: 1 })).toBe(true);
  });

  it.each([
    ['component', { component: 'Màn hình' }],
    ['scope', { scope: 'Lỗi phần cứng' }],
    ['cap', { cap: 5_000_000 }],
    ['deductible', { deductible: 500_000 }],
    ['exclusions', { exclusions: 'Rơi vỡ' }],
    ['region', { region: 'Toàn quốc' }],
    ['transferable', { transferable: false }],
    ['claimsAllowed', { claimsAllowed: 3 }],
    ['claimsUsed', { claimsUsed: 2 }],
  ])('expands when only %s is set', (_field, terms) => {
    expect(hasWarrantyTerms(terms)).toBe(true);
    expect(termsExpandedByDefault(terms)).toBe(true);
  });

  it('keeps the section collapsed for blank strings, not just missing keys', () => {
    expect(
      hasWarrantyTerms({
        component: '   ',
        scope: '',
        exclusions: '\n\t',
        region: '',
      }),
    ).toBe(false);
  });

  it('treats zero amounts as recorded terms', () => {
    // "Miễn khấu trừ" (0 ₫) is a real contract term, not an empty field.
    expect(hasWarrantyTerms({ cap: 0 })).toBe(true);
    expect(hasWarrantyTerms({ deductible: 0 })).toBe(true);
    expect(hasWarrantyTerms({ claimsAllowed: 0 })).toBe(true);
  });

  it('expands when several terms are set', () => {
    expect(
      termsExpandedByDefault({
        component: 'Màn hình',
        cap: 12_000_000,
        deductible: 0,
        claimsAllowed: 2,
        claimsUsed: 1,
        transferable: true,
      }),
    ).toBe(true);
  });
});

describe('hasWarrantyTermErrors', () => {
  it('is false without errors and for unrelated fields', () => {
    expect(hasWarrantyTermErrors(undefined)).toBe(false);
    expect(hasWarrantyTermErrors({})).toBe(false);
    expect(hasWarrantyTermErrors({ months: ['Số tháng không hợp lệ'] })).toBe(false);
    expect(hasWarrantyTermErrors({ claimsUsed: [] })).toBe(false);
  });

  it('is true when any of the nine fields carries an error', () => {
    expect(hasWarrantyTermErrors({ claimsUsed: ['Số lượt đã dùng vượt quá…'] })).toBe(
      true,
    );
    expect(hasWarrantyTermErrors({ cap: ['Mức chi trả không hợp lệ'] })).toBe(true);
  });

  it('covers exactly the nine term keys', () => {
    expect([...WARRANTY_TERM_KEYS]).toEqual([
      'component',
      'scope',
      'cap',
      'deductible',
      'exclusions',
      'region',
      'transferable',
      'claimsAllowed',
      'claimsUsed',
    ]);
  });
});

describe('warrantyAmountLabel (cap / deductible)', () => {
  it('returns null when the amount is not recorded', () => {
    expect(warrantyAmountLabel(null, 'vi')).toBeNull();
    expect(warrantyAmountLabel(undefined, 'en')).toBeNull();
    expect(warrantyAmountLabel(Number.NaN, 'vi')).toBeNull();
  });

  it('renders a cap as Vietnamese money', () => {
    expect(warrantyAmountLabel(5_000_000, 'vi')).toBe('5.000.000\u00a0₫');
  });

  it('renders a deductible as English money', () => {
    expect(warrantyAmountLabel(500_000, 'en')).toBe('₫500,000');
  });

  it('formats a recorded zero instead of treating it as unset', () => {
    expect(warrantyAmountLabel(0, 'vi')).toBe('0\u00a0₫');
    expect(warrantyAmountLabel(0, 'en')).toBe('₫0');
  });
});

describe('claimsUsedLabel', () => {
  it('renders used out of allowed', () => {
    expect(claimsUsedLabel({ claimsUsed: 1, claimsAllowed: 3 }, 'vi')).toBe(
      'Đã dùng 1/3 lượt',
    );
    expect(claimsUsedLabel({ claimsUsed: 1, claimsAllowed: 3 }, 'en')).toBe(
      '1/3 claims used',
    );
  });

  it('uses the singular when the contract allows one claim', () => {
    expect(claimsUsedLabel({ claimsUsed: 0, claimsAllowed: 1 }, 'en')).toBe(
      '0/1 claim used',
    );
  });

  it('renders the allowed-only budget', () => {
    expect(claimsUsedLabel({ claimsUsed: null, claimsAllowed: 3 }, 'vi')).toBe(
      'Tối đa 3 lượt',
    );
    expect(claimsUsedLabel({ claimsUsed: null, claimsAllowed: 3 }, 'en')).toBe(
      'Up to 3 claims',
    );
    expect(claimsUsedLabel({ claimsUsed: null, claimsAllowed: 1 }, 'en')).toBe(
      'Up to 1 claim',
    );
  });

  it('renders used-only when no ceiling is recorded', () => {
    expect(claimsUsedLabel({ claimsUsed: 2, claimsAllowed: null }, 'vi')).toBe(
      'Đã dùng 2 lượt',
    );
    expect(claimsUsedLabel({ claimsUsed: 2, claimsAllowed: null }, 'en')).toBe(
      '2 claims used',
    );
  });

  it('returns null when there is nothing to say', () => {
    expect(claimsUsedLabel({}, 'vi')).toBeNull();
    expect(claimsUsedLabel({ claimsUsed: 0 }, 'vi')).toBeNull();
    expect(claimsUsedLabel({ claimsUsed: null, claimsAllowed: null }, 'en')).toBeNull();
  });

  it('renders a zero budget when the server allows zero claims', () => {
    expect(claimsUsedLabel({ claimsUsed: 0, claimsAllowed: 0 }, 'en')).toBe(
      '0/0 claims used',
    );
  });
});

describe('warrantyComponentLabel', () => {
  it('labels a missing component as the whole unit', () => {
    expect(warrantyComponentLabel(null)).toEqual({ kind: 'whole' });
    expect(warrantyComponentLabel(undefined)).toEqual({ kind: 'whole' });
    expect(warrantyComponentLabel('')).toEqual({ kind: 'whole' });
    expect(warrantyComponentLabel('   ')).toEqual({ kind: 'whole' });
  });

  it('keeps a component name verbatim (trimmed)', () => {
    expect(warrantyComponentLabel('Màn hình')).toEqual({
      kind: 'component',
      label: 'Màn hình',
    });
    expect(warrantyComponentLabel('  Pin  ')).toEqual({
      kind: 'component',
      label: 'Pin',
    });
  });

  it('does not translate a component name through the catalog', () => {
    // A component that happens to equal a registered key must stay the user's
    // own word — the discriminated result is what forces the UI to keep it
    // out of `t(...)`.
    const label = warrantyComponentLabel('Ghi chú');
    expect(label).toEqual({ kind: 'component', label: 'Ghi chú' });
  });
});

describe('warrantyTransferableLabel', () => {
  it('returns null when the contract does not say', () => {
    expect(warrantyTransferableLabel(null, 'vi')).toBeNull();
    expect(warrantyTransferableLabel(undefined, 'en')).toBeNull();
  });

  it('renders an explicit yes and no in both languages', () => {
    expect(warrantyTransferableLabel(true, 'vi')).toBe('Có');
    expect(warrantyTransferableLabel(true, 'en')).toBe('Yes');
    expect(warrantyTransferableLabel(false, 'vi')).toBe('Không');
    expect(warrantyTransferableLabel(false, 'en')).toBe('No');
  });
});
