// Warranty claims / repair cases — the device card, the standalone /claims list and
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
  // The nav says "Claims", not "Repairs": the stored object is a warranty
  // claim (`coveredByWarranty`, `claimsUsed`/`claimsAllowed`), and someone whose
  // fridge died inside warranty looks for "claim"/"warranty", not a repair log.
  'Sửa chữa': 'Claims',
  'Phiếu sửa chữa': 'Claims & repairs',
  'Theo dõi máy đang ở tiệm, đã xong hay bị từ chối — trên mọi thiết bị.':
    'Track every claim — what is at the shop, what is done and what was rejected.',
  'Không tải được danh sách phiếu sửa chữa — thử tải lại trang nhé.':
    'Could not load claims — try reloading the page.',
  'Đang xử lý ({count})': 'In progress ({count})',
  'Đã kết thúc ({count})': 'Finished ({count})',
  'Chưa có phiếu sửa chữa nào': 'No claims yet',
  'Không có phiếu nào ở trạng thái này.': 'No claims with this status.',
  'Khi một thiết bị hỏng, tạo phiếu từ trang thiết bị để ghi lại nơi sửa, số phiếu và chi phí.':
    'When a device breaks, create a claim from its page to record the shop, the ticket number and the cost.',
  'Mở danh sách thiết bị': 'Open the device list',
  // The /claims empty state branches on whether the account has any devices:
  // with none, the only useful action is creating one (a claim needs a device).
  'Thêm thiết bị đầu tiên': 'Add your first device',

  // ── Device detail card (`components/claim-list.tsx`) ────────────────────
  'Sửa chữa & bảo hành': 'Claims & warranty',
  'Chưa có phiếu sửa chữa nào.': 'No claims yet.',
  'Thêm một phiếu khi bạn mang máy đi sửa hoặc đi bảo hành.':
    'Add a claim when you take the device in for repair or warranty.',
  'Thêm phiếu sửa chữa': 'Add a claim',
  'Sửa phiếu sửa chữa': 'Edit claim',
  'Xoá phiếu sửa chữa': 'Delete claim',
  'Xoá phiếu "{issue}"?': 'Delete the claim "{issue}"?',
  'Đã xoá phiếu sửa chữa': 'Claim deleted',
  'Không xoá được phiếu sửa chữa': 'Could not delete the claim',
  'Thiết bị này đang Hỏng nhưng chưa có phiếu sửa chữa.':
    'This device is marked broken but has no claim.',
  'Tạo phiếu để ghi lại nơi sửa, số phiếu và chi phí.':
    'Create one to record the shop, the ticket number and the cost.',
  'Tạo phiếu sửa chữa': 'Create a claim',

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
    'This device already has an open claim.',
  'Thiết bị này đang có một phiếu sửa chữa chưa đóng. Cập nhật phiếu đó thay vì tạo thêm.':
    'This device already has an open claim. Update that claim instead of adding another.',
  'Mở phiếu đang mở': 'Open the active claim',
  'Thiếu id phiếu sửa chữa': 'Missing claim id',
  'Chi phí phải là số nguyên không âm.':
    'Cost must be a non-negative whole number.',

  // ── Dashboard nudge (`app/(app)/dashboard/page.tsx`) ────────────────────
  '{count} thiết bị đang hỏng mà chưa có phiếu sửa chữa.': {
    en: '{count} devices are marked broken with no claim.',
    enOne: '{count} device is marked broken with no claim.',
  },
  'và {count} thiết bị khác': 'and {count} more',
  'Xem thiết bị đang hỏng': 'View broken devices',

  // ── AI claim assessment (gap #7) ────────────────────────────────────────
  //
  // The result is ADVICE, never a verdict. The coverage labels deliberately say
  // "likely" and "not enough information" — never "approved"/"rejected" — and
  // every result also renders the disclaimer below. `draftLetter` is the one
  // part that is NOT in the reader's language (it is always Vietnamese for the
  // service centre); its label and notice say so on purpose.
  'Đánh giá bảo hành': 'Assess warranty cover',
  'Đang đánh giá…': 'Assessing…',
  'Đánh giá lại': 'Assess again',
  'Không đánh giá được — thử lại sau.':
    'Could not assess the claim — try again later.',
  'Gợi ý tham khảo': 'Reference guidance',
  'Dựa trên hồ sơ và điều khoản bảo hành':
    'Based on the claim and warranty terms',
  'Gợi ý, không phải quyết định': 'Guidance, not a decision',
  'Độ tin cậy: {level}': 'Confidence: {level}',
  'Vì sao': 'Why',
  'Câu hỏi nên hỏi trung tâm': 'Questions to ask the service centre',
  'Mang các câu hỏi này tới trung tâm — hỏi trước khi gửi máy.':
    'Take these questions to the service centre — ask before handing the device over.',
  'Trung tâm bảo hành là bên kiểm tra máy và quyết định cuối cùng. Màn hình này không phê duyệt hay từ chối bảo hành.':
    'The service centre inspects the device and makes the final decision. This screen does not approve or reject a warranty claim.',

  // Coverage — hints, not claim outcomes.
  'Có khả năng được bảo hành': 'Likely covered',
  'Chưa đủ thông tin': 'Not enough information',
  'Có khả năng không được bảo hành': 'Likely not covered',
  'Hồ sơ có dấu hiệu nằm trong phạm vi bảo hành, nhưng đây chỉ là gợi ý. Trung tâm sẽ kiểm tra máy và quyết định.':
    'The claim looks like it may fall within the warranty, but this is only guidance. The service centre will inspect the device and decide.',
  'Hồ sơ chưa cho thấy rõ có được bảo hành hay không. Đây không phải ngõ cụt: mang các câu hỏi bên dưới tới trung tâm để hỏi cho rõ.':
    'The claim does not make it clear whether this is covered. This is not a dead end: take the questions below to the service centre and ask.',
  'Hồ sơ có vài dấu hiệu nằm ngoài phạm vi bảo hành, nhưng trung tâm vẫn là bên quyết định. Dùng các câu hỏi bên dưới để hỏi cho rõ trước khi đi.':
    'The claim shows some signs of being outside the warranty, but the service centre still decides. Use the questions below to ask before you go.',

  // Confidence is always shown next to the hint, with what it means.
  'Thấp': 'Low',
  'Trung bình': 'Medium',
  'Cao': 'High',
  'Mô hình chỉ suy đoán từ hồ sơ hiện có — đừng coi đây là câu trả lời chắc chắn.':
    'The model is only inferring from the claim on file — do not treat this as a firm answer.',
  'Dựa trên hồ sơ hiện có; trung tâm có thể hỏi thêm giấy tờ.':
    'Based on the claim on file; the service centre may ask for more paperwork.',
  'Hồ sơ khá rõ, nhưng trung tâm vẫn là bên quyết định.':
    'The claim is fairly clear, but the service centre still decides.',

  // Gate states — normal product states, not failures.
  'Đánh giá AI đang tắt': 'AI assessment is off',
  'Bật đánh giá AI để dùng tính năng này. Khi bật, nội dung phiếu và điều khoản bảo hành sẽ được gửi tới dịch vụ AI bên thứ ba để phân tích. App không thay đổi phiếu của bạn.':
    'Turn on AI assessment to use this feature. When it is on, the claim and its warranty terms are sent to a third-party AI service for analysis. The app does not change your claim.',
  'Bật và đánh giá': 'Turn on and assess',
  'Đang bật…': 'Turning on…',
  'Đã bật đánh giá AI': 'AI assessment turned on',
  'Không bật được đánh giá AI': 'Could not turn on AI assessment',
  'Đánh giá AI chưa khả dụng': 'AI assessment is not available yet',
  'Dịch vụ chưa bật tính năng đánh giá bằng AI. Đây là cấu hình của hệ thống, không phải lỗi từ phía bạn — phiếu sửa chữa của bạn không bị ảnh hưởng. Bạn vẫn có thể dùng checklist chuẩn bị đi bảo hành.':
    'AI assessment has not been switched on for this service. This is a system setting, not something you did wrong — your claim is unchanged. You can still use the pre-service checklist.',
  'Mở Cài đặt': 'Open Settings',

  // The letter is Vietnamese on purpose; say that instead of translating it.
  'Thư gửi trung tâm (tiếng Việt)':
    'Letter to the service centre (Vietnamese)',
  'Tiếng Việt — để trung tâm đọc':
    'Vietnamese — for the service centre to read',
  'Thư luôn viết bằng tiếng Việt, kể cả khi bạn dùng giao diện tiếng Anh. Trung tâm bảo hành đọc tiếng Việt, nên app không tự dịch thư.':
    'This letter is always written in Vietnamese, even when the app is in English. The service centre reads Vietnamese, so the app does not translate it.',
  'Sao chép thư': 'Copy letter',
  'Đã sao chép thư': 'Letter copied',
  'Không sao chép được — chọn thư và sao chép thủ công.':
    'Could not copy it — select the letter and copy it manually.',
  'Chưa soạn được thư cho phiếu này — bạn vẫn có thể dùng các câu hỏi bên trên.':
    'No letter was generated for this claim — you can still use the questions above.',
  'Tạo bằng {model} lúc {date}': 'Generated by {model} on {date}',
});
