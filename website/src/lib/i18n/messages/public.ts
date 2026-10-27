// The signed-out marketing/legal surface: `/`, `/privacy`, `/terms`, `/cookies`,
// plus the three chrome-less pages a visitor can land on without a session
// (`not-found`, `/offline`).
//
// Keys are the Vietnamese originals (see `../types.ts`). Generic shell copy
// (Đăng nhập / Đăng ký / Thử lại / Quay về trang chủ …) deliberately lives in
// `common.ts` and is NOT redefined here.
//
// Deliberate exceptions to "the Vietnamese is untouched", flagged where they
// happen: the landing hero badge used to claim "Local-first" (false — the device
// copy lives in Postgres behind the Go API, the service worker skips `/api/`,
// and there is no device store), and the 2026-10 advertising/consent rewrite
// replaced the "no ads / no paid tier" copy with the owner's actual model (free
// with ads, paid without, no price or launch date in this repo).
//
// The legal block was restructured again on 2026-10-27 against the owner's
// shipped app, and there the Vietnamese is NOT byte-for-byte: identity, the
// Google AdMob facts, the PDPL rights, retention, cross-border transfer,
// children, international users, changes and the subscription clause are new
// sentences, because the old document did not cover them. Landing-page copy was
// left alone apart from the two section numbers that moved (encryption is §3 now).
// Every other Vietnamese key in this file is the original.

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
  // Rewritten from "Miễn phí · Local-first · Tiếng Việt". Both old claims were
  // audited, not just the language one:
  //   * "Local-first" was FALSE. Warrly is a Next.js UI over the Go API and
  //     Postgres; `public/sw.js` skips `/api/`, and there is no IndexedDB or
  //     device store. The device does not hold the primary copy.
  //   * "Tiếng Việt" (Vietnamese-only) was also false: English is the default.
  //
  // "Xây cho Việt Nam" / "Built for Vietnam" was removed on the owner's call:
  // the product is global, and a market label in the eyebrow narrows it to one
  // country before a visitor has read a single sentence. Two true beats remain.
  // Two beats, not three — there is no third claim here that is both global and
  // checkable against the repo, and inventing one is how "Local-first" happened.
  'Miễn phí có quảng cáo · Gói trả phí chưa mở bán':
    'Free with ads · Paid plan not on sale yet',
  // The subhead is deliberately NOT a feature list. It names the three things
  // a Vietnamese household actually owns, then the two things Warrly keeps
  // for them. One sentence, no "everything you need".
  'Tủ lạnh, máy giặt, chiếc iPhone: mỗi món có một ngày hết hạn và một tấm hoá đơn. Warrly giữ cả hai, và nhắc bạn trước khi bảo hành hết hiệu lực.':
    'The fridge, the washing machine, the iPhone — each one has an expiry date and a receipt. Warrly keeps both, and reminds you before the warranty runs out.',
  'Không cần thẻ tín dụng': 'No credit card needed',
  'Quảng cáo chỉ ở gói miễn phí': 'Ads only on the free tier',
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

  // ── Feature illustrations (`components/landing/feature-visuals.tsx`) ─────
  // Alt text is content, not decoration: it is read in the UI language, so
  // every subject needs both columns. `Điện thoại` already exists in
  // `common.ts` as "Phone" and is reused rather than redefined.
  'Sổ bảo hành': 'Warranty booklet',
  'Chìa khoá xe máy': 'Motorbike key',
  'Điều khiển điều hoà': 'Air-conditioner remote',
  'Hoá đơn đỏ': 'Red invoice',
  'Nồi cơm điện': 'Rice cooker',

  // ── Brand line ──────────────────────────────────────────────────────────
  // Two sentences, two jobs: keep the date, keep the paper. It is the OG
  // card's descriptor and may be used wherever the lockup needs a line under
  // it. The share card is an ARTIFACT (it leaves the app and is read by
  // someone who never chose a language), so `/og` renders the Vietnamese
  // column by default; the English is here for in-app descriptors.
  'Giữ ngày. Giữ giấy.': 'Keep the date. Keep the paper.',

  // ── Empty-state art (`components/empty-state-art.tsx`) ──────────────────
  'Sổ bảo hành và hoá đơn': 'Warranty booklet and receipt',

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

  // ── Landing page — product composition (`components/landing/landing-product.tsx`)
  // These are real UI strings, not marketing copy: the device names use the
  // same catalogue entries as `/devices`, and the two new labels describe the
  // attachment chip exactly as the app does.
  'Hoá đơn': 'Receipt',
  'Đã mã hoá': 'Encrypted',
  'Máy giặt / Sấy sắp hết bảo hành.':
    'The washer is almost out of warranty.',

  // ── Landing page — final CTA + footer ───────────────────────────────────
  'Giữ ngày bảo hành ngay từ hôm nay.': 'Keep the date from today.',
  'Miễn phí để bắt đầu. Không cần thẻ. Gói miễn phí có quảng cáo; gói trả phí thì không.':
    'Free to start. No card. The free tier has ads; the paid tier does not.',
  '© {year} Warrly.':
    '© {year} Warrly.',

  // ── Landing page — price & limits ───────────────────────────────────────
  // The page said "Free forever. No card. No ads." three times and never once
  // said what the ceiling was. These numbers are the Go service's constants
  // (`services/devices.go`, `attachments.go`, `warranties.go`,
  // `subscriptions.go`, `wishlist.go`); the same list is written into Terms §4
  // so the link below the first column has something to substantiate.
  //
  // The earlier text went further and claimed there was no paid tier and
  // nothing to upgrade to. That is not the owner's model: free is a TIER WITH
  // LIMITS, not the whole product. The copy now says free, states the ceiling,
  // and does not pretend the ceiling is the end of the roadmap. It still does
  // not announce a price or a date, because none exists in this repo.
  'Miễn phí có quảng cáo. Gói trả phí nâng giới hạn.':
    'Free with ads. The paid plan raises the limits.',
  'Gói miễn phí là hạng bạn dùng hôm nay: có quảng cáo và dừng ở các con số dưới đây. Gói trả phí chưa mở bán; khi mở bán, nó bỏ quảng cáo và nâng các giới hạn này.':
    'The free tier is what you use today: it carries ads and stops at the numbers below. The paid tier is not on sale yet; when it is, it removes the ads and raises these limits.',
  'Gói miễn phí': 'The free plan',
  'Miễn phí, có quảng cáo, và đây là chỗ nó dừng':
    'Free, ad-supported, and here is where it stops',
  '50 thiết bị đang dùng — 500 dòng nếu tính cả máy đã bán':
    '50 active devices — 500 rows if you count sold ones',
  '5 gói bảo hành mỗi thiết bị': '5 warranty plans per device',
  '5 tệp mỗi thiết bị, tối đa 5 MB mỗi tệp': '5 files per device, up to 5 MB each',
  '100 MB tổng dung lượng tệp của cả tài khoản': '100 MB of files per account, total',
  '100 gói đăng ký': '100 subscriptions',
  '200 món wishlist': '200 wishlist items',
  'Điều khoản, mục 4': 'Terms, section 4',
  'Dữ liệu của bạn': 'Your data',
  'Hoá đơn là của bạn': 'Your receipts are yours',
  'Ảnh và PDF được mã hoá AES-256-GCM trên máy chủ. Mỗi tệp có một khoá riêng, khoá đó lại được bọc bằng khoá chủ của hệ thống.':
    'Photos and PDFs are encrypted on the server with AES-256-GCM. Each file has its own key, and that key is wrapped by the system master key.',
  'Gói miễn phí có quảng cáo. Quảng cáo có thể dùng cookie hoặc định danh thiết bị; khi mở bán, gói trả phí sẽ bỏ quảng cáo. Chi tiết ở Chính sách bảo mật, mục 5.':
    'The free tier carries ads. Ads may use cookies or device identifiers; when it goes on sale, the paid tier removes them. Details in the privacy policy, section 5.',
  'Chính sách bảo mật, mục 3 và 5': 'Privacy policy, sections 3 and 5',
  'Ra đi': 'Leaving',
  'Đi bất cứ lúc nào': 'Leave whenever',
  'Xuất mọi thứ ra JSON, hoặc .zip kèm nội dung ảnh đã mã hoá. Xoá tài khoản trong Cài đặt — không phải gửi yêu cầu qua email.':
    'Export everything as JSON, or as a .zip with the encrypted image files. Delete the account in Settings — no request by email.',
  'Chính sách bảo mật, mục 6': 'Privacy policy, section 6',

  // ── Landing page — FAQ ──────────────────────────────────────────────────
  // The answers are facts from the repo, not reassurance: the limits come from
  // the Go constants, the export caveat from `services/backup_blobs.go` (blobs
  // are ciphertext wrapped by `FILE_MASTER_KEY`), the iPhone answer from the
  // PWA metadata and the TestFlight-only status, and the last answer from the
  // fact that Warrly records warranty dates and does not underwrite cover.
  'Hỏi thẳng': 'Straight answers',
  'Năm câu thường gặp.': 'Five questions we get.',
  'Nếu câu bạn cần không có ở đây, email hỗ trợ ở cuối trang.':
    'If yours is not here, the support email is at the bottom of the page.',
  'Có thật là miễn phí không?': 'Is it really free?',
  'Có — và nó có giới hạn, cùng quảng cáo. Gói miễn phí không hết hạn, không cần thẻ, nhưng có quảng cáo và dừng ở các con số ở trên: 50 thiết bị đang dùng, 5 gói bảo hành mỗi thiết bị, 5 tệp mỗi thiết bị, 100 MB tổng, 100 gói đăng ký, 200 món wishlist. Gói trả phí chưa mở bán; khi mở bán, nó bỏ quảng cáo và nâng các giới hạn đó.':
    'Yes — and it has limits, plus ads. The free tier does not expire and needs no card, but it carries ads and stops at the numbers above: 50 active devices, 5 warranty plans per device, 5 files per device, 100 MB in total, 100 subscriptions, 200 wishlist items. The paid tier is not on sale yet; when it is, it removes the ads and raises those limits.',
  'Nếu tôi ngừng dùng thì hoá đơn của tôi ra sao?':
    'What happens to my receipts if I stop using it?',
  'Không có gì tự xoá chỉ vì bạn không đăng nhập. Dữ liệu nằm đó cho đến khi bạn tự xoá tài khoản. Trước khi đi, vào Cài đặt → Sao lưu & khôi phục để tải JSON (thông tin) hoặc .zip (kèm nội dung ảnh đã mã hoá). Bản JSON không chứa ảnh; ảnh trong .zip chỉ mở lại được khi khôi phục vào một máy chủ còn giữ đúng khoá đó.':
    'Nothing is deleted just because you stop signing in. The data stays until you delete the account yourself. Before you go, open Settings → Backup & restore and download JSON (the records) or a .zip (the encrypted image files). The JSON carries no images; the images in the .zip can only be opened when restored to a server that still holds the matching key.',
  'Có dùng trên iPhone được không?': 'Does it work on iPhone?',
  'Được, qua Safari — không cần tải app. Trên iOS 16.4 trở lên, bạn có thể thêm Warrly vào màn hình chính rồi bật thông báo đẩy. Bản iOS native hiện là beta qua TestFlight, chưa có trên App Store.':
    'Yes, in Safari — no download needed. On iOS 16.4 or later you can add Warrly to your home screen and turn on push notifications. The native iOS app is in TestFlight beta; it is not on the App Store yet.',
  'Dữ liệu của tôi có an toàn không?': 'Is my data safe?',
  'Hoá đơn được mã hoá AES-256-GCM trên máy chủ; mỗi tệp có một khoá riêng, khoá đó lại được bọc bằng khoá chủ của hệ thống. Mật khẩu lưu dưới dạng băm bcrypt, phiên đăng nhập nằm trong cookie đã mã hoá. Không có Google Analytics, không Facebook SDK, không bán dữ liệu; gói miễn phí có quảng cáo và quảng cáo có thể dùng cookie hoặc định danh thiết bị (xem Chính sách bảo mật, mục 5). Trợ lý AI mặc định tắt và chỉ gửi ảnh hoá đơn đã giải mã hoặc nội dung một lần đánh giá bảo hành tới Anthropic khi bạn tự bật.':
    'Receipts are encrypted on the server with AES-256-GCM; each file has its own key, and that key is wrapped by the system master key. Passwords are stored as bcrypt hashes, and your session lives in an encrypted cookie. There is no Google Analytics, no Facebook SDK and no data sold; the free tier carries ads, and ads may use cookies or device identifiers (see the privacy policy, section 5). The AI assistant is off by default and only sends a decrypted receipt image or the content of a claim assessment to Anthropic after you turn it on.',
  'Các bạn có phải đơn vị bảo hành không?': 'Are you a warranty provider?',
  'Không. Warrly chỉ ghi lại ngày, hoá đơn và gửi lời nhắc. Bảo hành là hợp đồng giữa bạn với hãng hoặc cửa hàng; việc sửa chữa, đổi trả hay từ chối bảo hành do họ quyết định. Phần đánh giá bằng AI, nếu bạn bật, chỉ là gợi ý để bạn kiểm tra — không phải cam kết bảo hành.':
    'No. Warrly records dates and receipts and sends reminders. The warranty is a contract between you and the manufacturer or retailer; they decide whether to repair, replace or refuse a claim. The AI assessment, if you turn it on, is guidance for you to check — not a warranty decision.',
  'Điều khoản, mục 1': 'Terms, section 1',

  // ── Landing page — founder note + support ───────────────────────────────
  // Provenance, so nobody has to guess: the 30-day 1-đổi-1 window and the
  // brand-dependent start of the warranty clock are quoted from
  // `docs/FEATURE_IDEAS.md` §1 and `docs/FEATURE_ROADMAP.md` #15; the default
  // 30/7-day lead-day schedule is `services/leaddays.go` (`api/internal/cron/run.go`
  // reads it); the receipt requirement is the FPT Shop policy quoted in the
  // roadmap. No founder name exists in the repo, so none is invented and the
  // signature stays role-only.
  'Ghi chú từ người làm Warrly': 'A note from the person who built Warrly',
  // No country named: the 30-day exchange window is a retail policy that exists
  // in many markets (and a 1-for-1 window is not universal), so the note states
  // it as policy that varies rather than as one country's rule. The origin story
  // survives — a deadline nobody wrote down — without pinning the product to a
  // single place.
  'Warrly bắt đầu từ một cái hạn 30 ngày. Một chiếc máy mới thường có một cửa sổ đổi trả ngắn — thường là 30 ngày — trước khi chỉ còn đường gửi sửa. Cửa sổ đó là chính sách của nơi bán và của hãng, không phải luật, và mỗi nơi một khác. Ngày bảo hành cũng có khi tính từ lúc kích hoạt, lúc xuất kho hay lúc mua, tuỳ hãng — và tấm hoá đơn là thứ chứng minh ngày đó. Tôi làm Warrly để giữ ngày và hoá đơn cạnh nhau, nhắc trước theo lịch bạn đặt — mặc định 30 và 7 ngày — và không hứa gì ngoài việc đó.':
    'Warrly started with a 30-day deadline. A new device usually has a short exchange window — often thirty days — before the only route left is a repair. That window is the retailer\'s policy and the brand\'s, not a law, and it differs from one place to the next. The warranty clock can also start at activation, when it leaves the warehouse, or at purchase, depending on the brand — and the receipt is what proves the date. I built Warrly to keep the date and the receipt together, remind you on the schedule you choose — 30 and 7 days by default — and promise nothing beyond that.',
  '— Người làm Warrly': '— The person who built Warrly',
  'Hỗ trợ': 'Support',

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
  //
  // Restructured against the owner's shipped app (Stavely) for COVERAGE: the
  // controller first, then what is stored, then advertising, rights, third
  // parties, legal basis and California, and only then the sections Vietnamese
  // law requires and the old document did not have — retention, cross-border
  // transfer, children, international users, changes, contact.
  //
  // Numbers in these keys are load-bearing. The landing page and the FAQ print
  // them ("Chính sách bảo mật, mục 5") and link to `#ads` / `#rights` /
  // `#encryption`. Advertising stays §5 and your rights stay §6 for that
  // reason; encryption moved from §2 to §3 because identity took §1, and the
  // two landing labels that named "mục 2" were updated in the same change.
  //
  // The Vietnamese column is the legally binding one and every paragraph is
  // one key, split only where the JSX has markup. No fill-in marker is left:
  // where a fact is genuinely Google's to state (ad-data retention), the
  // sentence says "per Google's policy" instead of inventing a number.
  'Chính sách bảo mật — Warrly': 'Privacy policy — Warrly',
  'Chính sách bảo mật và xử lý dữ liệu của Warrly':
    'Warrly privacy and data-handling policy',
  'Chính sách bảo mật': 'Privacy policy',
  'Với người dùng tại Việt Nam, bản tiếng Việt là bản có giá trị pháp lý.':
    'For users in Vietnam, the Vietnamese version is the legally binding one.',
  'Warrly là công cụ cá nhân để theo dõi thiết bị, bảo hành, gói đăng ký và danh sách “thèm”. Trang này mô tả bọn tao thu thập gì, lưu thế nào và chia sẻ với ai. Nguyên tắc gọn lại:':
    'Warrly is a personal tool for tracking devices, warranties, subscriptions and your “want” list. This page describes what we collect, how we store it and who we share it with. The short version:',
  'dữ liệu của mày là của mày': 'your data is yours',
  'bọn tao không bán dữ liệu của mày. Gói miễn phí có quảng cáo; gói trả phí thì không.':
    'we do not sell your data. The free tier carries ads; the paid tier does not.',

  // §1 — identity of the controller. The owner is an individual, not a company,
  // and there is deliberately no postal address (GDPR Art 13(1)(a) asks for
  // identity and contact details; Play asks for the address in its own console).
  '1. Chúng tôi là ai': '1. Who we are',
  'Warrly do một cá nhân tại Việt Nam cung cấp —':
    'Warrly is provided by an individual based in Vietnam —',
  '— và không phải công ty. Trong chính sách này, “Warrly” và “bọn tao” là cá nhân đó.':
    '— and is not a company. In this policy, “Warrly” and “we” mean that individual.',
  'Đây cũng là đầu mối xử lý dữ liệu cá nhân theo Nghị định 13/2023/NĐ-CP và Luật Bảo vệ dữ liệu cá nhân (Luật 91/2025/QH15, hiệu lực từ 01/01/2026). Warrly không có nhân viên nên không có DPO riêng: chính người đó là đầu mối.':
    'This is also the personal-data contact point under Decree 13/2023/ND-CP and the Law on Personal Data Protection (Law 91/2025/QH15, in force from 1 January 2026). Warrly has no staff, so there is no separate DPO: the same person is the contact.',
  'Warrly được vận hành từ Việt Nam và phục vụ người dùng ở nhiều nước. Luật Việt Nam áp dụng cho toàn bộ hoạt động xử lý, bất kể người dùng ở đâu; luật địa phương của người dùng vẫn áp dụng thêm cho họ.':
    'Warrly is run from Vietnam and serves users in many countries. Vietnamese law applies to all of its processing, wherever the user is; a user’s own local law still applies on top of that.',
  'Vai trò của Warrly: bên kiểm soát dữ liệu tài khoản (email, thiết bị, bảo hành, hoá đơn, wishlist), và bên xử lý đối với dữ liệu vận hành do hạ tầng bên thứ ba sinh ra khi chạy dịch vụ. Với dữ liệu quảng cáo, Google là bên kiểm soát độc lập — xem mục 5.':
    'Warrly’s role: controller of account data (email, devices, warranties, receipts, wishlist), and processor of the operational data that third-party infrastructure produces while the service runs. For advertising data, Google is an independent controller — see section 5.',
  'Liên hệ về quyền riêng tư:': 'Privacy contact:',
  'Hỗ trợ chung:': 'General support:',

  // §2 — what is stored. The original paragraph is unchanged; the two new ones
  // exist because the consent record and the *absence* of an ad/behavioural
  // profile are both things a reader (and a store reviewer) asks about.
  '2. Dữ liệu bọn tao lưu': '2. What we store',
  'Email và mật khẩu (lưu dưới dạng băm bcrypt, không bao giờ lưu mật khẩu gốc); các bản ghi mày tự nhập (thiết bị, gói bảo hành, subscription, wishlist); file đính kèm mày tải lên (ảnh hoá đơn / phiếu bảo hành); và token thông báo đẩy của thiết bị nếu mày bật push.':
    'Your email and password (stored as a bcrypt hash — the original password is never kept); the records you enter yourself (devices, warranty plans, subscriptions, wishlist); the attachments you upload (invoice / warranty-slip images); and the device push token, if you turn push on.',
  'Trạng thái đồng ý quảng cáo chỉ nằm trên thiết bị của mày — localStorage khoá wv_consent trên web, và do SDK của Google giữ trong app. Warrly không lưu trạng thái đó trên máy chủ của mình.':
    'Your advertising consent state lives only on your device — localStorage key wv_consent on the web, and held by Google’s SDK in the app. Warrly does not store that state on its own server.',
  'Ngoài những mục trên, Warrly không lưu hồ sơ nào khác về mày: không có tài khoản quảng cáo gắn với mày, và không có hồ sơ hành vi để dựng chân dung quảng cáo.':
    'Beyond those items, Warrly keeps no other profile about you: there is no advertising account tied to you, and no behavioural profile used to build an advertising persona.',

  // §3 — encryption & storage (was §2; the `#encryption` anchor moved with it,
  // which is why the heading number changed and the landing label did too).
  '3. Mã hoá & lưu trữ': '3. Encryption & storage',
  'File đính kèm được mã hoá': 'Attachments are encrypted with',
  'AES-256-GCM': 'AES-256-GCM',
  'khi lưu trên máy chủ, mỗi file một khoá riêng (khoá này lại được bọc bởi khoá chủ của hệ thống). Phiên đăng nhập nằm trong một cookie đã mã hoá':
    'on the server, one key per file (each of those keys is wrapped by the system master key). Your session lives in an encrypted cookie',
  'Toàn bộ dữ liệu nằm trên cơ sở dữ liệu do bọn tao tự vận hành.':
    'All data lives on a database we run ourselves.',
  'Máy chủ đó có thể đặt ngoài Việt Nam — xem mục 11.':
    'That server may sit outside Vietnam — see section 11.',

  // §4 — AI assistant, unchanged.
  '4. Trợ lý AI (tự chọn bật)': '4. AI assistant (opt-in)',
  'Mặc định tính năng này': 'This feature is',
  'TẮT': 'OFF',
  'Chỉ khi mày tự bật trong Cài đặt, trợ lý AI mới làm hai việc: đọc ảnh hoặc PDF hoá đơn mày chọn (được':
    'by default. Only after you enable it in Settings does the AI assistant do two things: read a receipt image or PDF you pick (',
  'giải mã và gửi tới nhà cung cấp AI bên thứ ba (Anthropic)':
    'decrypted and sent to a third-party AI provider (Anthropic)',
  'để tự điền thông tin thiết bị), và đánh giá một lần sửa chữa có thuộc diện bảo hành hay không (gửi nội dung phiếu sửa chữa, thông tin thiết bị và các điều khoản hợp đồng bảo hành tới cùng nhà cung cấp đó). Kết quả luôn là gợi ý để mày kiểm tra lại — không phải quyết định bảo hành, và không có gì được tự động lưu. Không bật thì ảnh không bao giờ rời máy chủ ở dạng đã giải mã và không nội dung nào được gửi đi. Mày có thể tắt lại bất cứ lúc nào.':
    'to fill in the device details), and assess whether a repair is likely covered (sending the claim content, the device details and the warranty contract terms to that same provider). The result is always guidance for you to check — it is not a warranty decision, and nothing is saved automatically. With the feature off, an image never leaves the server decrypted and no content is sent. You can turn it back off at any time.',

  // §5 — advertising. Facts, not adjectives: AdMob is named, the two Google
  // entities are named, Google's role is stated, the default (non-personalised)
  // is stated, and the two consent surfaces (ATT, UMP) are named. The provider
  // bullet used to be four fill-in markers; the retention bullet now says "per
  // Google's policy" because that is the true answer, not a gap.
  '5. Quảng cáo (Google AdMob)': '5. Advertising (Google AdMob)',
  'Gói miễn phí có quảng cáo. Gói trả phí không có quảng cáo và hiện chưa mở bán.':
    'The free tier carries ads. The paid tier has no ads and is not on sale yet.',
  'Khi Warrly có quảng cáo, chúng nằm trong app iOS và Android và do Google AdMob phục vụ — một mạng quảng cáo của Google. Tính đến lần cập nhật này, app chưa tích hợp SDK quảng cáo nào và chưa có quảng cáo nào được hiển thị; phần này mô tả mô hình, không phải trạng thái đã chạy. Trên web chưa có quảng cáo.':
    'When Warrly has ads, they run in the iOS and Android apps and are served by Google AdMob, a Google advertising network. As of this update the app has no advertising SDK integrated and shows no ads; this section describes the model, not a running state. The web has no ads.',
  'Nhà cung cấp:': 'Provider:',
  'Google AdMob — Google LLC (Hoa Kỳ) và Google Ireland Ltd (Ireland). Với dữ liệu quảng cáo, Google là bên kiểm soát độc lập: họ quyết định cách dùng dữ liệu đó theo chính sách của họ, không theo chỉ đạo của Warrly.':
    'Google AdMob — Google LLC (United States) and Google Ireland Ltd (Ireland). For advertising data, Google is an independent controller: it decides how that data is used under its own policies, not under Warrly’s instructions.',
  'Dữ liệu AdMob nhận:': 'Data AdMob receives:',
  'định danh quảng cáo của thiết bị (IDFA trên iOS, GAID trên Android); thông tin thiết bị tối thiểu (kiểu máy, phiên bản hệ điều hành, khu vực gần đúng suy ra từ IP); và sự kiện hiển thị, nhấp quảng cáo. Dữ liệu này được chia sẻ với Google để phục vụ và đo lường quảng cáo.':
    'your device’s advertising identifier (IDFA on iOS, GAID on Android); minimal device information (model, OS version, coarse region inferred from your IP address); and impression and click events. That data is shared with Google to serve and measure ads.',
  'Cookie và định danh quảng cáo:': 'Cookies and advertising identifiers:',
  'IDFA, GAID, và cookie hoặc định danh quảng cáo của Google (ví dụ NID, IDE — tuỳ sản phẩm Google dùng cho chỗ đặt quảng cáo). Mục đích: chọn quảng cáo, giới hạn tần suất và đo lường hiệu quả. Thời hạn: theo chính sách của Google; Warrly không đặt ra con số đó và không kiểm soát nó.':
    'IDFA, GAID, and Google’s advertising cookies or identifiers (for example NID, IDE — depending on which Google product fills the slot). Purpose: selecting ads, frequency capping and measuring performance. Duration: per Google’s policy; Warrly does not set that number and does not control it.',
  'Thời hạn lưu dữ liệu quảng cáo:': 'Advertising data retention:',
  'theo chính sách Ads/AdMob của Google. Warrly không lưu dữ liệu quảng cáo: không có bảng nào trên máy chủ ghi việc mày đã thấy hay bấm quảng cáo nào. Thứ duy nhất Warrly giữ là trạng thái đồng ý, và nó nằm trên thiết bị của mày.':
    'per Google’s Ads/AdMob policy. Warrly stores no advertising data: no table on our servers records which ads you saw or clicked. The only thing Warrly keeps is your consent state, and it stays on your device.',
  'Mặc định quảng cáo không cá nhân hoá. Warrly chỉ phục vụ quảng cáo cá nhân hoá sau khi mày đồng ý: trên iOS là hộp thoại App Tracking Transparency (ATT) của Apple, và với người dùng EU, Vương quốc Anh hoặc Thuỵ Sĩ là hộp đồng ý của Google UMP (một nền tảng quản lý đồng ý đã được chứng nhận TCF v2.2). Từ chối thì quảng cáo vẫn hiển thị, nhưng là loại không cá nhân hoá.':
    'Ads are non-personalised by default. Warrly only serves personalised ads after you agree: on iOS through Apple’s App Tracking Transparency (ATT) prompt, and for users in the EU, the United Kingdom or Switzerland through the Google UMP consent form (a consent-management platform certified under TCF v2.2). If you decline, you still see ads, but non-personalised ones.',
  'Cách tắt hoặc đổi lựa chọn quảng cáo:':
    'Turning ad personalisation off or changing your choice:',
  'iOS: Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Theo dõi, bật hoặc tắt cho Warrly.':
    'iOS: Settings → Privacy & Security → Tracking, and switch Warrly on or off.',
  'Android: Cài đặt → Google → Quảng cáo, xoá hoặc đặt lại Advertising ID, hoặc từ chối quảng cáo cá nhân hoá.':
    'Android: Settings → Google → Ads, delete or reset your Advertising ID, or opt out of personalised ads.',
  'EU, Vương quốc Anh, Thuỵ Sĩ: mở lại lựa chọn bất cứ lúc nào qua nút “Tuỳ chọn quyền riêng tư” trong app (Google UMP).':
    'EU, United Kingdom, Switzerland: reopen your choice at any time through the “Privacy options” button in the app (Google UMP).',
  'Web: quảng cáo mặc định tắt — Warrly không tải script quảng cáo và không đặt cookie quảng cáo trước khi mày đồng ý. Đổi lựa chọn bất cứ lúc nào qua “Tuỳ chọn cookie” ở chân trang.':
    'Web: advertising is off by default — Warrly loads no ad script and sets no advertising cookie before you agree. Change your choice at any time through “Cookie settings” in the footer.',
  'Không đồng ý quảng cáo cá nhân hoá không chặn mày dùng app hay web. Cách Google dùng dữ liệu cho quảng cáo và cách quản lý lựa chọn:':
    'Declining personalised ads does not stop you using the app or the web. How Google uses data for advertising, and how to manage your choices:',
  'Warrly không nhúng Google Analytics hay Facebook SDK, và không tự theo dõi mày xuyên trang.':
    'Warrly does not embed Google Analytics or the Facebook SDK, and does not track you across other sites itself.',

  // §6 — rights. PDPL list, then EEA/UK, then how to actually exercise one.
  '6. Quyền của mày': '6. Your rights',
  'Mày có thể': 'You can',
  'xuất toàn bộ dữ liệu': 'export all of your data',
  'ra file JSON hoặc .zip kèm ảnh đã mã hoá (Cài đặt → Sao lưu & khôi phục) bất cứ lúc nào, và':
    'to a JSON file or a .zip with the encrypted images (Settings → Backup & restore) at any time, and',
  'xoá tài khoản': 'delete your account',
  'để xoá vĩnh viễn mọi thiết bị, hoá đơn, ảnh và cài đặt. Thao tác xoá không thể hoàn tác.':
    'to permanently erase every device, invoice, image and setting. Deleting cannot be undone.',
  'Theo Nghị định 13/2023/NĐ-CP và Luật 91/2025/QH15, mày có quyền: được biết về việc xử lý dữ liệu, truy cập, chỉnh sửa, xoá dữ liệu; rút lại đồng ý; hạn chế xử lý; phản đối xử lý; yêu cầu bồi thường thiệt hại; và khiếu nại tới cơ quan có thẩm quyền — Cục An ninh mạng, Bộ Công an (A05).':
    'Under Decree 13/2023/ND-CP and Law 91/2025/QH15 you have the right to: be informed about processing, access, correct and delete your data; withdraw consent; restrict processing; object to processing; claim compensation for damage; and complain to the competent authority — the Department of Cybersecurity, Ministry of Public Security (A05).',
  'Nếu mày ở EEA hoặc Vương quốc Anh, mày có quyền truy cập, sửa, xoá, hạn chế xử lý, phản đối xử lý, chuyển dữ liệu, rút lại đồng ý và khiếu nại với cơ quan bảo vệ dữ liệu. Để thực hiện, gửi email tới privacy@warrly.com.':
    'If you are in the EEA or the United Kingdom, you have the right to access, correct, erase, restrict or object to processing, port your data, withdraw consent and complain to a data protection authority. To exercise these rights, email privacy@warrly.com.',
  'Để thực hiện bất kỳ quyền nào ở trên, gửi email tới privacy@warrly.com. Warrly có thể hỏi thêm vài thông tin để xác minh đó là mày trước khi xoá hoặc sửa dữ liệu, và không phân biệt đối xử khi mày thực hiện quyền.':
    'To exercise any of these rights, email privacy@warrly.com. Warrly may ask for a few details to verify that it is you before deleting or changing data, and will not discriminate against you for exercising your rights.',

  // §7 — third parties. AdMob is named here rather than "an advertising
  // provider", because a policy that will not name the recipient cannot be
  // informed consent under the PDPL.
  '7. Bên thứ ba & chia sẻ dữ liệu': '7. Third parties & data sharing',
  'Warrly chỉ chia sẻ dữ liệu với các bên sau, và chỉ phần cần cho việc đó:':
    'Warrly shares data only with the parties below, and only the part each of them needs:',
  'Anthropic': 'Anthropic',
  'chỉ khi mày bật trợ lý AI (xem mục 4).': 'only when you enable the AI assistant (see section 4).',
  'Resend': 'Resend',
  'gửi email đặt lại mật khẩu khi mày yêu cầu.':
    'sends the password-reset email when you ask for one.',
  'Apple (APNs), Google (FCM), trình duyệt (Web Push)':
    'Apple (APNs), Google (FCM), your browser (Web Push)',
  'chuyển thông báo nhắc bảo hành tới thiết bị, chỉ khi mày bật push.':
    'carry warranty reminders to your devices, only when you turn push on.',
  'Google AdMob (Google LLC, Google Ireland Ltd)':
    'Google AdMob (Google LLC, Google Ireland Ltd)',
  'quảng cáo trong app, chỉ ở gói miễn phí (xem mục 5). Dữ liệu quảng cáo được chia sẻ với Google để phục vụ và đo lường quảng cáo; với dữ liệu đó Google là bên kiểm soát độc lập.':
    'advertising in the app, on the free tier only (see section 5). Ad data is shared with Google to serve and measure ads; for that data Google is an independent controller.',
  'Ngoài các dịch vụ trên, bọn tao không chia sẻ dữ liệu với ai.':
    'Beyond those services, we share your data with nobody.',
  'Warrly không bán dữ liệu cá nhân, và không có nhà quảng cáo nào khác ngoài Google.':
    'Warrly does not sell personal data, and there is no advertiser other than Google.',

  // §8 — legal basis. The bundle-of-consent paragraph is the PDPL requirement
  // (voluntary, purpose-specific, no pre-ticked boxes, no bundling) stated as
  // what the product actually does, with every withdrawal path named.
  '8. Cơ sở pháp lý & sự đồng ý': '8. Legal basis & consent',
  'Bọn tao xử lý dữ liệu theo các cơ sở sau:': 'We process data on these bases:',
  'Phiên đăng nhập và ghi nhớ ngôn ngữ, giao diện: thực hiện hợp đồng và lợi ích hợp pháp trong việc giữ đúng lựa chọn của mày.':
    'Sign-in session and remembering your language and appearance: performance of the contract and our legitimate interest in keeping your choices.',
  'Cung cấp dịch vụ (tài khoản, thiết bị, bảo hành, hoá đơn, sao lưu): thực hiện hợp đồng với mày.':
    'Providing the service (account, devices, warranties, receipts, backup): performance of our contract with you.',
  'Thông báo đẩy và trợ lý AI: sự đồng ý của mày, có thể rút lại bất cứ lúc nào trong Cài đặt.':
    'Push notifications and the AI assistant: your consent, which you can withdraw at any time in Settings.',
  'Quảng cáo ở gói miễn phí: sự đồng ý của mày — ATT trên iOS, hộp đồng ý Google UMP với người dùng EU/UK/Thuỵ Sĩ. Không đồng ý thì quảng cáo vẫn hiện nhưng không cá nhân hoá.':
    'Advertising on the free tier: your consent — ATT on iOS, the Google UMP consent form for users in the EU/UK/Switzerland. If you decline, ads still appear, but non-personalised.',
  'Bảo mật, chống lạm dụng và giới hạn tần suất: lợi ích hợp pháp của bọn tao trong việc giữ dịch vụ an toàn.':
    'Security, abuse prevention and rate limiting: our legitimate interest in keeping the service safe.',
  'Email giao dịch (đặt lại mật khẩu, xác nhận đổi email): thực hiện hợp đồng và bảo mật tài khoản.':
    'Transactional email (password reset, email-change confirmation): performance of the contract and account security.',
  'Sự đồng ý ở Warrly là tự nguyện, theo từng mục đích, không gộp chung và không tích sẵn: mỗi công tắc là một quyết định riêng. Mày rút lại bất cứ lúc nào — tắt quyền theo dõi trong Cài đặt hệ thống (iOS), mở lại hộp UMP trong app, đổi “Tuỳ chọn cookie” trên web, hoặc tắt push và trợ lý AI trong Cài đặt.':
    'Consent at Warrly is voluntary, purpose-specific, never bundled and never pre-ticked: each switch is its own decision. You can withdraw at any time — turn tracking off in system Settings (iOS), reopen the UMP form in the app, change “Cookie settings” on the web, or switch push and the AI assistant off in Settings.',

  // §9 — California. The old sentence said ads only run when you agree, which
  // stopped being true when the default became non-personalised serving.
  '9. Người dùng California (CCPA/CPRA)': '9. California residents (CCPA/CPRA)',
  'Nếu mày ở California, mày có quyền biết dữ liệu cá nhân bọn tao thu thập và chia sẻ, quyền xoá, quyền sửa và quyền từ chối bán hoặc chia sẻ dữ liệu cá nhân.':
    'If you are a California resident, you have the right to know what personal information we collect and share, the right to delete, the right to correct, and the right to opt out of the sale or sharing of personal information.',
  'Warrly không bán dữ liệu cá nhân. Mặc định quảng cáo không cá nhân hoá; quảng cáo cá nhân hoá chỉ chạy sau khi mày đồng ý, và mày có thể từ chối hoặc rút lại đồng ý bất cứ lúc nào.':
    'Warrly does not sell personal information. Ads are non-personalised by default; personalised ads run only after you agree, and you can refuse or withdraw at any time.',
  'Để thực hiện các quyền này, gửi email tới privacy@warrly.com. Mày có thể dùng đại diện được uỷ quyền. Bọn tao sẽ xác minh yêu cầu và không phân biệt đối xử khi mày thực hiện quyền.':
    'To exercise these rights, email privacy@warrly.com. You may use an authorised agent. We will verify the request and will not discriminate against you for exercising your rights.',

  // §10–§14 — the sections Vietnamese law requires that the old document did
  // not have. Retention has no invented number for ad data because Google owns
  // it; cross-border names every recipient and its country; children states the
  // under-16 line; international users is written the way the shipped app writes
  // it, including the fact that there is no EU/UK representative.
  '10. Lưu trữ trong bao lâu': '10. How long we keep it',
  'Dữ liệu tài khoản (email, thiết bị, bảo hành, hoá đơn, wishlist) được giữ cho tới khi mày xoá tài khoản. Xoá tài khoản là xoá khỏi hệ thống; trong ứng dụng không có nút khôi phục.':
    'Account data (email, devices, warranties, receipts, wishlist) is kept until you delete your account. Deleting the account removes it from the system; there is no restore button in the app.',
  'Dữ liệu quảng cáo do Google lưu theo chính sách Ads/AdMob của Google. Warrly không giữ bản sao nào, nên không có thời hạn riêng của Warrly để nêu.':
    'Advertising data is kept by Google under Google’s Ads/AdMob policy. Warrly holds no copy, so there is no separate Warrly retention period to state.',
  'Trạng thái đồng ý trên web được nhớ tối đa 12 tháng — khớp với Chính sách Cookie — sau đó Warrly hỏi lại. Xoá localStorage là mất bản ghi đó, và biểu ngữ sẽ hiện lại.':
    'Your consent state on the web is remembered for up to 12 months — matching the cookie policy — after which Warrly asks again. Clearing localStorage removes that record and the banner comes back.',
  '11. Chuyển dữ liệu ra nước ngoài': '11. International data transfers',
  'Warrly chạy từ Việt Nam, nhưng dữ liệu không chỉ nằm ở Việt Nam. Dữ liệu tài khoản nằm trên máy chủ do Warrly tự vận hành; phần còn lại đi qua các bên sau, và đó là chuyển dữ liệu ra nước ngoài:':
    'Warrly runs from Vietnam, but the data does not stay only in Vietnam. Account data sits on a server Warrly runs itself; the rest passes through the parties below, and that is a transfer of data abroad:',
  'Google': 'Google',
  'quảng cáo (AdMob) và thông báo đẩy trên Android (FCM): Google LLC tại Hoa Kỳ, và Google Ireland Ltd tại Ireland cho người dùng EU.':
    'advertising (AdMob) and push on Android (FCM): Google LLC in the United States, and Google Ireland Ltd in Ireland for users in the EU.',
  'Apple': 'Apple',
  'thông báo đẩy trên iOS qua APNs: Apple Inc. tại Hoa Kỳ.':
    'push on iOS through APNs: Apple Inc. in the United States.',
  'email giao dịch (đặt lại mật khẩu, xác nhận đổi email): Hoa Kỳ.':
    'transactional email (password reset, email-change confirmation): the United States.',
  'chỉ khi mày bật trợ lý AI: Hoa Kỳ.':
    'only when you enable the AI assistant: the United States.',
  'Nghị định 13/2023/NĐ-CP và Luật 91/2025/QH15 yêu cầu nêu rõ việc chuyển dữ liệu ra nước ngoài; mục này là chỗ nêu đó. Dữ liệu chỉ được chuyển tới các bên ở mục 7, cho các mục đích ở mục 8.':
    'Decree 13/2023/ND-CP and Law 91/2025/QH15 require transfers of personal data abroad to be stated plainly; this section is that statement. Data goes only to the parties in section 7, for the purposes in section 8.',
  'Mỗi bên nói trên có chính sách quyền riêng tư riêng và chịu luật bảo vệ dữ liệu áp dụng với họ. Chính sách quảng cáo của Google:':
    'Each party above has its own privacy policy and is bound by the data-protection law that applies to it. Google’s advertising policy:',
  '12. Trẻ em': '12. Children',
  'Warrly không hướng đến trẻ em và không cố ý thu thập dữ liệu của người dưới 16 tuổi. Nếu mày cho rằng Warrly đã thu thập nhầm dữ liệu của một trẻ em, gửi email tới privacy@warrly.com và bọn tao sẽ xoá.':
    'Warrly is not directed at children and does not knowingly collect data from anyone under 16. If you believe Warrly has collected a child’s data by mistake, email privacy@warrly.com and we will delete it.',
  'Nếu phát hiện một tài khoản là của người dưới 16 tuổi, Warrly sẽ xoá tài khoản đó cùng dữ liệu bên trong.':
    'If an account turns out to belong to someone under 16, Warrly will delete that account and the data inside it.',
  '13. Người dùng quốc tế': '13. International users',
  'Warrly được viết cho người dùng ở bất kỳ đâu, không chỉ Việt Nam. Người dùng EU, Vương quốc Anh và Thuỵ Sĩ được hưởng các quyền theo luật bảo vệ dữ liệu áp dụng — xem mục 6 — và với quảng cáo cá nhân hoá, Warrly dùng Google UMP, một nền tảng quản lý đồng ý đã được chứng nhận TCF v2.2.':
    'Warrly is written for users anywhere, not only in Vietnam. Users in the EU, the United Kingdom and Switzerland enjoy the rights their data-protection law grants — see section 6 — and for personalised ads Warrly uses Google UMP, a consent-management platform certified under TCF v2.2.',
  'Warrly không có đại diện tại EU hay Vương quốc Anh: đây là ứng dụng của một cá nhân, xử lý từ Việt Nam, và đầu mối cho mọi yêu cầu — kể cả từ EU/UK — là privacy@warrly.com.':
    'Warrly has no representative in the EU or the United Kingdom: this is one individual’s app, run from Vietnam, and the contact for every request — including from the EU/UK — is privacy@warrly.com.',
  '14. Thay đổi': '14. Changes',
  'Warrly có thể cập nhật chính sách này. Bản mới luôn ghi ngày “Cập nhật lần cuối” ở đầu trang; mày nên đọc lại sau mỗi lần đổi. Nếu thay đổi làm tăng phạm vi dữ liệu thu thập, Warrly sẽ hỏi lại sự đồng ý thay vì coi như mày đã đồng ý.':
    'Warrly may update this policy. The new version always carries a new “Last updated” date at the top; read it again after each change. If a change widens what is collected, Warrly will ask for consent again instead of treating silence as agreement.',
  'Bản tiếng Việt và bản tiếng Anh được cập nhật cùng lúc. Nếu hai bản lệch nhau, bản tiếng Việt là bản có giá trị pháp lý.':
    'The Vietnamese and English versions are updated together. If they diverge, the Vietnamese version is the legally binding one.',

  // §15 — contact. The controller's name is rendered outside `t()` (see the
  // component: it is identical in both languages and would fail the English
  // diacritics check). This is the only place a postal address would go, and it
  // is deliberately absent.
  '15. Liên hệ': '15. Contact',
  'Đơn vị chịu trách nhiệm': 'Data controller',
  'cá nhân, Việt Nam.': 'an individual based in Vietnam.',
  'Đầu mối bảo vệ dữ liệu': 'Data protection contact',
  'không có DPO riêng; chính chủ sở hữu trả lời mọi yêu cầu qua privacy@warrly.com.':
    'there is no separate DPO; the owner answers every request at privacy@warrly.com.',

  // ── Terms (`app/(public)/terms/page.tsx`) ───────────────────────────────
  //
  // §5 is the new subscription section and is modelled on the shipped app's
  // clause — auto-renewal, the 24-hour cancellation window, store-managed
  // billing, price shown in-app — but it describes a tier that does not exist.
  // It therefore states NO price, NO interval, NO trial and NO currency, and
  // says in one sentence that those facts are absent because none of them has
  // been set. `#usage-limits` stays §4 because the landing page links to it and
  // prints the number; every section after the insertion shifted by one.
  'Điều khoản sử dụng — Warrly': 'Terms of service — Warrly',
  'Điều khoản sử dụng dịch vụ Warrly': 'Warrly terms of service',
  'Điều khoản sử dụng': 'Terms of service',
  'Khi có khác biệt về diễn giải, ưu tiên bản tiếng Việt cho người dùng tại Việt Nam.':
    'If there is any conflict in interpretation, the Vietnamese version prevails for users in Vietnam.',
  '— và không phải công ty. Điều khoản này cũng là thoả thuận cấp phép người dùng cuối (EULA) giữa mày và Warrly.':
    '— and is not a company. These Terms are also the end-user licence agreement (EULA) between you and Warrly.',
  'Dùng Warrly tức là mày đồng ý với các điều khoản dưới đây. Bọn tao cố giữ chúng ngắn và dễ hiểu.':
    'Using Warrly means you agree to the terms below. We try to keep them short and easy to read.',
  '1. Dịch vụ & mục đích cá nhân': '1. The service & personal use',
  'Warrly là công cụ cá nhân để quản lý thiết bị, bảo hành, gói đăng ký và wishlist của chính mày. Đừng dùng để lưu trữ dữ liệu của người khác khi chưa được họ cho phép.':
    'Warrly is a personal tool for managing your own devices, warranties, subscriptions and wishlist. Do not use it to store other people\'s data without their permission.',
  'Warrly cấp cho mày quyền dùng cá nhân, không độc quyền, không chuyển nhượng. Mày không được dịch ngược, gỡ rối hay can thiệp mã nguồn; không cào dữ liệu hàng loạt; và không dùng Warrly để vi phạm pháp luật.':
    'Warrly gives you a personal, non-exclusive, non-transferable right to use it. You may not reverse-engineer, decompile or tamper with the code; scrape or bulk-harvest data; or use Warrly to break the law.',
  '2. Tài khoản & bảo mật': '2. Accounts & security',
  'Mày chịu trách nhiệm giữ mật khẩu an toàn và mọi hoạt động dưới tài khoản của mình. Báo cho bọn tao ngay nếu nghi ngờ tài khoản bị truy cập trái phép.':
    'You are responsible for keeping your password safe and for everything done under your account. Tell us right away if you suspect unauthorised access.',
  '3. Nội dung của mày': '3. Your content',
  'Mày sở hữu dữ liệu mình nhập và tải lên. Mày tự đảm bảo nội dung đó hợp pháp và mày có quyền lưu trữ nó. Bọn tao không yêu cầu quyền sở hữu nội dung của mày.':
    'You own the data you enter and upload. You are responsible for making sure that content is lawful and that you have the right to store it. We claim no ownership over your content.',
  '4. Giới hạn sử dụng': '4. Usage limits',
  'Để hệ thống chạy ổn cho mọi người, mỗi tài khoản có giới hạn: 50 thiết bị đang dùng (500 dòng kể cả máy đã bán), 5 gói bảo hành và 5 tệp mỗi thiết bị, 5 MB mỗi tệp, 100 MB tổng dung lượng tệp, 100 gói đăng ký và 200 món wishlist. Gói miễn phí có quảng cáo. Gói trả phí, khi mở bán, sẽ nâng các giới hạn này và tắt quảng cáo trên tài khoản trả phí. Khi chạm giới hạn, ứng dụng báo rõ trong ngôn ngữ bạn đang dùng.':
    'So the system stays healthy for everyone, each account has limits: 50 active devices (500 rows including sold ones), 5 warranty plans and 5 files per device, 5 MB per file, 100 MB of total file storage, 100 subscriptions and 200 wishlist items. The free tier carries ads. The paid tier, when it goes on sale, will raise these limits and turn ads off for paid accounts. When you hit a limit, the app says so in the language you are using.',
  '5. Gói trả phí — chưa mở bán': '5. The paid tier — not on sale yet',
  'Gói trả phí của Warrly chưa mở bán. Hiện không có giá, không có ngày ra mắt, và mày không thể mua nó ở đâu cả. Mục này nói trước những gì sẽ áp dụng khi nó mở bán — không phải những gì đang chạy hôm nay.':
    'Warrly’s paid tier is not on sale. There is no price, no launch date, and you cannot buy it anywhere. This section states what will apply when it does go on sale — not what runs today.',
  'Khi mở bán, gói trả phí sẽ:': 'When it goes on sale, the paid tier will:',
  'Tự động gia hạn:': 'Auto-renew:',
  'gói tự gia hạn cho tới khi mày tắt tự động gia hạn, và phải tắt xong ít nhất 24 giờ trước khi kỳ hiện tại kết thúc.':
    'the plan renews automatically until you turn auto-renew off, and it must be off at least 24 hours before the current period ends.',
  'Do cửa hàng thu tiền:': 'Billed by the store:',
  'mua qua App Store (iOS) hoặc Google Play (Android), trừ vào tài khoản cửa hàng của mày. Warrly không nhận, không lưu và không xử lý thông tin thanh toán.':
    'you buy through the App Store (iOS) or Google Play (Android), charged to your store account. Warrly never receives, stores or processes your payment details.',
  'Huỷ trong cửa hàng:': 'Cancelled in the store:',
  'huỷ trong phần quản lý gói đăng ký của App Store hoặc Google Play; huỷ có hiệu lực từ kỳ kế tiếp, và mày dùng tiếp đến hết kỳ đã trả tiền.':
    'you cancel in the App Store or Google Play subscription settings; cancellation takes effect from the next period, and you keep the paid tier until the paid period ends.',
  'Giá hiện trước khi mua:': 'Price shown before purchase:',
  'giá và độ dài kỳ hiện trong ứng dụng trước khi mày xác nhận, theo tiền tệ tài khoản cửa hàng của mày.':
    'the price and period length appear in the app before you confirm, in your store account’s currency.',
  'Bỏ quảng cáo:': 'Ads removed:',
  'gói trả phí tắt quảng cáo và nâng các giới hạn ở mục 4.':
    'the paid tier removes ads and raises the limits in section 4.',
  'Mục này không nêu giá, không nêu độ dài kỳ và không nêu bản dùng thử, vì chưa có cái nào được chốt. Khi có, chúng sẽ hiện trong ứng dụng trước khi mua — Warrly không bán một gói mà mày chưa thấy giá.':
    'This section states no price, no period length and no free trial, because none of them has been set. When they are, they will appear in the app before purchase — Warrly does not sell a plan whose price you have not seen.',
  'Hoàn tiền: giao dịch trong ứng dụng do Apple và Google xử lý theo chính sách của họ; Warrly không tự hoàn tiền, nhưng trả lời email support@warrly.com nếu mày gặp trục trặc.':
    'Refunds: in-app purchases are handled by Apple and Google under their own policies; Warrly cannot refund directly, but answers support@warrly.com if something goes wrong.',
  'Điều khoản này là EULA áp dụng cho gói trả phí.':
    'These Terms are the EULA that governs the paid tier.',
  '6. Không bảo đảm': '6. No warranty',
  'Dịch vụ được cung cấp “nguyên trạng” (as-is). Bọn tao cố gắng giữ dữ liệu an toàn và nhắc nhở đúng hạn, nhưng không bảo đảm dịch vụ không gián đoạn hay không có lỗi. Hãy tự sao lưu dữ liệu quan trọng (Cài đặt → Sao lưu & khôi phục).':
    'The service is provided “as is”. We do our best to keep your data safe and to remind you on time, but we cannot promise the service will never go down or never have a bug. Back up anything important yourself (Settings → Backup & restore).',
  '7. Chấm dứt': '7. Termination',
  'Mày có thể xoá tài khoản bất cứ lúc nào trong phần Cài đặt — toàn bộ dữ liệu sẽ bị xoá vĩnh viễn. Bọn tao có thể tạm ngưng tài khoản nếu phát hiện hành vi lạm dụng hệ thống.':
    'You can delete your account at any time in Settings — all of your data is permanently erased. We may suspend an account if we find it being abused.',
  '8. Thay đổi điều khoản': '8. Changes to these Terms',
  'Warrly có thể cập nhật điều khoản này; bản mới ghi ngày “Cập nhật lần cuối” ở đầu trang. Dùng Warrly tiếp sau ngày đó là chấp nhận bản mới. Nếu thay đổi quan trọng, Warrly sẽ nói rõ thay đổi gì.':
    'Warrly may update these Terms; the new version carries a new “Last updated” date at the top. Continuing to use Warrly after that date means you accept the new version. If a change matters, Warrly will say what changed.',
  '9. Luật áp dụng': '9. Governing law',
  'Điều khoản này theo pháp luật Việt Nam, và tranh chấp được giải quyết tại cơ quan có thẩm quyền ở Việt Nam. Nếu mày là người tiêu dùng ở nước khác, mày vẫn giữ các quyền bắt buộc mà luật nước mày dành cho mày.':
    'These Terms are governed by the law of Vietnam, and disputes go to the competent authority in Vietnam. If you are a consumer elsewhere, you keep the mandatory rights your own law gives you.',
  '10. Liên hệ': '10. Contact',
  'Quyền riêng tư:': 'Privacy:',
  'Người cung cấp': 'Provider',
  // ── Cookies (`app/(public)/cookies/page.tsx`) ───────────────────────────
  'Chính sách Cookie — Warrly': 'Cookie policy — Warrly',
  'Chính sách sử dụng cookie của Warrly': 'How Warrly uses cookies',
  'Chính sách Cookie': 'Cookie policy',
  'Warrly dùng cookie thiết yếu để mày đăng nhập, giữ phiên và ghi nhớ ngôn ngữ, giao diện. Ở gói miễn phí, quảng cáo có thể dùng cookie hoặc định danh thiết bị của bên thứ ba — nhưng chỉ sau khi mày đồng ý. Gói trả phí không có quảng cáo.':
    'Warrly uses essential cookies to sign you in, keep your session and remember your language and appearance. On the free tier, ads may use third-party cookies or device identifiers — but only after you agree. The paid tier has no ads.',
  '1. Cookie thiết yếu': '1. Essential cookies',
  'Bọn tao dùng hai cookie thiết yếu:':
    'We use two essential cookies:',
  'Được mã hoá, chỉ chứa token phiên và thời hạn (tối đa 7 ngày) — không có thông tin cá nhân đọc được. Tắt cookie này thì không đăng nhập được.':
    'Encrypted, and holds only the session token and its expiry (up to seven days) — no readable personal information. Turn it off and you cannot sign in.',
  'ghi nhớ ngôn ngữ mày chọn (en hoặc vi), tối đa 1 năm. Không chứa thông tin cá nhân.':
    'remembers the language you chose (en or vi), for up to one year. It holds no personal information.',
  'Cả hai cookie đều do Warrly đặt trên tên miền này, không phải cookie bên thứ ba.':
    'Both cookies are set by Warrly on this domain; neither is a third-party cookie.',
  '2. Lưu trữ cục bộ trên máy': '2. Local storage on your device',
  'Một vài tuỳ chọn giao diện (chế độ sáng/tối, cỡ chữ, màu nhấn) được lưu trong bộ nhớ cục bộ của trình duyệt (localStorage, các khoá theme và wv:prefs) trên máy mày, không gửi về máy chủ.':
    'A few interface preferences (light/dark mode, font size, accent colour) are kept in your browser\'s local storage (localStorage, under the keys theme and wv:prefs) on your own machine and are never sent to the server.',
  'Lựa chọn cookie được lưu trong localStorage dưới khoá wv_consent. Đây là bản ghi cần thiết để biết mày đã đồng ý hay từ chối; không có cookie nào được đặt cho việc này. Lựa chọn được nhớ tối đa 12 tháng, sau đó Warrly hỏi lại.':
    'Your cookie choice is kept in localStorage under the key wv_consent. This record is necessary to know whether you agreed or refused; no cookie is set for it. The choice is remembered for up to 12 months, after which Warrly asks again.',
  'Xoá dữ liệu trình duyệt sẽ xoá các mục này; xoá wv_consent khiến biểu ngữ cookie hiện lại.':
    'Clearing your browser data removes these entries; clearing wv_consent makes the cookie banner appear again.',
  '3. Cookie quảng cáo (chỉ ở gói miễn phí)': '3. Advertising cookies (free tier only)',
  'Quảng cáo trong app iOS và Android do Google AdMob phục vụ. Trên web hiện chưa có quảng cáo: Warrly không tải script quảng cáo và không đặt cookie quảng cáo trước khi mày đồng ý.':
    'Ads in the iOS and Android apps are served by Google AdMob. The web has no ads yet: Warrly loads no ad script and sets no advertising cookie before you agree.',
  'Trên app, khi mày đồng ý, AdMob có thể đọc định danh quảng cáo của thiết bị để chọn, giới hạn và đo lường quảng cáo. Gói trả phí không có quảng cáo, nên không có dữ liệu quảng cáo.':
    'In the app, once you agree, AdMob may read your device’s advertising identifier to select, cap and measure ads. The paid tier has no ads, so it has no ad data.',
  // Labels on the four ad facts below (the cookies page uses them as list
  // headings, so they are registered here rather than inlined).
  'Nhà cung cấp quảng cáo': 'Advertising provider',
  'Cookie, định danh và thời hạn': 'Cookies, identifiers and duration',
  'Dữ liệu nhận và mục đích': 'Data received and purpose',
  'Thời hạn lưu dữ liệu quảng cáo': 'Ad data retention',
  // The four ad facts below used to be fill-in markers. The owner has
  // supplied them, and they now match `privacy-content.tsx` §5 rather than
  // guessing: Google AdMob, the two Google entities, independent controller for
  // ad data, non-personalised unless ATT/UMP consent says otherwise.
  'Google AdMob — Google LLC (Hoa Kỳ) và Google Ireland Ltd (Ireland). Với dữ liệu quảng cáo, Google là bên kiểm soát độc lập.':
    'Google AdMob — Google LLC (United States) and Google Ireland Ltd (Ireland). For advertising data, Google is an independent controller.',
  'Trên app: IDFA (iOS) và GAID (Android), cộng cookie hoặc định danh quảng cáo của Google (ví dụ NID, IDE); thời hạn theo chính sách của Google. Trên web hiện chưa có quảng cáo.':
    'In the app: IDFA (iOS) and GAID (Android), plus Google’s advertising cookies or identifiers (for example NID, IDE); duration per Google’s policy. The web has no ads yet.',
  'Định danh quảng cáo, thông tin thiết bị tối thiểu và sự kiện hiển thị, nhấp, để chọn và đo lường quảng cáo. Mặc định không cá nhân hoá; chỉ cá nhân hoá sau khi mày đồng ý (ATT trên iOS, Google UMP với EU/UK/Thuỵ Sĩ).':
    'Advertising identifier, minimal device information, and impression and click events, to select and measure ads. Non-personalised by default; personalised only after you agree (ATT on iOS, Google UMP for the EU/UK/Switzerland).',
  'theo chính sách Ads/AdMob của Google. Warrly không lưu dữ liệu quảng cáo.':
    'per Google’s Ads/AdMob policy. Warrly stores no advertising data.',
  '4. Đổi hoặc rút lại lựa chọn': '4. Changing or withdrawing your choice',
  'Mở “Tuỳ chọn cookie” ở chân trang bất cứ lúc nào. Chọn “Từ chối không cần thiết” để tắt quảng cáo ngay, hoặc “Quản lý” để bật/tắt từng loại.':
    'Open “Cookie settings” in the footer at any time. Choose “Reject non-essential” to turn advertising off immediately, or “Manage” to switch each category on or off.',
  'Rút lại đồng ý không làm mất hiệu lực của việc xử lý đã xảy ra trước đó, và không chặn mày dùng gói miễn phí.':
    'Withdrawing consent does not make earlier processing unlawful, and it does not block you from using the free tier.',

  // ── Cookie consent banner + footer control ──────────────────────────────
  // These labels are used by `components/consent/consent-banner.tsx`. The
  // banner is mounted on the landing, legal and auth surfaces; the footer
  // control reopens it.
  'Tuỳ chọn cookie': 'Cookie settings',
  'Cookie trên Warrly': 'Cookies on Warrly',
  'Quản lý cookie': 'Manage cookies',
  'Cookie thiết yếu': 'Strictly necessary',
  'Luôn bật': 'Always on',
  'Phiên đăng nhập, ngôn ngữ và giao diện. Luôn bật vì trang không chạy đúng nếu thiếu.':
    'Sign-in session, language and appearance. Always on because the site cannot work properly without them.',
  'Quảng cáo': 'Advertising',
  'Cookie và định danh thiết bị dùng cho quảng cáo bên thứ ba, chỉ khi bạn đồng ý. Mặc định tắt.':
    'Cookies and device identifiers used for third-party advertising, only if you agree. Off by default.',
  'Warrly dùng cookie thiết yếu để đăng nhập và ghi nhớ ngôn ngữ, giao diện. Cookie quảng cáo là tuỳ chọn và mặc định tắt; chỉ bật khi bạn đồng ý.':
    'Warrly uses essential cookies to sign you in and remember your language and appearance. Advertising cookies are optional and off by default; they are only used if you agree.',
  'Bạn có thể đổi lựa chọn bất cứ lúc nào qua “Tuỳ chọn cookie” ở chân trang.':
    'You can change your choice at any time through “Cookie settings” in the footer.',
  'Chấp nhận tất cả': 'Accept all',
  'Từ chối không cần thiết': 'Reject non-essential',
  'Quản lý': 'Manage',
  'Lưu lựa chọn': 'Save choices',
});
