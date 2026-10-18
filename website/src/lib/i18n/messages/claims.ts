// Repair / warranty cases — the device card, the standalone /claims list and
// the tri-state coverage / status vocabulary.
//
// The keys are the Vietnamese originals (see `../types.ts`). Every sentence the
// API also produces for this feature ("Thiết bị này đang có một phiếu sửa chữa
// chưa đóng.") is kept byte-identical here so the client-side 409 copy and the
// server's own message cannot drift in meaning.
//
// Generic verbs (Lưu / Huỷ / Sửa / Xoá) live in `common.ts` and are not
// redefined. `Đã huỷ` already exists in `subscriptions.ts` with the same
// English ("Cancelled"); the duplicate is intentional and the merge test allows
// it only because both translate to the same sentence.

import { defineMessages } from '../types';

export const claims = defineMessages({
  // ── Navigation + page (`app/(app)/claims/page.tsx`, `components/sidebar`) ─
  'Sửa chữa': 'Repairs',
  'Phiếu sửa chữa': 'Repair cases',
  'Theo dõi máy đang ở tiệm, đã xong hay bị từ chối — trên mọi thiết bị.':
    'Track what is at the shop, what is done and what was rejected — across every device.',
  'Không tải được danh sách phiếu sửa chữa — thử tải lại trang nhé.':
    'Could not load repair cases — try reloading the page.',
  'Đang xử lý ({count})': 'In progress ({count})',
  'Đã kết thúc ({count})': 'Finished ({count})',
  'Chưa có phiếu sửa chữa nào': 'No repair cases yet',
  'Không có phiếu nào ở trạng thái này.': 'No repair cases with this status.',
  'Khi một thiết bị hỏng, tạo phiếu từ trang thiết bị để ghi lại nơi sửa, số phiếu và chi phí.':
    'When a device breaks, create a repair case from its page to record the shop, the ticket number and the cost.',
  'Mở danh sách thiết bị': 'Open the device list',

  // ── Device detail card (`components/claim-list.tsx`) ────────────────────
  'Sửa chữa & bảo hành': 'Repairs & warranty',
  'Chưa có phiếu sửa chữa nào.': 'No repair cases yet.',
  'Thêm một phiếu khi bạn mang máy đi sửa hoặc đi bảo hành.':
    'Add one when you take the device in for repair or warranty.',
  'Thêm phiếu sửa chữa': 'Add a repair case',
  'Sửa phiếu sửa chữa': 'Edit repair case',
  'Xoá phiếu sửa chữa': 'Delete repair case',
  'Xoá phiếu "{issue}"?': 'Delete the repair case "{issue}"?',
  'Đã xoá phiếu sửa chữa': 'Repair case deleted',
  'Không xoá được phiếu sửa chữa': 'Could not delete the repair case',
  'Thiết bị này đang Hỏng nhưng chưa có phiếu sửa chữa.':
    'This device is marked broken but has no repair case.',
  'Tạo phiếu để ghi lại nơi sửa, số phiếu và chi phí.':
    'Create one to record the shop, the ticket number and the cost.',
  'Tạo phiếu sửa chữa': 'Create a repair case',

  // ── Claim form (`components/claim-form.tsx`) ────────────────────────────
  'Thiết bị của phiếu': 'Device',
  'Không gắn gói nào': 'No plan linked',
  'Ngày mở phiếu': 'Opened on',
  'Ngày dự kiến trả': 'Expected return',
  'Số phiếu': 'Ticket number',
  'vd: 2026-0912': 'e.g. 2026-0912',
  'Trung tâm sửa chữa': 'Service centre',
  'vd: FPT Shop Nguyễn Trãi': 'e.g. FPT Shop Nguyen Trai',
  'Mô tả lỗi': 'Issue',
  'Mô tả ngắn gọn lỗi': 'Briefly describe the fault',
  'Chẩn đoán': 'Diagnosis',
  'Trung tâm nói gì?': 'What did the shop say?',
  'Kết quả': 'Result',
  'Đã sửa xong, đổi mới, hoàn tiền...': 'Repaired, replaced, refunded...',
  'Chi phí (VND)': 'Cost (VND)',
  'Để trống nếu chưa biết. 0 ₫ nghĩa là sửa miễn phí.':
    'Leave blank if unknown. 0 ₫ means the repair was free.',
  'Có được bảo hành không?': 'Covered by warranty?',
  '“Chưa xác định” khác với “Không được bảo hành”.':
    '"Not sure yet" is different from "Not covered by warranty".',
  'Máy chủ sẽ tự đặt ngày đóng khi lưu.':
    'The server sets the closing date when you save.',

  // ── Dates + coverage (card rows, `/claims`) ─────────────────────────────
  'Mở ngày {date}': 'Opened on {date}',
  'Dự kiến trả {date}': 'Due back {date}',
  'Đã đóng {date}': 'Closed {date}',
  'Có bảo hành': 'Covered by warranty',
  'Không được bảo hành': 'Not covered by warranty',
  'Chưa xác định': 'Not sure yet',

  // ── Status vocabulary (`lib/claims.ts::CLAIM_STATUS_LABELS`) ────────────
  'Đang mở': 'Open',
  'Đang sửa': 'In repair',
  'Đã xử lý xong': 'Resolved',
  'Bị từ chối': 'Rejected',
  'Đã huỷ': 'Cancelled',

  // ── 409 / server-action copy (`app/actions/claims.ts`) ──────────────────
  'Thiết bị này đang có một phiếu sửa chữa chưa đóng.':
    'This device already has an open repair case.',
  'Thiết bị này đang có một phiếu sửa chữa chưa đóng. Cập nhật phiếu đó thay vì tạo thêm.':
    'This device already has an open repair case. Update that case instead of adding another.',
  'Mở phiếu đang mở': 'Open the active case',
  'Thiếu id phiếu sửa chữa': 'Missing repair case id',
  'Chi phí phải là số nguyên không âm.':
    'Cost must be a non-negative whole number.',

  // ── Dashboard nudge (`app/(app)/dashboard/page.tsx`) ────────────────────
  '{count} thiết bị đang hỏng mà chưa có phiếu sửa chữa.': {
    en: '{count} devices are marked broken with no repair case.',
    enOne: '{count} device is marked broken with no repair case.',
  },
  'và {count} thiết bị khác': 'and {count} more',
  'Xem thiết bị đang hỏng': 'View broken devices',
});
