// Transport + library copy: the API error fallbacks the web itself writes,
// global search, share links and the warranty service directory.
//
// "System" here means the layer BELOW the screens: `lib/search.ts`,
// `lib/share-links.ts`, `lib/service-directory.ts` and the two API wrappers
// that write a message of their own (`lib/api/backup.ts`, `lib/api/directory.ts`).
// Their sentences are rendered by more than one page — the share copy appears in
// the device detail page, in the one-time dialog and in the list rows; the
// directory copy in the card, the page and the tests — so they live in one file
// rather than being re-worded per screen.
//
// This file is the whole web-side "system" vocabulary. `messages/common.ts`
// owns the shared chrome and the generic transport fallbacks; the two domains
// this one covers are the ones whose copy a *helper* builds rather than a
// screen (`describeSearchFailure`, `shareRemainingLabel`, `phoneDisclosure`).
//
// Two rules were followed when filling this file, and both matter:
//
//   * A sentence that also exists in the Go catalog
//     (`api/internal/i18n/catalog.go`) copies that English verbatim. The
//     server's own copy is rendered next to these strings — a share link the
//     server calls "Expired" must not be called "Has expired" by the row beside
//     it. (`'Đã hết hạn'`, `'Chưa có số điện thoại'`, `'Không tìm thấy link chia
//     sẻ'`'s domain and the directory's hotline paragraph are all taken from
//     there.)
//   * A sentence that a sibling message file already owns is NOT redefined
//     here: `'Đóng'`, `'Huỷ'` and `'Tạo'` come from `common.ts`, `'Đang thèm'`
//     from `dashboard.ts`. Two files disagreeing about one Vietnamese sentence
//     fails `__tests__/i18n.test.ts`.
//
// Five sentences that this domain also needs are deliberately NOT redefined
// here, because a sibling file already owns them with exactly the English this
// file would have used: `'Gói đăng ký'` (common.ts), `'Đang hoạt động'`
// (subscriptions.ts), `'Phiên đăng nhập đã hết hạn — tải lại trang để đăng nhập
// lại.'` (settings.ts), `'Thiếu id thiết bị'` (settings.ts) and
// `'Hết hạn {date}'` (settings.ts). A duplicate with the same English is
// tolerated by the merge, but it is still two places to keep in step.

import { defineMessages } from '../types';

export const system = defineMessages({
  // ── Global search (`lib/search.ts`, `components/global-search.tsx`) ─────
  'Tìm thiết bị, đăng ký, wishlist…': 'Search devices, subscriptions, wishlist…',
  // The group headings repeat the sidebar's wording for the same three
  // sections, so a dropdown row and the nav item it leads to cannot read as two
  // features: `SEARCH_GROUP_LABELS.devices` is `common.ts::'Thiết bị'`, its
  // `subscriptions` is `common.ts::'Gói đăng ký'` and its `wishlist` is
  // `dashboard.ts::'Đang thèm'` — all three already registered, none redefined
  // here.
  'Nhập từ khoá để tìm trong thiết bị, đăng ký và wishlist.':
    'Type a keyword to search devices, subscriptions and the wishlist.',
  'Đang tìm…': 'Searching…',
  'Không tìm thấy kết quả cho “{query}”.': 'No results for “{query}”.',
  'Không tìm thấy kết quả nào.': 'No results found.',
  'Thao tác quá nhanh, thử lại sau.': 'Too many attempts, try again later.',
  // Mirrors the server's own 400 (`i18n`: "The search query is too long (at
  // most %d characters)") for the case where the 400 carried no message.
  'Từ khoá không hợp lệ (tối đa {count} ký tự).': {
    en: 'Invalid search query (at most {count} characters).',
    enOne: 'Invalid search query (at most {count} character).',
  },
  'Không tìm kiếm được, thử lại sau.': 'Could not search, try again later.',
  'Tìm kiếm thiết bị, đăng ký, wishlist': 'Search devices, subscriptions, wishlist',
  'Xoá từ khoá': 'Clear the keyword',
  'Đóng tìm kiếm': 'Close search',

  // ── Share links — states and action labels (`lib/share-links.ts`) ───────
  //
  // `SHARE_STATUS_LABELS.live` is `'Đang hoạt động'`, which `subscriptions.ts`
  // already registers as "Active" — same word, same meaning, so it is not
  // redefined here.
  'Đã hết hạn': 'Expired',
  'Đã thu hồi': 'Revoked',
  'Còn dưới 1 ngày': 'Less than 1 day left',
  // The "Còn {days} ngày" countdown is NOT defined here — `warranties.ts` owns
  // it, with the same English, and `lib/share-links.ts` reuses that key.
  'Chưa ai mở': 'No one has opened it yet',
  // Vietnamese does not inflect; English does — hence `enOne` (docs/I18N_PLAN.md
  // §4.6). The count is the number of times the link has been opened.
  'Đã mở {count} lần': { en: 'Opened {count} times', enOne: 'Opened {count} time' },
  'Kèm serial/IMEI đầy đủ': 'Full serial/IMEI included',
  'Chỉ serial che giữa': 'Serial partly masked',
  '7 ngày': '7 days',
  '30 ngày (mặc định)': '30 days (default)',
  '90 ngày': '90 days',

  // ── Share links — the owner-facing flow (`components/device-shares.tsx`) ─
  'Tạo link chia sẻ': 'Create a share link',
  'Tạo link': 'Create link',
  'Đã tạo link chia sẻ': 'Share link created',
  'Sao chép link': 'Copy link',
  'Đã sao chép': 'Copied',
  'Đã sao chép link chia sẻ': 'Share link copied',
  'Thu hồi': 'Revoke',
  'Không tạo được link chia sẻ, thử lại sau': 'Could not create the share link, try again later',
  'Không thu hồi được link chia sẻ, thử lại sau': 'Could not revoke the share link, try again later',
  'Không tự sao chép được — link đã được chọn, bấm Ctrl/Cmd + C để chép rồi gửi ngay.':
    'Could not copy it automatically — the link is selected, press Ctrl/Cmd + C to copy it and send it right away.',
  'Thu hồi link này? Người đang giữ link sẽ không mở được phiếu nữa. Không thể hoàn tác.':
    'Revoke this link? Whoever holds it will no longer be able to open the certificate. This cannot be undone.',
  'Tạo link chia sẻ cho “{name}”': 'Create a share link for “{name}”',
  'Link chỉ-đọc cho đúng thiết bị này, mở được không cần đăng nhập. Dùng khi bán máy hoặc khi đưa máy cho người khác đi bảo hành.':
    'A read-only link for this device only, openable without signing in. Use it when you sell the device or hand it to someone else to claim the warranty.',
  'Link chỉ hiện MỘT LẦN': 'The link is shown ONCE',
  'Đây là lần duy nhất link hiện ra': 'This is the only time the link appears',
  'Link sống trong bao lâu': 'How long the link lives',
  'Hết hạn là link ngừng hoạt động. Không có lựa chọn vĩnh viễn, và bạn luôn thu hồi được trước hạn.':
    'Once it expires the link stops working. There is no permanent option, and you can always revoke it early.',
  'Không bao giờ có trong phiếu': 'Never included in the certificate',
  'Không tải được danh sách link chia sẻ — thử tải lại trang nhé.':
    'Could not load the share links — try reloading the page.',
  'Chưa có link chia sẻ nào. Tạo link khi bạn cần đưa phiếu bàn giao bảo hành cho người mua.':
    'No share links yet. Create one when you need to hand a warranty certificate to a buyer.',
  'Link đã hết hạn hoặc đã thu hồi ({count})': {
    en: 'Expired or revoked links ({count})',
    enOne: 'Expired or revoked link ({count})',
  },
  'Không còn link nào đang hoạt động. Người nhận cũ mở link cũ sẽ thấy thông báo link không còn hiệu lực.':
    'No link is active any more. An old recipient opening an old link will be told it is no longer valid.',
  'Gửi link dưới đây cho người nhận. Họ mở được ngay, không cần đăng nhập.':
    'Send the link below to the recipient. They can open it right away, without signing in.',
  'Link gửi cho người nhận': 'Link to send to the recipient',
  'Mở phiếu (xem trước)': 'Open the certificate (preview)',
  'Tạo ngày {date}': 'Created {date}',
  // 'Hết hạn {date}' ("Expires {date}") is shared with `settings.ts` and is not
  // redefined here; the share rows and the directory card both use that key.
  'Mở lần cuối {date}': 'Last opened {date}',
  'Thu hồi link tạo ngày {date}': 'Revoke the link created on {date}',
  '{live}/{max} link còn hiệu lực': '{live}/{max} active links',
  ' — đã đạt giới hạn, thu hồi bớt để tạo thêm':
    ' — the limit is reached, revoke some to create more',

  // ── Share links — the server action's own messages (`app/actions/shares.ts`) ─
  //
  // Four of them, plus one shared with `settings.ts` (see the note below).
  // Everything else that action returns is Go's `message`, already rendered in
  // the request's language.
  // 'Thiếu id thiết bị' ("Missing device id") is shared with `settings.ts`.
  'Thiếu id link chia sẻ': 'Missing share-link id',
  'Không tạo được link chia sẻ': 'Could not create the share link',
  'Không thu hồi được link chia sẻ': 'Could not revoke the share link',
  'Đã thu hồi link chia sẻ': 'Share link revoked',

  // ── Service directory (`lib/service-directory.ts`) ──────────────────────
  'Thiết bị chưa ghi hãng': 'The device has no brand recorded',
  'Thêm hãng cho thiết bị (nút “Sửa” ở đầu trang) để app tra danh bạ trung tâm bảo hành uỷ quyền của hãng đó.':
    'Add a brand to the device (the “Edit” button at the top of the page) and the app can look up that brand’s authorised service centres.',
  'App không có thông tin đã kiểm chứng cho hãng này':
    'The app has no verified information for this brand',
  'App chỉ có danh bạ cho một số hãng, và khi chuỗi khớp bị mơ hồ (nhiều hãng cùng khớp) thì app không đoán. Bạn tra trang hỗ trợ chính thức của hãng để tìm trung tâm uỷ quyền gần nhất.':
    'The app only has a directory for some brands, and when the match is ambiguous (several brands match) it does not guess. Look on the manufacturer’s official support page to find the nearest authorised centre.',
  'App không có link nào đã kiểm chứng cho hãng này.':
    'The app has no verified link for this brand.',
  'Tra cứu trung tâm bảo hành uỷ quyền': 'Find an authorised service centre',
  'Trang hỗ trợ của hãng': 'The manufacturer’s support page',
  // The Go catalog carries the same paragraph, longer, as the endpoint's own
  // `disclaimer`; this is the card's own one-line honesty note and it copies
  // that English wording ("does not ship hotlines … would be worse than none").
  'App không phải nguồn của số điện thoại nào: số hiện ra là do bạn tự ghi cho gói bảo hành, còn “chưa có số” nghĩa là app không biết — không phải hotline.':
    'The app is not the source of any phone number: a number shown here is one you recorded yourself for a warranty plan, and “no number” means the app does not know one — it is not a hotline.',
  'Do bạn tự ghi': 'Recorded by you',
  'Số này bạn tự nhập cho gói bảo hành; app không kiểm chứng.':
    'You entered this number yourself for the warranty plan; the app has not verified it.',
  'Chưa có số điện thoại': 'No phone number recorded',
  'App không lưu hotline của hãng hay trung tâm nên không có số nào để hiện.':
    'The app does not store manufacturer or service-centre hotlines, so there is no number to show.',
  'Nguồn số chưa rõ': 'Source of the number unclear',
  'Máy chủ không nói số này từ đâu tới, nên app không coi nó là số đã kiểm chứng.':
    'The server does not say where this number came from, so the app does not treat it as verified.',
  'Địa chỉ do bạn tự ghi': 'Address recorded by you',
  'Chưa ghi địa chỉ cho gói này.': 'No address recorded for this plan.',
  'Chưa khớp danh bạ nhà bảo hành — app hiện đúng chữ bạn đã ghi và không đoán.':
    'Not matched to the warranty-provider directory — the app shows exactly what you typed and does not guess.',
  'Thiết bị chưa có gói bảo hành nào nên chưa có nơi bảo hành nào để hiện. Thêm gói bảo hành rồi ghi nơi bạn sẽ mang máy tới.':
    'The device has no warranty plan yet, so there is nowhere to take it for service yet. Add a warranty plan and record where you will take the device.',
  'App không lưu sẵn hotline hay địa chỉ trung tâm bảo hành — một hotline sai còn tệ hơn không có. Link của hãng bên dưới là nguồn duy nhất app dám chỉ; số điện thoại và địa chỉ còn lại là do bạn tự ghi.':
    'The app does not ship hotlines or service-centre addresses — a wrong hotline would be worse than none. The manufacturer links below are the only source the app is willing to point at; any other phone number or address is one you recorded yourself.',
  'Không rõ loại': 'Unknown type',
  'Còn hạn': 'Still covered',
  'Chưa ghi hạn': 'No expiry recorded',
  'Khớp danh bạ nhà bảo hành.': 'Matched to the warranty-provider directory.',
  'Chưa ghi nhà bảo hành cho gói này.': 'No warranty provider recorded for this plan.',
  'Link dưới đây do chính hãng duy trì — app chỉ dẫn lại, không chép hotline.':
    'The link below is maintained by the manufacturer itself — the app only points to it, it does not copy a hotline.',
  '{withPhone}/{total} gói có số điện thoại do bạn tự ghi. App không có hotline nào trong hai con số đó.':
    {
      en: '{withPhone}/{total} plans have a phone number you recorded yourself. The app has no hotline among those two figures.',
      enOne:
        '{withPhone}/{total} plan has a phone number you recorded yourself. The app has no hotline among those two figures.',
    },
  '{withPhone}/{total} gói có số điện thoại do bạn tự ghi · {count} gói chưa khớp danh bạ nhà bảo hành. App không có hotline nào trong hai con số đó.':
    {
      en: '{withPhone}/{total} plans have a phone number you recorded yourself · {count} plans not matched to the warranty-provider directory. The app has no hotline among those two figures.',
      enOne:
        '{withPhone}/{total} plan has a phone number you recorded yourself · {count} plans not matched to the warranty-provider directory. The app has no hotline among those two figures.',
    },
  'Không tải được danh bạ bảo hành — thử tải lại trang nhé.':
    'Could not load the warranty directory — try reloading the page.',
  'Danh bạ bảo hành trả về không hợp lệ': 'The warranty directory response was invalid',
  // Card-only fragments. The rest of the provider line is a proper noun (the
  // catalog's own name) or the user's own text, so those are rendered untouched.
  'Hãng bạn ghi trên thiết bị:': 'The brand you recorded on the device:',
  'Nhà bảo hành:': 'Warranty provider:',
  'Nhà bảo hành bạn ghi:': 'Warranty provider you recorded:',
  '(bạn ghi “{value}”)': '(you typed “{value}”)',

  // ── What the certificate is, and what it never contains ────────────────
  //
  // These are shown BEFORE a link exists and again while its token is on
  // screen: they are the contract of the certificate. Translated as whole
  // sentences rather than assembled from fragments — word order differs between
  // the two languages, and a concatenated sentence reads like one.
  'Link chỉ hiện MỘT LẦN, ngay sau khi bạn bấm tạo. Máy chủ chỉ lưu mã băm của token nên không ai — kể cả bạn — xem lại được link này. Hãy sao chép và gửi cho người nhận trước khi đóng; nếu lỡ đóng mà chưa sao chép, bạn phải tạo link mới.':
    'The link appears ONCE only, right after you press create. The server stores just a hash of the token, so nobody — not even you — can view this link again. Copy it and send it to the recipient before closing; if you close it without copying, you have to create a new link.',
  'Link chưa được lưu. Hãy bấm “Sao chép link”, hoặc tick xác nhận rằng bạn đã lưu, rồi mới đóng.':
    'The link has not been saved. Press “Copy link”, or tick the box confirming you have saved it, before closing.',
  'Tôi đã sao chép hoặc lưu link này và hiểu rằng không xem lại được.':
    'I have copied or saved this link and understand that it cannot be viewed again.',
  'Link chia sẻ là phiếu bàn giao cho người mua: mở được không cần đăng nhập, không có giá, ghi chú hay ảnh hoá đơn. Token chỉ hiện một lần lúc tạo.':
    'A share link is a handover certificate for the buyer: it opens without signing in, and carries no price, notes or receipt photos. The token is shown only once, when it is created.',
  'Tối đa {max} link còn hiệu lực cho mỗi thiết bị. Link luôn có hạn ({min}–{maxDays} ngày) và thu hồi được — không có link vĩnh viễn.':
    'At most {max} active links per device. A link always expires ({min}–{maxDays} days) and can be revoked — there is no permanent link.',
  'Mặc định TẮT: phiếu chỉ hiện serial che giữa (giữ đầu và cuối, che phần giữa) — vẫn đủ để người mua đối chiếu tem trên máy.':
    'OFF by default: the certificate shows only a partly masked serial (first and last characters kept, the middle hidden) — still enough for the buyer to check it against the sticker on the device.',
  'BẬT: phiếu hiện serial/IMEI đầy đủ. Cần khi trung tâm bảo hành tra cứu theo IMEI, nhưng nghĩa là bất kỳ ai có link (kể cả khi bị chuyển tiếp) đều thấy định danh đầy đủ của máy.':
    'ON: the certificate shows the full serial/IMEI. You need this when a service centre looks the device up by IMEI, but it means anyone holding the link (including a forwarded one) sees the device’s full identity.',
  'Kèm serial/IMEI đầy đủ trong phiếu': 'Include the full serial/IMEI in the certificate',
  'Người nhận đọc được gì': 'What the recipient can read',
  'Tên máy, loại, hãng, model': 'Device name, category, brand, model',
  'Ngày mua, nơi mua, trạng thái thiết bị (kể cả ngày bán nếu bạn có ghi)':
    'Purchase date, place of purchase, device status (including the sale date, if you recorded one)',
  'Serial che giữa — hoặc serial đầy đủ nếu bạn bật lựa chọn bên trên':
    'A partly masked serial — or the full serial if you turn on the option above',
  'Từng gói bảo hành: loại, nhà bảo hành, thời hạn, địa chỉ/số điện thoại do bạn tự ghi cho gói đó':
    'Each warranty plan: type, provider, term, and the address/phone number you recorded yourself for that plan',
  'Ngày hết hạn bảo hành xa nhất và ngày hết hạn của chính link':
    'The latest warranty expiry date, and the expiry date of the link itself',
  'Giá mua, giá bán, lãi/lỗ': 'Purchase price, sale price, profit/loss',
  'Chi phí từng gói bảo hành': 'The cost of each warranty plan',
  'Ghi chú của thiết bị và ghi chú của gói bảo hành':
    'Device notes and warranty-plan notes',
  'Ảnh hoá đơn và mọi file đính kèm': 'Receipt photos and every attachment',
  'Các thiết bị khác trong tài khoản của bạn': 'The other devices in your account',
  'Phiếu do máy chủ API dựng và mở trong tab mới — không cần đăng nhập. Đây cũng là thứ người nhận sẽ thấy, nên hãy mở xem trước khi gửi.':
    'The certificate is built by the API server and opens in a new tab — no sign-in needed. It is also exactly what the recipient will see, so open it before sending.',
});
