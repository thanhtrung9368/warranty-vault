import { describe, expect, it } from 'vitest';
import {
  SCAN_INBOX_HREF,
  buildExtractReceiptBody,
  scanFailureInboxNotice,
  scanInboxNotice,
} from '@/lib/receipt-scan';

// The client half of roadmap #13: the scan uploads to the inbox first, then
// asks the AI endpoint to extract FROM THAT ATTACHMENT. Only the
// `{ attachmentId }` branch persists the OCR transcript, so the shape built
// here is the difference between a searchable receipt and an empty search
// group. The copy assertions pin the orphan policy: a failed scan keeps the
// file in the inbox and says so — it is never silently deleted.

describe('buildExtractReceiptBody', () => {
  it('sends exactly the attachmentId branch, never a file field', () => {
    const body = buildExtractReceiptBody('  att_123  ');
    expect(body).toEqual({ attachmentId: 'att_123' });
    expect(Object.keys(body!)).toEqual(['attachmentId']);
    expect(body && 'file' in body).toBe(false);
  });

  it('refuses a blank id instead of sending attachmentId: ""', () => {
    // The server answers 400 for an empty id; an empty id can only mean the
    // upload result was malformed, so the action must not fire the request.
    expect(buildExtractReceiptBody('')).toBeNull();
    expect(buildExtractReceiptBody('   ')).toBeNull();
    expect(buildExtractReceiptBody(null)).toBeNull();
    expect(buildExtractReceiptBody(undefined)).toBeNull();
  });

  it('does not URL-encode the id: this is a JSON body, not a path segment', () => {
    expect(buildExtractReceiptBody('a/b?c=d')).toEqual({ attachmentId: 'a/b?c=d' });
  });
});

describe('inbox copy after a scan', () => {
  it('always names the inbox, in both languages', () => {
    for (const stored of [true, false]) {
      expect(scanInboxNotice(stored, 'vi')).toContain('Hộp thư');
      expect(scanInboxNotice(stored, 'en')).toContain('Inbox');
    }
    // A way to get there is the second half of the honesty requirement.
    expect(SCAN_INBOX_HREF).toBe('/inbox');
  });

  it('separates "text saved for search" from "text not saved this time"', () => {
    const storedVi = scanInboxNotice(true, 'vi');
    const notStoredVi = scanInboxNotice(false, 'vi');
    expect(storedVi).not.toBe(notStoredVi);
    expect(storedVi).toContain('tìm kiếm');
    expect(notStoredVi).toContain('chưa lưu được nội dung đọc');

    const storedEn = scanInboxNotice(true, 'en');
    const notStoredEn = scanInboxNotice(false, 'en');
    expect(storedEn).not.toBe(notStoredEn);
    expect(storedEn).toContain('search');
    expect(notStoredEn).toContain('could not be saved');
    // `extractedTextStored: false` must never be described as an erased or lost
    // earlier transcript — the API deliberately preserves it on a blank re-scan.
    for (const sentence of [notStoredVi, notStoredEn]) {
      expect(sentence).not.toMatch(/xoá|xoá bỏ|deleted|erased|wiped/i);
    }
  });

  it('says a failed scan kept the file instead of implying it was lost', () => {
    const vi = scanFailureInboxNotice('vi');
    const en = scanFailureInboxNotice('en');
    expect(vi).toContain('Không quét được');
    expect(vi).toContain('file vẫn được lưu trong Hộp thư');
    expect(en).toContain('could not be scanned');
    expect(en).toContain('still saved in the Inbox');
    // The client KEEPS the upload; nothing in the copy may claim deletion.
    for (const sentence of [vi, en]) {
      expect(sentence).not.toMatch(/đã xoá|deleted|removed/i);
    }
  });

  it('renders English without leftover Vietnamese diacritics', () => {
    const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;
    expect(VIETNAMESE_ONLY.test(scanInboxNotice(true, 'en'))).toBe(false);
    expect(VIETNAMESE_ONLY.test(scanInboxNotice(false, 'en'))).toBe(false);
    expect(VIETNAMESE_ONLY.test(scanFailureInboxNotice('en'))).toBe(false);
  });
});
