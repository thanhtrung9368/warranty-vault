// Insurance PDF pack (`components/insurance-pack-download.tsx`, the
// `/api/insurance-pack` proxy and `lib/insurance-pack.ts`).
//
// The PDF itself is an ARTIFACT, not app chrome: it is always rendered in
// Vietnamese because the reader is a Vietnamese insurer / loss adjuster, not
// the signed-in user. That is why the button says "(tiếng Việt)" / "(Vietnamese)"
// and the note beside it explains the language instead of letting it read as a
// bug. The surrounding UI still follows the user's language setting.

import { defineMessages } from '../types';

export const insurance = defineMessages({
  // ── Settings section + control (`components/insurance-pack-download.tsx`) ─
  'Bảng kê cho bảo hiểm': 'Insurance property schedule',
  'Bảng kê cho bảo hiểm (tiếng Việt)': 'Insurance property schedule (Vietnamese)',
  'Tải một file PDF để gửi cho công ty bảo hiểm khi họ yêu cầu bảng kê tài sản: trang bìa, bảng kê giá trị và giá mua, từng thiết bị kèm điều khoản bảo hành và ảnh, cùng danh mục file đính kèm.':
    'Download a PDF to send to your insurer when they ask for a schedule of property: a cover page, a schedule of values and purchase prices, a page for each device with its warranty terms and photos, and a manifest of attachments.',
  'File PDF luôn ở tiếng Việt vì người đọc là công ty bảo hiểm hoặc giám định viên, không phải người dùng app.':
    'The PDF is always in Vietnamese because it is read by the insurer or the adjuster, not by the app user.',
  'Bao gồm cả thiết bị đã bán': 'Include sold devices',
  'Mặc định chỉ liệt kê thiết bị bạn đang sở hữu. Bật nếu hồ sơ bảo hiểm cần cả tài sản đã bán trong kỳ.':
    'By default only devices you still own are listed. Turn this on if the insurance file also needs items sold during the period.',
  'Phạm vi: tất cả thiết bị đang sở hữu.': 'Scope: all devices you own.',
  'Phạm vi: tất cả thiết bị, kể cả đã bán.': 'Scope: all devices, including sold ones.',

  // ── Download state (`components/insurance-pack-download.tsx`) ───────────
  'Đang tạo bảng kê…': 'Creating the schedule…',
  'Đã tải bảng kê cho bảo hiểm': 'Insurance property schedule downloaded',
  'Không tải được bảng kê cho bảo hiểm.': 'Could not download the insurance property schedule.',
  'Không tải được bảng kê cho bảo hiểm (mã lỗi {status}).':
    'Could not download the insurance property schedule (error code {status}).',
  'File tải về trống — thử lại nhé.': 'The downloaded file is empty — please try again.',
  'Máy chủ trả về một file không phải PDF — thử lại nhé.':
    'The server returned a file that is not a PDF — please try again.',

  // ── Route handler (`app/api/insurance-pack/route.ts`) ──────────────────
  'Máy chủ trả về định dạng không phải PDF.': 'The server returned a non-PDF response.',
  'File bảng kê rỗng.': 'The schedule file is empty.',
});
