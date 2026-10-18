import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  attachmentRuleRejection,
  isAcceptedAttachmentType,
} from '@/lib/attachment-rules';

// The browser-side pre-check shared by the device uploader, the inbox uploader
// and the Web Share Target route. It is not the authority (Go sniffs magic
// bytes and enforces the cap again) — it is the single place the two client
// entry points agree on what "too big" and "wrong kind" mean.

const file = (size: number, type: string) => ({ size, type });

describe('isAcceptedAttachmentType', () => {
  it('accepts every image subtype the service stores', () => {
    for (const mime of [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/heic',
      'image/svg+xml', // not OCR-able, but still an allowed upload type
    ]) {
      expect(isAcceptedAttachmentType(mime), mime).toBe(true);
    }
  });

  it('accepts PDF exactly', () => {
    expect(isAcceptedAttachmentType('application/pdf')).toBe(true);
  });

  it('normalises case and surrounding whitespace', () => {
    // Multipart part headers can preserve the source app's casing; MIME types
    // are case-insensitive per RFC 9110.
    expect(isAcceptedAttachmentType('  IMAGE/JPEG ')).toBe(true);
    expect(isAcceptedAttachmentType('APPLICATION/PDF')).toBe(true);
  });

  it('rejects everything that is not an image or a PDF', () => {
    for (const mime of [
      '',
      'application/octet-stream',
      'application/zip',
      'text/plain',
      'video/mp4',
      'audio/mpeg',
      'image', // no subtype
      'application/pdfx', // prefix, not the real type
    ]) {
      expect(isAcceptedAttachmentType(mime), mime).toBe(false);
    }
  });
});

describe('attachmentRuleRejection', () => {
  it('accepts a file at exactly the 5 MB boundary', () => {
    // Go rejects only `len(body) > MaxAttachmentBytes`, so equality is valid.
    expect(attachmentRuleRejection(file(MAX_ATTACHMENT_BYTES, 'image/jpeg'))).toBeNull();
    expect(attachmentRuleRejection(file(MAX_ATTACHMENT_BYTES, 'application/pdf'))).toBeNull();
  });

  it('rejects one byte over the cap', () => {
    expect(attachmentRuleRejection(file(MAX_ATTACHMENT_BYTES + 1, 'application/pdf'))).toBe(
      'too_large',
    );
  });

  it('rejects an unsupported type under the cap', () => {
    expect(attachmentRuleRejection(file(1024, 'application/zip'))).toBe('wrong_type');
    expect(attachmentRuleRejection(file(0, ''))).toBe('wrong_type');
  });

  it('checks size before type, like both uploaders did', () => {
    // A 40 MB ZIP must keep saying "vượt quá 5MB", not switch to the type error.
    expect(attachmentRuleRejection(file(40 * 1024 * 1024, 'application/zip'))).toBe('too_large');
  });
});

describe('constants', () => {
  it('mirror the server cap and the picker accept list', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(5 * 1024 * 1024);
    expect(ATTACHMENT_ACCEPT).toBe('image/*,application/pdf');
    expect(ATTACHMENT_ACCEPT.split(',')).toEqual(['image/*', 'application/pdf']);
  });
});
