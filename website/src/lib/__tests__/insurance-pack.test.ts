import { describe, expect, it } from 'vitest';
import {
  buildInsurancePackQuery,
  hasPdfHeader,
  insurancePackCopy,
  insurancePackFailureMessage,
  insurancePackFilename,
  parseInsurancePackScope,
  resolveInsurancePackFilename,
} from '@/lib/insurance-pack';

// The frozen contract this pins:
//   GET /api/v1/insurance-pack
//     ?deviceIds=<id>,<id>   optional (omit = every device)
//     ?includeSold=true      optional (default false)
//   → application/pdf, ALWAYS Vietnamese.
//
// Nothing here touches the network or the route handler; the tests are about the
// request shape, the saved filename, and the copy the user sees.

describe('buildInsurancePackQuery', () => {
  it('omits both optional parameters for the default request', () => {
    expect(buildInsurancePackQuery()).toBe('');
    expect(buildInsurancePackQuery({})).toBe('');
    expect(buildInsurancePackQuery({ includeSold: false })).toBe('');
    expect(buildInsurancePackQuery({ deviceIds: [] })).toBe('');
  });

  it('asks for sold devices only when the toggle is on', () => {
    expect(buildInsurancePackQuery({ includeSold: true })).toBe('?includeSold=true');
  });

  it('joins the selected device IDs with commas', () => {
    expect(buildInsurancePackQuery({ deviceIds: ['dev-1', 'dev-2'] })).toBe(
      '?deviceIds=dev-1,dev-2',
    );
    expect(
      buildInsurancePackQuery({ deviceIds: ['dev-1', 'dev-2'], includeSold: true }),
    ).toBe('?deviceIds=dev-1,dev-2&includeSold=true');
  });

  it('trims, drops blanks and de-duplicates IDs without reordering', () => {
    expect(
      buildInsurancePackQuery({
        deviceIds: [' dev-2 ', '', 'dev-1', 'dev-2', '   '],
      }),
    ).toBe('?deviceIds=dev-2,dev-1');
  });

  it('percent-encodes each ID but keeps the comma separators readable', () => {
    expect(buildInsurancePackQuery({ deviceIds: ['a b', 'a/b'] })).toBe(
      '?deviceIds=a%20b,a%2Fb',
    );
  });
});

describe('parseInsurancePackScope', () => {
  it('reads the documented parameters and ignores everything else', () => {
    const parsed = parseInsurancePackScope(
      new URLSearchParams('deviceIds=dev-1,dev-2&includeSold=true&lang=vi&junk=1'),
    );
    expect(parsed).toEqual({ deviceIds: ['dev-1', 'dev-2'], includeSold: true });
  });

  it('accepts the boolean forms Go documents and defaults to false', () => {
    expect(parseInsurancePackScope(new URLSearchParams('includeSold=1')).includeSold).toBe(true);
    expect(parseInsurancePackScope(new URLSearchParams('includeSold=TRUE')).includeSold).toBe(true);
    expect(parseInsurancePackScope(new URLSearchParams('includeSold=false')).includeSold).toBe(
      false,
    );
    expect(parseInsurancePackScope(new URLSearchParams('')).includeSold).toBe(false);
  });

  it('round-trips what the builder writes', () => {
    const params = new URLSearchParams(
      buildInsurancePackQuery({ deviceIds: ['a b', 'dev-2'], includeSold: true }),
    );
    expect(parseInsurancePackScope(params)).toEqual({
      deviceIds: ['a b', 'dev-2'],
      includeSold: true,
    });
  });
});

describe('insurancePackFilename', () => {
  const at = new Date(2026, 2, 1, 14, 30);

  it('builds an ASCII fallback name with a minute-accurate timestamp', () => {
    expect(insurancePackFilename(at)).toBe('warrly-insurance-pack-20260301-1430.pdf');
    expect(insurancePackFilename(new Date(2026, 11, 9, 8, 5))).toBe(
      'warrly-insurance-pack-20261209-0805.pdf',
    );
  });

  it('prefers a PDF filename supplied by the server', () => {
    expect(
      resolveInsurancePackFilename(
        'attachment; filename="warrly-insurance-pack-user-2026-03-01.pdf"',
        at,
      ),
    ).toBe('warrly-insurance-pack-user-2026-03-01.pdf');
  });

  it('falls back when the header is missing, unusable or not a PDF', () => {
    expect(resolveInsurancePackFilename(null, at)).toBe(
      'warrly-insurance-pack-20260301-1430.pdf',
    );
    expect(resolveInsurancePackFilename('attachment', at)).toBe(
      'warrly-insurance-pack-20260301-1430.pdf',
    );
    expect(
      resolveInsurancePackFilename('attachment; filename="pack.json"', at),
    ).toBe('warrly-insurance-pack-20260301-1430.pdf');
  });

  it('strips directory segments from an upstream filename', () => {
    expect(
      resolveInsurancePackFilename('attachment; filename="../../evil.pdf"', at),
    ).toBe('evil.pdf');
  });
});

describe('hasPdfHeader', () => {
  it('accepts the ISO 32000 magic bytes', () => {
    expect(
      hasPdfHeader(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])),
    ).toBe(true);
  });

  it('rejects short, empty or non-PDF bodies', () => {
    expect(hasPdfHeader(new Uint8Array([]))).toBe(false);
    expect(hasPdfHeader(new Uint8Array([0x25, 0x50]))).toBe(false);
    expect(hasPdfHeader(new Uint8Array([0x7b, 0x22, 0x6f, 0x6b, 0x22]))).toBe(false);
    expect(hasPdfHeader(new Uint8Array([0x3c, 0x21, 0x44, 0x4f, 0x43]))).toBe(false);
  });
});

describe('insurancePackCopy', () => {
  it('names the document language in both languages', () => {
    expect(insurancePackCopy('vi').button).toBe('Bảng kê cho bảo hiểm (tiếng Việt)');
    expect(insurancePackCopy('en').button).toBe(
      'Insurance property schedule (Vietnamese)',
    );
  });

  it('explains why the PDF is Vietnamese, so the label does not read as a bug', () => {
    const vi = insurancePackCopy('vi');
    const en = insurancePackCopy('en');
    expect(vi.vietnameseNote).toContain('tiếng Việt');
    expect(vi.vietnameseNote).toContain('bảo hiểm');
    expect(vi.vietnameseNote).toContain('không phải người dùng app');
    expect(en.vietnameseNote).toContain('Vietnamese');
    expect(en.vietnameseNote).toMatch(/insurer|adjuster/);
    expect(en.vietnameseNote).toContain('not by the app user');
  });

  it('selects the scope line from the include-sold toggle', () => {
    expect(insurancePackCopy('vi', false).scope).toBe(
      'Phạm vi: tất cả thiết bị đang sở hữu.',
    );
    expect(insurancePackCopy('vi', true).scope).toBe(
      'Phạm vi: tất cả thiết bị, kể cả đã bán.',
    );
    expect(insurancePackCopy('en', false).scope).toBe('Scope: all devices you own.');
    expect(insurancePackCopy('en', true).scope).toBe(
      'Scope: all devices, including sold ones.',
    );
  });

  it('renders every English sentence without leftover Vietnamese characters', () => {
    const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;
    for (const [key, value] of Object.entries(insurancePackCopy('en', true))) {
      expect(value.trim(), key).not.toBe('');
      expect(value, key).not.toMatch(VIETNAMESE_ONLY);
    }
  });
});

describe('insurancePackFailureMessage', () => {
  it('prefers the server’s own message, which the proxy forwards verbatim', () => {
    expect(
      insurancePackFailureMessage('en', 400, 'deviceIds không hợp lệ'),
    ).toBe('deviceIds không hợp lệ');
  });

  it('falls back to a status-bearing sentence when the body has no message', () => {
    expect(insurancePackFailureMessage('en', 502)).toBe(
      'Could not download the insurance property schedule (error code 502).',
    );
    expect(insurancePackFailureMessage('vi', 401, '   ')).toBe(
      'Không tải được bảng kê cho bảo hiểm (mã lỗi 401).',
    );
  });
});
