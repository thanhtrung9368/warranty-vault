// Resale handoff ("chuyển chủ") — Warrly 2.0.
//
// There are three surfaces in this domain and they share one dictionary:
//
//   * the seller dialog on `/devices/[id]` (components/device-handoff.tsx),
//   * the public claim page `/handoff/[code]` (app/handoff/[code]/page.tsx),
//   * the pure helpers in `lib/handoff.ts` and the two server actions in
//     `app/actions/handoff.ts`.
//
// The copy is deliberately blunt in two places, because both are promises the
// product must not soften: this feature moves DATA (never a legal title), and it
// moves NO money (there is no payment/escrow/marketplace anywhere in the flow).
//
// The labels in `lib/handoff.ts` are Vietnamese constants (the source strings);
// they are registered here and resolved through `translate(locale, …)`.

import { defineMessages } from '../types';

export const handoff = defineMessages({
  // ── Seller entry point + dialog ──────────────────────────────────────────
  'Chuyển chủ': 'Transfer ownership',
  'Chuyển chủ “{name}”': 'Transfer “{name}”',
  'Hồ sơ chuyển chủ': 'Ownership transfer',
  'Giao hồ sơ thiết bị cho người mua. Mã chỉ dùng một lần, người nhận phải đăng nhập Warrly để nhận.':
    'Hand the device record to the buyer. The code works once, and the recipient must sign in to Warrly to claim it.',
  'Hồ sơ sẽ chuyển': 'What travels',
  'Không bao giờ chuyển': 'Never travels',
  'Tài liệu gửi kèm': 'Documents to include',
  'Không chọn tệp nào nghĩa là chỉ hồ sơ thiết bị được chuyển, không có tài liệu nào đi kèm.':
    'Selecting no files means only the device record travels — no documents are included.',
  'Chọn tất cả': 'Select all',
  'Bỏ chọn tất cả': 'Clear all',
  '{selected}/{total} tệp được chọn': {
    en: '{selected}/{total} files selected',
    enOne: '{selected}/{total} file selected',
  },
  '{count} gói bảo hành đi kèm': {
    en: '{count} warranty plans included',
    enOne: '{count} warranty plan included',
  },
  'Mã chuyển chủ: {code}': 'Transfer code: {code}',
  'Mã chỉ hiện một lần': 'The code is shown only once',
  'Mã chỉ hiện một lần lúc tạo — hãy sao chép hoặc chia sẻ ngay.':
    'The code is shown only once, when you create it — copy or share it right away.',
  'Mã chỉ hiện một lần lúc tạo nên không xem lại được. Nếu gửi nhầm, hãy huỷ mã.':
    'The code is shown only once, when it is created, so it cannot be viewed again. If you sent it to the wrong person, cancel it.',
  'Không tự sao chép được — hãy chọn mã và chép thủ công.':
    'Could not copy it automatically — select the code and copy it manually.',
  'Tạo mã chuyển chủ': 'Create a transfer code',
  'Đang tạo mã…': 'Creating the code…',
  'Đã tạo mã chuyển chủ': 'Transfer code created',
  'Gửi mã hoặc link dưới đây cho người mua. Họ đăng nhập Warrly để nhận thiết bị.':
    'Send the code or the link below to the buyer. They sign in to Warrly to claim the device.',
  'Mã chuyển chủ': 'Transfer code',
  'Link nhận thiết bị': 'Claim link',
  'Sao chép mã': 'Copy code',
  'Đã sao chép mã': 'Code copied',
  'Đã sao chép link': 'Link copied',
  'Chia sẻ': 'Share',
  'Mở link nhận thiết bị': 'Open the claim link',
  'Mã đang chờ người nhận': 'Code waiting for a recipient',
  'Người nhận mở link, đăng nhập và bấm nhận. Bạn không cần làm gì thêm.':
    'The recipient opens the link, signs in and claims it. You do not need to do anything else.',
  'Huỷ mã': 'Cancel the code',
  'Huỷ mã này? Người đang giữ link sẽ không nhận được thiết bị nữa. Không thể hoàn tác.':
    'Cancel this code? Whoever holds the link will no longer be able to claim the device. This cannot be undone.',
  'Đã huỷ mã chuyển chủ': 'Transfer code cancelled',
  'Không huỷ được mã chuyển chủ': 'Could not cancel the transfer code',
  'Không huỷ được mã chuyển chủ, thử lại sau':
    'Could not cancel the transfer code, try again later',
  'Không tạo được mã chuyển chủ': 'Could not create the transfer code',
  'Không tạo được mã chuyển chủ, thử lại sau':
    'Could not create the transfer code, try again later',
  'Thiết bị này đã được chuyển cho người nhận. Bạn giữ một bản đã bán trong tài khoản.':
    'This device has been transferred to the recipient. You keep a sold copy in your account.',
  'Chưa thể tạo mã mới': 'A new code is not available yet',
  'Mã trước tạo ngày {date}.': 'Previous code created {date}.',
  'Còn {days} ngày nữa mới tạo được mã mới.': {
    en: 'You can create a new code in {days} days.',
    enOne: 'You can create a new code in {days} day.',
  },
  'Không tải được trạng thái chuyển chủ — tải lại trang nhé.':
    'Could not load the transfer status — try reloading the page.',
  'Trạng thái chuyển chủ': 'Transfer status',

  // ── Device badges (buyer tag + seller mark) ─────────────────────────────
  'Chuyển từ người bán {name} ngày {date}': 'Transferred from {name} on {date}',
  'Chuyển từ người bán ngày {date}': 'Transferred from the seller on {date}',
  'Đã chuyển ngày {date}': 'Transferred on {date}',
  'Đã nhận': 'Received',
  'Đã chuyển': 'Transferred',
  'Người bán': 'Seller',
  'Đây là bản bạn nhận qua Warrly. Người bán giữ một bản đã bán và không còn xem được thiết bị này.':
    'This is the copy you received through Warrly. The seller keeps a sold copy and can no longer see this device.',

  // ── Lifecycle statuses (the owner-side read) ────────────────────────────
  'Đang chờ người nhận': 'Waiting for the recipient',
  'Đã có người nhận': 'Recipient confirmed',
  'Đã huỷ mã': 'Code cancelled',

  // ── Content contract: what travels / never travels ──────────────────────
  'Tên máy, loại, hãng và model': 'Device name, category, brand and model',
  'Ngày mua và nơi mua': 'Purchase date and place',
  'Serial/IMEI — chỉ phần đã che, không phải số đầy đủ':
    'Serial/IMEI — only the masked part, never the full number',
  'Các gói bảo hành còn lại: loại, nhà bảo hành, thời hạn':
    'Remaining warranty plans: type, provider, dates',
  'Tài liệu bạn chọn gửi kèm': 'The documents you choose to include',
  'Tình trạng máy và lịch sử sửa chữa đã ghi':
    'Device condition and the repair history you recorded',
  'Ghi chú riêng của bạn': 'Your private notes',
  'Tài liệu bạn không chọn': 'Documents you did not choose',
  'Các thiết bị khác, gói đăng ký và wishlist trong tài khoản':
    'Other devices, subscriptions and wishlist items in your account',
  'Email, mật khẩu, phiên đăng nhập và thông tin thanh toán':
    'Email, password, sessions and payment details',

  // ── Safety copy (must never be softened) ────────────────────────────────
  'Warrly chỉ chuyển dữ liệu, không phải giấy tờ pháp lý và không xác nhận quyền sở hữu.':
    'Warrly only moves data. This is not a legal document and does not confirm ownership.',
  'Không có thanh toán, đặt cọc hay trung gian. Warrly không giữ tiền và không bán thiết bị.':
    'No payment, deposit or middleman. Warrly holds no money and does not sell devices.',
  'Mã chỉ dùng một lần và hết hạn sau {days} ngày.':
    'The code works once and expires after {days} days.',
  'Mỗi thiết bị chỉ tạo được một mã trong {days} ngày.':
    'Each device can create one code every {days} days.',
  'Nếu không ai nhận, mã hết hạn và dữ liệu vẫn nằm nguyên trong tài khoản bạn.':
    'If nobody claims it, the code expires and nothing leaves your account.',
  'Mã chỉ hiện một lần, ngay sau khi bạn bấm tạo. Máy chủ chỉ lưu mã băm nên không ai — kể cả bạn — xem lại được. Hãy sao chép hoặc chia sẻ trước khi đóng.':
    'The code is shown once, right after you create it. The server stores only a hash, so nobody — including you — can view it again. Copy or share it before closing.',
  'Tôi đã sao chép hoặc lưu mã và link này và hiểu rằng không xem lại được.':
    'I have copied or saved the code and link, and I understand they cannot be shown again.',
  'Mã chưa được lưu. Hãy sao chép hoặc chia sẻ, hoặc tick xác nhận, rồi mới đóng.':
    'The code has not been saved. Copy or share it, or tick the acknowledgement, before closing.',
  'Thông tin do người bán gửi. Warrly không kiểm tra tình trạng máy hay giấy tờ, và lời mời này không có giá, ghi chú riêng hay thông tin thanh toán.':
    'These details come from the seller. Warrly does not inspect the device or the paperwork, and this invitation contains no price, private notes or payment details.',

  // ── Failure copy ────────────────────────────────────────────────────────
  'Mã không còn hiệu lực': 'This code is no longer valid',
  'Mã đã hết hạn': 'The code has expired',
  'Mã đã được dùng': 'The code was already used',
  'Không thể tự nhận': "You can't claim your own transfer",
  'Cần đăng nhập': 'Sign-in required',
  'Không mở được lời mời': 'Could not open this invitation',
  'Mã không tồn tại, đã hết hạn, đã được dùng hoặc đã bị người bán huỷ. Hãy kiểm tra lại với người bán — Warrly không cho biết mã nào từng tồn tại.':
    'The code does not exist, has expired, was already used, or was cancelled by the seller. Check it with the seller — Warrly does not reveal which codes ever existed.',
  'Mã đã hết hạn trước khi có người nhận. Không có dữ liệu nào được chuyển; hãy nhờ người bán tạo mã mới.':
    'The code expired before anyone claimed it. Nothing was transferred — ask the seller for a new code.',
  'Mã này đã được người khác dùng để nhận thiết bị. Mỗi mã chỉ nhận được một lần.':
    'Someone else already used this code to claim the device. Each code can be claimed only once.',
  'Bạn không thể nhận thiết bị từ chính mình. Hãy gửi mã cho người mua.':
    "You can't claim a device from yourself. Send the code to the buyer.",
  'Bạn đã thử quá nhiều lần. Chờ vài phút rồi mở lại link.':
    'You have tried too many times. Wait a few minutes and open the link again.',
  'Bạn cần đăng nhập để nhận thiết bị.': 'You need to sign in to claim the device.',
  'Không tải được thông tin chuyển chủ. Thử tải lại trang.':
    'Could not load the transfer details. Try reloading the page.',

  // ── Public claim page ───────────────────────────────────────────────────
  'Nhận thiết bị — Warrly': 'Claim a device — Warrly',
  'Mở lời mời chuyển chủ thiết bị trên Warrly. App chỉ chuyển dữ liệu, không phải giấy tờ pháp lý.':
    'Open a device transfer invitation on Warrly. The app only moves data — it is not a legal document.',
  'Chuyển chủ thiết bị': 'Device transfer',
  'Nhận thiết bị từ người bán': 'Claim a device from the seller',
  'Người bán đã gửi hồ sơ thiết bị qua Warrly. Đăng nhập để nhận một bản sao trong tài khoản của bạn.':
    'The seller has sent a device record through Warrly. Sign in to receive a copy in your account.',
  'Người bán: {name}': 'Seller: {name}',
  'Tên do người bán tự nhập, Warrly không xác minh danh tính.':
    'The name is typed by the seller; Warrly does not verify identity.',
  'Thông tin thiết bị': 'Device details',
  'Serial (đã che một phần)': 'Serial (partly masked)',
  'Tình trạng': 'Condition',
  'Bảo hành còn lại': 'Remaining warranty',
  'Chưa có gói bảo hành nào.': 'No warranty plan yet.',
  'Tài liệu kèm theo': 'Included documents',
  'Không có tài liệu nào được gửi kèm.': 'No documents were included.',
  'Chưa ghi ngày kết thúc': 'No end date recorded',
  'Chỉ tên tài liệu hiện ở đây; bản xem được chuyển vào tài khoản của bạn sau khi nhận.':
    'Only the file names appear here; the files themselves move into your account when you claim.',
  'Lịch sử sửa chữa': 'Repair history',
  'Đã ghi {count} lần đi bảo hành/sửa chữa.': {
    en: '{count} warranty or repair visits recorded.',
    enOne: '{count} warranty or repair visit recorded.',
  },
  'Sửa ngày {date}': 'Opened {date}',
  'Xong ngày {date}': 'Closed {date}',
  'Đăng nhập để nhận': 'Sign in to claim',
  'Chưa có tài khoản? Đăng ký': 'No account yet? Register',
  'Nhận thiết bị': 'Claim the device',
  'Xác nhận nhận thiết bị': 'Confirm the claim',
  'Để sau': 'Not now',
  'Thiết bị và các tài liệu đã chọn sẽ được sao vào tài khoản bạn. Người bán giữ một bản đã bán và không còn xem được thiết bị này. Mã chỉ dùng được một lần.':
    'The device and the selected documents will be copied into your account. The seller keeps a sold copy and can no longer see this device. The code works only once.',
  'Đang nhận thiết bị…': 'Claiming the device…',
  'Đã nhận thiết bị': 'Device claimed',
  'Mở thiết bị của bạn': 'Open your device',
  'Thiết bị đã nằm trong tài khoản của bạn, kèm bảo hành còn lại và các tài liệu người bán chọn gửi.':
    'The device is now in your account, with its remaining warranty and the documents the seller chose to include.',
  'Đăng nhập lại': 'Sign in again',
  'Không nhận được thiết bị. Thử lại sau.': 'Could not claim the device. Try again later.',
  'Nếu bạn vừa nhận thiết bị, mở danh sách thiết bị để xem.':
    'If you just claimed the device, open your device list to see it.',
});
