import { describe, expect, it } from 'vitest';
import {
  findingCount,
  findingSubjects,
  findingTag,
  findingTone,
  isMinorPriceRise,
  renewalCountdownLabel,
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
    expect(findingTag({ kind: 'PRICE_INCREASED', material: false }, 'vi')).toBe('Mức tăng nhỏ');
    expect(findingTag({ kind: 'PRICE_INCREASED', material: true }, 'vi')).toBe('Đáng chú ý');
  });

  it('names the duplicate signal', () => {
    expect(findingTag({ kind: 'DUPLICATE', reason: 'SAME_NAME' }, 'vi')).toBe('Trùng tên');
    expect(findingTag({ kind: 'DUPLICATE', reason: 'SAME_BRAND_CATEGORY' }, 'vi')).toBe(
      'Cùng hãng, cùng loại',
    );
    expect(findingTag({ kind: 'DUPLICATE' }, 'vi')).toBe('Có thể trùng nhau');
  });

  it('marks the quiet-auto-renew finding as advisory', () => {
    expect(findingTag({ kind: 'QUIET_AUTO_RENEW' }, 'vi')).toBe('Chỉ tư vấn');
  });

  it('adds no tag for an unknown kind', () => {
    expect(findingTag({ kind: 'SOMETHING_NEW' }, 'vi')).toBeNull();
  });

  it('renders the English column when the locale is en', () => {
    // The locale is passed in, not read from the machine — see docs/I18N_PLAN.md
    // §4.3. A missing catalog entry would fall back to the Vietnamese key, which
    // is exactly what these two assertions are here to catch.
    expect(findingTag({ kind: 'DUPLICATE', reason: 'SAME_NAME' }, 'en')).toBe('Same name');
    expect(findingTag({ kind: 'PRICE_INCREASED', material: false }, 'en')).toBe('Minor increase');
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
    const lines = thresholdLines(
      {
        quietMinAutoCharges: 4,
        quietMinMonths: 9,
        upcomingRenewalDays: 21,
        priceRiseMinPercent: 8,
        duplicateNormalized: true,
      },
      'vi',
    );
    expect(lines).toHaveLength(4);
    const joined = lines.join('\n');
    expect(joined).toContain('4 lần');
    expect(joined).toContain('9 tháng');
    expect(joined).toContain('8%');
    expect(joined).toContain('21 ngày');
    expect(joined).toContain('bỏ dấu, không phân biệt hoa/thường');
  });

  it('omits the normalisation detail when the server does not normalise', () => {
    const joined = thresholdLines({ ...thresholds, duplicateNormalized: false }, 'vi').join('\n');
    expect(joined).not.toContain('bỏ dấu');
    expect(joined).toContain('hai gói đang hoạt động trùng tên');
  });

  it('never claims anything about usage', () => {
    const joined = thresholdLines(thresholds, 'vi').join('\n').toLowerCase();
    // The honest phrasing is about RECORDING, not using. Guard the copy against
    // a future edit that would turn it into a usage claim.
    expect(joined).not.toContain('không dùng');
    expect(joined).not.toContain('bạn dùng');
    expect(joined).not.toContain('đã dùng');
  });

  it('uses the English column, with English plurals, for en', () => {
    // Two counts in one sentence, each inflecting on its own: passing a single
    // `count` for the whole sentence would render "1 time … 6 month ago".
    const joined = thresholdLines(
      { ...thresholds, quietMinAutoCharges: 1, quietMinMonths: 1 },
      'en',
    ).join('\n');
    expect(joined).toContain('1 time');
    expect(joined).toContain('1 month');
    expect(joined).not.toContain('tháng');
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

describe('renewalCountdownLabel', () => {
  // `nextRenewalAt` is a calendar DAY (openapi `format: date`), so the count is
  // calendar days in the reader's zone, not elapsed 24-hour periods. The fixed
  // `now` is built from LOCAL components, and every assertion is a rendered
  // string — never `toISOString()` — so this passes in both Asia/Saigon and
  // America/New_York (the suite is run under both).
  //
  // The finding deliberately carries a stale `daysUntilRenewal` computed by the
  // API host (Asia/Saigon): it must be ignored, because on a New York evening
  // that number can be one day ahead of the reader's calendar.
  const findingWith = (nextRenewalAt: string | null) => ({
    nextRenewalAt,
    daysUntilRenewal: 999,
  });

  it('counts calendar days from the reader clock, ignoring the server number', () => {
    // 23:59 on Oct 20 is still Oct 20: there are 9 calendar days to Oct 29,
    // even though fewer than 9 full 24-hour periods remain.
    expect(
      renewalCountdownLabel(findingWith('2026-10-29'), 'en', new Date(2026, 9, 20, 23, 59)),
    ).toBe('29 Oct 2026 · 9 days left');
    // 00:01 the same day must produce the same count — this is the assertion
    // that fails if someone swaps calendar-day arithmetic for elapsed time.
    expect(
      renewalCountdownLabel(findingWith('2026-10-29'), 'en', new Date(2026, 9, 20, 0, 1)),
    ).toBe('29 Oct 2026 · 9 days left');
    // The Vietnamese column is unchanged and does not inflect.
    expect(
      renewalCountdownLabel(findingWith('2026-10-29'), 'vi', new Date(2026, 9, 20, 23, 59)),
    ).toBe('29/10/2026 · còn 9 ngày');
  });

  it('inflects the English count for one and zero', () => {
    expect(
      renewalCountdownLabel(findingWith('2026-10-21'), 'en', new Date(2026, 9, 20, 12)),
    ).toBe('21 Oct 2026 · 1 day left');
    expect(
      renewalCountdownLabel(findingWith('2026-10-20'), 'en', new Date(2026, 9, 20, 12)),
    ).toBe('20 Oct 2026 · 0 days left');
    expect(
      renewalCountdownLabel(findingWith('2026-10-21'), 'vi', new Date(2026, 9, 20, 12)),
    ).toBe('21/10/2026 · còn 1 ngày');
  });

  it('returns null when there is no usable day', () => {
    expect(renewalCountdownLabel(findingWith(null), 'en', new Date(2026, 9, 20, 12))).toBeNull();
    expect(
      renewalCountdownLabel(findingWith('2026-10-29T00:00:00Z'), 'en', new Date(2026, 9, 20, 12)),
    ).toBeNull();
  });
});
