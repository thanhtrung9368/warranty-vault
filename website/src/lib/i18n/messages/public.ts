// The signed-out marketing/legal surface: `/`, `/privacy`, `/terms`, `/cookies`,
// plus the three chrome-less pages a visitor can land on without a session
// (`not-found`, `/offline`).
//
// Keys are the Vietnamese originals (see `../types.ts`). Generic shell copy
// (Đăng nhập / Đăng ký / Thử lại / Quay về trang chủ …) deliberately lives in
// `common.ts` and is NOT redefined here.
//
// One deliberate exception to "the Vietnamese is untouched", flagged where it
// happens: the landing hero badge used to claim "Local-first". That claim was
// false — the device copy lives in Postgres behind the Go API, the service
// worker explicitly skips `/api/`, and there is no IndexedDB/device store — so
// the sentence itself was rewritten (key, call site and translation together).
// Every other Vietnamese key in this file is the byte-for-byte original.

import { defineMessages } from '../types';

export const publicPages = defineMessages({
  // ── Landing page (`app/page.tsx`) — hero ────────────────────────────────
  // The headline is ONE sentence that the layout splits around a highlighted
  // word. It stays one key: the <span> and the `{' '}` are markup, not
  // punctuation, so the English renders as a single sentence with the same word
  // picked out. Splitting it would produce two fragments no translator can
  // order — see the note in `page.tsx`.
  //
  // Rewritten for this wave. The old line named one entity (the device) and
  // forgot the paperwork; this one names the job (keep the date), the receipt,
  // and the household. The English is not a word-for-word rendering of the
  // Vietnamese — it is the same plain-spoken sentence written natively.
  'Giữ ngày hết bảo hành — và cả hoá đơn — cho mọi thứ trong nhà.':
    'Keep the warranty date — and the receipt — for everything in your home.',
  // The landing page highlights ONE word inside the sentence above by looking
  // it up in whatever language that sentence came back in (`page.tsx` does
  // `sentence.indexOf(t('bảo hành'))`). That is why this bare noun needs an
  // entry of its own: an unregistered key returns the VIETNAMESE word in both
  // languages, so the English headline would have silently rendered with no
  // highlight at all — a "looks fine, is wrong" failure. It has to stay a
  // substring of the English sentence above ("warranty", never "warranties");
  // `page.tsx` degrades to an unhighlighted headline if it stops matching.
  'bảo hành': 'warranty',
  // Rewritten from "Miễn phí · Local-first · Tiếng Việt". All three old claims
  // were audited, not just the language one:
  //   * "Local-first" was FALSE. Warrly is a Next.js UI over the Go API and
  //     Postgres; `public/sw.js` skips `/api/`, and there is no IndexedDB or
  //     device store. The device does not hold the primary copy.
  //   * "Tiếng Việt" (Vietnamese-only) was also false: English is the default.
  // The replacement is true and specific — no ads/tracking matches the privacy
  // policy, free matches the product, and "built for Vietnam" describes the
  // VND / 1-đổi-1 / Vietnamese-warranty model rather than the UI language.
  'Miễn phí · Không quảng cáo, không theo dõi · Xây cho Việt Nam':
    'Free · No ads, no tracking · Built for Vietnam',
  // The subhead is deliberately NOT a feature list. It names the three things
  // a Vietnamese household actually owns, then the two things Warrly keeps
  // for them. One sentence, no "everything you need".
  'Tủ lạnh, máy giặt, chiếc iPhone: mỗi món có một ngày hết hạn và một tấm hoá đơn. Warrly giữ cả hai, và nhắc bạn trước khi bảo hành hết hiệu lực.':
    'The fridge, the washing machine, the iPhone — each one has an expiry date and a receipt. Warrly keeps both, and reminds you before the warranty runs out.',
  'Không cần thẻ tín dụng': 'No credit card needed',
  'Không quảng cáo': 'No ads',
  'Backup xuất/nhập JSON': 'JSON export/import backup',
  'Vào app': 'Open the app',
  'Bắt đầu miễn phí': 'Start for free',
  'Mở Dashboard': 'Open the dashboard',
  'Tạo tài khoản miễn phí': 'Create a free account',
  'Đã có tài khoản → Đăng nhập': 'Already have an account → Sign in',

  // ── Landing page — feature grid ─────────────────────────────────────────
  // The old heading and subhead were two of the audit's clichés ("Everything
  // you need", "No feature spam"). Replaced with a concrete promise. The six
  // pastel tint chips are gone in `page.tsx`; the icons are now plain and
  // colour carries the accent only.
  'Tính năng': 'What Warrly does',
  'Sáu việc nhỏ. Một chỗ.': 'Six small jobs. One place.',
  'Không bảng điều khiển rối rắm. Mỗi mục trả lời đúng một câu hỏi.':
    'No dashboard to decipher. Each part answers one question.',
  // `Bảo hành` and `Gói đăng ký` already exist in `devices.ts` / `common.ts`
  // with the same English, so the landing page reuses those keys instead of
  // redefining them.
  'Mỗi thiết bị có thể có nhiều gói — gốc, mở rộng, bên thứ ba. Warrly tự đếm ngược.':
    'Every device can carry several plans — standard, extended, third-party. Warrly keeps the countdown.',
  'Netflix, iCloud, ChatGPT: chu kỳ, ngày gia hạn, và chi phí mỗi tháng.':
    'Netflix, iCloud, ChatGPT: the cycle, the renewal date, and the cost per month.',
  'Món đang ngắm — ngày mục tiêu, giá, và mua xong thì thành thiết bị.':
    'The thing you are eyeing — a target date, the price, and one tap to make it a device.',
  'Nhắc trước khi hết hạn': 'Reminders before expiry',
  // The app claim now matches what a visitor can actually download. There is
  // no store listing for either native app in this repo and iOS is TestFlight
  // only, so the old "on the web and in the iOS/Android apps" was unactionable.
  'Thông báo đẩy trên web, và trên iOS beta qua TestFlight. Đủ sớm để bạn kịp xử lý.':
    'Push notifications on the web, and on iOS beta via TestFlight. Early enough to act on it.',
  'Hoá đơn & phiếu bảo hành': 'Receipts & warranty slips',
  'Ảnh hoặc PDF, tối đa 5 tệp mỗi thiết bị, mã hoá AES-256. Mở lại đúng lúc bạn cần đi bảo hành.':
    'Photos or PDFs, up to 5 files per device, AES-256 encrypted. Open them exactly when you need to claim.',
  'Chi tiêu': 'Spending',
  'Theo tháng, theo loại, thiết bị đắt nhất. Biết tiền đã đi đâu.':
    'By month, by category, the most expensive device. See where the money went.',

  // ── Landing page — 3 steps ──────────────────────────────────────────────
  // The eyebrow reads `Bắt đầu` in the original. It could NOT be reused as a
  // key: `subscriptions.ts` and `devices.ts` already register that exact
  // sentence as "Started" (a start date, past tense), and one Vietnamese key
  // cannot mean two different things — the merge in `messages/index.ts` reports
  // the disagreement and the suite fails. The Vietnamese stays as it was and the
  // copy was extended to `Bắt đầu như thế nào`, which is what the section
  // actually says and no other domain owns.
  'Bắt đầu như thế nào': 'Get started',
  'Ba bước để bắt đầu.': 'Start in three steps.',
  'Đăng ký miễn phí': 'Sign up for free',
  'Email và mật khẩu. Xong trong 30 giây.': 'Email and a password. Done in 30 seconds.',
  'Thêm thiết bị': 'Add a device',
  'Laptop, điện thoại, máy giặt — bất cứ thứ gì có bảo hành.':
    'A laptop, a phone, a washing machine — anything with a warranty.',
  'Để Warrly nhắc': 'Let Warrly remember',
  'Warrly giữ ngày hết hạn và nhắc bạn trước.': 'Warrly keeps the date and tells you before it arrives.',

  // ── Landing page — pinned stage ─────────────────────────────────────────
  // The stage is the product demonstration. Its copy is deliberately short and
  // declarative: the composition on the right is the proof, the three beats
  // are the narration. Each beat names one thing the UI is showing.
  'Trước khi hết hạn': 'Before it expires',
  'Từ lúc mua đến lúc hết hạn.': 'From purchase to expiry.',
  'Warrly giữ ngày bảo hành, hoá đơn và lời nhắc ở cùng một chỗ.':
    'Warrly keeps the date, the receipt and the reminder in one place.',
  'Mọi thứ trong nhà': 'Everything at home',
  'Tủ lạnh, máy giặt, chiếc iPhone. Một danh sách, đúng tên bạn gọi.':
    'The fridge, the washing machine, the iPhone. One list, named the way you name them.',
  'Ngày và hoá đơn': 'The date and the receipt',
  'Ngày hết hạn, các gói bảo hành và tấm ảnh hoá đơn nằm cạnh nhau.':
    'The expiry date, the warranty plans and the photo of the receipt, side by side.',
  'Nhắc trước khi quá muộn': 'A reminder before it is too late',
  'Warrly báo trước qua thông báo đẩy — đủ sớm để bạn kịp đi bảo hành.':
    'Warrly warns you by push notification — early enough to claim.',

  // ── Landing page — product composition (`components/landing-product.tsx`)
  // These are real UI strings, not marketing copy: the device names use the
  // same catalogue entries as `/devices`, and the two new labels describe the
  // attachment chip exactly as the app does.
  'Hoá đơn': 'Receipt',
  'Đã mã hoá': 'Encrypted',
  'Máy giặt / Sấy sắp hết bảo hành.':
    'The washer is almost out of warranty.',

  // ── Landing page — final CTA + footer ───────────────────────────────────
  'Giữ ngày bảo hành ngay từ hôm nay.': 'Keep the date from today.',
  'Free mãi mãi. Không cần thẻ. Không quảng cáo.': 'Free forever. No card. No ads.',
  '© {year} Warrly.':
    '© {year} Warrly.',

  // ── 404 (`app/not-found.tsx`) ───────────────────────────────────────────
  'Không tìm thấy — Warrly': 'Not found — Warrly',
  'Mã 404': 'Error 404',
  'Két sắt trống rỗng!': 'The vault is empty!',
  'Trang mày tìm chưa từng tồn tại — hoặc đã bị di chuyển đi nơi khác.':
    'The page you are looking for never existed — or it moved somewhere else.',
  'Về trang chủ': 'Go to the homepage',
  'Quay lại Dashboard': 'Back to the dashboard',
  'Mã lỗi 404 · Warrly': 'Error code 404 · Warrly',
  'Két sắt trống rỗng': 'The vault is empty',

  // ── Offline (`app/offline/page.tsx`) ────────────────────────────────────
  'Ngoại tuyến — Warrly': 'Offline — Warrly',
  'Trạng thái · Ngoại tuyến': 'Status · Offline',
  'Mất kết nối rồi 📡': 'You are offline 📡',
  'Mày đang ngoại tuyến. Warrly lưu lại những trang mày đã mở khi còn mạng để xem tiếp — nhưng dữ liệu đã lưu có thể đã cũ, nên đừng coi đó là bảo hành còn hiệu lực nếu chưa kiểm tra lại.':
    'You are offline. Warrly saves the pages you opened while online so you can keep reading — but saved data can be out of date, so do not treat it as proof a warranty is still valid until you have refreshed.',
  'Trang đã lưu có một dải vàng ở đầu ghi thời điểm lưu. Nếu trang mày cần chưa có trong danh sách, hãy kết nối lại một lần để Warrly lưu nó. Thông báo đẩy vẫn do trình duyệt nhận khi có mạng — không cần mở web.':
    'A saved page shows a yellow strip at the top with the time it was saved. If the page you need is not listed, reconnect once so Warrly can save it. Push notifications are still received by the browser when the device has a connection — you do not need to open the site.',
  'Trang đã lưu để xem ngoại tuyến': 'Pages saved for offline',
  'Chưa có trang nào được lưu. Khi còn mạng, mở một thiết bị hoặc trang tổng quan rồi quay lại đây.':
    'No pages saved yet. While online, open a device or the dashboard, then come back here.',
  'Đã lưu lúc {time}': 'Saved {time}',
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
  'Chính sách bảo mật — Warrly': 'Privacy policy — Warrly',
  'Chính sách bảo mật và xử lý dữ liệu của Warrly':
    'Warrly privacy and data-handling policy',
  'Chính sách bảo mật': 'Privacy policy',
  'Warrly là công cụ cá nhân để theo dõi thiết bị, bảo hành, gói đăng ký và danh sách “thèm”. Trang này mô tả bọn tao thu thập gì, lưu thế nào và chia sẻ với ai. Nguyên tắc gọn lại:':
    'Warrly is a personal tool for tracking devices, warranties, subscriptions and your “want” list. This page describes what we collect, how we store it and who we share it with. The short version:',
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
  '3. Trợ lý AI (tự chọn bật)': '3. AI assistant (opt-in)',
  'Mặc định tính năng này': 'This feature is',
  'TẮT': 'OFF',
  'Chỉ khi mày tự bật trong Cài đặt, trợ lý AI mới làm hai việc: đọc ảnh hoặc PDF hoá đơn mày chọn (được':
    'by default. Only after you enable it in Settings does the AI assistant do two things: read a receipt image or PDF you pick (',
  'giải mã và gửi tới nhà cung cấp AI bên thứ ba (Anthropic)':
    'decrypted and sent to a third-party AI provider (Anthropic)',
  'để tự điền thông tin thiết bị), và đánh giá một lần sửa chữa có thuộc diện bảo hành hay không (gửi nội dung phiếu sửa chữa, thông tin thiết bị và các điều khoản hợp đồng bảo hành tới cùng nhà cung cấp đó). Kết quả luôn là gợi ý để mày kiểm tra lại — không phải quyết định bảo hành, và không có gì được tự động lưu. Không bật thì ảnh không bao giờ rời máy chủ ở dạng đã giải mã và không nội dung nào được gửi đi. Mày có thể tắt lại bất cứ lúc nào.':
    'to fill in the device details), and assess whether a repair is likely covered (sending the claim content, the device details and the warranty contract terms to that same provider). The result is always guidance for you to check — it is not a warranty decision, and nothing is saved automatically. With the feature off, an image never leaves the server decrypted and no content is sent. You can turn it back off at any time.',
  '4. Bên thứ ba bọn tao dùng': '4. Third parties we use',
  'Anthropic': 'Anthropic',
  'chỉ khi mày bật trợ lý AI (xem mục 3).':
    'only when you enable the AI assistant (see section 3).',
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
  'Điều khoản sử dụng — Warrly': 'Terms of service — Warrly',
  'Điều khoản sử dụng dịch vụ Warrly': 'Warrly terms of service',
  'Điều khoản sử dụng': 'Terms of service',
  'Dùng Warrly tức là mày đồng ý với các điều khoản dưới đây. Bọn tao cố giữ chúng ngắn và dễ hiểu.':
    'Using Warrly means you agree to the terms below. We try to keep them short and easy to read.',
  '1. Dịch vụ & mục đích cá nhân': '1. The service & personal use',
  'Warrly là công cụ cá nhân để quản lý thiết bị, bảo hành, gói đăng ký và wishlist của chính mày. Đừng dùng để lưu trữ dữ liệu của người khác khi chưa được họ cho phép.':
    'Warrly is a personal tool for managing your own devices, warranties, subscriptions and wishlist. Do not use it to store other people\'s data without their permission.',
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
  'Chính sách Cookie — Warrly': 'Cookie policy — Warrly',
  'Chính sách sử dụng cookie của Warrly': 'How Warrly uses cookies',
  'Chính sách Cookie': 'Cookie policy',
  'Warrly dùng cookie ở mức tối thiểu — chỉ đủ để mày đăng nhập và giữ phiên. Không có cookie quảng cáo hay theo dõi.':
    'Warrly uses the bare minimum of cookies — just enough to sign you in and keep your session. There are no advertising or tracking cookies.',
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
