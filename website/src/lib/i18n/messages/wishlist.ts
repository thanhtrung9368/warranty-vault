// The wishlist ("thèm") list, detail, forms and filters.
//
// Also carries the copy for the three small shared widgets that had hardcoded
// Vietnamese of their own — the year picker, the forecast-window picker and the
// combobox's own placeholder/empty defaults. They belong here rather than in
// `common.ts` because `common` is the *shared vocabulary* file (nav, generic
// verbs, the language switcher, transport fallbacks) and these are three
// concrete widgets with one screen each; keeping them next to the wishlist copy
// that instantiates them is the smaller surprise.
//
// Table names (`WISHLIST_PRIORITY_LABELS`, `WISHLIST_STATUS_LABELS` in
// `lib/wishlist-types.ts`) are deliberately NOT here: those maps stay
// Vietnamese because they are the source text, and the keys below are what
// `lib/i18n/labels.ts` looks them up by.

import { defineMessages } from '../types';

export const wishlist = defineMessages({
  // ── Priority / status values (`lib/wishlist-types.ts` maps) ─────────────
  // These are the ~seven labels the maps in `lib/wishlist-types.ts` carry. They
  // are looked up through `wishlistPriorityLabel` / `wishlistStatusLabel`
  // (`lib/i18n/labels.ts`) everywhere the raw map used to be indexed.
  'Phải mua': 'Must buy',
  'Muốn': 'Want',
  'Cân nhắc': 'Considering',
  // 'Đang theo dõi' is the WATCHING status AND the dashboard's "being tracked"
  // card sub-line; 'dashboard.ts' registers it, so this file must agree.
  'Đang theo dõi': 'Being tracked',
  'Quyết mua': 'Decided',
  // 'Bỏ qua' is the SKIPPED status (and the paste-import "row skipped" badge).
  // `devices.ts` registers it as 'Skipped', which this file matches; `common.ts`
  // currently registers the same key as 'Skip' for a dismissal button, and that
  // disagreement is a test failure in `common.ts` I do not own — see the report.
  'Bỏ qua': 'Skipped',
  // 'Đã mua' is the PURCHASED status (filter pill, form <Select>, detail badge).
  'Đã mua': 'Purchased',

  // ── Small shared widgets ────────────────────────────────────────────────
  'Chọn năm': 'Choose a year',
  'Khoảng dự báo': 'Forecast window',
  // Composed rather than wrapped in place: the component is a Server Component
  // that already has `t`, so `{m} tháng` needs the placeholder form.
  '{months} tháng': { en: '{months} months', enOne: '{months} month' },

  // ── List page (`app/(app)/wishlist/page.tsx`) ───────────────────────────
  // Same sentence as the sidebar item for `/wishlist` and the dashboard section
  // heading, so it follows `dashboard.ts`'s English rather than introducing a
  // third name for one screen.
  'Đang thèm': 'Wishlist',
  // One key, not three: the original renders "Hiển thị N món", an optional
  // " (đã lọc)" and a following sentence as adjacent JSX nodes. Interpolating
  // the suffix keeps the spacing and the full stop identical in both languages
  // (a three-key split would drop a trailing space before "." in English).
  'Hiển thị {count} món{filtered}. Note lại đồ mày đang để mắt — đợi sale là nhào vô.':
    {
      en: 'Showing {count} items{filtered}. Jot down what you are keeping an eye on — wait for a sale, then pounce.',
      enOne:
        'Showing {count} item{filtered}. Jot down what you are keeping an eye on — wait for a sale, then pounce.',
    },
  ' (đã lọc)': ' (filtered)',
  'Thêm món': 'Add an item',
  'món trong list': { en: 'items in the list', enOne: 'item in the list' },
  'Tổng tiền': 'Total',
  'theo giá hiện tại': 'at the current price',
  'Sắp tới': 'Coming up',
  'Chưa đặt ngày dự kiến': 'No target date set',
  // 'Không có gì khớp bộ lọc' and 'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.'
  // are LIST-page sentences that `devices.ts` also registers — the two screens
  // show the same Vietnamese sentence and its English was worded differently
  // ("Nothing matches the filter" / "…clear the search box"), which
  // `messages/index.ts` treats as a hard conflict. This file adopts the sibling
  // wording rather than opening a second one for the same sentence.
  'Không có gì khớp bộ lọc': 'Nothing matches the filter',
  'Wishlist trống — thêm cái mày thèm đi': 'Your wishlist is empty — add something you want',
  'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.':
    'Try loosening the filter, or clear the search box.',
  'Note lại những món mày đang để mắt — giá, link, deadline...':
    'Jot down what you are keeping an eye on — price, link, deadline...',
  'Thêm món đầu tiên': 'Add your first item',
  // Composed, not spliced: the page renders "Lỗi tải wishlist: " and the raw
  // error as two adjacent JSX nodes, so the sentence carries a placeholder
  // instead of being glued together at the call site.
  'Lỗi tải wishlist: {message}': 'Could not load the wishlist: {message}',
  // 'Hiện tại' / 'Ban đầu' are the two price columns on the card; the detail
  // page uses the longer 'Giá hiện tại' / 'Giá ban đầu' for the same numbers.
  'Hiện tại': 'Current',
  'Ban đầu': 'Initial',

  // ── Detail page (`app/(app)/wishlist/[id]/page.tsx`) ────────────────────
  'Lỗi tải món: {message}': 'Could not load this wishlist item: {message}',
  'Xem thiết bị': 'View the device',
  'Giá ban đầu': 'Initial price',
  'Giá hiện tại': 'Current price',
  'Cập nhật {when}': 'Updated {when}',
  'Ngày dự kiến': 'Target date',
  'Chưa đặt': 'Not set',
  'Lịch sử giá': 'Price history',
  '{count} điểm': { en: '{count} points', enOne: '{count} point' },
  'Ghi chú': 'Notes',
  'Đổi trạng thái nhanh': 'Quick status change',
  'Mua ở đâu': 'Where to buy',
  'Mở link mua': 'Open the buy link',
  'Thông tin': 'Details',
  'Nhắc lại': 'Remind me again',
  'Mỗi {days} ngày': { en: 'Every {days} days', enOne: 'Every day' },
  'Loại': 'Category',

  // ── New / edit pages ────────────────────────────────────────────────────
  'Thêm mới': 'New',
  'Thêm món đang thèm': 'Add something you want',
  'Note lại sản phẩm đang để ý — giá, link, ngày dự kiến mua, lý do.':
    'Jot down the product you are watching — price, link, target purchase date, why.',
  // The edit page's back link reads "Quay lại chi tiết" as one sentence; it is
  // wrapped as two keys because the original renders it as two nodes. ('Quay
  // lại' itself is `common`'s — not redefined here.)
  'chi tiết': 'the details',
  'Chỉnh sửa': 'Edit',
  'Sửa món thèm': 'Edit a wishlist item',

  // ── Form (`components/wishlist-form.tsx`) ───────────────────────────────
  'Tên sản phẩm': 'Item name',
  'Hãng': 'Brand',
  'Mức độ thèm': 'Priority',
  'Giá ban đầu (VND)': 'Initial price (VND)',
  'Giá hiện tại (VND)': 'Current price (VND)',
  'Link mua': 'Buy link',
  'Link ảnh': 'Image link',
  'Ngày dự kiến mua': 'Target purchase date',
  'Nhắc lại sau (ngày)': 'Remind again after (days)',
  'Cơ bản': 'Basics',
  'Mục tiêu': 'Goal',
  'Xác nhận': 'Confirm',
  'Cân nhắc / 0': 'Skip / 0',
  'khác loại': 'other category',
  'Vui lòng kiểm tra: {fields}': 'Please check: {fields}',
  'Vui lòng nhập: {field}': 'Please fill in: {field}',
  'Chọn loại (tuỳ chọn)': 'Pick a category (optional)',
  'Tìm loại...': 'Search categories...',
  'Tìm hãng...': 'Search brands...',
  'Dùng hãng "{name}"': 'Use the brand "{name}"',
  'Lúc bắt đầu để ý. Để trống nếu chưa biết.':
    'The price when you started watching. Leave it empty if you do not know.',
  'Đổi giá ở đây sẽ tự log vào lịch sử.':
    'Changing the price here is logged to the history automatically.',
  'https://... (tuỳ chọn)': 'https://... (optional)',
  'Có ngày này → sẽ bị nhắc trước 30 / 7 / 0 ngày.':
    'With this date set you get reminders 30 / 7 / 0 days ahead.',
  'Nhắc lại check giá (ngày)': 'Remind me to check the price (days)',
  'Để trống nếu không cần. vd: 30 = mỗi 30 ngày ping check.':
    'Leave it empty if you do not need it. e.g. 30 = ping every 30 days.',
  'Điều kiện mua, lý do thèm, deal cần chờ...':
    'Conditions for buying, why you want it, the deal you are waiting for...',
  'Xác nhận món thèm': 'Confirm this wishlist item',
  ' · Hiện tại {price} ₫': ' · Current {price} ₫',
  ' · Target {date}': ' · Target {date}',
  'Thêm vào wishlist': 'Add to wishlist',

  // ── Actions (`components/wishlist-actions.tsx`) ─────────────────────────
  'Nhập giá hợp lệ': 'Enter a valid price',
  'Không lưu được': 'Could not save',
  'Đã log giá mới': 'New price logged',
  'Cập nhật giá': 'Update price',
  'Cập nhật giá hiện tại': 'Update the current price',
  'Giá mới (VND)': 'New price (VND)',
  'Ghi chú (tuỳ chọn)': 'Notes (optional)',
  'vd: deal Black Friday, ưu đãi student...':
    'e.g. Black Friday deal, student discount...',
  'Không đổi được trạng thái': 'Could not change the status',
  'Khôi phục về theo dõi': 'Put it back to watching',
  'Đổi trạng thái': 'Change status',
  'Đã mua → tạo Device': 'Bought → create a device',
  'Đã đăng ký → tạo Subscription': 'Subscribed → create a subscription',
  'Xoá món này khỏi wishlist? Lịch sử giá cũng sẽ mất.':
    'Remove this item from the wishlist? Its price history goes too.',
  'Không xoá được': 'Could not delete',

  // ── Filter bar (`components/wishlist-filter-bar.tsx`) ───────────────────
  'Tất cả': 'All',
  'Tìm tên, hãng, ghi chú...': 'Search name, brand, notes...',
  'Trạng thái': 'Status',
  'Mức độ': 'Priority',
  'Tất cả mức': 'All priorities',
  'Tất cả loại': 'All categories',
  'Trạng thái chi tiết': 'Detailed status',
  'Đang theo dõi + quyết mua': 'Watching + decided',
  'Tất cả trạng thái': 'All statuses',
  'Sắp xếp': 'Sort',
  'Mức độ thèm cao trước': 'Most wanted first',
  'Target gần nhất trước': 'Nearest target first',
  'Target xa nhất trước': 'Furthest target first',
  'Mới thêm': 'Recently added',
  'Giá cao trước': 'Highest price first',
  'Giá thấp trước': 'Lowest price first',

  // ── Combobox defaults (`components/ui/combobox.tsx`) ────────────────────
  // Only the widget's own copy. Every caller that passes a placeholder passes
  // its own translated sentence, so these show up only where the default is
  // used (`device-form`, the paste-import rows).
  'Tìm kiếm...': 'Search...',
  'Không có kết quả': 'No results',
  'Dùng "{value}"': 'Use "{value}"',
});
