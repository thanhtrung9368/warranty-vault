// Subscriptions: list, detail, create/edit, billing, the audit panel.
//
// The keys are the Vietnamese originals (see `../types.ts`). English that also
// exists in the API's own catalog (`api/internal/i18n/catalog.go`) is copied
// verbatim from there rather than re-phrased, so a screen and a server message
// cannot disagree about what a sentence says; where the API is silent the
// wording follows the app's other catalogs (`messages/devices.ts`,
// `messages/wishlist.ts`) so one Vietnamese sentence keeps one English.
//
// Generic verbs and shared vocabulary (Lưu / Huỷ / Xoá / Sửa / Tất cả / Ghi chú
// / Trạng thái / Sắp xếp / Cơ bản / Xác nhận …) deliberately live in `common.ts`
// and the other domain files; they are used from here but NOT redefined — two
// files defining one sentence with different English is a catalog-test failure.

import { defineMessages } from '../types';

export const subscriptions = defineMessages({
  // ── Enum labels (`lib/subscription-types.ts`, via `lib/i18n/labels.ts`) ──
  // The maps themselves stay Vietnamese: they are the source text AND the keys
  // looked up here.
  'Hàng tháng': 'Monthly',
  'Hàng quý': 'Quarterly',
  'Hàng năm': 'Yearly',
  'Lifetime / Trọn đời': 'Lifetime',
  'Tuỳ chỉnh': 'Custom',
  'Đang hoạt động': 'Active',
  'Tạm dừng': 'Paused',
  'Đã huỷ': 'Cancelled',
  'Hết hạn': 'Expired',
  // The quick-flip pills on the detail page use the shorter "Đang dùng" for the
  // same status; it is the device-status sentence too, so it keeps the API's
  // wording ("In use", as in devices.ts).
  'Đang dùng': 'In use',
  'Hoạt động': 'Active',

  // ── List page (`app/(app)/subscriptions/page.tsx`) ──────────────────────
  'Gói định kỳ': 'Recurring plans',
  // One key, not three: the original renders "Hiển thị N gói", an optional
  // " (đã lọc)" and a following sentence as adjacent JSX nodes. Interpolating
  // the suffix keeps the spacing and the full stop identical in both languages.
  'Hiển thị {count} gói{filtered}. Theo dõi chi phí định kỳ — biết tiền chảy đi đâu mỗi tháng.':
    {
      en: 'Showing {count} plans{filtered}. Track your recurring costs — know where the money goes each month.',
      enOne:
        'Showing {count} plan{filtered}. Track your recurring costs — know where the money goes each month.',
    },
  '~ {amount} / năm': '~ {amount} / year',
  'gói đang chạy': 'active plans',
  'Chưa có gói nào sắp charge': 'No plan is about to be charged yet',
  'Lỗi tải danh sách: {message}': 'Could not load the list: {message}',
  // Renewal badge on a card / upcoming row (`renewalLabel`).
  'Quá hạn {days} ngày': { en: '{days} days overdue', enOne: '{days} day overdue' },
  'Hôm nay': 'Today',
  'Giá / chu kỳ': 'Price / cycle',
  '~ / tháng': '~ / month',
  'Gia hạn': 'Renews',
  'Chưa có gói đăng ký nào': 'No subscriptions yet',
  'Note lại các gói phần mềm/dịch vụ — Apple One, ChatGPT, Spotify, hosting...':
    'Jot down your software and service plans — Apple One, ChatGPT, Spotify, hosting...',
  'Thêm gói đầu tiên': 'Add your first subscription',

  // ── Detail page (`app/(app)/subscriptions/[id]/page.tsx`) ───────────────
  'Lỗi tải gói: {message}': 'Could not load the subscription: {message}',
  // The overdue banner bolds the number, so the sentence is split in two around
  // it — the same shape `wishlist.ts` uses for "Quay lại chi tiết".
  'Đã quá hạn': 'Overdue by',
  'ngày — cron sẽ tự log payment kỳ này.':
    {
      en: 'days — the cron job logs this billing period automatically.',
      enOne: 'day — the cron job logs this billing period automatically.',
    },
  'Quy đổi / tháng': 'Monthly equivalent',
  'Gia hạn tới': 'Renews on',
  'Quá {days} ngày': { en: '{days} days past', enOne: '{days} day past' },
  'Đã chi tổng': 'Total spent',
  'qua {count} kỳ': { en: 'over {count} renewals', enOne: 'over {count} renewal' },
  'Lịch sử thanh toán': 'Payment history',
  'Liên kết': 'Links',
  'Quản lý gói': 'Manage subscription',
  'Huỷ gói': 'Cancel subscription',
  'Tự gia hạn': 'Auto-renews',
  '✓ Bật': '✓ On',
  '— Tắt': '— Off',
  'Bắt đầu từ': 'Started on',

  // ── Create / edit pages (`subscriptions/new`, `[id]/edit`) ──────────────
  'Thêm gói đăng ký': 'Add a subscription',

  // ── Form (`components/subscription-form.tsx`) ───────────────────────────
  // The first six are the field labels in `FIELD_META`, which stays a table of
  // Vietnamese keys — the toast copy translates them at the call site.
  'Số ngày': 'Days',
  'Ngày gia hạn': 'Renewal date',
  'Link quản lý': 'Manage link',
  'Link huỷ': 'Cancel link',
  'Chu kỳ & giá': 'Cycle & price',
  'Plan / Gói': 'Plan / Package',
  'Số ngày (chỉ khi Tuỳ chỉnh)': 'Days (only for Custom)',
  'Ngày gia hạn / charge tiếp theo': 'Renewal / next charge date',
  'Hãng / Nhà cung cấp': 'Brand / Provider',
  'Giá / chu kỳ (VND)': 'Price / cycle (VND)',
  'Tự tính từ Ngày bắt đầu + Chu kỳ. Sửa nếu billing date của mày khác.':
    'Calculated from the start date + billing cycle. Change it if your billing date is different.',
  'Phương thức thanh toán': 'Payment method',
  'Link quản lý gói': 'Manage link',
  'Link huỷ gói': 'Cancel link',
  'Lưu ý billing, mã coupon, người dùng chung gia đình...':
    'Billing notes, coupon codes, family members sharing it...',
  'Có — sẽ tự log payment + nhắc trước':
    'Yes — it logs a payment and reminds you beforehand',
  'Không — chỉ nhắc, không tự gia hạn': 'No — reminder only, no auto-renewal',
  'vd: Apple One Family, ChatGPT Plus': 'e.g. Apple One Family, ChatGPT Plus',
  'vd: Family, Pro, 200GB, Team-5 seats': 'e.g. Family, Pro, 200GB, Team-5 seats',
  'vd: 14, 90': 'e.g. 14, 90',
  'vd: thanhtrung@...': 'e.g. thanhtrung@...',
  'vd: Visa **4242, Apple ID, Momo': 'e.g. Visa **4242, Apple ID, Momo',
  'https://... (1-click cancel nếu có)': 'https://... (1-click cancel if available)',
  // Composed rather than spliced: " (3 ngày)" is appended to the cycle label.
  '({days} ngày)': { en: '({days} days)', enOne: '({days} day)' },
  'Bắt đầu {date}': 'Starts {date}',
  'Gia hạn tới {date}': 'Renews {date}',
  // NOTE: the form's cancel link is spelled "Hủy" (not `common`'s "Huỷ"). That
  // key is already registered — with the same English ("Cancel") — by
  // `warranties.ts`, so it is reused rather than duplicated here.

  // ── Actions (`components/subscription-actions.tsx`) ─────────────────────
  'Log một lần thanh toán': 'Log one payment',
  'Số tiền (VND)': 'Amount (VND)',
  'Ngày thanh toán': 'Payment date',
  'vd: tăng giá, khuyến mãi...': 'e.g. price rise, promotion...',
  'Đã log payment': 'Payment logged',
  'Không gia hạn được': 'Could not renew',
  'Đã gia hạn': 'Renewed',
  'Đánh dấu đã gia hạn 1 chu kỳ? Sẽ log payment + bump ngày tới.':
    'Mark it renewed for one cycle? This logs a payment and moves the next date forward.',
  'Xoá gói này? Lịch sử thanh toán cũng sẽ mất.':
    'Delete this subscription? Its payment history goes with it.',

  // ── Filter bar (`components/subscription-filter-bar.tsx`) ───────────────
  'Tìm tên, hãng, plan...': 'Search name, brand, plan...',
  'Đang dùng + tạm dừng': 'In use + paused',
  'Tất cả chu kỳ': 'All cycles',
  'Sắp gia hạn trước': 'Renewing first',
  'Lâu gia hạn nhất': 'Renewing last',
  'Tốn nhiều/tháng nhất': 'Most expensive per month',
  'Ít nhất/tháng': 'Cheapest per month',
  'Giá/cycle cao': 'Highest price / cycle',

  // ── Audit panel (`components/subscription-audit-panel.tsx` +
  //    `lib/subscription-audit.ts`) ────────────────────────────────────────
  'Soát gói đăng ký': 'Subscription audit',
  'Không tải được phần soát gói đăng ký — thử tải lại trang nhé. Danh sách gói bên dưới vẫn là dữ liệu thật.':
    'Could not load the subscription audit — try reloading the page. The list of subscriptions below is still real data.',
  'Chỉ tư vấn — không tự sửa hay huỷ gì': 'Advisory only — nothing is changed or cancelled',
  '{total} phát hiện': { en: '{total} findings', enOne: '{total} finding' },
  'Không có phát hiện nào': 'No findings',
  'Soát từ lịch sử thanh toán bạn đã ghi, tính tới {date}.':
    'Checked against the payment history you recorded, as of {date}.',
  'Không có phát hiện nào từ dữ liệu bạn đã ghi. Các luật bên dưới vẫn được chạy lại mỗi lần bạn mở trang này.':
    'Nothing surfaced from the data you recorded. The rules below still run again every time you open this page.',
  'Luật đang áp dụng': 'Rules in force',
  // Finding tag + threshold copy (`lib/subscription-audit.ts`).
  'Mức tăng nhỏ': 'Minor increase',
  'Đáng chú ý': 'Notable',
  'Trùng tên': 'Same name',
  'Cùng hãng, cùng loại': 'Same brand and category',
  'Có thể trùng nhau': 'Possible duplicate',
  'Chỉ tư vấn': 'Advisory only',
  '{count} lần': { en: '{count} times', enOne: '{count} time' },
  ' (bỏ dấu, không phân biệt hoa/thường)': ' (accents ignored, case-insensitive)',
  'Gói tự trừ tiền: chỉ gắn cờ gói đang hoạt động, có bật tự gia hạn và không phải gói trọn đời, khi đã tự trừ ít nhất {charges}, khoản tự trừ đầu tiên cách đây ít nhất {months}, và bạn chưa từng tự ghi khoản thanh toán nào cho gói đó.':
    'Auto-charging subscriptions: only an active, auto-renewing, non-lifetime plan is flagged, once it has charged at least {charges}, the first charge was at least {months} ago, and you have never logged a payment of your own for it.',
  'Tăng giá: báo mọi mức tăng giữa hai kỳ thanh toán liền kề; từ {percent}% trở lên mới được coi là đáng chú ý.':
    'Price rises: every increase between two consecutive billing periods is reported; {percent}% or more counts as notable.',
  'Trùng nhau: hai gói đang hoạt động trùng tên{normalized} hoặc cùng hãng và cùng loại.':
    'Duplicates: two active subscriptions share a name{normalized}, or share a brand and category.',
  'Cửa sổ còn hành động được trước khi bị trừ tiền: {days} ngày.':
    {
      en: 'Window left to act before the charge: {days} days.',
      enOne: 'Window left to act before the charge: {days} day.',
    },
  // Money/date metrics on a finding row. `title` / `detail` / `note` come from
  // the API already translated, so nothing here re-states them.
  'Máy đã tự trừ:': 'Charged automatically:',
  'Khoản ghi nhận mới nhất:': 'Latest recorded payment:',
  '(ngày ghi nhận thanh toán — không phải ngày dùng cuối)':
    '(the date a payment was recorded — not the date of last use)',
  'Lần trừ tới:': 'Next charge:',
  '{date} · còn {days} ngày': { en: '{date} · {days} days left', enOne: '{date} · {days} day left' },
  '{amount}/tháng': '{amount}/month',
  'Giá:': 'Price:',
  'Tăng:': 'Increase:',
  'Kỳ ghi nhận:': 'Recorded period:',
  'Cộng lại:': 'Combined:',
});
