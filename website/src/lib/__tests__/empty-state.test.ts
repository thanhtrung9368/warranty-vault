import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE_COPY,
  emptyReasonFor,
  emptyStateCopy,
  type EmptyReason,
} from '@/lib/empty-state';
import { translate } from '@/lib/i18n/catalog';

// The empty-state decision. What matters is not the exact sentence but the
// invariants that stop the two states from collapsing into one another:
//
//   * there are exactly two reasons, and each has its own copy;
//   * every set carries a CTA (the old component allowed none, and the two
//     screens that needed it most were the two that hid it);
//   * `no-data` never reuses the reassuring nothing-due sentence;
//   * both sets are registered in the catalog in both languages.
//
// The JSX that renders them is not unit-tested — there is no DOM renderer in
// this suite and a test that only asserted "a <div> exists" would prove nothing
// about the copy. The rendered result is verified visually (see the screenshots
// in the change report).

const REASONS: EmptyReason[] = ['nothing-due', 'no-data'];

// Same detector the catalog tests use: a Vietnamese-only character in the
// English column means the translation is missing (translate() falls back to the
// Vietnamese key), which is the failure this test must catch.
const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;

describe('emptyStateCopy', () => {
  it('has a distinct copy set for both reasons', () => {
    expect(Object.keys(EMPTY_STATE_COPY).sort()).toEqual([...REASONS].sort());
    expect(EMPTY_STATE_COPY['no-data'].title).not.toBe(
      EMPTY_STATE_COPY['nothing-due'].title,
    );
    expect(EMPTY_STATE_COPY['no-data'].description).not.toBe(
      EMPTY_STATE_COPY['nothing-due'].description,
    );
  });

  it('always gives every reason a CTA with a label', () => {
    for (const reason of REASONS) {
      const copy = emptyStateCopy(reason);
      expect(copy.ctaHref.startsWith('/')).toBe(true);
      expect(copy.ctaLabel.trim().length).toBeGreaterThan(0);
    }
    // The first-run CTA is the product's first step, not a dead-end back to the
    // list the new account is already looking at.
    expect(emptyStateCopy('no-data').ctaHref).toBe('/devices/new');
  });

  it('falls back to nothing-due for an absent or unknown reason', () => {
    expect(emptyStateCopy(undefined)).toEqual(EMPTY_STATE_COPY['nothing-due']);
    expect(emptyStateCopy(null)).toEqual(EMPTY_STATE_COPY['nothing-due']);
    expect(emptyStateCopy('bogus' as EmptyReason)).toEqual(
      EMPTY_STATE_COPY['nothing-due'],
    );
  });

  it('resolves every copy string through the real catalog in English', () => {
    // `EmptyState` passes these strings to `t(...)` as variables, so the source
    // scan in `i18n-coverage.test.ts` cannot see them. This is that check for
    // these keys: a missing entry would come back still Vietnamese.
    for (const reason of REASONS) {
      const copy = emptyStateCopy(reason);
      for (const key of [copy.title, copy.description, copy.ctaLabel]) {
        const english = translate('en', key);
        expect(english).not.toBe(key);
        expect(VIETNAMESE_ONLY.test(english)).toBe(false);
      }
    }
  });
});

describe('emptyReasonFor', () => {
  it('is nothing-due when the account has a device', () => {
    expect(emptyReasonFor(true)).toBe('nothing-due');
  });

  it('is no-data when the account has no device at all', () => {
    expect(emptyReasonFor(false)).toBe('no-data');
  });
});
