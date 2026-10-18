import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_SEARCH_STATUS_LABELS,
  attachmentSearchHref,
  attachmentSearchStatus,
  attachmentUploadedLabel,
  searchTextExcerpt,
} from '@/lib/search';

// The `attachments` group of `GET /api/v1/search` (openapi
// `AttachmentSearchHit`). The mapping decisions pinned here are the ones the
// dropdown renders directly:
//
//   * `deviceId: null` means the file is still in the inbox → link to /inbox;
//   * any device id → the device's attachment section;
//   * upload time in the reader's date format;
//   * the matched transcript in context, found diacritic-insensitively because
//     the server matched it that way.
//
// Language is pinned explicitly ('vi' / 'en') so these assertions are about the
// dictionary, not about the machine's locale.

describe('attachment hit → link target', () => {
  it('routes an unfiled hit to the inbox', () => {
    expect(attachmentSearchStatus(null)).toBe('inbox');
    expect(attachmentSearchHref(null)).toBe('/inbox');
    // A blank id is the same thing as null on the wire: no device.
    expect(attachmentSearchHref('   ')).toBe('/inbox');
  });

  it('routes a filed hit to the device attachment section', () => {
    expect(attachmentSearchStatus('dev_1')).toBe('filed');
    expect(attachmentSearchHref('dev_1')).toBe('/devices/dev_1#attachments');
    // Ids come from Go, but encode anyway so a stray character cannot break
    // the path (the fragment stays outside the encoded segment).
    expect(attachmentSearchHref('a/b')).toBe('/devices/a%2Fb#attachments');
  });

  it('has a status label for each destination', () => {
    expect(ATTACHMENT_SEARCH_STATUS_LABELS.inbox).toBe('Trong hộp thư');
    expect(ATTACHMENT_SEARCH_STATUS_LABELS.filed).toBe('Đã gắn thiết bị');
  });
});

describe('attachmentUploadedLabel', () => {
  it('formats the upload time for the reader, empty for a missing value', () => {
    // No timezone suffix: the assertion is about the date FORMAT, not about
    // where the test machine happens to be.
    const uploadedAt = '2026-02-01T12:00:00';
    expect(attachmentUploadedLabel(uploadedAt, 'vi')).toBe('Tải lên 01/02/2026');
    expect(attachmentUploadedLabel(uploadedAt, 'en')).toBe('Uploaded 02/01/2026');
  });

  it('returns an empty string rather than "Invalid Date"', () => {
    expect(attachmentUploadedLabel(null, 'en')).toBe('');
    expect(attachmentUploadedLabel('', 'en')).toBe('');
    expect(attachmentUploadedLabel('not-a-date', 'en')).toBe('');
  });
});

describe('searchTextExcerpt', () => {
  it('shows the match with context, preserving the original spelling', () => {
    const text = 'Hoá đơn mua tại CellphoneS ngày 12/03/2026, kèm sạc 65W và cáp USB-C.';
    const excerpt = searchTextExcerpt(text, 'sac 65w');
    expect(excerpt).not.toBeNull();
    // The API matched `sac 65w` against `sạc 65W` by folding diacritics; the
    // row must display what is actually stored, not the folded query.
    expect(excerpt!.match).toBe('sạc 65W');
    expect(excerpt!.before).toContain('ngày 12/03/2026');
    expect(excerpt!.after).toContain('cáp USB-C');
    expect(excerpt!.truncatedStart).toBe(false);
    expect(excerpt!.truncatedEnd).toBe(false);
  });

  it('is diacritic- and case-insensitive in both directions', () => {
    expect(searchTextExcerpt('Điện thoại Samsung', 'dien thoai')!.match).toBe('Điện thoại');
    expect(searchTextExcerpt('dien thoai samsung', 'ĐIỆN THOẠI')!.match).toBe('dien thoai');
  });

  it('returns null when the API sent no transcript', () => {
    // `extractedText` is absent for a file that was never scanned; there is no
    // context line to render at all.
    expect(searchTextExcerpt(null, 'samsung')).toBeNull();
    expect(searchTextExcerpt(undefined, 'samsung')).toBeNull();
    expect(searchTextExcerpt('   ', 'samsung')).toBeNull();
  });

  it('marks both ends when the text is trimmed around the match', () => {
    const text = 'a'.repeat(100) + 'target' + 'b'.repeat(100);
    const excerpt = searchTextExcerpt(text, 'target', 10)!;
    expect(excerpt.match).toBe('target');
    expect(excerpt.before).toBe('a'.repeat(10));
    expect(excerpt.after).toBe('b'.repeat(10));
    expect(excerpt.truncatedStart).toBe(true);
    expect(excerpt.truncatedEnd).toBe(true);
  });

  it('falls back to the opening of the transcript instead of inventing a match', () => {
    const excerpt = searchTextExcerpt('abcdef', 'zzz', 2)!;
    expect(excerpt).toEqual({
      before: 'abcd',
      match: '',
      after: '',
      truncatedStart: false,
      truncatedEnd: true,
    });
  });

  it('does not split a surrogate pair when slicing context', () => {
    // Counting code points (not UTF-16 units) keeps an emoji intact; a broken
    // pair would render as a replacement character in the dropdown.
    const excerpt = searchTextExcerpt('😀😀😀receipt😀😀😀', 'receipt', 2)!;
    expect(excerpt.before).toBe('😀😀');
    expect(excerpt.after).toBe('😀😀');
    // No half of a surrogate pair leaked into either side.
    expect(`${excerpt.before}${excerpt.after}`).not.toContain('\uFFFD');
  });
});
