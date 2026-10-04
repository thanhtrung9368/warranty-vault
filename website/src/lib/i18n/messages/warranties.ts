import { defineMessages } from '../types';

// Warranty rows (form, list, pill, timeline), the reminder feed, the attachment
// gallery/uploader, the non-blocking serial/IMEI advisories and the device
// resale/return-window sentences.
//
// Warranty AND attachment copy both live here on purpose (brief 02): the gallery
// is rendered inside the warranty card on the device page, and splitting them
// would put "Giá gói" in one file and "Mô tả" in another for no reader's benefit.
//
// English wording is taken from the Go catalog (`api/internal/i18n/catalog.go`)
// wherever the same sentence exists there — "Thiếu file" → "Missing file",
// "Không tìm thấy file" → "File not found", "{months} tháng" → "{months} months".
// Where the Go catalog has no such sentence, the wording mirrors the iOS string
// catalog (`ios/Sources/WarrantyVaultKit/Resources/Localizable.xcstrings`), which
// carries the same Vietnamese source sentences.
export const warranties = defineMessages({
  // ── Warranty form (`components/warranty-form.tsx`) ──────────────────────
  'Loại gói': 'Plan type',
  'Đơn vị bảo hành': 'Warranty provider',
  'vd: AppleCare+, FPT, ...': 'e.g. AppleCare+, FPT, ...',
  'Ngày bắt đầu': 'Start date',
  'Số tháng': 'Months',
  'Giá gói (VND)': 'Plan price (VND)',
  'SĐT bảo hành': 'Warranty phone number',
  'vd: 1800 1234': 'e.g. 1800 1234',
  // The device form (`messages/devices.ts`) renders these two labels too, so the
  // English is kept byte-identical to that file's entries — two domain files may
  // share a key, but only if they agree on the sentence.
  'Địa chỉ trung tâm BH': 'Warranty centre address',
  // A placeholder is still copy a reader sees, so it follows the language — but
  // the sample street has to lose its diacritics in English.
  'vd: 123 Nguyễn Trãi, Q.1': 'e.g. 123 Nguyen Trai, District 1',
  'Ghi chú': 'Notes',
  'Điều kiện gói, ngày kích hoạt...': 'Plan terms, activation date...',
  // Distinct from `common.ts`'s "Huỷ" (this literal is spelled without the hook
  // on the u) — both mean Cancel, but only one of them is this key.
  'Hủy': 'Cancel',
  'Thêm gói': 'Add a plan',

  // ── Warranty list (`components/warranty-list.tsx`) ──────────────────────
  'Sửa gói': 'Edit plan',
  'Xoá gói': 'Delete plan',
  'Xoá gói bảo hành "{name}"?': 'Delete the "{name}" warranty plan?',
  'Đã xoá gói bảo hành': 'Warranty plan deleted',
  // Same as `messages/wishlist.ts`'s entry for this sentence (a failed delete
  // reads identically in both lists).
  'Không xoá được': 'Could not delete',
  // Go: "%d tháng" → "%d months" / "1 tháng" → "1 month".
  '{months} tháng': { en: '{months} months', enOne: '{months} month' },
  'Giá gói': 'Plan price',
  'SĐT': 'Phone',
  'Địa chỉ': 'Address',
  'Chưa có gói bảo hành nào. Bấm “Thêm gói” để tạo.':
    'No warranty plans yet. Click “Add a plan” to create one.',
  'Sửa gói bảo hành': 'Edit warranty plan',
  'Thêm gói bảo hành': 'Add a warranty plan',
  'Đã đạt giới hạn {max} gói cho thiết bị này.':
    'This device has reached its limit of {max} warranty plans.',

  // ── Warranty timeline + pill ────────────────────────────────────────────
  // `warrantyState()` in `lib/format.ts` renders these four sentences and is
  // already locale-aware; they are registered here because `warranty-pill.tsx`
  // and `warranty-timeline.tsx` are its only call sites in the app.
  // ("Còn {days} ngày" and "còn {days} ngày" are two different keys: the pill
  // capitalises the sentence, the return-window note does not. Both are the
  // original bytes, and neither may be "tidied" into the other.)
  'Mua': 'Bought',
  'Hết': 'Expires',
  'Còn {days} ngày': { en: '{days} days left', enOne: '{days} day left' },
  'Đã hết {days} ngày': { en: 'Expired {days} days ago', enOne: 'Expired {days} day ago' },
  'Hết hôm nay': 'Ends today',
  'Còn {months} tháng': { en: '{months} months left', enOne: '{months} month left' },

  // ── Attachment gallery (`components/attachment-gallery.tsx`) ────────────
  'Không lưu được mô tả': 'Could not save the description',
  'Đã lưu mô tả': 'Description saved',
  'Đã xoá mô tả': 'Description cleared',
  'Chưa có file đính kèm nào': 'No attachments yet',
  'Tải lên ảnh hoá đơn hoặc phiếu bảo hành để lưu kèm thiết bị. Sau khi tải lên, bấm biểu tượng bút chì để đặt mô tả cho từng file.':
    'Upload a receipt photo or warranty card to keep it with the device. After uploading, click the pencil icon to give each file a description.',
  'Mô tả cho file này': 'Description for this file',
  'Mô tả cho {name}': 'Description for {name}',
  'Lưu mô tả': 'Save description',
  'Lưu (Enter)': 'Save (Enter)',
  'Huỷ sửa mô tả': 'Cancel description edit',
  'Huỷ (Esc)': 'Cancel (Esc)',
  'Sửa mô tả': 'Edit description',
  'Xóa file này?': 'Delete this file?',
  'Đã xóa file': 'File deleted',
  'Không xóa được': 'Could not delete it',
  'Xóa': 'Delete',
  'Mở trong tab mới': 'Open in a new tab',

  // ── Attachment uploader (`components/attachment-uploader.tsx`) ──────────
  'Đã đạt tối đa 5 file cho thiết bị này. Xóa file cũ để tải file mới.':
    'This device already has the maximum of 5 files. Delete an old file to upload a new one.',
  // Go: "File vượt quá 5MB" → "File is larger than 5 MB".
  '{name} vượt quá 5MB': '{name} is larger than 5 MB',
  '{name}: chỉ chấp nhận ảnh hoặc PDF': '{name}: only images or PDF are accepted',
  'Upload thất bại': 'Upload failed',
  'Đã tải lên {count} file': { en: 'Uploaded {count} files', enOne: 'Uploaded {count} file' },
  'Không tải được file': 'Could not upload the file',
  'Kéo thả hoặc bấm để chọn file': 'Drag and drop, or click to choose files',
  'Ảnh hoặc PDF, tối đa 5MB. Còn lại: {remaining} file.': {
    en: 'Images or PDF, up to 5MB. Remaining: {remaining} files.',
    enOne: 'Images or PDF, up to 5MB. Remaining: {remaining} file.',
  },
  'Bỏ chọn': 'Remove',
  'Mô tả chung (vd: Hóa đơn VAT, Phiếu bảo hành)':
    'Shared description (e.g. VAT invoice, warranty card)',
  'Tải lên {count} file': { en: 'Upload {count} files', enOne: 'Upload {count} file' },

  // ── Device warnings banner (`components/device-warnings-banner.tsx`) ────
  'Đã lưu thiết bị — nhưng thông tin này có vẻ chưa đúng':
    'Device saved — but this information looks wrong',
  'Cảnh báo không chặn gì cả: thiết bị vẫn được lưu nguyên như bạn nhập. Kiểm tra lại rồi sửa nếu cần.':
    'These warnings block nothing: the device was saved exactly as you entered it. Check it and fix it if needed.',
  // The full warning text itself is the API's own `message` and arrives already
  // localised (`?lang=`); these are only the short headings `lib/device-warnings`
  // adds per stable `code`.
  'IMEI có thể sai một chữ số': 'IMEI may have a wrong digit',
  'Độ dài IMEI không chuẩn': 'Unusual IMEI length',
  'Serial đã có ở thiết bị khác': 'Serial already used on another device',
  'Cảnh báo số serial/IMEI': 'Serial/IMEI warning',

  // ── Dismiss / restore (`components/dismiss-button.tsx`) ─────────────────
  'Đã hiện lại nhắc nhở': 'Reminder shown again',
  'Đã ẩn nhắc nhở': 'Reminder hidden',
  'Hoàn tác': 'Undo',
  'Hiện lại': 'Show again',
  'Đã xem, ẩn đi': 'Seen, hide it',

  // ── Reminders page (`app/(app)/reminders/page.tsx`) ─────────────────────
  'Sắp hết trong 30 ngày': 'Ending within 30 days',
  'Sắp hết trong 60 ngày': 'Ending within 60 days',
  'Sắp hết trong 90 ngày': 'Ending within 90 days',
  'Bảo hành sắp hết': 'Warranties ending soon',
  'Gói bảo hành sắp hết hoặc vừa hết. Bấm “Đã xem, ẩn đi” để bỏ qua từng gói — gói đã ẩn luôn xem lại và khôi phục được ở mục “Đã ẩn” bên dưới.':
    'Warranty plans that are ending or have just ended. Click “Seen, hide it” to skip one — hidden plans can always be reviewed and restored under “Hidden” below.',
  'Không có nhắc nhở nào, ngon!': 'No reminders — nice!',
  'Tất cả gói bảo hành đều an toàn. Mày khỏi lo gì hết.':
    'Every warranty plan is safe. Nothing to worry about.',
  'Đã ẩn': 'Hidden',
  'Không tải được danh sách nhắc nhở đã ẩn — thử tải lại trang nhé.':
    'Could not load the hidden reminders — try reloading the page.',
  'Chưa ẩn gói bảo hành nào. Gói nào mày bấm “Đã xem, ẩn đi” sẽ nằm ở đây để khôi phục lại.':
    'Nothing hidden yet. Anything you hide with “Seen, hide it” shows up here so you can bring it back.',

  // ── Return window (`lib/device-return-window.ts`) ───────────────────────
  'còn {days} ngày': { en: '{days} days left', enOne: '{days} day left' },
  'hôm nay là ngày cuối': 'today is the last day',
  // Go: "«%s» có ngày dự kiến mua %s, đã qua %d ngày." → "… which passed %d days ago."
  'đã qua {days} ngày': { en: '{days} days ago', enOne: '{days} day ago' },

  // ── Device resale (`lib/device-resale.ts`) ──────────────────────────────
  // The three validator sentences are the Go server's own wording
  // (`api/internal/services/devices.go`), so their English is the Go catalog's.
  'Thiếu ngày bán': 'Missing sale date',
  'Thiếu giá bán': 'Missing sale price',
  'Giá bán không hợp lệ': 'Invalid sale price',
  'Lãi {amount}': 'Profit {amount}',
  'Lỗ {amount}': 'Loss {amount}',
  'Hoà vốn': 'Break-even',

  // ── Attachment server action (`app/actions/attachments.ts`) ─────────────
  'Thiếu file': 'Missing file',
  'Thiếu deviceId': 'Missing deviceId',
  'Tải lên thất bại': 'Upload failed',
  'Thiếu id file đính kèm': 'Missing attachment id',
  'Không tìm thấy file đính kèm': 'Attachment not found',
});
