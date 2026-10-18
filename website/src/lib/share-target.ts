// Pure logic for the Web Share Target entry point.
//
// A receipt opened in another Android app can be sent to Warrly because the
// manifest declares a `share_target` (`public/manifest.webmanifest`) whose
// action is `POST /share-target`. This module is the part of that route that
// does not need Next, React or the network:
//
//   * the accept/size pre-check lives in `attachment-rules.ts` (shared with the
//     two uploaders);
//   * a failed upload is mapped to a STABLE reason code — never to a raw
//     upstream sentence — so the result page can translate it in the reader's
//     language and a crafted URL cannot inject copy into our own page;
//   * the reason ↔ Vietnamese copy map is also here, so the coverage test can
//     prove every reason is registered in both languages.
//
// Everything is deliberately URL-shape-free (no Next imports) and tested in
// `__tests__/share-target.test.ts`.

/** The manifest `share_target.action`. Must be a real route in this app. */
export const SHARE_TARGET_ACTION = '/share-target';

/**
 * The multipart field name the OS share sheet fills. Declared as
 * `share_target.params.files[0].name` in the manifest; the route reads it with
 * `form.getAll(...)` so a second part is refused, not ignored. The manifest
 * test pins the two together.
 */
export const SHARE_FILE_FIELD = 'file';

/** Where a successful share lands. The inbox is force-dynamic, so the new row
 *  is on the very next render; `shared=1` only adds the "received" banner. */
export const SHARE_SUCCESS_PATH = '/inbox?shared=1';

/** The public confirmation screen for every failure. */
export const SHARE_RESULT_PATH = '/share/result';

/**
 * Every way a share can fail, as a stable code.
 *
 * `auth`     — no/expired session cookie, or Go answered 401.
 * `too_large`— >5 MB (checked locally, or Go answered 413).
 * `unsupported_type` — not an image/* and not application/pdf.
 * `too_many_files` — more than one file in one share (we accept exactly one).
 * `user_quota` — the account's 100 MB total is full (Go `limit_reached`).
 * `rate_limited` — Go's per-user write limiter answered 429.
 * `network`  — the Go service was unreachable (status 0).
 * `malformed`— not multipart, or the multipart body could not be parsed.
 * `missing_file` — the share sheet posted no `file` part.
 * `rejected` — Go refused the file for any other 4xx/3xx reason.
 * `failed`   — 5xx, an unreadable success body, or an unexpected exception.
 */
export type ShareFailureReason =
  | 'auth'
  | 'too_large'
  | 'unsupported_type'
  | 'too_many_files'
  | 'user_quota'
  | 'rate_limited'
  | 'network'
  | 'malformed'
  | 'missing_file'
  | 'rejected'
  | 'failed';

export const SHARE_FAILURE_REASONS = [
  'auth',
  'too_large',
  'unsupported_type',
  'too_many_files',
  'user_quota',
  'rate_limited',
  'network',
  'malformed',
  'missing_file',
  'rejected',
  'failed',
] as const satisfies readonly ShareFailureReason[];

/**
 * Vietnamese sentence (the catalog key) for each reason. Registered in
 * `lib/i18n/messages/inbox.ts`; `i18n-coverage.test.ts` asserts every value is
 * a real key. "Nothing was saved" is only claimed where the route knows that
 * for certain — `network`/`failed` say the file MAY not have been saved,
 * because a lost response can still mean a successful upload.
 */
export const SHARE_FAILURE_MESSAGES: Record<ShareFailureReason, string> = {
  auth: 'Bạn cần đăng nhập để nhận file. File chưa được lưu — đăng nhập rồi chia sẻ lại.',
  too_large: 'File vượt quá 5MB nên chưa được lưu. Chọn file nhỏ hơn rồi chia sẻ lại.',
  unsupported_type: 'Chỉ nhận ảnh hoặc PDF. File này chưa được lưu.',
  too_many_files:
    'Mỗi lần chỉ chia sẻ được một file. Chưa có file nào được lưu — chọn một file rồi chia sẻ lại.',
  user_quota:
    'Dung lượng lưu file của bạn đã đầy (tối đa 100MB). Xoá bớt file cũ rồi chia sẻ lại — file này chưa được lưu.',
  rate_limited:
    'Bạn thao tác quá nhanh nên file chưa được lưu. Đợi một lát rồi chia sẻ lại.',
  network:
    'Không kết nối được máy chủ. File có thể chưa được lưu — kiểm tra hộp thư trước khi chia sẻ lại.',
  malformed: 'Không đọc được dữ liệu chia sẻ. File chưa được lưu.',
  missing_file: 'Ứng dụng chia sẻ không gửi kèm file. Không có gì được lưu.',
  rejected:
    'Máy chủ không nhận file này (chỉ ảnh hoặc PDF hợp lệ, tối đa 5MB). File chưa được lưu.',
  failed:
    'Có lỗi khi nhận file. File có thể chưa được lưu — kiểm tra hộp thư trước khi chia sẻ lại.',
};

export function isShareFailureReason(value: unknown): value is ShareFailureReason {
  return (
    typeof value === 'string' &&
    (SHARE_FAILURE_REASONS as readonly string[]).includes(value)
  );
}

/**
 * A URL-supplied `reason` is untrusted: anything that is not one of our codes
 * becomes the generic failure. This is also what stops a hand-crafted link
 * from rendering arbitrary copy on our domain.
 */
export function parseShareFailureReason(value: unknown): ShareFailureReason {
  return isShareFailureReason(value) ? value : 'failed';
}

/** Relative URL of the failure screen. Relative so the route can put it in a
 *  `Location` header without rebuilding (or guessing) the public origin. */
export function shareResultPath(reason: ShareFailureReason): string {
  return `${SHARE_RESULT_PATH}?reason=${encodeURIComponent(reason)}`;
}

/** Relative URL of the success landing. */
export function shareSuccessPath(): string {
  return SHARE_SUCCESS_PATH;
}

export type SharedFileSelection =
  | { ok: true; file: File }
  | { ok: false; reason: 'missing_file' | 'too_many_files' };

/**
 * Pick the single file out of a parsed share form.
 *
 * The manifest declares one `file` field, but the OS share sheet can put more
 * than one part under that name (Android's multi-select). We accept exactly one
 * per share, matching the native clients — Android deliberately declares
 * `ACTION_SEND` and not `ACTION_SEND_MULTIPLE`, because a multi-file flow is a
 * different feature (N uploads, partial failures, N×5 MB). Taking the first
 * part and quietly discarding the rest would be a silent drop, so a multi-file
 * share is refused as a whole with `too_many_files`.
 *
 * Non-`File` entries are ignored: they are text fields that happen to share the
 * name, not files.
 */
export function selectSharedFile(entries: readonly unknown[]): SharedFileSelection {
  const files = entries.filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) return { ok: false, reason: 'missing_file' };
  if (files.length > 1) return { ok: false, reason: 'too_many_files' };
  return { ok: true, file: files[0] };
}

/**
 * Map a failed `POST /v1/attachments` onto a reason the result page can render.
 *
 * The service codes are lower-case on the wire (`handlers` lowercases them), but
 * the domain constant is `LIMIT_REACHED`; like `attachmentFileError`, accept
 * both spellings so a future casing change cannot mislabel a full account as a
 * generic failure. Status 0 is the API client's "fetch never landed" transport
 * failure, not an HTTP status.
 */
export function mapShareUploadFailure(result: {
  status: number;
  error: string;
}): ShareFailureReason {
  if (result.status === 401) return 'auth';
  if (result.status === 413) return 'too_large';
  if (result.status === 429) return 'rate_limited';

  const code = result.error.toLowerCase();
  if (code === 'limit_reached') return 'user_quota';
  if (result.status === 0 || code === 'network_error') return 'network';
  if (result.status === 400) return 'rejected';

  return 'failed';
}
