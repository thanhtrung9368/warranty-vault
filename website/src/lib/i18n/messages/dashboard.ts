// Dashboard, stats, the spending forecast, the action queue and the charts.
//
// One file for four screens that read as one story: the dashboard is the
// overview, `/stats` is the same money in detail, the forecast panel is its
// forward-looking half, and `/actions` is the "what needs deciding" list drawn
// from the same data. Keeping their vocabulary in one file is what stops "Tổng
// chi" being translated as "Total spend" on one screen and "Spend total" on the
// next.
//
// Where a sentence also exists in the API's own catalog
// (`api/internal/i18n/catalog.go`), its English is copied verbatim rather than
// re-invented — the API's `note` strings are rendered next to web copy, and two
// phrasings for one idea read as a bug.

import { defineMessages } from '../types';

export const dashboard = defineMessages({
  // ── Dashboard hero + stat cards ─────────────────────────────────────────
  'Chào': 'Hi',
  'Đây là tổng quan tình trạng bảo hành & chi phí của bạn hôm nay.':
    'Here is your warranty status and spending at a glance today.',
  'Tổng thiết bị': 'Total devices',
  'Đang theo dõi': 'Being tracked',
  'Còn bảo hành': 'Under warranty',
  'Còn được bảo vệ': 'Still covered',
  'Sắp hết (≤30 ngày)': 'Expiring soon (≤30 days)',
  'Cần để ý nha': 'Worth a look',
  'Đã hết bảo hành': 'Out of warranty',
  // The device-status label of the same Vietnamese sentence ("Đã bán" /
  // "Đang dùng" style); here it is the dashboard card's sub-line.
  'Hết kèo rồi': 'Cover has ended',
  'Sắp hết bảo hành': 'Warranty expiring soon',
  'Tất cả đều ngon, không có gì sắp hết trong 30 ngày tới đâu.':
    'All good — nothing is expiring in the next 30 days.',
  'Thêm nhanh': 'Quick add',
  'Mới mua đồ? Note ngay vào kẻo lại quên.':
    'Bought something? Note it down before you forget.',
  'Chưa có thiết bị nào, bắt đầu nào': 'No devices yet — let’s start',
  'Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... để theo dõi bảo hành tự động.':
    'Add your first device — a laptop, a phone, a washing machine… — and warranty tracking runs itself.',

  // ── Dashboard subscription / wishlist cards ─────────────────────────────
  'Mỗi tháng': 'Per month',
  '~ {amount} / năm • {count} gói đang hoạt động':
    { en: '~ {amount} / year • {count} active plans', enOne: '~ {amount} / year • {count} active plan' },
  'Sắp gia hạn': 'Renewing soon',
  'Không có gói nào sắp charge': 'No plan is about to be charged',
  'Đang thèm': 'Wishlist',
  'Tổng tiền (giá hiện tại)': 'Total (current prices)',
  '{count} món đang theo dõi': { en: '{count} items tracked', enOne: '{count} item tracked' },
  'Sắp tới ngày mua': 'Purchase date approaching',
  'Chưa có món nào đặt ngày dự kiến': 'No item has a target date yet',

  // ── Stats — header + empty states ───────────────────────────────────────
  'Tổng quan': 'Overview',
  'Chưa có gì để thống kê đâu — thêm thiết bị xong quay lại nhé.':
    'There is nothing to chart yet — add a device and come back.',
  'Chưa có dữ liệu để thống kê': 'No data to chart yet',
  'Thêm thiết bị xong tao sẽ vẽ chart cho mày xem chi tiêu mỗi tháng.':
    'Add a device and this page will chart your monthly spending.',
  'Tổng quan chi phí mua sắm (thiết bị + gói bảo hành) và giá trị tài sản còn bảo hành.':
    'An overview of purchase spending (devices + warranty plans) and the value still under warranty.',
  'Không tải được gói bảo hành của một vài thiết bị — các con số bên dưới có thể thiếu.':
    'Some devices’ warranty plans could not be loaded — the figures below may be incomplete.',
  'Chưa có thiết bị nào': 'No devices yet',
  'Phí định kỳ bên trên vẫn được tính từ các gói đăng ký. Thêm thiết bị để thấy chi tiêu mua sắm ở đây.':
    'The recurring fees above are still counted from your subscriptions. Add a device to see purchase spending here.',

  // ── Stats — KPI row ─────────────────────────────────────────────────────
  'Tổng chi {year}': 'Total spend {year}',
  '{devices} thiết bị • {warranties} gói bảo hành':
    '{devices} devices • {warranties} warranty plans',
  'Tổng chi mua sắm': 'Total purchase spend',
  'Tài sản còn bảo hành': 'Assets still under warranty',
  '{count}/{total} thiết bị': '{count}/{total} devices',
  'Phí định kỳ mỗi tháng': 'Recurring fees per month',
  '{count} gói đang hoạt động • ~{amount}/năm':
    { en: '{count} active plans • ~{amount}/year', enOne: '{count} active plan • ~{amount}/year' },
  'Không tải được số liệu đăng ký': 'Could not load subscription figures',

  // ── Stats — charts ──────────────────────────────────────────────────────
  'Chi phí 12 tháng gần nhất': 'Spending over the last 12 months',
  'Gồm tiền thiết bị và gói bảo hành (tính theo ngày bắt đầu của gói).':
    'Includes device money and warranty plans (attributed to each plan’s start date).',
  'Phân bổ theo loại': 'Breakdown by category',
  'Gói bảo hành được tính vào loại của thiết bị mà nó bảo vệ.':
    'A warranty plan is counted under the category of the device it protects.',
  'Chưa có dữ liệu chi phí.': 'No spending data yet.',
  '{amount} ({count} món)': { en: '{amount} ({count} items)', enOne: '{amount} ({count} item)' },
  'Chi phí': 'Spending',

  // ── Stats — year breakdown + Top 5 ──────────────────────────────────────
  'Tổng chi theo năm': 'Spending by year',
  '({devices} thiết bị • {warranties} gói trong {year})':
    '({devices} devices • {warranties} warranty plans in {year})',
  'Chưa có chi phí nào trong năm {year}.': 'No spending recorded in {year}.',
  'Top 5 thiết bị đắt nhất': 'Top 5 most expensive devices',
  'Xếp theo giá mua thiết bị (chưa gồm gói bảo hành).':
    'Ranked by device purchase price (warranty plans not included).',
  'Chưa có dữ liệu.': 'No data yet.',

  // ── Stats — cost per day (đ/ngày) ───────────────────────────────────────
  'Chi phí mỗi ngày': 'Cost per day',
  '(giá mua + gói bảo hành − tiền bán) ÷ số ngày sở hữu. Máy đắt mà dùng lâu có thể rẻ mỗi ngày hơn máy rẻ mà dùng ngắn.':
    '(purchase price + warranty plans − sale proceeds) ÷ days owned. An expensive machine used for a long time can cost less per day than a cheap one used briefly.',
  'Rẻ nhất mỗi ngày': 'Cheapest per day',
  'Đắt nhất mỗi ngày': 'Most expensive per day',
  'Chưa đủ dữ liệu — cần ngày mua và giá mua.':
    'Not enough data — a purchase date and a purchase price are needed.',
  '{days} ngày': { en: '{days} days', enOne: '{days} day' },
  '(đã bán)': '(sold)',
  'tổng {amount}': 'total {amount}',
  '“≥” = còn gói bảo hành chưa ghi giá, con số thực có thể cao hơn.':
    '“≥” means at least one warranty plan has no recorded price, so the real figure may be higher.',
  'Không xếp hạng:': 'Not ranked:',
  '{count} thiết bị thiếu ngày mua':
    { en: '{count} devices with no purchase date', enOne: '{count} device with no purchase date' },
  '{count} thiết bị chưa ghi giá':
    { en: '{count} devices with no recorded price', enOne: '{count} device with no recorded price' },
  'Không tải được dự báo chi tiêu — phần dự báo tạm ẩn, thử tải lại trang nhé.':
    'Could not load the spending forecast — that section is hidden for now, try reloading the page.',

  // ── Forecast panel ──────────────────────────────────────────────────────
  'Dự báo chi tiêu': 'Spending forecast',
  '{months} tháng tới': 'Next {months} months',
  'chỉ tính các gói đăng ký đang hoạt động.':
    'only active subscriptions are counted.',
  'Sẽ bị trừ tự động': 'Charged automatically',
  'Các gói bật tự động gia hạn': 'Plans with auto-renew on',
  'Bạn phải tự gia hạn': 'You must renew yourself',
  'Không tự trừ — bạn quyết định': 'Not charged automatically — your call',
  'Tổng kỳ gia hạn {months} tháng': 'Total for the {months}-month renewal period',
  'Không có kỳ gia hạn nào': 'No renewal in this window',
  'Trung bình mỗi tháng': 'Average per month',
  'Đúng bằng “Phí định kỳ mỗi tháng” ở trên':
    'Exactly the “Recurring fees per month” figure above',
  'Kỳ gia hạn theo từng tháng. Cột xếp chồng: phần dưới là tiền sẽ tự động bị trừ, phần trên là gói bạn phải tự gia hạn. Biểu đồ chỉ gồm khoản đăng ký.':
    'Renewals month by month. The stacked bar: the lower part is money charged automatically, the upper part is plans you renew yourself. The chart covers subscriptions only.',
  'Tự động trừ': 'Charged automatically',
  'Có thể phát sinh trong {months} tháng tới — tham khảo, không phải khoản chắc chắn trả và không cộng vào tổng ở trên':
    'May come up in the next {months} months — for reference only, not a certain charge, and not added to the totals above',
  'Bảo hành hết hạn: {amount}': 'Warranty expiring: {amount}',
  '{packages} • giá gói cũ, để tham khảo khi để dành tiền mua gói mới':
    '{packages} • the old plan’s price, as a reference when saving up for a new one',
  'Không có gói bảo hành nào hết hạn trong cửa sổ này':
    'No warranty plan expires in this window',
  'Wishlist tới mốc: {amount}': 'Wishlist milestone: {amount}',
  '{packages} • giá ghi nhận gần nhất, chưa chắc mua':
    '{packages} • the last recorded price, not a certain purchase',
  'Không có mốc wishlist nào trong cửa sổ này':
    'No wishlist milestone falls in this window',
  'Từng tháng': 'Month by month',
  'Tháng đánh dấu “một phần” chỉ tính các khoản rơi trong cửa sổ dự báo (tháng này tính từ hôm nay; tháng cuối tính tới hết cửa sổ). Tháng không có gì vẫn được liệt kê.':
    'A month marked “partial” counts only what falls inside the forecast window (this month counts from today; the last month counts up to the end of the window). Months with nothing in them are still listed.',
  'Không có tháng nào trong cửa sổ này.': 'No months in this window.',
  'tháng này · một phần': 'this month · partial',
  'tháng cuối · một phần': 'last month · partial',
  'Tự động trừ {amount} • Phải tự gia hạn {amountSelf}':
    'Charged automatically {amount} • Renew yourself {amountSelf}',
  'Có thể phát sinh:': 'May come up:',
  'bảo hành hết hạn {amount} ({packages})':
    'warranty expiring {amount} ({packages})',
  'wishlist {amount} ({packages})': 'wishlist {amount} ({packages})',
  'Bảo hành sắp hết hạn': 'Warranties expiring soon',
  'Giá gói bên dưới là giá của gói đang hết hạn — chỉ để tham khảo khi để dành tiền, không phải khoản sẽ bị trừ.':
    'The price below is the price of the plan that is expiring — a reference for saving up, not a charge.',
  'Không có gói bảo hành nào hết hạn trong cửa sổ này.':
    'No warranty plan expires in this window.',
  'Gói {type}': 'Plan {type}',
  '{months} tháng': { en: '{months} months', enOne: '{months} month' },
  'Giá gói cũ (tham khảo): {amount}': 'Old plan price (reference): {amount}',
  'Chưa ghi giá gói cũ': 'No recorded price for the old plan',
  'Wishlist tới mốc': 'Wishlist milestones',
  'Giá bên dưới là giá ghi nhận gần nhất, chưa chắc bạn sẽ mua — không phải khoản sẽ bị trừ.':
    'The price below is the last recorded one and you may not buy it — it is not a charge.',
  'Không có mốc wishlist nào trong cửa sổ này.':
    'No wishlist milestone in this window.',
  'Giá ghi nhận gần nhất: {amount}': 'Last recorded price: {amount}',
  'Chưa từng nhập giá': 'No price ever recorded',

  // ── Count/unit words shared by the rollups and the panel ────────────────
  'Không có kỳ nào': 'No renewals',
  // The forecast panel's per-month empty state. Same sense as the key above,
  // phrased as the sentence the panel actually renders.
  'Không có kỳ gia hạn nào.': 'No renewals.',
  '{count} kỳ gia hạn': { en: '{count} renewals', enOne: '{count} renewal' },
  '{count} gói': { en: '{count} plans', enOne: '{count} plan' },
  '{count} món': { en: '{count} items', enOne: '{count} item' },
  '{count} kỳ': { en: '{count} renewals', enOne: '{count} renewal' },

  // ── Month labels (`lib/forecast-rollup.ts`) ─────────────────────────────
  // The key is the Vietnamese source pattern, not a sentence anybody typed:
  // `bucketMonthLabel` built this string with a template literal before it was
  // converted, exactly like `t('Còn {days} ngày', { days })`.
  'Tháng {month}/{year}': 'Month {month}/{year}',

  // ── Charts (`components/charts/*`) ──────────────────────────────────────
  'Đang tải biểu đồ…': 'Loading chart…',
  'Giá': 'Price',
  'Chưa có dữ liệu giá. Cập nhật giá hiện tại để bắt đầu theo dõi.':
    'No price data yet. Update the current price to start tracking.',

  // ── Action queue (`lib/action-queue.ts` + /actions) ─────────────────────
  'Thiết bị': 'Devices',
  'Gói đăng ký': 'Subscriptions',
  'Món đang thèm': 'Wishlist item',
  'Khoảng dự báo': 'Forecast window',
  'Ưu tiên cao': 'High priority',
  'Ưu tiên vừa': 'Medium priority',
  'Ưu tiên thấp': 'Low priority',
  'Mốc thời gian hoặc tiền sắp mất': 'A deadline or money about to be lost',
  'Nên xem lại': 'Worth reviewing',
  'Chưa gấp': 'Not urgent',
  'hôm nay': 'today',
  'ngày mai': 'tomorrow',
  // `lib/format.ts::formatRelativeDay` — the shared relative-time helper used
  // by every screen. Registered here because this file already owned the two
  // unparameterised forms above and the wording has to agree with them.
  'hôm qua': 'yesterday',
  '{days} ngày trước': { en: '{days} days ago', enOne: '{days} day ago' },
  'trong {days} ngày': { en: 'in {days} days', enOne: 'in {days} day' },
  '{weeks} tuần trước': { en: '{weeks} weeks ago', enOne: '{weeks} week ago' },
  'trong {weeks} tuần': { en: 'in {weeks} weeks', enOne: 'in {weeks} week' },
  '{months} tháng trước': { en: '{months} months ago', enOne: '{months} month ago' },
  'trong {months} tháng': { en: 'in {months} months', enOne: 'in {months} month' },
  '{years} năm trước': { en: '{years} years ago', enOne: '{years} year ago' },
  'trong {years} năm': { en: 'in {years} years', enOne: 'in {years} year' },
  'còn {days} ngày': { en: '{days} days left', enOne: '{days} day left' },
  'đã qua {days} ngày': { en: '{days} days ago', enOne: '{days} day ago' },
  'Hiện lại sau {days} ngày': { en: 'Comes back in {days} days', enOne: 'Comes back in {days} day' },
  'Hiện lại ngày mai': 'Comes back tomorrow',
  'Hiện lại hôm nay': 'Comes back today',
  'Đã tới hạn hiện lại': 'The snooze has expired',
  '1 tuần': '1 week',
  '1 tháng': '1 month',
  '3 tháng (mặc định)': '3 months (default)',
  '6 tháng': '6 months',
  '1 năm': '1 year',
  'Hàng đợi': 'Queue',
  'Việc cần xử lý': 'Action items',
  'Những việc app tự suy ra từ dữ liệu bạn đã nhập và không tự quyết được. Hoãn một việc sẽ ẩn nó khỏi hàng đợi tới hạn bạn chọn — việc đang hoãn luôn xem lại và bỏ hoãn được ở mục “Đang hoãn” bên dưới.':
    'Things the app infers from the data you entered and cannot decide on its own. Snoozing an item hides it from the queue until the deadline you choose — snoozed items can always be reviewed and un-snoozed under “Snoozed” below.',
  'Lỗi tải hàng đợi: {message}': 'Could not load the queue: {message}',
  'Đang cần xử lý': 'Needs attention',
  'Không tính việc đang hoãn': 'Snoozed items are not counted',
  'Hàng đợi tính tới {date}.': 'The queue is calculated as of {date}.',
  'Không có việc nào đang chờ': 'Nothing is waiting',
  'Từ dữ liệu bạn đã nhập, app chưa suy ra được việc nào cần bạn quyết. Việc mới sẽ xuất hiện ở đây khi dữ liệu đổi.':
    'From the data you entered, the app has not inferred anything that needs your decision. New items appear here when the data changes.',
  'Đang hoãn': 'Snoozed',
  'Không tải được danh sách việc đang hoãn — thử tải lại trang nhé.':
    'Could not load the snoozed list — try reloading the page.',
  'Chưa hoãn việc nào. Việc nào bạn bấm “Hoãn” sẽ nằm ở đây để bỏ hoãn.':
    'Nothing is snoozed yet. Anything you snooze lands here so you can un-snooze it.',
  'Xem {entity}': 'View {entity}',
  'Hoãn': 'Snooze',
  'Bỏ hoãn': 'Un-snooze',
  'Hoãn việc này trong': 'Snooze this item for',
  'Đã hoãn tới {date}': 'Snoozed until {date}',
  'Đã hoãn việc này': 'This item is snoozed',
  'Đã bỏ hoãn': 'Un-snoozed',

  // ── Action-queue server action copy (`app/actions/actions.ts`) ──────────
  'Thiếu mã việc cần xử lý': 'Missing action item id',
  'Số ngày hoãn phải trong khoảng 1–365':
    'The snooze length must be between 1 and 365 days',
  'Không hoãn được việc này, thử lại sau nhé.':
    'Could not snooze this item, please try again later.',
  'Đã hoãn {days} ngày': { en: 'Snoozed for {days} days', enOne: 'Snoozed for {days} day' },
  'Không bỏ hoãn được việc này, thử lại sau nhé.':
    'Could not un-snooze this item, please try again later.',
  'Đã đưa việc này trở lại hàng đợi': 'This item is back in the queue',
});
