// Failure codes and their copy — the small, catalog-free half of `lib/handoff`.
//
// The public claim page is a CLIENT component. Importing `lib/handoff.ts` from
// it would also pull `lib/format.ts`, `lib/i18n/catalog.ts` and the full merged
// dictionary into `/handoff/[code]`'s first-load JS, which is exactly what the
// message-bundle split is trying to avoid on public routes.
//
// The maps stay here; the page resolves them through its provider's `t`, and
// the server helpers in `lib/handoff.ts` keep their old wrappers for the RSC
// failure state and the claim action.
//
// Nothing here may import `./i18n/catalog` or `./i18n/messages`.

/**
 * The ONLY reasons a claim can fail, as stable codes. The public preview has
 * just one honest state (`unavailable`) because the server answers a uniform
 * 404 for unknown/expired/cancelled/claimed; the specific reasons can only be
 * learned by a signed-in visitor actually claiming.
 */
export type HandoffFailureReason =
  | 'unavailable'
  | 'expired'
  | 'claimed'
  | 'forbidden'
  | 'rate_limited'
  | 'auth'
  | 'error';

export const HANDOFF_FAILURE_TITLES: Record<HandoffFailureReason, string> = {
  unavailable: 'Mã không còn hiệu lực',
  expired: 'Mã đã hết hạn',
  claimed: 'Mã đã được dùng',
  forbidden: 'Không thể tự nhận',
  rate_limited: 'Thử lại sau',
  auth: 'Cần đăng nhập',
  error: 'Không mở được lời mời',
};

export const HANDOFF_FAILURE_BODIES: Record<HandoffFailureReason, string> = {
  unavailable:
    'Mã không tồn tại, đã hết hạn, đã được dùng hoặc đã bị người bán huỷ. Hãy kiểm tra lại với người bán — Warrly không cho biết mã nào từng tồn tại.',
  expired:
    'Mã đã hết hạn trước khi có người nhận. Không có dữ liệu nào được chuyển; hãy nhờ người bán tạo mã mới.',
  claimed:
    'Mã này đã được người khác dùng để nhận thiết bị. Mỗi mã chỉ nhận được một lần.',
  forbidden:
    'Bạn không thể nhận thiết bị từ chính mình. Hãy gửi mã cho người mua.',
  rate_limited:
    'Bạn đã thử quá nhiều lần. Chờ vài phút rồi mở lại link.',
  auth: 'Bạn cần đăng nhập để nhận thiết bị.',
  error: 'Không tải được thông tin chuyển chủ. Thử tải lại trang.',
};
