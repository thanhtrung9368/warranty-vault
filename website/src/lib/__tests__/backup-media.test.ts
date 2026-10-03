import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ATTACHMENT_BYTES_NOTE_JSON,
  ATTACHMENT_BYTES_NOTE_ZIP,
  BACKUP_IMPORT_ACCEPT,
  describeImportResult,
  filenameFromDisposition,
} from '@/lib/backup-media';

// Two backup shapes share one route (`api/internal/services/backup*.go`):
// a v5 JSON with attachment metadata only, and a v6 .zip carrying each
// attachment's AES-256-GCM ciphertext. Import sniffs ZIP magic bytes, so the
// client never gates on a filename or MIME type.

describe('filenameFromDisposition', () => {
  it('reads the quoted filename Go writes', () => {
    expect(
      filenameFromDisposition('attachment; filename="warranty-vault-u1-2026-03-01.zip"'),
    ).toBe('warranty-vault-u1-2026-03-01.zip');
    expect(filenameFromDisposition('attachment; filename="warranty-vault-u1-2026-03-01.json"')).toBe(
      'warranty-vault-u1-2026-03-01.json',
    );
  });

  it('reads an unquoted filename too', () => {
    expect(filenameFromDisposition('attachment; filename=backup.json')).toBe('backup.json');
  });

  it('returns null when there is nothing usable', () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition(undefined)).toBeNull();
    expect(filenameFromDisposition('')).toBeNull();
    expect(filenameFromDisposition('attachment')).toBeNull();
    // RFC 5987 form is not emitted by the Go handler; do not invent it.
    expect(filenameFromDisposition("attachment; filename*=UTF-8''backup.zip")).toBeNull();
  });
});

describe('file picker', () => {
  it('accepts both formats, by extension and by MIME type', () => {
    expect(BACKUP_IMPORT_ACCEPT).toContain('.json');
    expect(BACKUP_IMPORT_ACCEPT).toContain('.zip');
    expect(BACKUP_IMPORT_ACCEPT).toContain('application/json');
    expect(BACKUP_IMPORT_ACCEPT).toContain('application/zip');
    // Windows maps .zip to this one.
    expect(BACKUP_IMPORT_ACCEPT).toContain('application/x-zip-compressed');
  });
});

describe('the server notes the UI surfaces', () => {
  it('does not describe the blob archive more rosily than the payload does', () => {
    expect(ATTACHMENT_BYTES_NOTE_ZIP).toContain('CÓ chứa');
    expect(ATTACHMENT_BYTES_NOTE_ZIP).toContain('AES-256-GCM');
    // The truth that must never be dropped: the bytes are useless without the key.
    expect(ATTACHMENT_BYTES_NOTE_ZIP).toContain('FILE_MASTER_KEY');
    expect(ATTACHMENT_BYTES_NOTE_ZIP).toContain('không mở được');
  });

  it('does not describe the JSON export as self-sufficient', () => {
    expect(ATTACHMENT_BYTES_NOTE_JSON).toContain('KHÔNG chứa');
    expect(ATTACHMENT_BYTES_NOTE_JSON).not.toBe(ATTACHMENT_BYTES_NOTE_ZIP);
  });

  // Drift guard: these two strings must stay byte-for-byte identical to the Go
  // constants, because the UI shows them before a download (the archive's own
  // copy of the note can only be read by opening the archive). The repo already
  // pins cross-language copies this way in Go (category_seed_test.go reads
  // types.ts); this is the same trick in the other direction.
  const goSource = (() => {
    try {
      return readFileSync(
        fileURLToPath(new URL('../../../../api/internal/services/backup.go', import.meta.url)),
        'utf8',
      );
    } catch {
      return null;
    }
  })();

  const describeWithGo = goSource ? describe : describe.skip;

  describeWithGo('mirror of api/internal/services/backup.go', () => {
    const goConst = (name: string): string | null => {
      // \b keeps `AttachmentBytesNoteVN` from matching inside
      // `BlobAttachmentBytesNoteVN` (both appear in that file).
      const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(goSource ?? '');
      return match ? match[1] : null;
    };

    it('mirrors AttachmentBytesNoteVN exactly', () => {
      expect(goConst('AttachmentBytesNoteVN')).toBe(ATTACHMENT_BYTES_NOTE_JSON);
    });

    it('mirrors BlobAttachmentBytesNoteVN exactly', () => {
      expect(goConst('BlobAttachmentBytesNoteVN')).toBe(ATTACHMENT_BYTES_NOTE_ZIP);
    });
  });
});

describe('describeImportResult', () => {
  it('keeps the existing counter wording for a JSON import', () => {
    const summary = describeImportResult({
      imported: 3,
      skipped: 1,
      wishlistImported: 2,
      wishlistSkipped: 0,
      subImported: 1,
      subSkipped: 0,
      attachmentsImported: 0,
      attachmentsSkipped: 0,
      attachmentsUnreadable: 0,
    });
    expect(summary.tone).toBe('success');
    expect(summary.message).toBe(
      'Đã import 3 thiết bị, bỏ qua 1 thiết bị đã tồn tại, 2 món wishlist, 1 gói đăng ký.',
    );
    expect(summary.unreadableWarning).toBeUndefined();
    // Nothing to warn about, so no attachment line is invented.
    expect(summary.details.join(' ')).not.toContain('không giải mã được');
  });

  it('reports the attachment counters of a zip import', () => {
    const summary = describeImportResult({
      imported: 4,
      skipped: 0,
      wishlistImported: 0,
      wishlistSkipped: 0,
      subImported: 0,
      subSkipped: 0,
      attachmentsImported: 12,
      attachmentsSkipped: 3,
      attachmentsUnreadable: 0,
    });
    expect(summary.tone).toBe('success');
    expect(summary.message).toContain('12 file đính kèm đã ghi');
    expect(summary.message).toContain('bỏ qua 3 file đính kèm');
    expect(summary.details).toContain('File đính kèm: 12 đã ghi, 3 bỏ qua, 0 không giải mã được');
    expect(summary.unreadableWarning).toBeUndefined();
  });

  it('surfaces attachmentsUnreadable as a warning instead of a success', () => {
    const summary = describeImportResult({
      imported: 1,
      attachmentsImported: 5,
      attachmentsSkipped: 0,
      attachmentsUnreadable: 2,
    });
    expect(summary.tone).toBe('warning');
    expect(summary.message).toContain('2 file đính kèm KHÔNG giải mã được');
    expect(summary.details.join(' ')).toContain('2 không giải mã được');
    expect(summary.unreadableWarning).toBeDefined();
    // The explanation has to name the key and the consequence, or the user will
    // only discover it when an invoice fails to open.
    expect(summary.unreadableWarning).toContain('FILE_MASTER_KEY');
    expect(summary.unreadableWarning).toContain('không mở được');
    expect(summary.unreadableWarning).toContain('2 file đính kèm');
  });

  it('still warns when the blob rows came from a missing-blob export', () => {
    // `missingAttachmentIds` at export time shows up here as unreadable rows.
    const summary = describeImportResult({
      imported: 0,
      attachmentsImported: 0,
      attachmentsSkipped: 0,
      attachmentsUnreadable: 3,
    });
    expect(summary.tone).toBe('warning');
    expect(summary.unreadableWarning).toContain('thiếu từ lúc xuất');
  });

  it('degrades gracefully when the response is missing or partially shaped', () => {
    const empty = describeImportResult(null);
    expect(empty.tone).toBe('success');
    expect(empty.message).toBe('Đã import 0 thiết bị.');
    expect(empty.details).toEqual([]);

    const partial = describeImportResult({ imported: 2, attachmentsUnreadable: undefined });
    expect(partial.message).toBe('Đã import 2 thiết bị.');
    expect(Number.isNaN(Number(partial.message.match(/\d+/)?.[0]))).toBe(false);
  });

  it('ignores negative / non-finite counters rather than printing them', () => {
    const summary = describeImportResult({
      imported: -5,
      skipped: Number.NaN,
      attachmentsUnreadable: -1,
    });
    expect(summary.message).toBe('Đã import 0 thiết bị.');
    expect(summary.tone).toBe('success');
  });
});
