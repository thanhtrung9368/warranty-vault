import { describe, expect, it } from 'vitest';
import {
  BRAND_WARRANTY_ISSUE_KEYS,
  BRAND_WARRANTY_STATUSES,
  BRAND_WARRANTY_STATUS_HINTS,
  BRAND_WARRANTY_STATUS_LABELS,
  WARRANTY_MISMATCH_KINDS,
  WARRANTY_MISMATCH_SENTENCES,
  brandAgreementLine,
  brandCheckedAtLabel,
  brandLookupState,
  brandNotRegisteredLine,
  brandWarrantyDatesLine,
  brandWarrantyDateOnly,
  brandWarrantyIssueList,
  brandWarrantySpanDays,
  brandWarrantySpanLabel,
  brandWarrantyStatusHint,
  brandWarrantyStatusLabel,
  brandWarrantyTimestamp,
  brandWarrantyValues,
  brandWarrantyWriteFields,
  isBrandWarrantyDraftEmpty,
  matchBrand,
  mismatchCopy,
  normalizeBrandWarrantyStatus,
  normalizeBrandName,
  normalizeWarrantyMismatch,
} from '@/lib/brand-warranty';

// Brand warranty lookup (the frozen contract).
//
// The pure module owns every sentence and every state decision, so these tests
// are the ones a reviewer can trust without a browser or a running API:
//
//   * the mismatch copy selector — ALL FOUR kinds, both languages, with both
//     dates and the day count;
//   * the five status labels (English must be a real translation);
//   * the "we do not have this brand's lookup page" state, including the rule
//     that a non-http URL is NOT rendered as a link;
//   * the date arithmetic (span in days, relative "checked at");
//   * the three frozen validation rules and the erase/write mapping.

const VI = 'vi' as const;
const EN = 'en' as const;

// Z-less dates, like the Go wire (`purchaseDate`'s shape). Local-midnight
// parsing keeps the calendar day stable in every timezone.
const PURCHASE = '2026-01-10';

describe('brand warranty status labels', () => {
  it.each([
    ['ACTIVE', 'Hãng ghi đang còn bảo hành', 'Brand says the warranty is active'],
    ['EXPIRED', 'Hãng ghi đã hết bảo hành', 'Brand says the warranty has expired'],
    [
      'NOT_REGISTERED',
      'Hãng chưa ghi nhận bảo hành',
      'No warranty registration on the brand record',
    ],
    ['PRE_ACTIVATED', 'Hãng ghi đã kích hoạt trước', 'Brand says it was activated earlier'],
    ['UNKNOWN', 'Hãng ghi chưa rõ', 'Brand status is unclear'],
  ] as const)('labels %s in both languages', (code, vi, en) => {
    expect(brandWarrantyStatusLabel(code, VI)).toBe(vi);
    expect(brandWarrantyStatusLabel(code, EN)).toBe(en);
    expect(BRAND_WARRANTY_STATUS_LABELS[code]).toBe(vi);
  });

  it('covers exactly the five contract values', () => {
    expect([...BRAND_WARRANTY_STATUSES]).toEqual([
      'ACTIVE',
      'EXPIRED',
      'NOT_REGISTERED',
      'PRE_ACTIVATED',
      'UNKNOWN',
    ]);
  });

  it('says nothing for null or an unknown code instead of inventing a status', () => {
    expect(brandWarrantyStatusLabel(null, VI)).toBeNull();
    expect(brandWarrantyStatusLabel(undefined, EN)).toBeNull();
    expect(brandWarrantyStatusLabel('SOMETHING', VI)).toBeNull();
    expect(normalizeBrandWarrantyStatus('ACTIVE')).toBe('ACTIVE');
    expect(normalizeBrandWarrantyStatus('active')).toBeNull();
    expect(normalizeBrandWarrantyStatus(undefined)).toBeNull();
  });

  it('translates every status hint in both languages', () => {
    for (const code of BRAND_WARRANTY_STATUSES) {
      const vi = brandWarrantyStatusHint(code, VI);
      const en = brandWarrantyStatusHint(code, EN);
      expect(vi).toBe(BRAND_WARRANTY_STATUS_HINTS[code]);
      expect(en).toBeTruthy();
      expect(en).not.toBe(vi);
      expect(en).not.toMatch(/[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/);
    }
  });
});

describe('mismatch copy selector — all four kinds', () => {
  it('STARTS_BEFORE explains a pre-activation with the day count and both dates', () => {
    const copy = mismatchCopy(
      {
        kind: 'STARTS_BEFORE',
        days: 47,
        brandDate: '2025-11-24',
        purchaseDate: PURCHASE,
      },
      VI,
    );
    expect(copy.sentence).toBe(
      'Hãng ghi bảo hành bắt đầu trước ngày mua 47 ngày — hoá đơn của bạn có thể không phải ngày kích hoạt.',
    );
    expect(copy.brandDateLabel).toBe('Hãng ghi bắt đầu 24/11/2025');
    expect(copy.purchaseDateLabel).toBe('Bạn ghi ngày mua 10/01/2026');
    expect(copy.dateLine).toBe(
      'Hãng ghi bắt đầu 24/11/2025 · Bạn ghi ngày mua 10/01/2026',
    );
    expect(copy.note).toContain('không phải lỗi');
  });

  it('STARTS_AFTER says the brand started later, singular in English for one day', () => {
    const mismatch = {
      kind: 'STARTS_AFTER' as const,
      days: 1,
      brandDate: '2026-01-11',
      purchaseDate: PURCHASE,
    };
    expect(mismatchCopy(mismatch, VI).sentence).toBe(
      'Hãng ghi bảo hành bắt đầu sau ngày mua 1 ngày — hoá đơn của bạn có thể đã được ghi sau khi máy kích hoạt.',
    );
    expect(mismatchCopy(mismatch, EN).sentence).toBe(
      'The brand says warranty started 1 day after your purchase date — your invoice may have been written after the device was activated.',
    );
    expect(mismatchCopy(mismatch, EN).brandDateLabel).toBe('Brand start: 01/11/2026');
    expect(mismatchCopy(mismatch, EN).purchaseDateLabel).toBe(
      'Your purchase date: 01/10/2026',
    );
  });

  it('ENDED_EARLIER warns not to wait for the date the owner is working from', () => {
    const copy = mismatchCopy(
      {
        kind: 'ENDED_EARLIER',
        days: 47,
        brandDate: '2026-02-01',
        purchaseDate: '2026-03-20',
      },
      VI,
    );
    expect(copy.sentence).toBe(
      'Hãng ghi bảo hành kết thúc sớm hơn 47 ngày so với mốc bạn đang tính — đừng chờ tới ngày đó mới mang máy đi bảo hành.',
    );
    expect(copy.sentence).toContain('47');
    expect(copy.brandDateLabel).toBe('Hãng ghi hết hạn 01/02/2026');
    expect(copy.purchaseDateLabel).toBe('Bạn đang tính hết hạn 20/03/2026');
  });

  it('ENDED_LATER says the cover may be longer than the owner thinks', () => {
    const mismatch = {
      kind: 'ENDED_LATER' as const,
      days: 12,
      brandDate: '2027-01-22',
      purchaseDate: '2027-01-10',
    };
    expect(mismatchCopy(mismatch, VI).sentence).toBe(
      'Hãng ghi bảo hành kết thúc muộn hơn 12 ngày so với mốc bạn đang tính — máy có thể còn bảo hành lâu hơn bạn tưởng.',
    );
    expect(mismatchCopy(mismatch, EN).sentence).toBe(
      'The brand says warranty ends 12 days later than the date you are working from — the device may be covered for longer than you think.',
    );
  });

  it('has a distinct, translated sentence for every kind', () => {
    const sentences = new Set<string>();
    for (const kind of WARRANTY_MISMATCH_KINDS) {
      const vi = WARRANTY_MISMATCH_SENTENCES[kind];
      expect(vi).toContain('{days}');
      const copy = mismatchCopy(
        { kind, days: 3, brandDate: PURCHASE, purchaseDate: PURCHASE },
        EN,
      );
      expect(copy.sentence).toContain('3 days');
      expect(copy.sentence).not.toMatch(/[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/);
      sentences.add(copy.sentence);
    }
    expect(sentences.size).toBe(4);
  });

  it('never renders an invalid date as "Invalid Date"', () => {
    const copy = mismatchCopy(
      {
        kind: 'STARTS_BEFORE',
        days: 5,
        brandDate: 'not-a-date',
        purchaseDate: '',
      },
      VI,
    );
    expect(copy.brandDateLabel).toBe('Hãng ghi bắt đầu —');
    expect(copy.purchaseDateLabel).toBe('Bạn ghi ngày mua —');
    expect(copy.sentence).not.toContain('Invalid');
  });

  it('normalises a payload and treats a negative day count as its magnitude', () => {
    const mismatch = normalizeWarrantyMismatch({
      kind: 'STARTS_BEFORE',
      days: -47,
      brandDate: ' 2025-11-24 ',
      purchaseDate: PURCHASE,
    });
    expect(mismatch).toEqual({
      kind: 'STARTS_BEFORE',
      days: 47,
      brandDate: '2025-11-24',
      purchaseDate: PURCHASE,
    });
    expect(normalizeWarrantyMismatch(null)).toBeNull();
    expect(normalizeWarrantyMismatch({ kind: 'NOPE', days: 1 })).toBeNull();
    expect(normalizeWarrantyMismatch('STARTS_BEFORE')).toBeNull();
  });
});

describe('agreement / no registration — no mismatch is information too', () => {
  const base = {
    brandWarrantyStatus: 'ACTIVE',
    brandWarrantyStart: '2026-01-10',
    brandWarrantyEnd: '2027-01-10',
    warrantyMismatch: null,
  };

  it('says the two sides agree when the server computed a null mismatch', () => {
    expect(brandAgreementLine(base, VI)).toBe(
      'Không có lệch: hãng ghi bảo hành từ 10/01/2026 đến 10/01/2027. Ngày bắt đầu trùng với mốc bạn đang tính.',
    );
    expect(brandAgreementLine(base, EN)).toBe(
      'No disagreement: the brand records warranty from 01/10/2026 to 01/10/2027. The start date matches the date you use.',
    );
  });

  it('uses the start-only sentence when the brand recorded no end date', () => {
    expect(
      brandAgreementLine({ ...base, brandWarrantyEnd: null }, VI),
    ).toBe(
      'Không có lệch: hãng ghi bảo hành bắt đầu 10/01/2026, trùng với mốc bạn đang tính.',
    );
  });

  it('does NOT claim agreement when a mismatch exists', () => {
    expect(
      brandAgreementLine(
        { ...base, warrantyMismatch: { kind: 'STARTS_BEFORE', days: 3 } },
        VI,
      ),
    ).toBeNull();
  });

  it('does NOT claim agreement when the server did not compute the field', () => {
    // The key is absent (older server): "not computed" is not "agrees".
    const { warrantyMismatch: _omit, ...withoutComputed } = base;
    expect(brandAgreementLine(withoutComputed, VI)).toBeNull();
  });

  it('does NOT claim agreement for NOT_REGISTERED or a missing brand start', () => {
    expect(
      brandAgreementLine({ ...base, brandWarrantyStatus: 'NOT_REGISTERED' }, VI),
    ).toBeNull();
    expect(brandAgreementLine({ ...base, brandWarrantyStart: null }, VI)).toBeNull();
    expect(brandAgreementLine({ ...base, brandWarrantyStatus: null }, VI)).toBeNull();
  });

  it('explains NOT_REGISTERED separately from agreement', () => {
    expect(
      brandNotRegisteredLine({ brandWarrantyStatus: 'NOT_REGISTERED' }, VI),
    ).toBe(
      'Hãng chưa ghi nhận bảo hành cho serial này — hoá đơn của bạn vẫn là mốc duy nhất app có.',
    );
    expect(
      brandNotRegisteredLine({ brandWarrantyStatus: 'ACTIVE' }, VI),
    ).toBeNull();
  });

  it('formats the recorded brand date range in one sentence', () => {
    expect(brandWarrantyDatesLine(base, VI)).toBe(
      'Hãng ghi bảo hành từ 10/01/2026 đến 10/01/2027.',
    );
    expect(
      brandWarrantyDatesLine({ ...base, brandWarrantyEnd: null }, VI),
    ).toBe('Hãng ghi bảo hành bắt đầu 10/01/2026.');
    expect(
      brandWarrantyDatesLine({ ...base, brandWarrantyStart: null }, VI),
    ).toBe('Hãng ghi bảo hành kết thúc 10/01/2027.');
    expect(brandWarrantyDatesLine({ brandWarrantyStatus: 'ACTIVE' }, VI)).toBe(
      'Hãng không ghi ngày bảo hành cụ thể.',
    );
    expect(brandWarrantyDatesLine({ brandWarrantyStatus: null }, VI)).toBeNull();
  });
});

describe('the no-lookup-URL state', () => {
  it('shows the brand URL when the API has one', () => {
    const state = brandLookupState(
      { brandName: 'Samsung', lookupUrl: 'https://www.samsung.com/vn/support/' },
      VI,
    );
    expect(state.kind).toBe('url');
    if (state.kind !== 'url') throw new Error('unreachable');
    expect(state.url).toBe('https://www.samsung.com/vn/support/');
    expect(state.linkLabel).toBe('Mở trang tra cứu của hãng');
    expect(state.title).toBe('Trang tra cứu bảo hành của hãng');
  });

  it('says plainly that we have no page for this brand, and never guesses a URL', () => {
    const state = brandLookupState({ brandName: 'Điện Quang', lookupUrl: null }, VI);
    expect(state.kind).toBe('no-url');
    if (state.kind !== 'no-url') throw new Error('unreachable');
    expect(state.brandName).toBe('Điện Quang');
    expect(state.title).toBe('App không có trang tra cứu bảo hành của hãng này');
    expect(state.detail).toContain('app không có link nào');
    expect(state.detail).toContain('app không đoán URL');
    // The whole point: no synthesised href anywhere in this state.
    expect(JSON.stringify(state)).not.toContain('http');
  });

  it('renders the same honest answer in English', () => {
    const state = brandLookupState({ brandName: 'Acme', lookupUrl: null }, EN);
    if (state.kind !== 'no-url') throw new Error('unreachable');
    expect(state.title).toBe('The app has no warranty check page for this brand');
    expect(state.detail).toContain('will not guess a URL');
  });

  it('refuses a non-http(s) URL instead of turning it into a link', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://example.com/page',
      'example.com/page',
      'http:foo',
      'https://example.com/a b',
      '   ',
    ]) {
      expect(brandLookupState({ brandName: 'X', lookupUrl: bad }, VI).kind).toBe(
        'no-url',
      );
    }
  });

  it('asks for a brand first when the device has none', () => {
    const state = brandLookupState({ brandName: null, lookupUrl: 'https://x.test' }, VI);
    expect(state.kind).toBe('no-brand');
    if (state.kind !== 'no-brand') throw new Error('unreachable');
    expect(state.title).toBe('Thiết bị chưa ghi hãng');
  });
});

describe('date arithmetic display', () => {
  it('counts calendar days between the brand start and end', () => {
    expect(
      brandWarrantySpanDays('2026-01-01', '2026-12-31'),
    ).toBe(364);
    expect(brandWarrantySpanDays('2026-01-01', '2026-01-02')).toBe(1);
    expect(brandWarrantySpanDays(null, '2026-01-02')).toBeNull();
    expect(brandWarrantySpanDays('bad', '2026-01-02')).toBeNull();
  });

  it('renders the span with the right plural in both languages', () => {
    expect(
      brandWarrantySpanLabel('2026-01-01', '2027-01-01', VI),
    ).toBe('Hãng ghi bảo hành kéo dài 365 ngày.');
    expect(
      brandWarrantySpanLabel('2026-01-01', '2027-01-01', EN),
    ).toBe('The brand records 365 days of cover.');
    expect(
      brandWarrantySpanLabel('2026-01-01', '2026-01-02', EN),
    ).toBe('The brand records 1 day of cover.');
  });

  it('omits the span for an inverted or unparseable pair', () => {
    expect(
      brandWarrantySpanLabel('2026-02-01', '2026-01-01', VI),
    ).toBeNull();
    expect(brandWarrantySpanLabel(null, null, VI)).toBeNull();
  });

  it('says when the brand was last checked, relative to an injected now', () => {
    const now = new Date(2026, 3, 7, 15, 0, 0);
    expect(brandCheckedAtLabel('2026-04-07T09:00:00', VI, now)).toBe(
      'Đã đối chiếu hôm nay.',
    );
    expect(brandCheckedAtLabel('2026-04-04T09:00:00', VI, now)).toBe(
      'Đã đối chiếu 3 ngày trước.',
    );
    expect(brandCheckedAtLabel('2026-04-04T09:00:00', EN, now)).toBe(
      'Checked 3 days ago.',
    );
    expect(brandCheckedAtLabel(null, VI, now)).toBe('Chưa đối chiếu với hãng lần nào.');
    expect(brandCheckedAtLabel('not-a-date', VI, now)).toBeNull();
  });
});

describe('validation (the three frozen rules)', () => {
  it('accepts a fully blank draft — the explicit erase signal', () => {
    expect(
      brandWarrantyIssueList({ status: null, start: null, end: null, url: null }),
    ).toEqual([]);
    expect(
      isBrandWarrantyDraftEmpty({ status: null, start: null, end: null, url: null }),
    ).toBe(true);
  });

  it('requires a status whenever another value is set', () => {
    const issues = brandWarrantyIssueList({
      status: null,
      start: PURCHASE,
      end: null,
      url: 'https://brand.test/check',
    });
    expect(issues).toEqual([
      { field: 'brandWarrantyStatus', key: BRAND_WARRANTY_ISSUE_KEYS.statusRequired },
    ]);
  });

  it('rejects an unrecognised status instead of treating it as "erase"', () => {
    expect(
      brandWarrantyIssueList({ status: 'NOPE', start: null, end: null, url: null }),
    ).toEqual([
      { field: 'brandWarrantyStatus', key: BRAND_WARRANTY_ISSUE_KEYS.invalidStatus },
    ]);
  });

  it('rejects an end date before the start date', () => {
    const issues = brandWarrantyIssueList({
      status: 'ACTIVE',
      start: '2026-03-01',
      end: '2026-02-01',
      url: null,
    });
    expect(issues).toContainEqual({
      field: 'brandWarrantyEnd',
      key: BRAND_WARRANTY_ISSUE_KEYS.endBeforeStart,
    });
  });

  it('rejects an unparseable date and a non-http URL', () => {
    const issues = brandWarrantyIssueList({
      status: 'ACTIVE',
      start: 'nope',
      end: '2026-02-01',
      url: 'javascript:alert(1)',
    });
    expect(issues.map((i) => i.key).sort()).toEqual(
      [BRAND_WARRANTY_ISSUE_KEYS.invalidStart, BRAND_WARRANTY_ISSUE_KEYS.invalidUrl].sort(),
    );
  });

  it('accepts a status alone, or status plus valid dates and URL', () => {
    expect(
      brandWarrantyIssueList({ status: 'UNKNOWN', start: null, end: null, url: null }),
    ).toEqual([]);
    expect(
      brandWarrantyIssueList({
        status: 'ACTIVE',
        start: '2026-01-01',
        end: '2027-01-01',
        url: 'https://brand.test/check?x=1',
      }),
    ).toEqual([]);
  });
});

describe('write mapping', () => {
  const values = {
    status: 'ACTIVE' as const,
    start: '2026-01-01',
    end: '2027-01-01',
    checkedAt: '2026-04-07T09:00:00.000Z',
    url: 'https://brand.test/check',
  };

  it('sends the five keys and preserves the supplied checkedAt', () => {
    expect(brandWarrantyWriteFields(values, values.checkedAt)).toEqual({
      brandWarrantyStatus: 'ACTIVE',
      brandWarrantyStart: '2026-01-01',
      brandWarrantyEnd: '2027-01-01',
      brandCheckedAt: '2026-04-07T09:00:00.000Z',
      brandLookupUrl: 'https://brand.test/check',
    });
  });

  it('erases all five when the status is blank', () => {
    expect(
      brandWarrantyWriteFields(
        { ...values, status: null, start: '2026-01-01', url: 'https://x.test' },
        '2026-04-07T09:00:00.000Z',
      ),
    ).toEqual({
      brandWarrantyStatus: null,
      brandWarrantyStart: null,
      brandWarrantyEnd: null,
      brandCheckedAt: null,
      brandLookupUrl: null,
    });
  });

  it('drops an invalid URL rather than putting it on the wire', () => {
    expect(
      brandWarrantyWriteFields({ ...values, url: 'javascript:alert(1)' }, values.checkedAt)
        .brandLookupUrl,
    ).toBeNull();
  });

  it('round-trips stored timestamps into the formats Go accepts', () => {
    // Go serialises a timestamp Z-less, possibly with fractional seconds, and its
    // parser does not accept that exact shape back. Both helpers normalise.
    expect(brandWarrantyDateOnly('2026-01-01T00:00:00.123456')).toBe('2026-01-01');
    expect(brandWarrantyDateOnly('2026-02-03T12:34:56Z')).toBe('2026-02-03');
    // The wall-clock time must survive: only the fraction is dropped, so the
    // stored instant does not shift by the browser's UTC offset.
    expect(brandWarrantyTimestamp('2026-04-07T09:00:00.123456')).toBe(
      '2026-04-07T09:00:00',
    );
    expect(brandWarrantyTimestamp('2026-04-07T09:00:00')).toBe('2026-04-07T09:00:00');
    expect(brandWarrantyTimestamp('2026-04-07T09:00:00Z')).toBe('2026-04-07T09:00:00Z');
    expect(brandWarrantyTimestamp('2026-04-07T09:00:00.000Z')).toBe(
      '2026-04-07T09:00:00.000Z',
    );
    expect(brandWarrantyTimestamp('2026-04-07')).toBe('2026-04-07');
    expect(brandWarrantyTimestamp('not-a-date')).toBeNull();
    expect(brandWarrantyDateOnly('not-a-date')).toBeNull();
    expect(brandWarrantyTimestamp(null)).toBeNull();
    expect(brandWarrantyDateOnly('')).toBeNull();

    // The write mapping uses normalization for the stored-round-trip path.
    expect(
      brandWarrantyWriteFields(
        { ...values, start: '2026-01-01T00:00:00.123456' },
        '2026-04-07T09:00:00.123456',
      ),
    ).toMatchObject({
      brandWarrantyStart: '2026-01-01',
      brandCheckedAt: '2026-04-07T09:00:00',
    });
  });

  it('reads the wire shape defensively for the form', () => {
    expect(
      brandWarrantyValues({
        brandWarrantyStatus: 'PRE_ACTIVATED',
        brandWarrantyStart: ' 2025-11-24 ',
        brandWarrantyEnd: null,
        brandCheckedAt: '2026-04-07T09:00:00Z',
        brandLookupUrl: ' https://brand.test ',
      }),
    ).toEqual({
      status: 'PRE_ACTIVATED',
      start: '2025-11-24',
      end: null,
      checkedAt: '2026-04-07T09:00:00Z',
      url: 'https://brand.test',
    });
    expect(brandWarrantyValues({}).status).toBeNull();
  });
});

describe('brand name matching', () => {
  const brands = [
    { id: 'dien-quang', name: 'Điện Quang' },
    { id: 'samsung', name: 'Samsung' },
  ];
  const info = [
    {
      brandId: 'samsung',
      name: 'Samsung',
      warrantyLookupUrl: 'https://samsung.test/lookup',
    },
  ];

  it('matches case/diacritic-insensitively and carries the lookup URL', () => {
    expect(matchBrand('dien quang', brands, info)).toEqual({
      brandId: 'dien-quang',
      name: 'Điện Quang',
      lookupUrl: null,
    });
    expect(matchBrand('  SAMSUNG ', brands, info)).toEqual({
      brandId: 'samsung',
      name: 'Samsung',
      lookupUrl: 'https://samsung.test/lookup',
    });
    expect(normalizeBrandName('Điện Quang')).toBe('dien quang');
  });

  it('falls back to the service-info rows when the brand catalogue has no match', () => {
    expect(matchBrand('Samsung', [], info)?.brandId).toBe('samsung');
  });

  it('does not guess when nothing matches or several brands match', () => {
    expect(matchBrand('LG', brands, info)).toBeNull();
    expect(matchBrand('', brands, info)).toBeNull();
    expect(
      matchBrand('Acme', [
        { id: 'a', name: 'Acme' },
        { id: 'b', name: 'ACME' },
      ]),
    ).toBeNull();
  });
});
