// The signed-out marketing/legal surface: `/`, `/privacy`, `/terms`, `/cookies`,
// plus the three chrome-less pages a visitor can land on without a session
// (`not-found`, `/offline`).
//
// Keys are the Vietnamese originals (see `../types.ts`). Generic shell copy
// (Đăng nhập / Đăng ký / Thử lại / Quay về trang chủ …) deliberately lives in
// `common.ts` and is NOT redefined here.
//
// One deliberate exception to "the Vietnamese is untouched", flagged where it
// happens: the landing hero badge said the app is Vietnamese-only. That claim is
// now false (English is the default, the whole point of this change), so its
// English column states what the badge means today — see the comment on that
// entry. Everything else is the byte-for-byte original.

import { defineMessages } from '../types';

export const publicPages = defineMessages({
  // ── Landing page (`app/page.tsx`) — hero ────────────────────────────────
  // The headline is ONE sentence that the layout splits around a highlighted
  // word. It stays one key: the <span> and the `{' '}` are markup, not
  // punctuation, so the English renders as a single sentence with the same word
  // picked out. Splitting it would produce two fragments no translator can
  // order — see the note in `page.tsx`.
  'Đừng quên ngày hết bảo hành thiết bị của bạn':
    "Don't forget when your device's warranty runs out",
  // The landing page highlights ONE word inside the sentence above by looking
  // it up in whatever language that sentence came back in (`page.tsx` does
  // `sentence.indexOf(t('bảo hành'))`). That is why this bare noun needs an
  // entry of its own: an unregistered key returns the VIETNAMESE word in both
  // languages, so the English headline would have silently rendered with no
  // highlight at all — a "looks fine, is wrong" failure. It has to stay a
  // substring of the English sentence above ("warranty", never "warranties");
  // `page.tsx` degrades to an unhighlighted headline if it stops matching.
  'bảo hành': 'warranty',
  // Was "Miễn phí · Local-first · Tiếng Việt". The third claim is no longer true
  // of this app — English is the default language now, which is exactly what
  // this change delivers — and an English reader is the one person it would
  // mislead. The Vietnamese column is the untouched original (rule 1); the
  // English column states the same three facts as they stand today. The app is
  // still built for Vietnamese users, now bilingually (see the root layout's
  // description, which was corrected the same way).
  'Miễn phí · Local-first · Tiếng Việt': 'Free · Local-first · Bilingual VI/EN',
  'Theo dõi thiết bị, gói đăng ký và những món đang thèm — tất cả ở một chỗ. Nhắc bảo hành sắp hết, lưu hoá đơn, biết tiền chảy đi đâu.':
    'Track your devices, subscriptions and wishlist in one place. Get warned before a warranty ends, keep the receipts, and see where the money goes.',
  'Không cần thẻ tín dụng': 'No credit card needed',
  'Không quảng cáo': 'No ads',
  'Backup xuất/nhập JSON': 'JSON export/import backup',
  'Vào app': 'Open the app',
  'Bắt đầu miễn phí': 'Start for free',
  'Mở Dashboard': 'Open the dashboard',
  'Tạo tài khoản miễn phí': 'Create a free account',
  'Đã có tài khoản → Đăng nhập': 'Already have an account → Sign in',

  // ── Landing page — feature grid ─────────────────────────────────────────
  'Tính năng': 'Features',
  'Tất cả những gì mày cần': 'Everything you need',
  'Không spam tính năng, không tracking. Chỉ những thứ thực sự hữu ích.':
    'No feature spam, no tracking. Only what is genuinely useful.',
  'Theo dõi bảo hành': 'Warranty tracking',
  'Mỗi thiết bị có thể có nhiều gói bảo hành — gốc, mở rộng, bên thứ 3. Đếm ngược tự động.':
    'Every device can carry several warranty plans — standard, extended, third-party. The countdown runs itself.',
  'Quản lý gói đăng ký': 'Subscription management',
  'Netflix, iCloud, ChatGPT... theo dõi chu kỳ và ngày gia hạn. Quy ra chi phí mỗi tháng.':
    'Netflix, iCloud, ChatGPT… track the cycle and the renewal date, and see the cost per month.',
  'Wishlist “đang thèm”': 'A “want list” wishlist',
  'Món đang ngắm — đặt ngày mục tiêu, theo dõi giá. Mua xong là thành thiết bị luôn.':
    'Things you are eyeing — set a target date, watch the price. Buy it and it becomes a device.',
  'Cảnh báo sắp hết': 'Expiry alerts',
  'Bọn tao nhắc trước qua push notification — cả trên web lẫn app iOS/Android. Khỏi lo bỏ lỡ.':
    'We warn you ahead of time by push notification — on the web and in the iOS/Android apps. You will not miss it.',
  'Lưu hoá đơn & phiếu BH': 'Store invoices & warranty slips',
  'Tải ảnh hoặc PDF — tối đa 5 file mỗi thiết bị, mã hoá AES-256. Tìm lại nhanh khi cần đi bảo hành.':
    'Upload photos or PDFs — up to 5 files per device, AES-256 encrypted. Find them fast when you need to claim.',
  'Thống kê chi tiêu': 'Spending stats',
  'Biểu đồ theo tháng, theo loại, top thiết bị đắt nhất. Biết tiền đi đâu.':
    'Charts by month and by category, plus your most expensive devices. Know where the money goes.',

  // ── Landing page — 3 steps + mock dashboard preview ─────────────────────
  // The eyebrow reads `Bắt đầu` in the original. It could NOT be reused as a
  // key: `subscriptions.ts` and `devices.ts` already register that exact
  // sentence as "Started" (a start date, past tense), and one Vietnamese key
  // cannot mean two different things — the merge in `messages/index.ts` reports
  // the disagreement and the suite fails. The Vietnamese stays as it was and the
  // copy was extended to `Bắt đầu như thế nào`, which is what the section
  // actually says and no other domain owns.
  'Bắt đầu như thế nào': 'Get started',
  '3 bước để bắt đầu': '3 steps to get started',
  'Đăng ký miễn phí': 'Sign up for free',
  'Email + mật khẩu. 30 giây xong.': 'Email and a password. Done in 30 seconds.',
  'Thêm thiết bị': 'Add a device',
  'Laptop, điện thoại, máy giặt... bất cứ thứ gì có bảo hành.':
    'A laptop, a phone, a washing machine… anything with a warranty.',
  'Theo dõi tự động': 'Automatic tracking',
  'Khỏi đụng vào, tao lo phần đếm ngược.': 'Touch nothing — we handle the countdown.',
  // The four mock stat cards inside the preview. `Tổng` and `Sắp hết` are new
  // sentences (the real dashboard cards read 'Tổng thiết bị' / 'Sắp hết (≤30
  // ngày)'), so their English follows that vocabulary. `Còn BH` is the
  // abbreviated form of `dashboard.ts`'s 'Còn bảo hành' → "Under warranty".
  //
  // The fourth card is plain `Hết` and is deliberately NOT registered: see the
  // note in `page.tsx` where it renders. `warranties.ts` owns that exact
  // sentence as "Expires" (the end date on a warranty timeline), which is the
  // opposite of what this card counts, and `messages/index.ts` fails the suite
  // when one Vietnamese key carries two English meanings.
  'Tổng': 'Total',
  'Còn BH': 'Under warranty',
  'Sắp hết': 'Expiring soon',
  // The fourth mock stat card on the landing hero. Distinct from
  // `warranties.ts`'s `'Hết'` → "Expires" (a warranty's end DATE); this one
  // says the cover has already run out. Wording from the Go catalog.
  'Hết hạn': 'Expired',

  // ── Landing page — final CTA + footer ───────────────────────────────────
  'Sẵn sàng quản lý thiết bị?': 'Ready to get your devices in order?',
  'Free mãi mãi. Không cần thẻ. Không quảng cáo.': 'Free forever. No card. No ads.',
  '© {year} WarrantyVault. Made with ♥ in Vietnam.':
    '© {year} WarrantyVault. Made with ♥ in Vietnam.',

  // ── 404 (`app/not-found.tsx`) ───────────────────────────────────────────
  'Không tìm thấy — WarrantyVault': 'Not found — WarrantyVault',
  'Mã 404': 'Error 404',
  'Két sắt trống rỗng!': 'The vault is empty!',
  'Trang mày tìm chưa từng tồn tại — hoặc đã bị di chuyển đi nơi khác.':
    'The page you are looking for never existed — or it moved somewhere else.',
  'Về trang chủ': 'Go to the homepage',
  'Quay lại Dashboard': 'Back to the dashboard',
  'Mã lỗi 404 · WarrantyVault': 'Error code 404 · WarrantyVault',
  'Két sắt trống rỗng': 'The vault is empty',

  // ── Offline (`app/offline/page.tsx`) ────────────────────────────────────
  'Ngoại tuyến — WarrantyVault': 'Offline — WarrantyVault',
  'Trạng thái · Ngoại tuyến': 'Status · Offline',
  'Mất kết nối rồi 📡': 'You are offline 📡',
  'Mày đang ngoại tuyến. WarrantyVault chưa lưu dữ liệu để xem offline — thiết bị, bảo hành, thống kê… đều cần kết nối mạng. Có mạng lại là mọi thứ chạy như bình thường.':
    'You are offline. WarrantyVault does not cache your data for offline viewing yet — devices, warranties and stats all need a connection. Once you are back online everything works as usual.',
  'Ngoại tuyến thì chỉ mở được đúng trang này thôi. Thông báo đẩy vẫn do trình duyệt nhận giúp khi thiết bị có mạng — không cần mở web.':
    'Offline, this is the only page that opens. Push notifications are still received by your browser whenever the device has a connection — you do not need to open the site.',
  'Bước 1': 'Step 1',
  'Kiểm tra Wi-Fi / dữ liệu di động': 'Check Wi-Fi / mobile data',
  'Bước 2': 'Step 2',
  'Bật/tắt chế độ máy bay': 'Turn airplane mode off and on',
  'Bước 3': 'Step 3',
  'Kết nối lại rồi thử lại': 'Reconnect and try again',
  'Mất kết nối': 'No connection',

  // ── Legal pages: shared chrome ──────────────────────────────────────────
  'Cập nhật lần cuối: {date}': 'Last updated: {date}',
  'Email': 'Email',
  'Liên hệ': 'Contact',
  'Có thắc mắc về dữ liệu:': 'Questions about your data:',
  'Có thắc mắc:': 'Questions:',

  // ── Privacy (`app/(public)/privacy/page.tsx`) ───────────────────────────
  'Chính sách bảo mật — Warranty Vault': 'Privacy policy — Warranty Vault',
  'Chính sách bảo mật và xử lý dữ liệu của Warranty Vault':
    'Warranty Vault privacy and data-handling policy',
  'Chính sách bảo mật': 'Privacy policy',
  'Warranty Vault là công cụ cá nhân để theo dõi thiết bị, bảo hành, gói đăng ký và danh sách “thèm”. Trang này mô tả bọn tao thu thập gì, lưu thế nào và chia sẻ với ai. Nguyên tắc gọn lại:':
    'Warranty Vault is a personal tool for tracking devices, warranties, subscriptions and your “want” list. This page describes what we collect, how we store it and who we share it with. The short version:',
  'dữ liệu của mày là của mày': 'your data is yours',
  'bọn tao không bán, không quảng cáo, không tracking.':
    'we do not sell it, advertise against it or track you.',
  '1. Dữ liệu bọn tao lưu': '1. What we store',
  'Email và mật khẩu (lưu dưới dạng băm bcrypt, không bao giờ lưu mật khẩu gốc); các bản ghi mày tự nhập (thiết bị, gói bảo hành, subscription, wishlist); file đính kèm mày tải lên (ảnh hoá đơn / phiếu bảo hành); và token thông báo đẩy của thiết bị nếu mày bật push.':
    'Your email and password (stored as a bcrypt hash — the original password is never kept); the records you enter yourself (devices, warranty plans, subscriptions, wishlist); the attachments you upload (invoice / warranty-slip images); and the device push token, if you turn push on.',
  '2. Mã hoá & lưu trữ': '2. Encryption & storage',
  'File đính kèm được mã hoá': 'Attachments are encrypted with',
  'AES-256-GCM': 'AES-256-GCM',
  'khi lưu trên máy chủ, mỗi file một khoá riêng (khoá này lại được bọc bởi khoá chủ của hệ thống). Phiên đăng nhập nằm trong một cookie đã mã hoá':
    'on the server, one key per file (each of those keys is wrapped by the system master key). Your session lives in an encrypted cookie',
  'Toàn bộ dữ liệu nằm trên cơ sở dữ liệu do bọn tao tự vận hành.':
    'All data lives on a database we run ourselves.',
  '3. Tính năng AI quét hoá đơn (tự chọn bật)': '3. AI receipt scanning (opt-in)',
  'Mặc định tính năng này': 'This feature is',
  'TẮT': 'OFF',
  'Chỉ khi mày tự bật trong Cài đặt, ảnh hoá đơn mày chọn mới được':
    'by default. Only after you enable it in Settings is a receipt image you pick',
  'giải mã và gửi tới nhà cung cấp AI bên thứ ba (Anthropic)':
    'decrypted and sent to a third-party AI provider (Anthropic)',
  'để tự đọc thông tin điền vào form. Kết quả luôn là bản nháp — mày kiểm tra lại rồi mới lưu. Không bật thì ảnh không bao giờ rời máy chủ ở dạng đã giải mã. Mày có thể tắt lại bất cứ lúc nào.':
    'to read the details and fill in the form. The result is always a draft — you review it before saving. With the feature off, an image never leaves the server decrypted. You can turn it back off at any time.',
  '4. Bên thứ ba bọn tao dùng': '4. Third parties we use',
  'Anthropic': 'Anthropic',
  'chỉ khi mày bật AI quét hoá đơn (xem mục 3).':
    'only when you enable AI receipt scanning (see section 3).',
  'Resend': 'Resend',
  'gửi email đặt lại mật khẩu khi mày yêu cầu.':
    'sends the password-reset email when you ask for one.',
  'Apple (APNs), Google (FCM), trình duyệt (Web Push)':
    'Apple (APNs), Google (FCM), your browser (Web Push)',
  'chuyển thông báo nhắc bảo hành tới thiết bị, chỉ khi mày bật push.':
    'carry warranty reminders to your devices, only when you turn push on.',
  'Ngoài các dịch vụ trên, bọn tao không chia sẻ dữ liệu với ai.':
    'Beyond those services, we share your data with nobody.',
  '5. Không quảng cáo, không tracking': '5. No ads, no tracking',
  'Không gắn pixel, không Google Analytics, không Facebook SDK, không cookie quảng cáo.':
    'No pixels, no Google Analytics, no Facebook SDK, no advertising cookies.',
  '6. Quyền của mày': '6. Your rights',
  'Mày có thể': 'You can',
  'xuất toàn bộ dữ liệu': 'export all of your data',
  'ra file JSON (Cài đặt → Dữ liệu) bất cứ lúc nào, và':
    'to a JSON file (Settings → Data) at any time, and',
  'xoá tài khoản': 'delete your account',
  'để xoá vĩnh viễn mọi thiết bị, hoá đơn, ảnh và cài đặt. Thao tác xoá không thể hoàn tác.':
    'to permanently erase every device, invoice, image and setting. Deleting cannot be undone.',
  '7. Liên hệ': '7. Contact',

  // ── Terms (`app/(public)/terms/page.tsx`) ───────────────────────────────
  'Điều khoản sử dụng — Warranty Vault': 'Terms of service — Warranty Vault',
  'Điều khoản sử dụng dịch vụ Warranty Vault': 'Warranty Vault terms of service',
  'Điều khoản sử dụng': 'Terms of service',
  'Dùng Warranty Vault tức là mày đồng ý với các điều khoản dưới đây. Bọn tao cố giữ chúng ngắn và dễ hiểu.':
    'Using Warranty Vault means you agree to the terms below. We try to keep them short and easy to read.',
  '1. Dịch vụ & mục đích cá nhân': '1. The service & personal use',
  'Warranty Vault là công cụ cá nhân để quản lý thiết bị, bảo hành, gói đăng ký và wishlist của chính mày. Đừng dùng để lưu trữ dữ liệu của người khác khi chưa được họ cho phép.':
    'Warranty Vault is a personal tool for managing your own devices, warranties, subscriptions and wishlist. Do not use it to store other people\'s data without their permission.',
  '2. Tài khoản & bảo mật': '2. Accounts & security',
  'Mày chịu trách nhiệm giữ mật khẩu an toàn và mọi hoạt động dưới tài khoản của mình. Báo cho bọn tao ngay nếu nghi ngờ tài khoản bị truy cập trái phép.':
    'You are responsible for keeping your password safe and for everything done under your account. Tell us right away if you suspect unauthorised access.',
  '3. Nội dung của mày': '3. Your content',
  'Mày sở hữu dữ liệu mình nhập và tải lên. Mày tự đảm bảo nội dung đó hợp pháp và mày có quyền lưu trữ nó. Bọn tao không yêu cầu quyền sở hữu nội dung của mày.':
    'You own the data you enter and upload. You are responsible for making sure that content is lawful and that you have the right to store it. We claim no ownership over your content.',
  '4. Giới hạn sử dụng': '4. Usage limits',
  // "…báo bằng tiếng Việt" was true when Vietnamese was the only language.
  // It is not any more (the message arrives in the interface language), so the
  // English column says what happens today; the Vietnamese column is untouched.
  'Để hệ thống chạy ổn cho mọi người, mỗi tài khoản có một số giới hạn (số thiết bị, số gói bảo hành/đính kèm mỗi thiết bị, dung lượng tải lên, số subscription/wishlist). Khi chạm giới hạn, ứng dụng sẽ báo bằng tiếng Việt.':
    'So the system stays healthy for everyone, each account has some limits (number of devices, warranty plans and attachments per device, upload quota, number of subscriptions/wishlist items). When you hit a limit, the app tells you.',
  '5. Không bảo đảm': '5. No warranty',
  'Dịch vụ được cung cấp “nguyên trạng” (as-is). Bọn tao cố gắng giữ dữ liệu an toàn và nhắc nhở đúng hạn, nhưng không bảo đảm dịch vụ không gián đoạn hay không có lỗi. Hãy tự sao lưu dữ liệu quan trọng (Cài đặt → Dữ liệu → Sao lưu).':
    'The service is provided “as is”. We do our best to keep your data safe and to remind you on time, but we cannot promise the service will never go down or never have a bug. Back up anything important yourself (Settings → Data → Backup).',
  '6. Chấm dứt': '6. Termination',
  'Mày có thể xoá tài khoản bất cứ lúc nào trong phần Cài đặt — toàn bộ dữ liệu sẽ bị xoá vĩnh viễn. Bọn tao có thể tạm ngưng tài khoản nếu phát hiện hành vi lạm dụng hệ thống.':
    'You can delete your account at any time in Settings — all of your data is permanently erased. We may suspend an account if we find it being abused.',

  // ── Cookies (`app/(public)/cookies/page.tsx`) ───────────────────────────
  'Chính sách Cookie — WarrantyVault': 'Cookie policy — WarrantyVault',
  'Chính sách sử dụng cookie của WarrantyVault': 'How WarrantyVault uses cookies',
  'Chính sách Cookie': 'Cookie policy',
  'WarrantyVault dùng cookie ở mức tối thiểu — chỉ đủ để mày đăng nhập và giữ phiên. Không có cookie quảng cáo hay theo dõi.':
    'WarrantyVault uses the bare minimum of cookies — just enough to sign you in and keep your session. There are no advertising or tracking cookies.',
  '1. Cookie thiết yếu': '1. Essential cookies',
  'Bọn tao dùng đúng một cookie cho phiên đăng nhập:':
    'We use exactly one cookie for the sign-in session:',
  'Nó được mã hoá, chỉ chứa token phiên và thời hạn — không có thông tin cá nhân đọc được. Tắt cookie này thì không đăng nhập được.':
    'It is encrypted and holds only the session token and its expiry — no readable personal information. Turn it off and you cannot sign in.',
  '2. Lưu trữ cục bộ trên máy': '2. Local storage on your device',
  'Một vài tuỳ chọn giao diện (ví dụ chế độ sáng/tối) được lưu trong bộ nhớ cục bộ của trình duyệt (localStorage) trên máy mày, không gửi về máy chủ.':
    'A few interface preferences (light/dark mode, for example) are kept in your browser\'s local storage (localStorage) on your own machine and are never sent to the server.',
  '3. Không cookie bên thứ ba': '3. No third-party cookies',
  'Không Google Analytics, không pixel mạng xã hội, không cookie quảng cáo hay tracking xuyên trang.':
    'No Google Analytics, no social pixels, no advertising or cross-site tracking cookies.',
});
