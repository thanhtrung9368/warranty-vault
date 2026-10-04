// Settings: profile, language, sessions, push, AI, backup, appearance.
//
// The keys are the Vietnamese originals (see `../types.ts`); the English column
// is the translation. Where the API already ships an English sentence for the
// same concept — `api/internal/i18n/catalog.go`, mirrored at
// `/tmp/go-catalog.json` for the duration of this change — that sentence is
// copied verbatim rather than re-phrased, so the settings screen and the server
// cannot disagree about what a message says.
//
// Generic verbs (Lưu / Huỷ / Xoá / Sửa / Tải lại …) and the shell labels
// (Tài khoản / Hồ sơ / Ngôn ngữ / Cài đặt) live in `common.ts` and are NOT
// redefined here. Two sentences are shared with a domain file and are
// deliberately not repeated either (`'Không xuất được dữ liệu'` — devices.ts,
// `'Mất kết nối tới máy chủ, thử lại sau nhé.'` — common.ts): `translate()`
// resolves them through the merged catalog.

import { defineMessages } from '../types';

export const settings = defineMessages({
  // ── Settings page (`app/(app)/settings/page.tsx`) ───────────────────────
  'Quản lý tài khoản và dữ liệu cá nhân.': 'Manage your account and personal data.',
  'Giao diện': 'Appearance',
  'Thông báo': 'Notifications',
  'Đổi mật khẩu': 'Change password',
  'Phiên đăng nhập': 'Sign-in sessions',
  'Quét hoá đơn (AI)': 'Receipt scanning (AI)',
  'Sao lưu & khôi phục': 'Backup & restore',
  'Xuất bảng tính (CSV)': 'Export a spreadsheet (CSV)',
  'Xoá tài khoản': 'Delete account',
  'Về WarrantyVault': 'About WarrantyVault',
  'App cá nhân theo dõi thiết bị, bảo hành và chi phí. Mỗi tài khoản dữ liệu riêng, không chia sẻ. Backup JSON xuất/nhập bất cứ lúc nào.':
    'A personal app for tracking devices, warranties and costs. Every account keeps its own data and nothing is shared. Export and import a JSON backup whenever you like.',

  // ── Profile (`components/profile-form.tsx`) ─────────────────────────────
  'Lưu hồ sơ': 'Save profile',
  'Đã cập nhật hồ sơ': 'Profile updated',
  'Tên hiển thị': 'Display name',
  'vd: Trung Nguyễn': 'e.g. Trung Nguyen',
  'Tên hiển thị ở thanh trên cùng và lời chào trên bảng điều khiển. Tối đa 80 byte — tên tiếng Việt có dấu tốn nhiều byte hơn số ký tự. Để trống rồi lưu nếu muốn xoá tên.':
    'Shown in the top bar and in the dashboard greeting. At most 80 bytes — Vietnamese diacritics take more bytes than characters. Leave it empty and save to remove the name.',
  'Email đăng nhập': 'Sign-in email',
  'Email dùng để đăng nhập. Đổi được bằng mục':
    'This is the address you sign in with. You can change it under',
  'ngay bên dưới — cần mật khẩu hiện tại và một bước xác nhận qua email gửi tới địa chỉ mới.':
    'just below — it needs your current password and a confirmation step by email sent to the new address.',
  'Đang dùng: {name}': 'In use: {name}',
  'Chưa đặt tên hiển thị.': 'No display name set.',

  // ── Change password (`components/change-password-form.tsx`) ─────────────
  'Đã đổi mật khẩu': 'Password changed',
  'Mật khẩu hiện tại': 'Current password',
  'Mật khẩu mới': 'New password',
  'Xác nhận mật khẩu mới': 'Confirm new password',

  // ── Delete account (`components/delete-account-form.tsx`) ───────────────
  'Xoá vĩnh viễn tài khoản': 'Permanently delete account',
  'Xoá tài khoản sẽ xoá toàn bộ thiết bị, hoá đơn, ảnh BH và cài đặt push. Không thể hoàn tác.':
    'Deleting your account removes every device, invoice, warranty photo and push setting. This cannot be undone.',
  'Tao muốn xoá tài khoản': 'I want to delete my account',
  'Sau khi bấm xoá, toàn bộ dữ liệu của mày bị xoá vĩnh viễn. Tao khuyên mày xuất backup JSON trước.':
    'Once you confirm, all of your data is gone for good. Export a JSON backup first.',
  'Gõ': 'Type',
  'để xác nhận': 'to confirm',

  // ── Email change (`components/email-change-form.tsx`) ───────────────────
  'Gửi link xác nhận': 'Send confirmation link',
  'Đã ghi nhận yêu cầu đổi email': 'Email change request received',
  'Đổi email đăng nhập': 'Change sign-in email',
  'Bước 1/2: nhập địa chỉ mới và mật khẩu hiện tại. Hệ thống gửi một link xác nhận tới':
    'Step 1 of 2: enter the new address and your current password. We send a confirmation link to',
  'địa chỉ mới': 'the new address',
  '; email hiện tại': '; your current email',
  'vẫn dùng được cho tới khi bạn bấm link đó.':
    'keeps working until you click that link.',
  'Email mới': 'New email',
  'vd: trung@vidu.com': 'e.g. trung@example.com',
  'Cần mật khẩu để một phiên đăng nhập bị đánh cắp không thể tự chuyển tài khoản sang địa chỉ khác.':
    'Your password is required so a stolen session cannot move the account to a different address.',

  // ── Push notifications (`components/push-settings.tsx`) ─────────────────
  'Thiếu VAPID public key trong .env': 'Missing the VAPID public key in .env',
  'Bạn cần cho phép thông báo': 'You need to allow notifications',
  'Đã bật thông báo cho thiết bị này': 'Notifications are on for this device',
  'Không đăng ký được': 'Could not subscribe',
  'Lỗi: {message}': 'Error: {message}',
  'Đã tắt thông báo trên thiết bị này': 'Notifications are off for this device',
  'Đã gửi': 'Sent',
  'Không gửi được': 'Could not send',
  'Trình duyệt này chưa hỗ trợ push notification. Thử Chrome, Edge, Firefox hoặc Safari phiên bản mới.':
    'This browser does not support push notifications. Try a recent version of Chrome, Edge, Firefox or Safari.',
  'Bạn đã chặn thông báo từ site này. Mở cài đặt trình duyệt → quyền thông báo → cho phép rồi tải lại trang.':
    'You have blocked notifications from this site. Open your browser settings → notification permission → allow, then reload the page.',
  'Thiết bị này đã bật thông báo': 'This device has notifications on',
  'Gửi thử': 'Send a test',
  'Tắt': 'Turn off',
  'Bật': 'Turn on',
  'Nhận thông báo khi thiết bị sắp hết bảo hành, ngay cả khi không mở web.':
    'Get notified when a device is close to the end of its warranty, even when the site is closed.',
  'Bật thông báo': 'Turn on notifications',

  // ── Registered push devices (`components/push-devices.tsx`) ─────────────
  //
  // `iPhone / iPad (APNs)` and `Android (FCM)` are identical in both languages
  // and deliberately have no entry — a lookup falls back to the key, which is
  // already the correct English.
  'Trình duyệt (Web Push)': 'Browser (Web Push)',
  'Đã gỡ thiết bị khỏi danh sách nhận thông báo':
    'Device removed from the notification list',
  'Không gỡ được thiết bị': 'Could not remove the device',
  'Không gỡ được thiết bị, thử lại sau': 'Could not remove the device, try again later',
  'Thiết bị nhận thông báo': 'Notification devices',
  'Không tải được danh sách thiết bị — thử tải lại trang nhé.':
    'Could not load the device list — try reloading the page.',
  'Chưa có thiết bị nào đăng ký nhận thông báo. Bật thông báo ở trên để thêm thiết bị này.':
    'No device is registered for notifications yet. Turn notifications on above to add this one.',
  'Mọi thiết bị dưới đây đều nhận thông báo nhắc bảo hành. Gỡ bớt nếu mày không dùng nữa.':
    'Every device below receives warranty reminders. Remove the ones you no longer use.',
  'Không có thông tin thiết bị': 'No device information',
  'Thêm {date}': 'Added {date}',
  'Gỡ {device} khỏi danh sách nhận thông báo':
    'Remove {device} from the notification list',
  'Gỡ': 'Remove',

  // ── Sign-in sessions (`components/session-list.tsx`, `lib/sessions.ts`) ─
  'Không gỡ được phiên đăng nhập, thử lại sau':
    'Could not revoke the session, try again later',
  'Không gỡ được phiên đăng nhập': 'Could not revoke the session',
  'Không tải được danh sách phiên đăng nhập — thử tải lại trang nhé.':
    'Could not load the session list — try reloading the page.',
  'Không có phiên đăng nhập nào đang hoạt động.': 'No active sign-in sessions.',
  'Mỗi lần đăng nhập tạo một phiên. Gỡ phiên ở thiết bị bạn không dùng nữa để cắt quyền truy cập vào dữ liệu — không liên quan tới danh sách nhận thông báo ở trên.':
    'Every sign-in creates a session. Revoke the ones on devices you no longer use to cut off access to your data — this is separate from the notification list above.',
  'Thiết bị này': 'This device',
  'Đăng nhập {date}': 'Signed in {date}',
  'Hoạt động {when}': 'Active {when}',
  'Hết hạn {date}': 'Expires {date}',
  'Gỡ phiên này tương đương đăng xuất — bạn sẽ được đưa về trang đăng nhập.':
    'Revoking this session signs you out — you will be sent to the sign-in page.',
  'Đăng xuất khỏi thiết bị này': 'Sign out of this device',
  'Gỡ phiên đăng nhập trên {device}': 'Revoke the sign-in session on {device}',
  'Thiếu id phiên đăng nhập': 'Missing session id',
  'Không rõ thiết bị': 'Unknown device',
  'Không rõ nền tảng': 'Unknown platform',
  'Trình duyệt web': 'Web browser',
  'Đã thu hồi phiên đăng nhập. Hãy đăng nhập lại.':
    'The session has been revoked. Please sign in again.',
  'Phiên đăng nhập này đã được thu hồi trước đó.':
    'That session had already been revoked.',
  'Đã thu hồi phiên đăng nhập.': 'The session has been revoked.',

  // ── AI receipt scanning (`components/ai-settings.tsx`) ──────────────────
  'Đã bật quét hoá đơn AI': 'AI receipt scanning is on',
  'Đã tắt quét hoá đơn AI': 'AI receipt scanning is off',
  'Không cập nhật được cài đặt': 'Could not update the setting',
  'Quét hoá đơn bằng AI': 'Scan receipts with AI',
  'Khi bật, bạn có thể chụp/chọn ảnh (JPEG, PNG, WEBP) hoặc file PDF hoá đơn / phiếu bảo hành để tự điền thông tin thiết bị. File sẽ được gửi (đã giải mã) tới dịch vụ AI bên thứ ba để trích xuất — bạn luôn kiểm tra lại bản nháp trước khi lưu. Mặc định tắt.':
    'When on, you can photograph or pick an image (JPEG, PNG, WEBP) or a PDF of an invoice / warranty card and have the device fields filled in for you. The file is sent (decrypted) to a third-party AI service for extraction — you always review the draft before saving. Off by default.',
  'Đang bật': 'On',
  'Đang tắt': 'Off',
  'Thiếu ảnh hoá đơn': 'Missing the receipt image',
  'Không quét được hoá đơn, thử lại nhé': 'Could not scan the receipt, please try again',

  // ── Backup & restore (`components/backup-tools.tsx`, `lib/backup-media.ts`)
  'Đã xuất {count} thiết bị': {
    en: 'Exported {count} devices',
    enOne: 'Exported {count} device',
  },
  'Không xuất được file kèm ảnh': 'Could not export the file with images',
  'Đã xuất file .zip kèm nội dung ảnh đã mã hoá':
    'Exported the .zip together with the encrypted image contents',
  'Chế độ "Thay thế" sẽ XOÁ TOÀN BỘ dữ liệu hiện tại (thiết bị, bảo hành, đăng ký, wishlist). Ảnh đính kèm đã mã hoá nằm trong kho riêng của máy chủ nên không bị xoá theo, nhưng mọi bản ghi trỏ tới chúng sẽ mất. Tiếp tục?':
    '"Replace" mode DELETES ALL of your current data (devices, warranties, subscriptions, wishlist). The encrypted attachments live in the server\'s own store so they are not deleted with it, but every record pointing at them is gone. Continue?',
  'Import thất bại': 'Import failed',
  'Không gửi được file lên máy chủ, thử lại sau':
    'Could not upload the file to the server, try again later',
  'Xuất dữ liệu': 'Export data',
  'Tải toàn bộ thiết bị, gói bảo hành, nhắc nhở, gói đăng ký và wishlist ra 1 file JSON. File đính kèm chỉ đi kèm phần mô tả (tên file, kích thước, đường dẫn) — ảnh gốc không nằm trong file backup. Ảnh được mã hoá AES-256-GCM và lưu trong kho riêng của máy chủ (không nằm trong thư mục public của web), nên file JSON không mang ảnh theo được.':
    'Download every device, warranty plan, reminder, subscription and wishlist item into a single JSON file. Attachments travel as their description only (file name, size, path) — the original images are not inside the backup file. Images are encrypted with AES-256-GCM and kept in the server\'s own store (not in the web public folder), so the JSON file cannot carry them.',
  'File backup chứa dữ liệu nhạy cảm: số seri, địa chỉ & SĐT trung tâm bảo hành, giá mua. Lưu ở nơi an toàn — nếu upload cloud thì nên đặt mật khẩu zip trước.':
    'A backup file holds sensitive data: serial numbers, service-centre addresses and phone numbers, purchase prices. Keep it somewhere safe — if you upload it to the cloud, put a password on the zip first.',
  'Tải JSON': 'Download JSON',
  'Xuất kèm nội dung ảnh (.zip)': 'Export with image contents (.zip)',
  'Bản .zip chứa file data.json và toàn bộ nội dung đã mã hoá của từng file đính kèm (mỗi ảnh một entry attachments/…), nên khôi phục sang máy chủ mới mang theo được ảnh hoá đơn — thứ bản JSON chỉ có metadata không làm được.':
    'The .zip holds the data.json file and the complete, encrypted contents of every attachment (one entry per image under attachments/…), so restoring onto a new server brings the invoice images along — something the metadata-only JSON cannot do.',
  'Máy chủ ghi rõ trong file:': 'The server states this in the file itself:',
  'Tải kèm ảnh (.zip)': 'Download with images (.zip)',
  'nhập từ file': 'import from a file',
  'Nhập dữ liệu': 'Import data',
  'Chọn file .json (chỉ bản ghi) hoặc .zip (kèm nội dung ảnh đã mã hoá) đã xuất trước đó. Máy chủ tự nhận dạng file bằng nội dung, không cần đổi tên. Nhập lại chỉ khôi phục bản ghi (thiết bị, bảo hành, đăng ký, wishlist): với file JSON, ảnh cũ chỉ hiện lại nếu kho file trên máy chủ vẫn còn — muốn chắc thì dùng bản .zip.':
    'Pick a .json file (records only) or a .zip file (with the encrypted image contents) that you exported earlier. The server recognises the format from the contents, so there is no need to rename anything. Importing only restores records (devices, warranties, subscriptions, wishlist): with a JSON file the old images reappear only if the server still holds them — use the .zip to be sure.',
  'Chế độ': 'Mode',
  'Merge (gộp)': 'Merge (combine)',
  'Replace (xoá hết)': 'Replace (delete everything)',
  'sẽ XOÁ TOÀN BỘ dữ liệu hiện tại trước khi nạp backup. Không thể hoàn tác. Chắc chắn rồi mới làm nha.':
    'deletes ALL of your current data before the backup is loaded. It cannot be undone. Only continue once you are sure.',
  'hoặc bấm để chọn': 'or click to choose a file',
  'Nhập từ file': 'Import from a file',

  // Import counters (`lib/backup-media.ts`). Each is assembled into one line,
  // so the fragments are translated as fragments and the counts carry `count`.
  'Đã import {count} thiết bị': {
    en: 'Imported {count} devices',
    enOne: 'Imported {count} device',
  },
  'bỏ qua {count} thiết bị đã tồn tại': {
    en: 'skipped {count} devices that already existed',
    enOne: 'skipped {count} device that already existed',
  },
  '{count} món wishlist': {
    en: '{count} wishlist items',
    enOne: '{count} wishlist item',
  },
  'bỏ qua {count} món wishlist đã tồn tại': {
    en: 'skipped {count} wishlist items that already existed',
    enOne: 'skipped {count} wishlist item that already existed',
  },
  '{count} gói đăng ký': {
    en: '{count} subscriptions',
    enOne: '{count} subscription',
  },
  'bỏ qua {count} gói đã tồn tại': {
    en: 'skipped {count} subscriptions that already existed',
    enOne: 'skipped {count} subscription that already existed',
  },
  '{count} file đính kèm đã ghi': {
    en: '{count} attachments written',
    enOne: '{count} attachment written',
  },
  'bỏ qua {count} file đính kèm': {
    en: 'skipped {count} attachments',
    enOne: 'skipped {count} attachment',
  },
  '{count} thiết bị đã tồn tại nên được bỏ qua': {
    en: '{count} devices already existed and were skipped',
    enOne: '{count} device already existed and was skipped',
  },
  '{count} món wishlist đã tồn tại nên được bỏ qua': {
    en: '{count} wishlist items already existed and were skipped',
    enOne: '{count} wishlist item already existed and was skipped',
  },
  '{count} gói đăng ký đã tồn tại nên được bỏ qua': {
    en: '{count} subscriptions already existed and were skipped',
    enOne: '{count} subscription already existed and was skipped',
  },
  'File đính kèm: {imported} đã ghi, {skipped} bỏ qua, {unreadable} không giải mã được':
    'Attachments: {imported} written, {skipped} skipped, {unreadable} could not be decrypted',
  '{count} file đính kèm KHÔNG giải mã được': {
    en: '{count} attachments could NOT be decrypted',
    enOne: '{count} attachment could NOT be decrypted',
  },
  '{count} file đính kèm đã được khôi phục nhưng KHÔNG giải mã được bằng FILE_MASTER_KEY của máy chủ này (hoặc blob đã thiếu từ lúc xuất bản sao lưu). Dòng dữ liệu vẫn còn, nhưng ảnh/hoá đơn đó sẽ không mở được — cần đúng FILE_MASTER_KEY của máy chủ đã xuất bản sao lưu.':
    {
      en: '{count} attachments were restored but could NOT be decrypted with this server\'s FILE_MASTER_KEY (or the blob was already missing when the backup was written). The rows are still there, but those images/invoices will not open — you need the exact FILE_MASTER_KEY of the server that exported the backup.',
      enOne:
        '{count} attachment was restored but could NOT be decrypted with this server\'s FILE_MASTER_KEY (or the blob was already missing when the backup was written). The row is still there, but that image/invoice will not open — you need the exact FILE_MASTER_KEY of the server that exported the backup.',
    },

  // The two notes the UI mirrors from the Go service
  // (`services.AttachmentBytesNoteVN` / `BlobAttachmentBytesNoteVN`,
  // pinned byte-for-byte by `__tests__/backup-media.test.ts`). The constants
  // stay Vietnamese — they are the source text and the catalog key — and the
  // English below is copied from the same entries in the Go catalog.
  'Bản sao lưu này KHÔNG chứa nội dung ảnh/hoá đơn đính kèm (chỉ có tên file, loại file và kích thước). Khôi phục sang một máy chủ khác sẽ không khôi phục được ảnh.':
    'This backup does NOT contain the contents of the attached images/invoices (only the file name, file type and size). Restoring it onto a different server will not bring those images back.',
  'Bản sao lưu này CÓ chứa nội dung ảnh/hoá đơn đính kèm (đã mã hoá AES-256-GCM). Cần đúng FILE_MASTER_KEY của máy chủ đã xuất bản sao lưu thì mới giải mã được; thiếu hoặc sai khoá thì file vẫn được khôi phục nhưng không mở được.':
    'This backup DOES contain the contents of the attached images/invoices (encrypted with AES-256-GCM). You need the exact FILE_MASTER_KEY of the server that exported it in order to decrypt them; with a missing or wrong key the files are still restored but cannot be opened.',
  'Kéo thả file .json hoặc .zip vào đây': 'Drag and drop a .json or .zip file here',

  // ── Appearance (`components/appearance-tweaks.tsx`) ─────────────────────
  //
  // `'Chế độ'` is the appearance section's row label AND the backup screen's
  // mode picker; one entry above covers both.
  'Tông màu sáng, tối, hay theo cài đặt hệ thống.':
    'A light or dark tone, or whatever the system is set to.',
  'Sáng': 'Light',
  'Tối': 'Dark',
  'Hệ thống': 'System',
  'Màu nhấn': 'Accent colour',
  'Màu chủ đạo cho nút, liên kết, biểu đồ và các điểm nhấn.':
    'The main colour for buttons, links, charts and highlights.',
  'Cam san hô': 'Coral',
  'Xanh lục bảo': 'Emerald',
  'Tím': 'Violet',
  'Xanh da trời': 'Sky blue',
  'Thanh bên': 'Sidebar',
  'Hiện đầy đủ nhãn, hoặc chỉ biểu tượng cho gọn.':
    'Show the full labels, or icons only to save space.',
  'Đầy đủ': 'Full',
  'Biểu tượng': 'Icons',
  'Bo góc': 'Corner radius',
  'Độ bo của thẻ, nút và ô nhập.': 'How rounded cards, buttons and inputs are.',
  'Vuông': 'Square',
  'Vừa': 'Medium',
  'Bo nhiều': 'Very round',
  'Mật độ': 'Density',
  'Khoảng cách giữa các thành phần — thoáng dễ thở, đặc xem nhiều hơn.':
    'The spacing between elements — airy and easy to read, or dense to fit more in.',
  'Thoáng': 'Airy',
  'Đặc': 'Dense',
  'Font hiển thị': 'Display font',
  'Kiểu chữ cho tiêu đề và số liệu nổi bật.':
    'The typeface used for headings and highlighted figures.',

  // ── Push server actions (`app/actions/push.ts`) ─────────────────────────
  'Payload không hợp lệ': 'Invalid payload',
  'Không gửi được thông báo thử': 'Could not send the test notification',
  'Bạn chưa đăng ký thiết bị nào để nhận thông báo':
    'You have not registered any device for notifications yet',
  'Gửi thất bại cho {count} thiết bị': {
    en: 'Sending failed for {count} devices',
    enOne: 'Sending failed for {count} device',
  },
  'Đã gửi {sent} thông báo (lỗi: {failed})':
    'Sent {sent} notifications ({failed} failed)',
  'Đã gửi {count} thông báo thử': {
    en: 'Sent {count} test notifications',
    enOne: 'Sent {count} test notification',
  },
  'Thiếu id thiết bị': 'Missing device id',

  // ── Email-change server actions (`app/actions/email-change.ts`) ─────────
  'Email không hợp lệ': 'Invalid email address',
  'Nhập mật khẩu hiện tại': 'Enter your current password',
  'Thiếu token': 'Missing token',
  'Đã đổi email. Vào /login để đăng nhập lại bằng địa chỉ mới.':
    'Email changed. Sign in again with your new address.',

  // ── Email-change copy (`lib/email-change.ts`) ───────────────────────────
  'Nếu địa chỉ mới hợp lệ và chưa được dùng cho tài khoản khác, một email xác nhận đã được gửi tới địa chỉ mới. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận.':
    'If the new address is valid and not already used by another account, a confirmation email has been sent to it. Your current address keeps working until you confirm.',
  'Kiểm tra {inbox} (cả mục Spam / Quảng cáo) để bấm link xác nhận. Link chỉ dùng được một lần và hết hạn sau 30 phút; email hiện tại vẫn đăng nhập được cho tới khi bạn xác nhận.':
    'Check {inbox} (including the Spam / Promotions folder) for the confirmation link. The link works only once and expires after 30 minutes; your current email keeps working until you confirm.',
  'hộp thư của {email}': 'the inbox of {email}',
  'hộp thư của địa chỉ mới': 'the inbox of the new address',
  'Vì lý do bảo mật, mọi phiên đăng nhập trên tất cả thiết bị đã bị thu hồi — hãy đăng nhập lại bằng địa chỉ mới.':
    'For security, every sign-in session on every device has been revoked — sign in again with your new address.',
  'Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.':
    'This link is invalid or has expired. Request a new one.',
  'Email này đã được dùng cho một tài khoản khác. Yêu cầu đổi sang địa chỉ khác.':
    'That email already belongs to another account. Choose a different address.',
  'Thao tác quá nhanh, thử lại sau ít phút.':
    'Too many attempts, try again in a few minutes.',
  'Không xác nhận được đổi email. Thử lại sau.':
    'Could not confirm the email change. Try again later.',
  'Link không dùng được': 'This link cannot be used',
  'Email đã có người dùng': 'That email is already taken',
  'Thử lại sau': 'Try again later',
  'Thiếu token xác nhận': 'Missing confirmation token',
  'Mất kết nối': 'No connection',
  'Không xác nhận được': 'Could not confirm',
  'Token đổi email chỉ dùng được một lần và hết hạn sau 30 phút, nên token đã dùng, token quá cũ và token sai đều báo giống nhau. Đăng nhập rồi vào Cài đặt → Hồ sơ để yêu cầu link mới.':
    'An email-change token works only once and expires after 30 minutes, so a used token, an old token and a wrong token all report the same thing. Sign in, then go to Settings → Profile to request a new link.',
  'Địa chỉ này đã thuộc một tài khoản khác trong lúc chờ xác nhận. Đăng nhập rồi vào Cài đặt → Hồ sơ để đổi sang địa chỉ khác.':
    'This address came to belong to another account while you were waiting to confirm. Sign in, then go to Settings → Profile to choose a different address.',
  'Máy chủ giới hạn số lần thử xác nhận trong một khoảng thời gian. Chờ một lát rồi thử lại.':
    'The server limits how many confirmation attempts you can make in a period. Wait a moment and try again.',
  'Mở lại link đầy đủ trong email xác nhận, hoặc yêu cầu link mới trong Cài đặt → Hồ sơ.':
    'Open the full link from the confirmation email again, or request a new one in Settings → Profile.',

  // ── Backup route handlers (`app/api/backup/{export,import}/route.ts`) ───
  'Phiên đăng nhập đã hết hạn': 'Your session has expired',
  'Phiên đăng nhập đã hết hạn — tải lại trang để đăng nhập lại.':
    'Your session has expired — reload the page to sign in again.',
});
