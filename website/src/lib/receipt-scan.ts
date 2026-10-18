// Pure helpers for the receipt-scan flow: upload-first OCR.
//
// The scan used to POST the chosen file straight to
// `POST /v1/ai/extract-receipt` as multipart. That branch has no Attachment row
// to own a transcript, so it returned `extractedTextStored: false` and the
// search endpoint's `attachments` group could never match anything the web had
// scanned. The web now does the two-step the contract documents:
//
//   1. `POST /v1/attachments` with NO `deviceId` → an inbox item;
//   2. `POST /v1/ai/extract-receipt` with JSON `{ attachmentId }` → the draft
//      AND a persisted transcript (`extractedTextStored: true`).
//
// ── Orphan policy (step 2 fails) ─────────────────────────────────────────
//
// The uploaded file is KEPT in the inbox; the action never deletes it. An OCR
// failure can be transient (network, rate limit, AI feature disabled) and the
// source file is the one thing the user cannot get back from a failed request.
// The inbox is a first-class, visible place (nav entry + count), so the file is
// not orphaned: the UI says it is there and links to /inbox. Deleting on
// failure would also be destructive in the one case the server is explicit
// about — a re-scan that reads no text does NOT erase a transcript that was
// stored earlier (services/ai_extract.go). No client code here ever tries to
// "fix" that by clearing or replacing an existing attachment.
//
// This module must stay free of React, Next and the API client so the shape
// and the copy can be unit-tested without a backend.

import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

/** The capture-first inbox, where the upload waits for a device. */
export const SCAN_INBOX_HREF = '/inbox';

/** Body of the attachmentId branch of `POST /v1/ai/extract-receipt`. */
export type ExtractReceiptBody = { attachmentId: string };

/**
 * Build the JSON body for the extract call.
 *
 * Returns `null` for a blank id rather than `{ attachmentId: '' }`: the server
 * answers 400 for that, and an empty id can only mean the upload result was
 * malformed. Keeping the builder pure lets the test pin that this branch sends
 * `attachmentId` and never a `file` field.
 */
export function buildExtractReceiptBody(
  attachmentId: string | null | undefined,
): ExtractReceiptBody | null {
  const id = (attachmentId ?? '').trim();
  return id === '' ? null : { attachmentId: id };
}

/**
 * The line under a successful scan draft. The receipt now exists in the inbox
 * whether or not the user finishes the device form, so the UI has to say that
 * instead of implying the scan merely pre-filled some fields.
 *
 * `extractedTextStored` comes from the response. `false` means the transcript
 * was not written (the model read no text, or the best-effort DB write failed) —
 * it NEVER means previously stored text was wiped. The copy says only what the
 * flag actually guarantees.
 */
export function scanInboxNotice(extractedTextStored: boolean, locale: Locale): string {
  if (extractedTextStored) {
    return translate(locale, 'Hoá đơn đã được lưu trong Hộp thư — bạn có thể gán vào một thiết bị sau. Nội dung đọc được cũng đã được lưu để tìm kiếm.');
  }
  return translate(locale, 'Hoá đơn đã được lưu trong Hộp thư — bạn có thể gán vào một thiết bị sau. Lần này chưa lưu được nội dung đọc để tìm kiếm.');
}

/**
 * Shown when the upload landed but extraction failed. It must not read like a
 * generic "scan failed": the file is still there and the user can act on it.
 */
export function scanFailureInboxNotice(locale: Locale): string {
  return translate(locale, 'Không quét được hoá đơn, nhưng file vẫn được lưu trong Hộp thư — mở Hộp thư để gán vào một thiết bị.');
}
