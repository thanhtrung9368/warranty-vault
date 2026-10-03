// Pure helpers + Vietnamese copy for the two backup shapes (roadmap #2):
//
//   JSON v5  `GET /api/v1/backup/export` (default)
//            metadata only — `includesAttachmentBytes: false`
//   ZIP  v6  `GET /api/v1/backup/export?includeBlobs=true`
//            `data.json` + `attachments/<storagePath>` (AES-256-GCM ciphertext)
//
// Import accepts BOTH on the same route (`POST /api/v1/backup/import`), deciding
// by ZIP magic bytes rather than by filename or Content-Type — so nothing here
// sniffs or gates on an extension.
//
// The two note constants below are MIRRORS of the server's own
// `attachmentBytesNote` (api/internal/services/backup.go):
//
//	AttachmentBytesNoteVN     — the JSON export's note
//	BlobAttachmentBytesNoteVN — the .zip archive's note
//
// They exist because the archive's note can only be read by opening the archive,
// while the UI has to explain the download BEFORE the user clicks it (and the
// blob-carrying option must never be described more rosily than the payload
// describes itself). `src/lib/__tests__/backup-media.test.ts` re-reads the Go
// source and fails if either string drifts by a single byte, so the mirror
// cannot silently become a lie.
//
// Note: when blobs were missing on disk at export time, the archive's note gets
// one extra sentence appended and `missingAttachmentIds` is set. That variant
// cannot be known client-side; the import result reports those rows through
// `attachmentsUnreadable`, which the UI surfaces.

/** Mirror of `services.AttachmentBytesNoteVN` (JSON export, metadata only). */
export const ATTACHMENT_BYTES_NOTE_JSON =
  'Bản sao lưu này KHÔNG chứa nội dung ảnh/hoá đơn đính kèm (chỉ có tên file, loại file và kích thước). Khôi phục sang một máy chủ khác sẽ không khôi phục được ảnh.';

/** Mirror of `services.BlobAttachmentBytesNoteVN` (the `.zip` export). */
export const ATTACHMENT_BYTES_NOTE_ZIP =
  'Bản sao lưu này CÓ chứa nội dung ảnh/hoá đơn đính kèm (đã mã hoá AES-256-GCM). Cần đúng FILE_MASTER_KEY của máy chủ đã xuất bản sao lưu thì mới giải mã được; thiếu hoặc sai khoá thì file vẫn được khôi phục nhưng không mở được.';

// File-picker hint. Both MIME types and extensions: a browser maps `.zip` to
// `application/zip` (or `application/x-zip-compressed` on Windows), and the
// server ignores all of it anyway — this only makes the dialog convenient.
export const BACKUP_IMPORT_ACCEPT =
  '.json,.zip,application/json,application/zip,application/x-zip-compressed';

export const BACKUP_DROP_TITLE = 'Kéo thả file .json hoặc .zip vào đây';

/**
 * Pull the filename out of a `Content-Disposition` header. Handles the quoted
 * form Go writes (`attachment; filename="warranty-vault-u1-2026-03-01.zip"`),
 * an unquoted token, and returns `null` when the header is absent/unusable so
 * the caller can fall back to its own name.
 */
export function filenameFromDisposition(disposition: string | null | undefined): string | null {
  if (!disposition) return null;
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  const name = match?.[1]?.trim();
  return name && name.length > 0 ? name : null;
}

// ---- import result -----------------------------------------------------------

/**
 * Counters of `POST /api/v1/backup/import` (openapi `ImportResult`). All nine
 * fields are always present on the wire; the optional typing here is defensive
 * so a partially-shaped response cannot produce `NaN` in the UI.
 */
export type ImportCounters = {
  imported?: number;
  skipped?: number;
  wishlistImported?: number;
  wishlistSkipped?: number;
  subImported?: number;
  subSkipped?: number;
  attachmentsImported?: number;
  attachmentsSkipped?: number;
  attachmentsUnreadable?: number;
};

export type ImportSummary = {
  /** `warning` when files were restored but cannot be decrypted. */
  tone: 'success' | 'warning';
  /** One-line Vietnamese summary (toast). */
  message: string;
  /** Per-entity counter lines for the persistent result block. */
  details: string[];
  /** Counter line for the unreadable blobs (repeated in `details`). */
  unreadableWarning?: string;
};

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Turn the API's counters into Vietnamese. The wording of the pre-existing four
 * counters is unchanged; the three attachment counters are additive.
 *
 * `attachmentsUnreadable` is never dropped or folded into "thành công": it means
 * the rows and bytes were restored but cannot be decrypted with THIS server's
 * `FILE_MASTER_KEY` (or the blob was already missing when the archive was
 * written). The user has to be told, because the loss only becomes visible when
 * they try to open an invoice.
 */
export function describeImportResult(result: ImportCounters | null | undefined): ImportSummary {
  const imported = count(result?.imported);
  const skipped = count(result?.skipped);
  const wishlistImported = count(result?.wishlistImported);
  const wishlistSkipped = count(result?.wishlistSkipped);
  const subImported = count(result?.subImported);
  const subSkipped = count(result?.subSkipped);
  const attachmentsImported = count(result?.attachmentsImported);
  const attachmentsSkipped = count(result?.attachmentsSkipped);
  const attachmentsUnreadable = count(result?.attachmentsUnreadable);

  const parts: string[] = [`Đã import ${imported} thiết bị`];
  if (skipped) parts.push(`bỏ qua ${skipped} thiết bị đã tồn tại`);
  if (wishlistImported) parts.push(`${wishlistImported} món wishlist`);
  if (wishlistSkipped) parts.push(`bỏ qua ${wishlistSkipped} món wishlist đã tồn tại`);
  if (subImported) parts.push(`${subImported} gói đăng ký`);
  if (subSkipped) parts.push(`bỏ qua ${subSkipped} gói đã tồn tại`);
  if (attachmentsImported) parts.push(`${attachmentsImported} file đính kèm đã ghi`);
  if (attachmentsSkipped) parts.push(`bỏ qua ${attachmentsSkipped} file đính kèm`);

  const details: string[] = [];
  if (skipped) details.push(`${skipped} thiết bị đã tồn tại nên được bỏ qua`);
  if (wishlistSkipped) details.push(`${wishlistSkipped} món wishlist đã tồn tại nên được bỏ qua`);
  if (subSkipped) details.push(`${subSkipped} gói đăng ký đã tồn tại nên được bỏ qua`);

  let unreadableWarning: string | undefined;
  if (attachmentsImported || attachmentsSkipped || attachmentsUnreadable) {
    details.push(
      `File đính kèm: ${attachmentsImported} đã ghi, ${attachmentsSkipped} bỏ qua, ${attachmentsUnreadable} không giải mã được`,
    );
  }
  if (attachmentsUnreadable) {
    parts.push(`${attachmentsUnreadable} file đính kèm KHÔNG giải mã được`);
    unreadableWarning =
      `${attachmentsUnreadable} file đính kèm đã được khôi phục nhưng KHÔNG giải mã được bằng FILE_MASTER_KEY của máy chủ này ` +
      '(hoặc blob đã thiếu từ lúc xuất bản sao lưu). Dòng dữ liệu vẫn còn, nhưng ảnh/hoá đơn đó sẽ không mở được — cần đúng ' +
      'FILE_MASTER_KEY của máy chủ đã xuất bản sao lưu.';
  }

  return {
    tone: attachmentsUnreadable > 0 ? 'warning' : 'success',
    message: `${parts.join(', ')}.`,
    details,
    unreadableWarning,
  };
}
