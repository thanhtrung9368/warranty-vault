// Brand warranty lookup + mismatch (frozen contract).
//
// Keys are the Vietnamese originals; `defineMessages` derives the `vi` column
// from them. English is the product default, so every entry needs a real English
// sentence — an unregistered key would silently render Vietnamese to an English
// reader (`app/report` coverage test catches that).
//
// The mismatch copy is deliberately informational, not alarming: a disagreement
// between the brand's system and the invoice is normal (pre-activation,
// grey-market import, a repair re-registration), and the user's own data is not
// "wrong". Both dates are interpolated at render time.

import { defineMessages } from '../types';

export const brandWarrantyMessages = defineMessages({
  // ── Status labels (the five enum values) ────────────────────────────────
  'Hãng ghi đang còn bảo hành': 'Brand says the warranty is active',
  'Hãng ghi đã hết bảo hành': 'Brand says the warranty has expired',
  'Hãng chưa ghi nhận bảo hành': 'No warranty registration on the brand record',
  'Hãng ghi đã kích hoạt trước': 'Brand says it was activated earlier',
  'Hãng ghi chưa rõ': 'Brand status is unclear',

  // ── Status hints ────────────────────────────────────────────────────────
  'Hệ thống của hãng đang ghi nhận bảo hành còn hiệu lực.':
    "The brand's system shows the warranty as active.",
  'Hệ thống của hãng ghi bảo hành đã hết hạn.':
    "The brand's system shows the warranty as expired.",
  'Hãng không tìm thấy serial này trong hệ thống bảo hành — máy có thể chưa được kích hoạt hoặc mua ngoài kênh chính thức.':
    'The brand cannot find this serial in its warranty system — the device may not be activated, or it may have been bought outside official channels.',
  'Hãng ghi bảo hành đã bắt đầu trước ngày bạn mua — thường là máy được kích hoạt sẵn.':
    'The brand records a warranty start before your purchase date — usually a unit that was activated in store.',
  'Hãng có trả lời nhưng không nói rõ trạng thái.':
    'The brand replied but did not state a clear status.',

  // ── Mismatch sentences (one per kind) ───────────────────────────────────
  'Hãng ghi bảo hành bắt đầu trước ngày mua {days} ngày — hoá đơn của bạn có thể không phải ngày kích hoạt.':
    {
      en: 'The brand says warranty started {days} days before your purchase date — your invoice may not be the activation date.',
      enOne:
        'The brand says warranty started {days} day before your purchase date — your invoice may not be the activation date.',
    },
  'Hãng ghi bảo hành bắt đầu sau ngày mua {days} ngày — hoá đơn của bạn có thể đã được ghi sau khi máy kích hoạt.':
    {
      en: 'The brand says warranty started {days} days after your purchase date — your invoice may have been written after the device was activated.',
      enOne:
        'The brand says warranty started {days} day after your purchase date — your invoice may have been written after the device was activated.',
    },
  'Hãng ghi bảo hành kết thúc sớm hơn {days} ngày so với mốc bạn đang tính — đừng chờ tới ngày đó mới mang máy đi bảo hành.':
    {
      en: 'The brand says warranty ends {days} days earlier than the date you are working from — do not wait until that date to claim.',
      enOne:
        'The brand says warranty ends {days} day earlier than the date you are working from — do not wait until that date to claim.',
    },
  'Hãng ghi bảo hành kết thúc muộn hơn {days} ngày so với mốc bạn đang tính — máy có thể còn bảo hành lâu hơn bạn tưởng.':
    {
      en: 'The brand says warranty ends {days} days later than the date you are working from — the device may be covered for longer than you think.',
      enOne:
        'The brand says warranty ends {days} day later than the date you are working from — the device may be covered for longer than you think.',
    },

  // ── Mismatch chrome ─────────────────────────────────────────────────────
  // Kind-specific because `brandDate`/`purchaseDate` compare different things
  // per kind (start vs purchase date, end vs the app's warranty end).
  'Hãng ghi bắt đầu {date}': 'Brand start: {date}',
  'Bạn ghi ngày mua {date}': 'Your purchase date: {date}',
  'Hãng ghi hết hạn {date}': 'Brand expiry: {date}',
  'Bạn đang tính hết hạn {date}': 'Your warranty end: {date}',
  'Đây là thông tin để đối chiếu, không phải lỗi — dữ liệu bạn đã nhập vẫn được giữ nguyên.':
    'This is information to compare, not an error — everything you entered is kept as it is.',

  // ── Agreement / no-registration / recorded answer ───────────────────────
  // "No mismatch" means the server's comparison found nothing to flag, not
  // necessarily that every date was comparable. The sentence therefore calls out
  // the start date (which WAS compared) and states the end date as information.
  'Không có lệch: hãng ghi bảo hành từ {start} đến {end}. Ngày bắt đầu trùng với mốc bạn đang tính.':
    'No disagreement: the brand records warranty from {start} to {end}. The start date matches the date you use.',
  'Không có lệch: hãng ghi bảo hành bắt đầu {start}, trùng với mốc bạn đang tính.':
    'No disagreement: the brand records warranty starting {start}, matching the date you use.',
  'Hãng chưa ghi nhận bảo hành cho serial này — hoá đơn của bạn vẫn là mốc duy nhất app có.':
    'The brand has no warranty record for this serial — your invoice is still the only date the app has.',
  'Hãng ghi bảo hành từ {start} đến {end}.': 'The brand records warranty from {start} to {end}.',
  'Hãng ghi bảo hành bắt đầu {start}.': 'The brand records warranty starting {start}.',
  'Hãng ghi bảo hành kết thúc {end}.': 'The brand records warranty ending {end}.',
  'Hãng không ghi ngày bảo hành cụ thể.':
    'The brand did not record specific warranty dates.',
  'Hãng ghi bảo hành kéo dài {days} ngày.': {
    en: 'The brand records {days} days of cover.',
    enOne: 'The brand records {days} day of cover.',
  },
  'Chưa đối chiếu với hãng lần nào.': 'Never checked with the brand.',
  'Đã đối chiếu {when}.': 'Checked {when}.',

  // ── Lookup link / no-link state ─────────────────────────────────────────
  // `'Thiết bị chưa ghi hãng'` already lives in `system.ts` (the service
  // directory uses the same sentence); redefining it here with different
  // English would trip the cross-file conflict test. Translation is shared.
  'Thêm hãng cho thiết bị để app tìm trang tra cứu bảo hành của hãng đó.':
    "Add a brand to the device so the app can find that brand's warranty check page.",
  'App không có trang tra cứu bảo hành của hãng này':
    'The app has no warranty check page for this brand',
  'App chỉ dẫn link khi biết chắc đó là trang tra cứu chính thức của hãng. Với hãng này app không có link nào, nên bạn tự mở trang hỗ trợ của hãng — app không đoán URL.':
    "The app only links a page when it is sure the page belongs to the brand. There is no such link for this brand, so open the brand's support page yourself — the app will not guess a URL.",
  'Trang tra cứu bảo hành của hãng': "The brand's warranty check page",
  'Mở trang dưới đây, nhập serial/IMEI để xem ngày bảo hành hãng ghi. Xong thì quay lại ghi kết quả bên dưới.':
    'Open the page below and enter the serial/IMEI to see the warranty dates the brand recorded. Then come back and record the answer.',
  'Mở trang tra cứu của hãng': "Open the brand's check page",

  // ── Validation (mirrors Go's rules; wording copied from the Go
  // validator so pre-flight and server errors read identically) ────────────
  'Trạng thái bảo hành hãng không hợp lệ': 'Invalid brand warranty status',
  'Trạng thái bảo hành hãng bắt buộc khi đã ghi ngày hoặc link tra cứu':
    'Brand warranty status is required when a date or lookup URL is recorded',
  'Ngày bắt đầu bảo hành hãng không hợp lệ': 'Invalid brand warranty start date',
  'Ngày hết hạn bảo hành hãng không hợp lệ': 'Invalid brand warranty end date',
  'Ngày hết hạn bảo hành hãng không được trước ngày bắt đầu':
    'Brand warranty end date must not be before the start date',
  'Link tra cứu bảo hành hãng phải là URL http/https tuyệt đối':
    'Brand warranty lookup URL must be an absolute http/https URL',

  // ── Detail card + form section chrome ───────────────────────────────────
  'Đối chiếu với hãng': 'Check with the brand',
  'Ngày bắt đầu bảo hành bạn ghi là đoán từ hoá đơn. Hãng có hệ thống riêng — đối chiếu để biết mình còn bảo hành thật hay không.':
    'The warranty start date you entered is a guess from the invoice. The brand keeps its own record — compare the two to see whether the cover is really still there.',
  'Chưa đối chiếu với hãng — khi có kết quả, ghi ngày hãng ghi để app so với hoá đơn của bạn.':
    "Not checked with the brand yet — when you have the answer, record the brand's date so the app can compare it with your invoice.",
  'Ghi kết quả': 'Record the answer',
  'Cập nhật kết quả': 'Update answer',
  'Chưa đối chiếu': 'Not checked yet',
  'Trạng thái hãng ghi': 'Status the brand showed',
  'Ngày bắt đầu hãng ghi': "Brand's start date",
  'Ngày kết thúc hãng ghi': "Brand's end date",
  'Link đã mở': 'Link you opened',
  'Dán link bạn đã mở (không bắt buộc)': 'Paste the link you opened (optional)',
  'Lưu kết quả': 'Save answer',
  'Thời điểm ghi kết quả được lưu tự động.':
    'The time you recorded the answer is saved automatically.',
  'Kết quả hãng ghi đã lưu:': 'Saved brand answer:',
  'Ngày bảo hành hãng ghi có thể khác ngày trên hoá đơn. Tra trang của hãng rồi ghi lại kết quả.':
    "The warranty dates the brand recorded can differ from your invoice. Check the brand's page, then record the answer.",
  'Tra trang tra cứu bảo hành của hãng {brand}': 'Find the warranty check page for {brand}',
  'App chỉ dẫn link khi biết chắc đó là trang chính thức của hãng; nếu không có, app sẽ nói thẳng là không có.':
    'The app only links a page when it is sure the page is the brand’s official one; when there is none, it says so plainly.',
  'Không tra được trang tra cứu của hãng — thử lại sau.':
    "Could not look up the brand's check page — try again later.",
  'Chọn “Chưa đối chiếu” để xoá kết quả đã ghi. Thời điểm ghi được lưu tự động.':
    'Choose “Not checked yet” to erase the recorded answer. The time it was recorded is saved automatically.',
  'Đã ghi kết quả đối chiếu với hãng.': 'Brand warranty answer saved.',
});
