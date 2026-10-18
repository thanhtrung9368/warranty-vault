// Pre-service handover checklist (`lib/handover-checklist.ts` + the device
// detail page and its `/devices/[id]/handover` route).
//
// The copy is per-item on purpose: a generic "back up your data" line is not
// actionable. These sentences name the Vietnamese specifics a service counter
// argues about — Activation Lock / Google FRP, a matching IMEI on the box, the
// intake slip, and the fact that a chain may wipe the device on intake.
//
// The list is generated in `lib/handover-checklist.ts`. Its literal translate
// calls are visible to the source scan in `__tests__/i18n-coverage.test.ts`;
// `__tests__/handover-checklist.test.ts` additionally builds every variant in
// English and fails if any string is still Vietnamese, including the calls
// formatted across several lines.
//
// Nothing here claims a specific retailer policy. "Cửa hàng có thể xoá dữ liệu"
// is a possibility the owner must be ready for, not a quote from FPT Shop or
// CellphoneS; the page tells the user to ask the counter.

import { defineMessages } from '../types';

export const handover = defineMessages({
  // ── Page + device-detail entry point ─────────────────────────────────────
  'Chuẩn bị đi bảo hành': 'Pre-service handover checklist',
  'Checklist bàn giao': 'Handover checklist',
  'Danh sách sinh riêng cho {name} — tick từng mục khi làm xong.':
    'A list generated for {name} — tick each item as you finish it.',
  'Đã xong {done}/{total} mục': { en: '{done}/{total} done' },
  'Bỏ đánh dấu': 'Clear ticks',
  'Danh sách chỉ để bạn tự kiểm tra — app không lưu trạng thái đánh dấu. Đóng hoặc tải lại trang là mất.':
    'This list is for your own check — the app does not save the ticks. Closing or reloading the page clears them.',
  'Máy còn passcode hoặc tài khoản iCloud/Google/Mi có thể bị từ chối ngay ở quầy. Cửa hàng cũng có thể xoá dữ liệu khi tiếp nhận — hãy sao lưu trước.':
    'A device still locked with a passcode or signed in to iCloud/Google/Mi can be refused at the counter. The centre may also wipe data on intake — back up first.',
  'Máy còn mật khẩu hoặc tài khoản iCloud/Microsoft/Google có thể bị từ chối ngay ở quầy. Cửa hàng cũng có thể xoá dữ liệu khi tiếp nhận — hãy sao lưu trước.':
    'A laptop still locked with a password or signed in to iCloud/Microsoft/Google can be refused at the counter. The centre may also wipe data on intake — back up first.',
  'Cửa hàng có thể kiểm tra tem máy và giấy tờ trước khi nhận. Chụp lại tình trạng máy và giữ phiếu tiếp nhận.':
    'The centre may check the model label and paperwork before accepting it. Photograph its condition and keep the intake slip.',
  'Mở checklist bàn giao': 'Open the handover checklist',
  '{count} việc cần kiểm tra trước khi giao máy, từ sao lưu dữ liệu và đăng xuất tài khoản đến hoá đơn, hộp máy và phiếu tiếp nhận.':
    {
      en: '{count} tasks to check before handing the device over, from backing up data and signing out of accounts to the invoice, box and intake slip.',
      enOne:
        '1 task to check before handing the device over, from backing up data and signing out of accounts to the invoice, box and intake slip.',
    },

  // ── Group headings ───────────────────────────────────────────────────────
  'Dữ liệu & tài khoản': 'Data & accounts',
  'Tình trạng máy': 'Device condition',
  'Giấy tờ & bảo hành': 'Paperwork & warranty',
  'Ở quầy tiếp nhận': 'At the service counter',
  'Khi nhận lại máy': 'When you collect it',

  // ── Phone / tablet / watch — data & accounts ─────────────────────────────
  'Sao lưu ảnh, danh bạ và dữ liệu trước khi đi':
    'Back up photos, contacts and data before you go',
  'Cửa hàng có thể xoá dữ liệu khi tiếp nhận. Sao lưu vào iCloud/Google Drive hoặc máy tính, rồi mở thử một file để chắc bản sao dùng được.':
    'The service centre may wipe the device on intake. Back up to iCloud/Google Drive or a computer, then open one restored file to be sure the copy works.',
  'Đăng xuất iCloud, Google và Mi Cloud':
    'Sign out of iCloud, Google and Mi Cloud',
  'Đăng xuất mọi tài khoản đang đăng nhập trên máy. Máy còn iCloud/Find My hoặc tài khoản Google có thể bị từ chối tiếp nhận hoặc không mở được sau khi sửa.':
    'Sign out of every account on the device. A phone still linked to iCloud/Find My or a Google account can be refused at intake, or cannot be set up after the repair.',
  'Tắt Find My và khoá kích hoạt (Activation Lock/FRP)':
    'Turn off Find My and activation lock (Activation Lock/FRP)',
  'Tắt Find My iPhone/Find My Device trước khi đăng xuất. Chỉ xoá máy sau khi đã tắt — nếu không, máy có thể bị khoá lại và không ai mở được.':
    'Turn off Find My iPhone/Find My Device before signing out. Only erase the device afterwards — otherwise it can lock again and nobody can open it.',
  'Gỡ mật khẩu màn hình, Face ID/Touch ID và khoá ứng dụng':
    'Remove the screen passcode, Face ID/Touch ID and app locks',
  'Gỡ mật khẩu đăng nhập, Touch ID và khoá ứng dụng':
    'Remove the login password, Touch ID and app locks',
  'Máy còn passcode hoặc khoá sinh trắc học có thể bị từ chối ngay ở quầy tiếp nhận. Gỡ mọi khoá trước khi giao, kể cả khoá ứng dụng ngân hàng.':
    'A device with a passcode or biometric lock can be refused at the counter. Remove every lock before handing it over, including banking-app locks.',
  'Chuyển mã 2FA, tháo SIM và eSIM trước khi xoá máy':
    'Move 2FA codes, remove the SIM and eSIM before erasing',
  'Ứng dụng xác thực và eSIM có thể mất khi xoá máy. Xuất mã dự phòng, đăng nhập ứng dụng xác thực trên máy khác, tháo SIM/thẻ nhớ; với eSIM hỏi nhà mạng cách chuyển.':
    'Authenticator apps and eSIMs can be lost when the device is erased. Export backup codes, sign in to the authenticator on another phone, remove the SIM/memory card, and ask your carrier how to move an eSIM.',
  'Chỉ xoá máy sau khi đã sao lưu và đăng xuất':
    'Only erase the device after backing up and signing out',
  'Xoá máy là bước cuối, không phải bước đầu. Nếu chưa chắc có bản sao hoặc chưa thoát tài khoản, đừng xoá — cửa hàng có thể tự xoá khi tiếp nhận, nhưng bạn vẫn nên chủ động.':
    'Erasing is the last step, not the first. If you are not sure the backup exists or the accounts are signed out, do not erase — the service centre may wipe it anyway, but you should be the one in control.',

  // ── Laptop — data & accounts ─────────────────────────────────────────────
  'Sao lưu dữ liệu và lưu khoá mã hoá ổ đĩa':
    'Back up your data and save the disk-encryption key',
  'Cửa hàng có thể xoá dữ liệu khi tiếp nhận. Sao lưu tài liệu, ảnh và bookmark ra ổ ngoài hoặc cloud; nếu Windows dùng BitLocker, lưu luôn recovery key.':
    'The service centre may wipe the device on intake. Back up documents, photos and bookmarks to an external drive or cloud; on Windows with BitLocker, save the recovery key too.',
  'Đăng xuất iCloud, Microsoft và Google':
    'Sign out of iCloud, Microsoft and Google',
  'Đăng xuất mọi tài khoản đang đăng nhập trên máy. Máy còn iCloud/Find My Mac, tài khoản Microsoft hoặc Google có thể bị từ chối tiếp nhận hoặc không mở được sau khi sửa.':
    'Sign out of every account on the device. A laptop still linked to iCloud/Find My Mac, a Microsoft account or Google can be refused at intake, or cannot be set up after the repair.',
  'Tắt Find My Mac và khoá kích hoạt':
    'Turn off Find My Mac and activation lock',
  'Tắt Find My Mac trước khi đăng xuất iCloud. Nếu máy có khoá kích hoạt của hãng hoặc MDM, gỡ liên kết thiết bị khỏi tài khoản quản lý trước khi giao.':
    'Turn off Find My Mac before signing out of iCloud. If the laptop has a manufacturer activation lock or MDM, unlink it from the management account before handing it over.',
  'Gỡ mật khẩu đăng nhập, Touch ID và mọi khoá ứng dụng. Không cần tắt mã hoá ổ đĩa — chỉ cần nhân viên mở được máy để kiểm tra.':
    'Remove the login password, Touch ID and any app locks. Do not disable disk encryption — the technician only needs to be able to open the machine and check it.',
  'Sao lưu mã 2FA sang thiết bị khác':
    'Back up your 2FA codes to another device',
  'Xoá máy có thể xoá luôn ứng dụng xác thực. Xuất mã dự phòng hoặc chuyển tài khoản sang điện thoại khác trước, nếu không bạn sẽ không đăng nhập được vào chính tài khoản của mình.':
    'Erasing the laptop can erase the authenticator app too. Export backup codes or move the accounts to a phone first, or you will lock yourself out of your own accounts.',

  // ── Condition ────────────────────────────────────────────────────────────
  'Chụp ảnh và quay clip tình trạng máy, kèm tem serial/IMEI {serial}':
    'Photograph and film the device, including the serial/IMEI label {serial}',
  'Chụp ảnh và quay clip tình trạng máy trước khi giao':
    'Photograph and film the device before handing it over',
  'Chụp 4 mặt, màn hình khi bật/tắt, cổng sạc, camera và các vết xước đã có. Quay một clip ngắn lúc máy còn chạy để làm bằng chứng.':
    'Photograph all four sides, the screen on and off, the charging port, the cameras and any existing scratches. Record a short clip while it still works as evidence.',
  'Ghi lại lỗi hiện tại và đề nghị ghi vào phiếu tiếp nhận':
    'Write down the current fault and ask for it to go on the intake slip',
  'Lỗi gì, xuất hiện từ khi nào, đã thử gì. Đề nghị nhân viên ghi đúng tình trạng lúc nhận để không bị quy cho hư hỏng mới.':
    'What the fault is, when it started and what you already tried. Ask the staff to record the exact condition on intake so new damage is not blamed on you.',
  'Không tự tháo máy hoặc sửa ở tiệm ngoài trước':
    'Do not open the device or use an outside repair shop first',
  'Tem niêm phong rách hoặc dấu mở máy có thể làm mất bảo hành. Nếu đã sửa ngoài, nói trước với trung tâm để họ kiểm tra và báo giá.':
    'A broken seal or signs of opening can void the warranty. If an outside shop has already worked on it, say so before the centre inspects it and quotes.',

  // ── Paperwork & warranty ─────────────────────────────────────────────────
  'Mang hoá đơn mua tại {place}': 'Bring the invoice from {place}',
  'Mang hoá đơn hoặc email xác nhận đơn hàng':
    'Bring the invoice or the order confirmation email',
  'Hoá đơn giấy hoặc email xác nhận đơn mua tại {place}. Nếu mua online, mang cả phiếu giao hàng; không có hoá đơn, trung tâm có thể chỉ tra theo serial/IMEI hoặc từ chối bảo hành.':
    'The paper invoice or order-confirmation email from {place}. If bought online, bring the delivery note too; without an invoice the centre may only check the serial/IMEI or refuse the claim.',
  'Hoá đơn giấy hoặc email xác nhận đơn hàng. Nếu mua online, mang cả phiếu giao hàng; không có hoá đơn, trung tâm có thể chỉ tra theo serial/IMEI hoặc từ chối bảo hành.':
    'The paper invoice or order-confirmation email. If bought online, bring the delivery note too; without an invoice the centre may only check the serial/IMEI or refuse the claim.',
  'Mang hộp máy có serial/IMEI khớp với máy ({serial})':
    'Bring the box with the serial/IMEI matching the device ({serial})',
  'Mang hộp máy có serial/IMEI khớp với máy và hoá đơn':
    'Bring the box with the serial/IMEI matching the device and invoice',
  'Số serial/IMEI trên hộp phải khớp với máy và hoá đơn: {serial}. Nếu hộp ghi số khác, chụp lại cả hai trước khi đi.':
    'The serial/IMEI on the box must match the device and invoice: {serial}. If the box shows a different number, photograph both before you go.',
  'Số serial/IMEI trên hộp phải khớp với máy và hoá đơn. Nếu không tìm thấy hộp, hỏi trung tâm trước xem có cần không.':
    'The serial/IMEI on the box must match the device and invoice. If you cannot find the box, ask the centre whether they need it before you go.',
  'Biết chính xác ngày hết bảo hành': 'Know the exact warranty end date',
  'Bảo hành của máy hết ngày {date}. Nếu đã hết hạn, hỏi giá trước khi đồng ý sửa.':
    'The warranty on this device ends on {date}. If it has expired, ask for a quote before agreeing to the repair.',
  'App chưa có ngày hết bảo hành. Tra trên hoá đơn hoặc trang tra cứu của hãng trước khi đi, và hỏi giá nếu đã hết hạn.':
    'The app has no warranty end date for this device. Check the invoice or the manufacturer lookup page before you go, and ask for a quote if it has expired.',
  'Đọc trước điều kiện bảo hành và mức phí':
    'Check the warranty terms and costs first',
  'Hỏi rõ rơi vỡ/vào nước có được bảo hành không, thời gian xử lý bao lâu và ngoài bảo hành thì phí bao nhiêu. Ghi lại câu trả lời để đối chiếu sau. Mang thẻ bảo hành nếu hãng phát hành riêng.':
    'Ask whether drops or liquid damage are covered, how long the repair takes and what an out-of-warranty repair costs. Write the answers down for later. Bring the warranty card if the manufacturer issues one separately.',

  // ── At the counter ───────────────────────────────────────────────────────
  'Liệt kê phụ kiện gửi kèm máy':
    'List the accessories handed over with the device',
  'Sạc, cáp, bút, ốp, tai nghe, thẻ nhớ, remote... Ghi rõ món nào gửi lại và món nào mang về; đừng để phụ kiện lẫn trong hộp máy.':
    'Charger, cable, stylus, case, headphones, memory card, remote... Write down what stays with the device and what you take home; do not leave loose accessories in the box.',
  'Xin phiếu tiếp nhận ghi đủ máy, serial/IMEI, phụ kiện và ngày hẹn':
    'Get an intake slip with the device, serial/IMEI, accessories and promised date',
  'Phiếu cần có tên máy, serial/IMEI, tình trạng lúc nhận, phụ kiện, ngày hẹn trả và số liên hệ. Chụp lại phiếu trước khi rời quầy.':
    'The slip should show the device name, serial/IMEI, condition on intake, accessories, promised return date and a contact number. Photograph it before leaving the counter.',
  'Hỏi rõ cửa hàng có xoá dữ liệu khi tiếp nhận không':
    'Ask whether the centre wipes data on intake',
  'Hỏi trước khi giao: họ có reset máy không, có cần bạn mở khoá không, dữ liệu được xử lý thế nào. Nếu máy phải ở lại qua đêm, hỏi ai chịu trách nhiệm.':
    'Ask before handing it over: will they reset it, do they need you to unlock it, and what happens to the data? If the device stays overnight, ask who is responsible for it.',

  // ── Pickup ───────────────────────────────────────────────────────────────
  'Kiểm tra máy và phụ kiện khi nhận lại':
    'Check the device and accessories when you collect it',
  'Bật máy, thử màn hình/camera/sạc, chạy lại lỗi cũ, đối chiếu serial/IMEI và phụ kiện trước khi ký nhận. Ra khỏi quầy rồi mới phát hiện thì khó xử lý.':
    'Power it on, test the screen/camera/charging, reproduce the original fault, and check the serial/IMEI and accessories before signing. Problems found after leaving the counter are harder to resolve.',
});
