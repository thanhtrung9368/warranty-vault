// Devices: list, detail, create/edit, import, attachments, CSV export.
//
// The keys are the Vietnamese originals (see `../types.ts`). Where the API
// already ships an English sentence for the same concept — every device
// validator message, the status and warranty labels — the English column here
// is copied verbatim from `api/internal/i18n/catalog.go` rather than
// re-phrased, so the screen and the server cannot disagree about what a
// sentence says.
//
// Generic verbs (Lưu / Huỷ / Xoá / Quay lại / Sửa …) deliberately live in
// `common.ts` and are NOT redefined here.

import { defineMessages } from '../types';

export const devices = defineMessages({
  // ── List (`app/(app)/devices/page.tsx`) ─────────────────────────────────
  'Kho thiết bị': 'Device vault',
  'Tổng {count} thiết bị. Bấm vào từng cái để xem chi tiết.':
    { en: '{count} devices in total. Tap one to see its details.', enOne: '{count} device in total. Tap it to see its details.' },
  'Tổng {count} thiết bị (đã lọc). Bấm vào từng cái để xem chi tiết.':
    { en: '{count} devices in total (filtered). Tap one to see its details.', enOne: '{count} device in total (filtered). Tap it to see its details.' },
  'Chi phí mỗi ngày': 'Cost per day',
  'Dán bảng': 'Paste a table',
  'Không có gì khớp bộ lọc': 'Nothing matches the filter',
  'Chưa có thiết bị nào, mày': 'No devices yet',
  'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.':
    'Try loosening the filter, or clear the search box.',
  'Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... gì cũng được.':
    'Add your first device — a laptop, a phone, a washing machine, anything.',
  'Đã có sẵn danh sách trong Excel/Google Sheets?':
    'Already have a list in Excel/Google Sheets?',
  'Dán bảng để nhập nhiều thiết bị một lúc':
    'Paste a table to import many devices at once',
  'Tên': 'Name',
  'Loại': 'Category',
  'Giá': 'Price',
  'Ngày mua': 'Purchase date',
  'Bảo hành': 'Warranty',
  'Trạng thái': 'Status',
  'Không có': 'None',

  // ── Filter bar (`components/devices-filter-bar.tsx`) ────────────────────
  'Tìm theo tên, hãng, model, serial...': 'Search by name, brand, model, serial...',
  'Tất cả trạng thái': 'All statuses',
  'Sắp xếp': 'Sort',
  'Ngày mua mới nhất': 'Newest purchase first',
  'Ngày mua cũ nhất': 'Oldest purchase first',
  'BH sắp hết trước': 'Warranty ending soonest',
  'BH lâu hết trước': 'Warranty ending latest',
  'Giá cao nhất': 'Highest price',
  'Giá thấp nhất': 'Lowest price',
  'Tên A-Z': 'Name A-Z',
  'Xoá lọc': 'Clear filters',
  'Tất cả': 'All',
  'Loại khác': 'Other category',
  'Loại khác…': 'Other category…',

  // ── Create / edit (`devices/new`, `devices/[id]/edit`, `device-form`) ───
  'Thêm vào kho': 'Add to the vault',
  'Thêm thiết bị': 'Add a device',
  'Nhập thông tin thiết bị, bảo hành và mua hàng.':
    'Enter the device, warranty and purchase details.',
  'Quay lại wishlist': 'Back to wishlist',
  'Danh sách thiết bị': 'Device list',
  'Tạo từ wishlist:': 'Created from wishlist:',
  'Cập nhật': 'Update',
  'Sửa thiết bị': 'Edit device',
  'Quay lại chi tiết': 'Back to details',

  // ── Device form — steps + summary ───────────────────────────────────────
  'Bảo hành {value}': 'Warranty {value}',
  'Cơ bản': 'Basics',
  'Tên, hãng, model': 'Name, brand, model',
  'Mua hàng': 'Purchase',
  'Ngày mua, giá, nơi mua': 'Purchase date, price, store',
  'Gói tiêu chuẩn': 'Standard plan',
  'Xác nhận': 'Confirm',
  'Ghi chú & kiểm tra': 'Notes and review',
  'Bước {step}/{total}': 'Step {step}/{total}',
  'Kiểm tra lại': 'Review',
  'Tên thiết bị': 'Device name',
  'Serial / IMEI': 'Serial / IMEI',
  'Loại thiết bị': 'Device category',
  'Số tháng bảo hành': 'Warranty length in months',
  'Ngày bán': 'Sale date',
  'Giá bán': 'Sale price',
  'Vui lòng nhập: {field}': 'Please fill in: {field}',
  'Vui lòng kiểm tra: {fields}': 'Please check: {fields}',
  'Đặt lại': 'Reset',
  'Lưu thiết bị': 'Save device',
  'Hãng': 'Brand',
  'Nơi mua': 'Purchased at',
  'Chọn loại': 'Choose a category',
  'Tìm loại...': 'Search categories...',
  'Tìm hãng...': 'Search brands...',
  'Dùng hãng "{value}"': 'Use brand “{value}”',
  'Không bắt buộc': 'Optional',
  'Tìm cửa hàng...': 'Search stores...',
  'Dùng nơi mua "{value}"': 'Use store “{value}”',
  'Đây là gói bảo hành tiêu chuẩn khi tạo thiết bị. Có thể thêm gói khác (AppleCare+, FPT Care...) sau khi tạo.':
    'This is the standard warranty plan created with the device. You can add other plans (AppleCare+, FPT Care...) after saving.',
  'Ngày hết = ngày mua + số tháng. Để 0 nếu không có.':
    'Expiry date = purchase date + this many months. Leave 0 for none.',
  'Đơn vị bảo hành': 'Warranty provider',
  'Ghi đè SĐT/địa chỉ/ghi chú từ template':
    'Overwrite the phone/address/notes with the template values',
  'Khôi phục từ template': 'Restore from template',
  'Dùng đơn vị "{value}"': 'Use provider “{value}”',
  'Tìm đơn vị bảo hành...': 'Search warranty providers...',
  'SĐT bảo hành': 'Warranty phone number',
  'Địa chỉ trung tâm BH': 'Warranty centre address',
  'Ghi chú bảo hành': 'Warranty notes',
  'Điều kiện, lưu ý khi đi bảo hành...': 'Conditions, things to remember when claiming...',
  'vd: Apple Việt Nam': 'e.g. Apple Vietnam',
  'vd: 123 Nguyễn Trãi, Q.1': 'e.g. 123 Nguyen Trai, District 1',
  'Ghi chú': 'Notes',
  'Ghi chú tự do về thiết bị...': 'Anything you want to note about this device...',
  'khác loại': 'other category',
  'cửa hàng': 'store',

  // ── Device form — resale ────────────────────────────────────────────────
  'Bán lại': 'Resale',
  'Lãi/lỗ so với giá mua': 'Profit/loss against the purchase price',
  '(giá mua {amount})': '(bought for {amount})',
  'Ghi ngày bán và giá bán để tính lãi/lỗ so với giá mua. Bỏ trống nếu chưa bán.':
    'Record the sale date and price to see the profit or loss against the purchase price. Leave it blank if you have not sold it.',
  'Bỏ ghi nhận': 'Remove the record',
  'Ghi nhận đã bán': 'Record as sold',
  'Nhập 0 nếu cho tặng. Cần cả ngày bán và giá bán.':
    'Enter 0 if you gave it away. Both the sale date and the price are required.',
  'so với giá mua {amount}': 'against the purchase price of {amount}',
  'Chưa bán': 'Not sold',
  'Giá mua (VND)': 'Purchase price (VND)',
  'Giá bán (VND)': 'Sale price (VND)',
  'Hãng / Model': 'Brand / Model',
  '{months} tháng': { en: '{months} months', enOne: '{months} month' },
  'Không': 'No',

  // ── Multi-currency devices ──────────────────────────────────────────────
  // `currency` is an ISO-4217 code; `fxRate` is the locked VND-per-unit rate.
  // Money fields carry the device currency in their label so the same form can
  // never present a USD price as đồng.
  'Giá mua ({currency})': 'Purchase price ({currency})',
  'Giá bán ({currency})': 'Sale price ({currency})',
  'Giá gói ({currency})': 'Plan price ({currency})',
  'Tỷ giá (VND cho 1 {currency})': 'Exchange rate (VND per 1 {currency})',
  'Lấy tỷ giá': 'Get rate',
  'Đang lấy tỷ giá…': 'Getting the rate…',
  'Đã lấy tỷ giá': 'Rate fetched',
  'Không lấy được tỷ giá': 'Could not fetch the rate',
  '≈ {amount} khi lưu': '≈ {amount} when saved',
  'Giá, giá bán và chi phí bảo hành của thiết bị này tính bằng {currency}.':
    'The price, sale price and warranty costs of this device are in {currency}.',
  'Tỷ giá có thể đã cũ (lấy lúc {time}) — kiểm tra lại trước khi lưu.':
    'This rate may be out of date (fetched {time}) — check it before saving.',
  'Tỷ giá được khoá tại thời điểm nhập, không đổi theo thị trường.':
    'The rate is locked when you enter it and does not follow the market.',
  'Tỷ giá đã khoá': 'Locked exchange rate',
  '1 {currency} = {rate}': '1 {currency} = {rate}',
  '≈ {amount}': '≈ {amount}',
  'Vui lòng nhập tỷ giá.': 'Please enter an exchange rate.',
  'Tỷ giá phải là số nguyên lớn hơn 0.':
    'The exchange rate must be a whole number greater than 0.',
  'Dịch vụ tỷ giá đang tạm thời không khả dụng — bạn nhập tỷ giá bằng tay nhé.':
    'The exchange-rate service is temporarily unavailable — enter the rate by hand.',
  'Không lấy được tỷ giá — bạn nhập tay bên dưới nhé.':
    'Could not fetch the rate — type it in below.',
  'Không đọc được tỷ giá từ máy chủ — bạn nhập tay bên dưới nhé.':
    'Could not read a rate from the server — type it in below.',
  'Chọn một loại tiền khác VND để lấy tỷ giá.':
    'Choose a currency other than VND to fetch a rate.',
  'Có gói bảo hành bằng ngoại tệ chưa được quy đổi — con số này chưa gồm gói đó.':
    'A warranty plan is priced in a foreign currency and has not been converted — this figure does not include it.',
  'Có {count} gói bảo hành tính bằng ngoại tệ nhưng API chưa trả giá trị VND — các tổng bên dưới chưa gồm những gói đó.':
    {
      en: '{count} warranty plans are priced in a foreign currency but the API does not return a VND value yet — the totals below do not include them.',
      enOne:
        '{count} warranty plan is priced in a foreign currency but the API does not return a VND value yet — the totals below do not include it.',
    },
  'Có {count} thiết bị ngoại tệ thiếu tỷ giá nên chưa quy được giá mua sang VND — các tổng bên dưới chưa gồm giá mua của chúng.':
    {
      en: '{count} foreign-currency devices have no exchange rate, so their purchase price cannot be converted to VND — the totals below do not include them.',
      enOne:
        '{count} foreign-currency device has no exchange rate, so its purchase price cannot be converted to VND — the totals below do not include it.',
    },
  'Thiết bị ngoại tệ này thiếu tỷ giá nên chưa quy được giá mua — con số này chỉ gồm phần đã biết.':
    'This foreign-currency device has no exchange rate, so its purchase price cannot be converted — this figure includes only the known part.',

  // ── Device form — warranty activation & extended cover (Feature A) ─────
  // Three fields inside the existing warranty step, not a step of their own.
  // The activation date may legitimately predate the purchase date, and the
  // hint below says so — the server accepts it, so the client must not "fix" it.
  'Bảo hành & kích hoạt': 'Warranty & activation',
  'Kích hoạt bảo hành': 'Warranty activation required',
  'Bảo hành chỉ bắt đầu sau khi cửa hàng kích hoạt. Máy chưa kích hoạt có thể bị từ chối tiếp nhận.':
    'The warranty only starts once the retailer activates it. An unactivated device can be refused at the counter.',
  'Ngày kích hoạt': 'Activation date',
  'Ngày kích hoạt có thể trước ngày mua — cửa hàng kích hoạt sẵn trước khi giao máy.':
    'The activation date can be before the purchase date — a shop can pre-activate the device before handing it over.',
  'Hạn mua gói mở rộng': 'Extended cover buy-by date',
  'AppleCare+, Samsung Care+... phải mua trước ngày này; quá hạn là không mua được nữa.':
    'AppleCare+, Samsung Care+... must be bought by this date; once it passes, the option is gone.',

  // ── Device form — receipt scan (AI) ─────────────────────────────────────
  'Đang quét hoá đơn…': 'Scanning the receipt…',
  'Quét hoá đơn / phiếu bảo hành': 'Scan a receipt / warranty card',
  'Chụp hoặc chọn ảnh (JPEG/PNG/WEBP) hoặc file PDF hoá đơn để tự điền thông tin — bạn vẫn kiểm tra lại trước khi lưu':
    'Take or choose a photo (JPEG/PNG/WEBP) or a PDF of the receipt to fill the form in — you still check it before saving',
  'Đã điền nháp từ hoá đơn': 'Draft filled in from the receipt',
  ' (độ tin cậy chưa cao — kiểm tra kỹ)': ' (low confidence — check carefully)',
  'Cần xem lại:': 'Needs a look:',
  'Vẫn dùng được, nhưng nên kiểm tra lại': 'Usable, but worth checking again',
  '{title} — vẫn lưu được, xem chi tiết ở khung quét phía trên.':
    '{title} — it is still saved; see the scan panel above for details.',
  'Đã điền nháp từ hoá đơn — kiểm tra lại trước khi lưu nhé':
    'Draft filled in from the receipt — check it before saving',
  'Không quét được hoá đơn, thử lại sau': 'Could not scan the receipt, try again later',
  // The scan uploads the file to the inbox BEFORE calling the AI endpoint (the
  // only branch that persists the OCR transcript). The receipt therefore exists
  // independently of this form, and both the success panel and the failure box
  // must say so — no dead-end "scan failed" that hides a saved file.
  'Hoá đơn đã được lưu trong Hộp thư — bạn có thể gán vào một thiết bị sau. Nội dung đọc được cũng đã được lưu để tìm kiếm.':
    'The receipt is saved in the Inbox — you can file it under a device later. The text we read is saved for search too.',
  'Hoá đơn đã được lưu trong Hộp thư — bạn có thể gán vào một thiết bị sau. Lần này chưa lưu được nội dung đọc để tìm kiếm.':
    'The receipt is saved in the Inbox — you can file it under a device later. This time the text we read could not be saved for search.',
  'Không quét được hoá đơn, nhưng file vẫn được lưu trong Hộp thư — mở Hộp thư để gán vào một thiết bị.':
    'The receipt could not be scanned, but the file is still saved in the Inbox — open the Inbox to file it under a device.',

  // ── Device form — serial / IMEI barcode scan (native BarcodeDetector) ───
  // The feature exists only in Chromium: Safari and Firefox do not ship
  // `BarcodeDetector`, so the button is not rendered there and the field says
  // why. Every message below is reachable only after the client-side feature
  // detect has said yes, except the "not supported" line itself.
  'Quét mã': 'Scan code',
  'Quét serial / IMEI': 'Scan serial / IMEI',
  'Trình duyệt này không hỗ trợ quét mã vạch — nhập serial bằng tay.':
    'This browser does not support barcode scanning — type the serial in by hand.',
  'Dùng camera để đọc mã vạch trên tem máy hoặc hộp. Ảnh không rời khỏi thiết bị.':
    'Use the camera to read the barcode on the device label or box. The video never leaves your device.',
  'Khung hình camera để quét mã vạch': 'Camera preview for barcode scanning',
  'Đang mở camera…': 'Opening the camera…',
  'Đưa mã vạch vào khung hình. Định dạng thường gặp: Code 128, EAN-13, EAN-8, QR và Data Matrix.':
    'Point the barcode into the frame. Common formats: Code 128, EAN-13, EAN-8, QR and Data Matrix.',
  'Mã quét được chỉ điền vào ô serial — bạn vẫn sửa và kiểm tra trước khi lưu.':
    'The scanned code only fills the serial field — you still edit and check it before saving.',
  'Đã điền từ mã vừa quét — sửa được, chưa lưu.':
    'Filled in from the scanned code — editable, not saved yet.',
  'Đã quét serial — kiểm tra lại trước khi lưu':
    'Serial scanned — check it before saving',
  'Không có quyền dùng camera. Bật quyền camera cho trang này trong cài đặt trình duyệt rồi thử lại.':
    'Camera permission was denied. Allow camera access for this site in your browser settings and try again.',
  'Không tìm thấy camera nào trên thiết bị này.':
    'No camera was found on this device.',
  'Camera đang được ứng dụng khác dùng. Đóng ứng dụng đó rồi thử lại.':
    'The camera is being used by another app. Close it and try again.',
  'Không mở được camera. Thử lại sau.': 'Could not open the camera. Try again later.',
  'Trình duyệt không quét được định dạng mã vạch này. Thử nhập serial bằng tay.':
    'This browser cannot scan that barcode format. Type the serial in by hand.',
  'Mã vừa quét quá dài ({count} ký tự) — có vẻ không phải serial. Nhập tay nếu cần.':
    'The scanned code is too long ({count} characters) — it does not look like a serial. Type it in if needed.',
  'Mã vừa quét là một đường dẫn, không phải serial. Nhập tay nếu cần.':
    'The scanned code is a URL, not a serial. Type it in if needed.',
  'Không đọc được mã vạch. Giữ máy ổn định và thử lại.':
    'Could not read a barcode. Hold the device steady and try again.',

  // ── Detail page (`devices/[id]/page.tsx`) ───────────────────────────────
  'Không tải được thiết bị': 'Could not load the device',
  'Tổng quan bảo hành': 'Warranty overview',
  'Có {count} gói bảo hành. Gói xa nhất hết {date}.':
    {
      en: '{count} warranty plans, the furthest ending on {date}.',
      enOne: '{count} warranty plan, the furthest ending on {date}.',
    },
  'Quản lý chi tiết từng gói ở mục bên dưới.':
    'Manage each plan in detail in the section below.',
  'Thiết bị chưa có gói bảo hành nào.': 'This device has no warranty plan yet.',
  'Hạn đổi/trả:': 'Return deadline:',
  'Chính sách của cửa hàng do bạn ghi lại, không phải quy định pháp luật.':
    'The store policy is whatever you recorded — it is not a legal requirement.',
  // Warranty activation + extended-cover deadline (Feature A). The two-line
  // warning is deliberate: "chưa kích hoạt" alone reads like missing data,
  // while the point of the field is that the counter can refuse the device.
  'Đã kích hoạt ngày {date}': 'Activated on {date}',
  'Chưa kích hoạt': 'Not activated',
  'Cửa hàng chưa kích hoạt — máy có thể bị từ chối bảo hành.':
    'The retailer has not activated it — the device can be refused for warranty service.',
  'Hạn mua gói mở rộng:': 'Extended cover deadline:',
  'Còn {days} ngày để mua gói mở rộng': {
    en: '{days} days left to buy extended cover',
    enOne: '{days} day left to buy extended cover',
  },
  'Hôm nay là ngày cuối mua gói mở rộng':
    'Today is the last day to buy extended cover',
  'Đã hết hạn mua gói mở rộng ({days} ngày trước)': {
    en: 'The extended-cover deadline passed {days} days ago',
    enOne: 'The extended-cover deadline passed {days} day ago',
  },
  'Đi bảo hành ở đâu': 'Where to claim the warranty',
  'Phiếu bàn giao & link chia sẻ': 'Handover certificate & share links',
  'Chi phí sử dụng': 'Cost of ownership',
  'Thiết bị chưa có ngày mua hợp lệ nên chưa tính được chi phí mỗi ngày.':
    'This device has no usable purchase date, so the cost per day cannot be worked out.',
  '/ngày': '/day',
  'Chi phí thực trả': 'What you actually paid',
  'Tính đến hôm nay': 'Up to today',
  '{days} ngày': { en: '{days} days', enOne: '{days} day' },
  'kể từ {from}': 'since {from}',
  'Gói bảo hành ({count})': { en: 'Warranty plans ({count})', enOne: 'Warranty plan ({count})' },
  'Tiền bán': 'Sale proceeds',
  'Tổng chi': 'Total spent',
  'Chưa ghi giá mua và chi phí gói bảo hành nên tạm tính 0 ₫.':
    'No purchase price or warranty cost was recorded, so this is counted as 0 ₫.',
  'Có gói bảo hành chưa ghi giá — con số này chỉ là mức tối thiểu.':
    'A warranty plan has no cost recorded — this figure is only a minimum.',
  'Ngày bán trước ngày mua — dữ liệu có vẻ sai, tạm tính 1 ngày.':
    'The sale date is before the purchase date — the data looks wrong, so this counts as 1 day.',
  'Có giá bán nhưng thiếu ngày bán — tạm tính tới hôm nay.':
    'There is a sale price but no sale date — this counts up to today.',
  'Tiền bán đã thu hồi đủ (hoặc hơn) số đã chi.':
    'The sale proceeds have recovered what you spent, or more.',
  'So sánh với các thiết bị khác →': 'Compare with your other devices →',
  'File đính kèm': 'Attachments',
  'File đính kèm ({count})': { en: 'Attachments ({count})', enOne: 'Attachment ({count})' },
  'Gói bảo hành': 'Warranty plan',
  'Thông tin nhanh': 'Quick facts',
  'Số gói BH': 'Warranty plans',
  'ID': 'ID',

  // ── Delete dialog (`components/delete-device-button.tsx`) ───────────────
  'Xóa thiết bị?': 'Delete this device?',
  'Hành động này sẽ xóa vĩnh viễn {name} cùng toàn bộ file đính kèm và nhắc nhở. Không thể khôi phục.':
    'This permanently deletes {name}, along with every attachment and reminder. It cannot be undone.',
  'Xoá vĩnh viễn': 'Delete permanently',
  'Đã xoá thiết bị': 'Device deleted',
  'Không xoá được, thử lại sau': 'Could not delete it, try again later',

  // ── Not found (`devices/[id]/not-found.tsx`) ────────────────────────────
  'Không tìm thấy thiết bị': 'Device not found',
  'Thiết bị này không tồn tại hoặc đã bị xóa.':
    'This device does not exist, or it has been deleted.',
  'Quay lại danh sách': 'Back to the list',

  // ── Paste import — page + component (`devices/import`) ──────────────────
  'Nhập nhanh': 'Quick import',
  'Dán bảng để thêm nhiều thiết bị': 'Paste a table to add many devices',
  'Copy một vùng ô từ Excel / Google Sheets (hoặc gõ tay, ngăn cách bằng tab, dấu phẩy hay dấu chấm phẩy) rồi dán vào đây. Xem trước từng dòng trước khi tạo.':
    'Copy a block of cells from Excel / Google Sheets (or type it out, separated by tabs, commas or semicolons) and paste it here. Preview every row before creating anything.',
  'Cách dán': 'How to paste',
  'Mỗi dòng là một thiết bị. Cột ngăn cách bằng tab (copy từ Excel/Sheets), hoặc ; / , — web tự nhận và ghi rõ bên dưới.':
    'One device per line. Columns are separated by a tab (copying from Excel/Sheets), or by ; / , — the app detects which and says so below.',
  'Có tiêu đề thì web đọc theo tên cột ({first}, {second}, …). Không có tiêu đề thì đọc theo đúng thứ tự: {order}.':
    'With a header row, columns are read by name ({first}, {second}, …). Without one, they are read in exactly this order: {order}.',
  'Ngày mua nhận dd/MM/yyyy hoặc yyyy-MM-dd; giá nhận 15.000.000, 15tr, 15,5tr, 15k.':
    'The purchase date accepts dd/MM/yyyy or yyyy-MM-dd; the price accepts 15.000.000, 15tr, 15,5tr, 15k.',
  'Các cột khác (Trạng thái, Hết bảo hành…) không được nhập — thiết bị tạo ra ở trạng thái “Đang dùng” và chưa có gói bảo hành; thêm sau ở trang chi tiết.':
    'Other columns (Status, Warranty expiry…) are not imported — the device is created with the status “In use” and no warranty plan; add those later on the detail page.',
  'Dán bảng vào đây': 'Paste the table here',
  'Chưa có gì để dán? Thử copy bảng mẫu trong ô trên rồi dán lại.':
    'Nothing to paste yet? Copy the sample table above and paste it back in.',
  'Dòng đầu tiên': 'First row',
  'Tự nhận diện': 'Detect automatically',
  'Là tiêu đề cột': 'It is a header row',
  'Là dữ liệu': 'It is data',
  'Tạo {count} thiết bị': {
    en: 'Create {count} devices',
    enOne: 'Create {count} device',
  },
  'Tạo thiết bị': 'Create a device',
  'Đang tạo…': 'Creating…',
  'Xem trước': 'Preview',
  'Tách bằng {delimiter} · dòng đầu là tiêu đề':
    'Split by {delimiter} · the first row is a header',
  'Tách bằng {delimiter} · không có tiêu đề, đọc theo thứ tự cột chuẩn':
    'Split by {delimiter} · no header, read in the standard column order',
  'Sẽ tạo {count} thiết bị': { en: 'Will create {count} devices', enOne: 'Will create {count} device' },
  // The preview used to be ONE key with two counted nouns, and its single
  // `enOne` could only inflect the first ("Will create 1 device · skipping 1
  // bad rows"). The sentence is now composed from these two fragments, each
  // carrying its own `count`; Vietnamese joins them with the same " · " and
  // reads byte-for-byte as before.
  'bỏ qua {skipped} dòng lỗi': {
    en: 'skipping {skipped} bad rows',
    enOne: 'skipping {skipped} bad row',
  },
  'Cột đọc được:': 'Columns read:',
  'Cột bỏ qua:': 'Columns skipped:',
  'Bảng dài hơn mức xử lý — chỉ phần đầu được đọc. Chia nhỏ rồi dán lại.':
    'The table is longer than the app will process — only the beginning is read. Split it up and paste it again.',
  'Dòng': 'Row',
  'Kết quả': 'Result',
  'Sẽ tạo': 'Will create',
  'Chỉ hiển thị {shown}/{total} dòng đầu — danh sách lỗi bên dưới vẫn tính tất cả.':
    'Showing the first {shown} of {total} rows — the error list below still counts them all.',
  '{count} dòng sẽ bị bỏ qua (không tạo thiết bị):': {
    en: '{count} rows are skipped (no device is created):',
    enOne: '{count} row is skipped (no device is created):',
  },
  'Dòng {line}: {errors}': 'Row {line}: {errors}',
  'Đã dừng giữa chừng: {reason}': 'Stopped part-way: {reason}',
  'Những dòng còn lại chưa được tạo — xoá bớt thiết bị rồi dán lại phần còn thiếu.':
    'The remaining rows were not created — delete some devices and paste the missing part again.',
  'Những dòng còn lại chưa được tạo — đợi khoảng một phút rồi dán lại phần còn thiếu.':
    'The remaining rows were not created — wait about a minute, then paste the missing part again.',
  'Dòng {line}': 'Row {line}',
  'Đã tạo · xem': 'Created · view',
  // Deliberately NOT 'Bỏ qua': that key belongs to `common.ts` as the generic
  // "Skip" *action*. This is the outcome of a paste-import row, so it carries
  // its own sentence.
  'Đã bỏ qua': 'Skipped',
  'Chưa tạo': 'Not created',
  'Lỗi': 'Failed',
  'Xem danh sách thiết bị': 'View the device list',

  // ── Paste import — parser diagnostics (`lib/device-paste.ts`) ───────────
  'dấu chấm phẩy (;)': 'semicolon (;)',
  'dấu phẩy (,)': 'comma (,)',
  'Thiếu tên thiết bị': 'Missing device name',
  'Thiếu ngày mua': 'Missing purchase date',
  // Reported by the paste importer's date leaf (`lib/device-paste.ts::dayOf`)
  // for a value that is not a real calendar date at all. Wording taken from the
  // Go catalog: "Ngày không hợp lệ" → "Invalid date".
  'Ngày không hợp lệ': 'Invalid date',
  'Ngày mua không hợp lệ: "{value}"': 'Invalid purchase date: “{value}”',
  'Ngày mua không hợp lệ: "{value}" (dùng dd/MM/yyyy)':
    'Invalid purchase date: “{value}” (use dd/MM/yyyy)',
  'Không đọc được giá "{value}" — tạm để 0':
    'Could not read the price “{value}” — counted as 0 for now',
  'Giá không hợp lệ: "{value}" — tạm để 0':
    'Invalid price: “{value}” — counted as 0 for now',
  'Loại không có trong danh mục: "{value}"': 'Category not in the catalog: “{value}”',
  'Chưa ghi loại — dùng "{value}"': 'No category recorded — using “{value}”',
  'Thừa {count} ô so với bảng — phần thừa bị bỏ qua': {
    en: 'There are {count} more cells than the table has columns — the extras are ignored',
    enOne:
      'There is {count} more cell than the table has columns — the extra is ignored',
  },
  'Cột "{header}" bị trùng — chỉ dùng cột đầu tiên.':
    'Duplicate column “{header}” — only the first one is used.',
  'Không thấy dấu phân cách (tab, ; hoặc ,) — mỗi dòng đang chỉ có 1 cột.':
    'No separator found (tab, ; or ,) — every line currently has just 1 column.',
  // The two ignored-column labels that are not already an enum label.
  'Số tháng bảo hành (cột)': 'Warranty months',

  // ── CSV export (`components/csv-export.tsx`, `lib/csv-export.ts`) ───────
  'Dấu phân cách': 'Delimiter',
  'Excel (Việt Nam)': 'Excel (Vietnam)',
  'Dấu chấm phẩy — Excel bản tiếng Việt tách cột bằng dấu này.':
    'Semicolon — Vietnamese Excel splits columns on this character.',
  'Chuẩn quốc tế': 'International standard',
  'Dấu phẩy — hợp với Google Sheets, Excel bản tiếng Anh, hoặc khi gửi file cho người khác.':
    'Comma — works with Google Sheets, English Excel, or when you send the file to someone else.',
  'Tải CSV': 'Download CSV',
  'Đã xuất {count} dòng {dataset}': {
    en: 'Exported {count} rows of {dataset}',
    enOne: 'Exported {count} row of {dataset}',
  },
  'Không xuất được dữ liệu': 'Could not export the data',
  'Không có dữ liệu để xuất': 'There is no data to export',
  'Tải danh sách ra file': 'Download a list as a',
  'để mở bằng Excel hoặc Google Sheets — tiện khi cần gửi cho người khác, dán vào báo giá, hoặc tự tính toán lại. File có kèm':
    'file to open in Excel or Google Sheets — handy for sending to someone else, pasting into a quote, or doing your own maths. The file carries a',
  'nên tiếng Việt không bị lỗi font, và cột tiền là số trần (không có dấu chấm nghìn, không có ₫) để bảng tính cộng trừ được ngay. Muốn khôi phục lại vào app thì dùng file JSON ở mục trên — CSV chỉ để đọc.':
    'so Vietnamese text is not mangled, and money columns are bare numbers (no thousands separators, no ₫) so a spreadsheet can sum them straight away. To restore data back into the app, use the JSON file above — CSV is read-only.',
  'Tên, danh mục, hãng, model, số seri, ngày mua, giá mua, nơi mua, trạng thái, ngày hết bảo hành (muộn nhất) và ghi chú.':
    'Name, category, brand, model, serial number, purchase date, purchase price, store, status, warranty end date (the latest one) and notes.',
  'Tên gói, chu kỳ, giá, tiền tệ, chi phí tương đương mỗi tháng, ngày bắt đầu, ngày gia hạn, trạng thái và ghi chú.':
    'Plan name, billing cycle, price, currency, monthly equivalent cost, start date, renewal date, status and notes.',
  'Tên món, danh mục, hãng, ưu tiên, trạng thái, giá ban đầu, giá hiện tại, ngày mục tiêu và ghi chú.':
    'Item name, category, brand, priority, status, initial price, current price, target date and notes.',
  'File CSV chỉ chứa nội dung đang thấy trong app (tối đa 50 thiết bị, 100 gói đăng ký, 200 món wishlist) — không kèm ảnh hoá đơn hay file đính kèm.':
    'The CSV file holds only what you can see in the app (at most 50 devices, 100 subscriptions, 200 wishlist items) — it carries no receipt images or attachments.',

  // CSV column headers. They are read back by the paste importer, so the
  // English column uses wording `HEADER_ALIASES` in `lib/device-paste.ts`
  // already recognises, rather than a free translation.
  'Danh mục': 'Category',
  'Số seri': 'Serial number',
  'Giá mua': 'Purchase price',
  'Tên gói': 'Subscription name',
  'Gói': 'Plan',
  'Chu kỳ': 'Billing cycle',
  'Tiền tệ': 'Currency',
  'Tương đương mỗi tháng': 'Monthly equivalent',
  'Bắt đầu': 'Started',
  'Gia hạn tiếp theo': 'Next renewal',
  'Tự động gia hạn': 'Auto-renew',
  'Email tài khoản': 'Account email',
  'Thanh toán': 'Payment',
  'Tên món': 'Item name',
  'Ưu tiên': 'Priority',
  'Giá ban đầu': 'Initial price',
  'Giá hiện tại': 'Current price',
  'Ngày mục tiêu': 'Target date',
  'Link mua': 'Buy link',

  // ── API error fallbacks (`app/actions/devices.ts`) ──────────────────────
  'Không tạo được thiết bị': 'Could not create the device',
  'Chưa có dữ liệu để nhập — dán bảng vào ô bên trên nhé.':
    'There is nothing to import yet — paste a table into the box above.',
  'Không đọc được dòng dữ liệu nào từ nội dung đã dán. Kiểm tra lại tiêu đề cột hoặc chọn "Dòng đầu là dữ liệu".':
    'No data row could be read from what you pasted. Check the column headers, or choose "It is data".',
  'Chưa tạo — đã dừng vì chạm giới hạn thiết bị.':
    'Not created — the run stopped at the device limit.',
  'Chưa tạo — đã dừng vì thao tác quá nhanh.':
    'Not created — the run stopped because the requests came too fast.',
  'Đã tạo {created} thiết bị.': {
    en: 'Created {created} devices.',
    enOne: 'Created {created} device.',
  },
  'Bỏ qua {skipped} dòng lỗi.': {
    en: 'Skipped {skipped} bad rows.',
    enOne: 'Skipped {skipped} bad row.',
  },
  '{failed} dòng máy chủ từ chối.': {
    en: 'The server rejected {failed} rows.',
    enOne: 'The server rejected {failed} row.',
  },
  '{missing} dòng chưa tạo.': {
    en: '{missing} rows were not created.',
    enOne: '{missing} row was not created.',
  },
  'Không có dòng nào hợp lệ để tạo ({count} dòng lỗi).': {
    en: 'No row was valid enough to create ({count} bad rows).',
    enOne: 'No row was valid enough to create ({count} bad row).',
  },
  'Không tạo được thiết bị nào — xem lý do ở từng dòng bên dưới.':
    'No device could be created — see the reason on each row below.',

  // ── Bulk add (`devices/bulk`, `components/device-bulk-add.tsx`) ──────────
  //
  // This screen is the row-editor shape, not a paste box: the existing
  // `devices/import` already covers "paste a table from a shop / spreadsheet".
  // The copy therefore explains the four minimum fields and the partial-success
  // rule, and keeps the paste flow one click away.
  'Thêm hàng loạt': 'Bulk add',
  'Thêm nhiều thiết bị một lúc': 'Add several devices at once',
  'Mỗi dòng một thiết bị. Chỉ cần tên, loại, ngày mua và giá — phần còn lại thêm sau ở trang chi tiết.':
    'One device per row. Just the name, category, purchase date and price — everything else can be added later on the detail page.',
  'Mỗi dòng chỉ cần bốn thông tin: tên, loại, ngày mua và giá.':
    'Each row only needs four things: name, category, purchase date and price.',
  'Hãng, model, serial, bảo hành, nơi mua, ghi chú... thêm sau ở trang chi tiết.':
    'Brand, model, serial, warranty, store and notes can be added later on the detail page.',
  'Giá trong bảng này tính bằng VND. Thiết bị mua bằng ngoại tệ cần thêm ở form đơn để có tỷ giá.':
    'Prices in this table are in VND. Devices bought in a foreign currency need the single-device form so the exchange rate can be recorded.',
  'Tối đa 50 dòng mỗi lần. Dòng hợp lệ vẫn được tạo kể cả khi dòng khác lỗi — sửa dòng lỗi rồi gửi lại, các dòng đã tạo không bị tạo lại.':
    'Up to 50 rows at a time. Valid rows are still created even when another row fails — fix the failed one and resubmit; created rows are not created again.',
  'Có sẵn danh sách từ cửa hàng?': 'Already have a list from the shop?',
  'Thêm dòng': 'Add row',
  'Xoá dòng': 'Remove row',
  '{count}/{max} dòng': '{count} of {max} rows',
  'Đã đạt tối đa {max} dòng mỗi lần.':
    'You can add at most {max} rows at a time.',
  'Đã tạo': 'Created',
  'Cần sửa': 'Needs fixing',
  'Chưa rõ kết quả': 'Unclear result',
  'Sửa lỗi ở các dòng được đánh dấu rồi gửi lại — chỉ những dòng lỗi được gửi đi.':
    'Fix the highlighted rows and resubmit — only the rows that failed are sent.',
  'vd: Tủ lạnh Samsung': 'e.g. Samsung fridge',
  'Các dòng đã tạo giữ nguyên; lần gửi sau chỉ gồm các dòng còn lỗi hoặc dòng mới.':
    'Created rows stay as they are; the next submission only includes failed or new rows.',
  'Không đọc được dữ liệu các dòng — tải lại trang rồi thử lại.':
    'Could not read the row data — reload the page and try again.',
  'Chưa có dòng nào để tạo — nhập ít nhất một thiết bị.':
    'There is nothing to create yet — fill in at least one device.',
  'Không tạo được thiết bị nào — cả lô vượt giới hạn thiết bị của tài khoản.':
    'No device was created — the whole batch would exceed this account’s device limit.',
  'Đã tạo {created}/{total} thiết bị.': {
    en: 'Created {created} of {total} devices.',
    enOne: 'Created {created} of {total} device.',
  },
  'Đã tạo 0/{total} thiết bị — sửa các dòng lỗi rồi gửi lại.': {
    en: 'Created 0 of {total} devices — fix the failed rows and resubmit.',
    enOne: 'Created 0 of {total} device — fix the failed row and resubmit.',
  },
  'Đã tạo {created}/{total} thiết bị. Còn {failed} dòng cần sửa.':
    'Created {created} of {total} devices. Rows still needing a fix: {failed}.',
  'Chỉ được thêm tối đa {max} thiết bị mỗi lần.':
    'You can add at most {max} devices per batch.',
  'Không có thiết bị nào trong lô này được tạo.':
    'No device in this batch was created.',
  'Tài khoản còn nhận thêm {remaining} thiết bị.': {
    en: 'The account can take {remaining} more devices.',
    enOne: 'The account can take {remaining} more device.',
  },
  'Đang có {active}/{max} thiết bị chưa bán.':
    'Currently {active} of {max} unsold devices.',
  'Đang có {total}/{max} hồ sơ thiết bị (tính cả thiết bị đã bán).':
    'Currently {total} of {max} device records, sold devices included.',
  'Bớt còn tối đa {remaining} dòng rồi gửi lại.': {
    en: 'Reduce the batch to at most {remaining} rows and resubmit.',
    enOne: 'Reduce the batch to at most {remaining} row and resubmit.',
  },
  'Tài khoản đã đầy — xoá bớt thiết bị rồi thử lại.':
    'The account is full — delete some devices and try again.',
  'Không đọc được số suất còn lại — kiểm tra danh sách thiết bị rồi thử lại.':
    'Could not read the remaining device slots — check the device list and try again.',
  'Không tải được danh mục loại thiết bị — tải lại trang rồi thử lại.':
    'Could not load the category catalog — reload the page and try again.',
  'Dòng này chưa có kết quả từ máy chủ — kiểm tra danh sách thiết bị trước khi gửi lại.':
    'This row has no result from the server — check the device list before resubmitting.',
});
