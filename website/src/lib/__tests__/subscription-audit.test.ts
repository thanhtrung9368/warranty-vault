import { describe, expect, it } from 'vitest';
import {
  findingCount,
  findingSubjects,
  findingTag,
  findingTone,
  isMinorPriceRise,
  thresholdLines,
} from '@/lib/subscription-audit';
import type {
  SubscriptionAuditCounts,
  SubscriptionAuditFinding,
  SubscriptionAuditThresholds,
} from '@/lib/api/subscriptions';

function finding(
  over: Partial<SubscriptionAuditFinding> & { kind: string },
): SubscriptionAuditFinding {
  return {
    findingKey: 'X:1',
    severity: 'MEDIUM',
    title: 'Tiêu đề từ server',
    detail: 'Câu giải thích từ server',
    subscriptionIds: ['sub-1'],
    names: ['Netflix'],
    monthlyVnd: 0,
    chargedTotalVnd: 0,
    chargeCount: 0,
    ...over,
  };
}

const thresholds: SubscriptionAuditThresholds = {
  quietMinAutoCharges: 3,
  quietMinMonths: 6,
  upcomingRenewalDays: 14,
  priceRiseMinPercent: 5,
  duplicateNormalized: true,
};

describe('isMinorPriceRise', () => {
  it('is true only for a non-material price rise', () => {
    expect(isMinorPriceRise({ kind: 'PRICE_INCREASED', material: false })).toBe(true);
    expect(isMinorPriceRise({ kind: 'PRICE_INCREASED', material: true })).toBe(false);
    // A missing `material` (pre-5% logic / older server) is not a "small rise".
    expect(isMinorPriceRise({ kind: 'PRICE_INCREASED' })).toBe(false);
    expect(isMinorPriceRise({ kind: 'DUPLICATE', material: false })).toBe(false);
  });
});

describe('findingTone', () => {
  it('maps the three severities', () => {
    expect(findingTone({ kind: 'QUIET_AUTO_RENEW', severity: 'HIGH' })).toBe('rose');
    expect(findingTone({ kind: 'PRICE_INCREASED', severity: 'MEDIUM' })).toBe('amber');
    expect(findingTone({ kind: 'DUPLICATE', severity: 'LOW' })).toBe('zinc');
  });

  it('downgrades a non-material price rise instead of showing an alert', () => {
    expect(
      findingTone({ kind: 'PRICE_INCREASED', severity: 'MEDIUM', material: false }),
    ).toBe('zinc');
    expect(
      findingTone({ kind: 'PRICE_INCREASED', severity: 'MEDIUM', material: true }),
    ).toBe('amber');
  });

  it('falls back to the neutral tone for an unknown severity', () => {
    expect(findingTone({ kind: 'DUPLICATE', severity: 'WHATEVER' })).toBe('zinc');
  });
});

describe('findingTag', () => {
  it('labels a small price rise as minor', () => {
    expect(findingTag({ kind: 'PRICE_INCREASED', material: false })).toBe('Mức tăng nhỏ');
    expect(findingTag({ kind: 'PRICE_INCREASED', material: true })).toBe('Đáng chú ý');
  });

  it('names the duplicate signal', () => {
    expect(findingTag({ kind: 'DUPLICATE', reason: 'SAME_NAME' })).toBe('Trùng tên');
    expect(findingTag({ kind: 'DUPLICATE', reason: 'SAME_BRAND_CATEGORY' })).toBe(
      'Cùng hãng, cùng loại',
    );
    expect(findingTag({ kind: 'DUPLICATE' })).toBe('Có thể trùng nhau');
  });

  it('marks the quiet-auto-renew finding as advisory', () => {
    expect(findingTag({ kind: 'QUIET_AUTO_RENEW' })).toBe('Chỉ tư vấn');
  });

  it('adds no tag for an unknown kind', () => {
    expect(findingTag({ kind: 'SOMETHING_NEW' })).toBeNull();
  });
});

describe('findingSubjects', () => {
  it('zips ids and names into links', () => {
    expect(
      findingSubjects({
        subscriptionIds: ['a', 'b'],
        names: ['Netflix', 'Netflix Standard'],
      }),
    ).toEqual([
      { id: 'a', name: 'Netflix', href: '/subscriptions/a' },
      { id: 'b', name: 'Netflix Standard', href: '/subscriptions/b' },
    ]);
  });

  it('falls back to the id when a name is missing, and drops empty ids', () => {
    expect(findingSubjects({ subscriptionIds: ['a', 'b'], names: ['Netflix'] })).toEqual([
      { id: 'a', name: 'Netflix', href: '/subscriptions/a' },
      { id: 'b', name: 'b', href: '/subscriptions/b' },
    ]);
    expect(findingSubjects({ subscriptionIds: ['', 'a'], names: [] })).toEqual([
      { id: 'a', name: 'a', href: '/subscriptions/a' },
    ]);
  });

  it('tolerates a malformed payload', () => {
    expect(
      findingSubjects({
        subscriptionIds: undefined as unknown as string[],
        names: undefined as unknown as string[],
      }),
    ).toEqual([]);
  });
});

describe('thresholdLines', () => {
  it('states every rule using the numbers the payload carries', () => {
    const lines = thresholdLines({
      quietMinAutoCharges: 4,
      quietMinMonths: 9,
      upcomingRenewalDays: 21,
      priceRiseMinPercent: 8,
      duplicateNormalized: true,
    });
    expect(lines).toHaveLength(4);
    const joined = lines.join('\n');
    expect(joined).toContain('4 lần');
    expect(joined).toContain('9 tháng');
    expect(joined).toContain('8%');
    expect(joined).toContain('21 ngày');
    expect(joined).toContain('bỏ dấu, không phân biệt hoa/thường');
  });

  it('omits the normalisation detail when the server does not normalise', () => {
    const joined = thresholdLines({ ...thresholds, duplicateNormalized: false }).join('\n');
    expect(joined).not.toContain('bỏ dấu');
    expect(joined).toContain('hai gói đang hoạt động trùng tên');
  });

  it('never claims anything about usage', () => {
    const joined = thresholdLines(thresholds).join('\n').toLowerCase();
    // The honest phrasing is about RECORDING, not using. Guard the copy against
    // a future edit that would turn it into a usage claim.
    expect(joined).not.toContain('không dùng');
    expect(joined).not.toContain('bạn dùng');
    expect(joined).not.toContain('đã dùng');
  });
});

describe('findingCount', () => {
  it('uses the server count', () => {
    expect(findingCount({ counts: { total: 5, high: 1, medium: 2, low: 2 } })).toBe(5);
    expect(
      findingCount({ counts: undefined as unknown as SubscriptionAuditCounts }),
    ).toBe(0);
  });
});
