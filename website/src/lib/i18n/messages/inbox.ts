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

  // ── Web Share Target (`app/share-target/route.ts`) ──────────────────────
  //
  // The OS share sheet posts a file straight to /share-target; its success
  // redirect lands on /inbox?shared=1 and every failure lands on
  // /share/result?reason=<code>. The eleven reason sentences below are the
  // VALUES of `SHARE_FAILURE_MESSAGES` in `lib/share-target.ts` — the result
  // page translates them by key, so they must exist here (the coverage test
  // asserts that map, since the page looks them up dynamically). Never claim a
  // file was saved when the route cannot know: `network`/`failed` say "may not
  // have been saved" because a lost response can still mean a successful
  // upload.
  'Đã nhận file từ chia sẻ. File đang chờ gán thiết bị.':
    'File received from the share sheet. It is waiting to be filed under a device.',
  'Trên Android, trình duyệt Chromium (Chrome, Edge, Samsung Internet) cho phép chia sẻ ảnh hoặc PDF thẳng vào hộp thư này sau khi cài Warrly. Safari và Firefox không hỗ trợ.':
    'On Android, Chromium-based browsers (Chrome, Edge, Samsung Internet) can share an image or PDF straight into this inbox once Warrly is installed. Safari and Firefox do not support this.',
  'Chia sẻ file': 'File share',
  'Chưa nhận được file': 'The file was not received',
  'Không nhận được file — Warrly': 'File not received — Warrly',
  'Mở hộp thư': 'Open the inbox',
  'Muốn thử lại? Mở ứng dụng có file rồi chọn “Chia sẻ” → Warrly.':
    'To try again, open the app that has the file and choose “Share” → Warrly.',

  // Failure reasons — keep byte-for-byte in sync with `SHARE_FAILURE_MESSAGES`.
  'Bạn cần đăng nhập để nhận file. File chưa được lưu — đăng nhập rồi chia sẻ lại.':
    'You need to sign in to receive the file. Nothing was saved — sign in, then share it again.',
  'File vượt quá 5MB nên chưa được lưu. Chọn file nhỏ hơn rồi chia sẻ lại.':
    'The file is larger than 5MB, so nothing was saved. Pick a smaller file and share it again.',
  'Chỉ nhận ảnh hoặc PDF. File này chưa được lưu.':
    'Only images and PDFs are accepted. Nothing was saved.',
  'Mỗi lần chỉ chia sẻ được một file. Chưa có file nào được lưu — chọn một file rồi chia sẻ lại.':
    'Only one file can be shared at a time. Nothing was saved — pick one file and share it again.',
  'Dung lượng lưu file của bạn đã đầy (tối đa 100MB). Xoá bớt file cũ rồi chia sẻ lại — file này chưa được lưu.':
    'Your file storage is full (100MB maximum). Delete some old files and share again — this file was not saved.',
  'Bạn thao tác quá nhanh nên file chưa được lưu. Đợi một lát rồi chia sẻ lại.':
    'You are sharing too quickly, so nothing was saved. Wait a moment and share it again.',
  'Không kết nối được máy chủ. File có thể chưa được lưu — kiểm tra hộp thư trước khi chia sẻ lại.':
    'Could not reach the server. The file may not have been saved — check the inbox before sharing it again.',
  'Không đọc được dữ liệu chia sẻ. File chưa được lưu.':
    'Could not read the shared data. Nothing was saved.',
  'Ứng dụng chia sẻ không gửi kèm file. Không có gì được lưu.':
    'The sharing app did not include a file. Nothing was saved.',
  'Máy chủ không nhận file này (chỉ ảnh hoặc PDF hợp lệ, tối đa 5MB). File chưa được lưu.':
    'The server did not accept this file (only valid images or PDFs, up to 5MB). Nothing was saved.',
  'Có lỗi khi nhận file. File có thể chưa được lưu — kiểm tra hộp thư trước khi chia sẻ lại.':
    'Something went wrong while receiving the file. It may not have been saved — check the inbox before sharing it again.',
});
