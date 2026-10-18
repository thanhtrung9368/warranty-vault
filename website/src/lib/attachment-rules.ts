// The client-side half of the attachment rules, shared by every file entry
// point that lives in the browser: the device uploader
// (`components/attachment-uploader.tsx`), the capture-first inbox uploader
// (`components/inbox-uploader.tsx`) and the Web Share Target route
// (`app/share-target/route.ts`, which parses the multipart body server-side but
// still runs the exact same pre-check).
//
// The server is the authority. `api/internal/services/attachments.go` enforces
// the 5 MB cap and `api/internal/files/mime.go` sniffs the MAGIC BYTES, so a
// renamed `.exe` or a `.jpg` full of HTML is rejected even if it gets past this
// module. This module only avoids a round trip for a file the client already
// knows is wrong, and it keeps the three entry points saying the same thing
// instead of each carrying its own copy of `5 * 1024 * 1024` and
// `startsWith('image/')`.
//
// The values mirror the Go constants. When changing either, change both:
//   * `MAX_ATTACHMENT_BYTES` = `services.MaxAttachmentBytes` (5 MB)
//   * the accept list        = the JPG/PNG/WEBP/GIF/HEIC + PDF whitelist
//     (`files/mime.go`). HEIC is accepted for storage; OCR refuses it, but this
//     is an upload check, not an OCR check.

/** Mirrors `services.MaxAttachmentBytes` in the Go service. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * The `accept` value for `<input type="file">`. The Share Target manifest
 * declares the same two MIME families as a JSON array (it cannot use this
 * string); `__tests__/share-target.test.ts` pins them together.
 */
export const ATTACHMENT_ACCEPT = 'image/*,application/pdf';

/** Why a file cannot be sent. UI copy (Vietnamese keys) is chosen by callers. */
export type AttachmentRuleRejection = 'too_large' | 'wrong_type';

/**
 * Is this MIME type in the whitelist the Go service will accept?
 *
 * MIME types are case-insensitive (RFC 9110), and a share target's multipart
 * part can preserve whatever casing the source app sent, so normalise before
 * comparing. An empty type is rejected: the server's magic-byte check is the
 * authority, but the browser/share-sheet layer has nothing better to go on and
 * a visibly wrong file should fail before it is uploaded.
 */
export function isAcceptedAttachmentType(mime: string): boolean {
  const normalized = mime.trim().toLowerCase();
  return normalized.startsWith('image/') || normalized === 'application/pdf';
}

/**
 * The first rule a file breaks, or `null` when it passes the client-side
 * pre-check.
 *
 * Size is checked before type, matching the order both uploaders used before
 * this module existed, so a 40 MB ZIP keeps saying "vượt quá 5MB" rather than
 * switching to the type error. The boundary is inclusive: exactly 5 MB is
 * accepted, because Go rejects only `len(body) > MaxAttachmentBytes`.
 */
export function attachmentRuleRejection(
  file: Pick<File, 'size' | 'type'>,
): AttachmentRuleRejection | null {
  if (file.size > MAX_ATTACHMENT_BYTES) return 'too_large';
  if (!isAcceptedAttachmentType(file.type)) return 'wrong_type';
  return null;
}
