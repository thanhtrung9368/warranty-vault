// Capture-first inbox: `/inbox` page, its no-device uploader and the
// "Gán vào thiết bị" action.
//
// The feature exists because the receipt is in hand at the counter while the
// device row is not: upload with no `deviceId`, and the attachment waits here
// without occupying a device's five slots. The copy therefore has to make two
// things obvious: (a) this file is not lost, and (b) filing it into a full
// device is a distinct, recoverable refusal (409 `LIMIT_REACHED`).
//
// Reused keys are NOT redefined here: `'Tải lên thất bại'`, `'Thiếu file'`,
// `'Thiếu id file đính kèm'`, `'Không tìm thấy file đính kèm'`,
// `'Không xoá được'`, `'Kéo thả hoặc bấm để chọn file'`, the two per-file
// validation sentences and `'Thêm thiết bị'` already live in
// `messages/warranties.ts` / `messages/devices.ts`. The nav label
// `'Hộp thư'` lives in `messages/common.ts` with the rest of the chrome.

import { defineMessages } from '../types';

export const inbox = defineMessages({
  // ── Page (`app/(app)/inbox/page.tsx`) ───────────────────────────────────
  'File chờ gán': 'Unfiled files',
  'Tải hoá đơn lên trước, chọn thiết bị sau. File nằm ở đây cho tới khi bạn gán vào một thiết bị.':
    'Upload the receipt first, pick the device later. It waits here until you file it under one.',
  'Tải file lên hộp thư': 'Upload a file to the inbox',
  // The count is a sentence, not a bare number: English inflects, Vietnamese
  // does not, so `enOne` carries the singular.
  '{count} file đang chờ gán thiết bị.': {
    en: '{count} files waiting for a device.',
    enOne: '{count} file waiting for a device.',
  },
  'Không tải được hộp thư — thử tải lại trang nhé.':
    'Could not load the inbox — try reloading the page.',
  'Chưa có file nào chờ gán': 'No files waiting to be filed',
  'Khi bạn tải hoá đơn lên mà chưa chọn thiết bị, file sẽ nằm ở đây. Mỗi thiết bị nhận tối đa 5 file.':
    'When you upload a receipt without picking a device, it waits here. Each device holds up to 5 files.',

  // ── No-device uploader (`components/inbox-uploader.tsx`) ────────────────
  'Ảnh hoặc PDF, tối đa 5MB. Không cần chọn thiết bị ngay.':
    'Image or PDF, up to 5MB. No need to pick a device yet.',
  'Mô tả (không bắt buộc)': 'Description (optional)',
  'Tải lên hộp thư': 'Upload to the inbox',
  'Đang tải lên…': 'Uploading…',
  'Đã tải file vào hộp thư': 'File added to the inbox',

  // ── Filing (`components/inbox-list.tsx`) ────────────────────────────────
  'Tải lên {date}': 'Uploaded {date}',
  'Mở file {name}': 'Open {name}',
  'Chọn thiết bị': 'Choose a device',
  'đã đủ 5 file': 'full — 5 files',
  'Gán vào thiết bị': 'Assign to a device',
  'Đang gán…': 'Filing…',
  'Đã gán file vào thiết bị': 'Attachment filed under the device',
  'Không gán được file vào thiết bị': 'Could not file the attachment',
  // The 409 `LIMIT_REACHED` sentence. Both exits are named because the user's
  // next click is the whole point of surfacing the conflict separately.
  'Thiết bị này đã đủ 5 file. Chọn thiết bị khác hoặc xoá file này.':
    'This device already has 5 files. Pick another device or delete this file.',
  'Chọn thiết bị khác': 'Pick another device',
  'Xoá file': 'Delete file',
  'Xoá file này khỏi hộp thư?': 'Delete this file from the inbox?',
  'Đã xoá file khỏi hộp thư': 'File removed from the inbox',
  'Chưa có thiết bị nào để gán.': 'You have no devices to file it under yet.',
});
