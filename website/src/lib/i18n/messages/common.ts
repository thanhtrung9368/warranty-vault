import { defineMessages } from '../types';

// Shared UI vocabulary + app chrome: the shell (sidebar, topbar, user menu),
// generic actions and states that appear on more than one screen, the language
// switcher, and the fallback copy the API client writes for transport failures.
//
// Keeping them in one file is what stops "Lưu" being translated as "Save" on
// one screen and "Store" on another.
export const common = defineMessages({
  // ── App chrome ──────────────────────────────────────────────────────────
  'Bảng điều khiển': 'Dashboard',
  'Thiết bị': 'Devices',
  'Gói đăng ký': 'Subscriptions',
  'Nhắc nhở': 'Reminders',
  'Việc cần xử lý': 'Action items',
  'Thống kê': 'Stats',
  'Cài đặt': 'Settings',
  'Wishlist': 'Wishlist',
  'Đăng xuất': 'Sign out',
  'Đăng nhập': 'Sign in',
  'Đăng ký': 'Sign up',
  'Tài khoản': 'Account',
  'Hồ sơ': 'Profile',
  'Bảo mật': 'Security',
  'Điều khoản': 'Terms',
  'Cookie': 'Cookies',
  'Quay về trang chủ': 'Back to home',
  'Đóng': 'Close',
  'Mở menu': 'Open menu',
  // `components/sidebar.tsx` — the `<nav>` landmark of the mobile bottom bar.
  'Điều hướng chính': 'Main navigation',
  // `components/user-menu.tsx` — the avatar menu's fallback display name (a
  // user with no `displayName`), and the toast when the sign-out call fails.
  'Người dùng': 'User',
  'Không đăng xuất được': 'Could not sign out',

  // ── Theme switcher (`components/theme-toggle.tsx`) ──────────────────────
  //
  // `Sáng`/`Tối` are also the labels of the theme options in
  // `components/appearance-tweaks.tsx` (another brief's file — it uses
  // `Hệ thống`, not `Theo hệ thống`, for the third one). If that file registers
  // the same two keys with different English, the merge reports a conflict.
  'Đổi giao diện': 'Change theme',
  'Theo hệ thống': 'System',
  'Sáng': 'Light',
  'Tối': 'Dark',

  // ── Enum / label-map values ─────────────────────────────────────────────
  //
  // These are the VALUES of the static label maps in `lib/types.ts`,
  // `lib/subscription-types.ts`, `lib/wishlist-types.ts` and friends — reached
  // at render time through `labelOf(MAP, code, locale)`, never as a literal.
  // That is exactly why they need entries: `labelOf` degrades to the Vietnamese
  // label when a value is unregistered, so a fully English screen could still
  // print "Đang dùng" on every row and nothing would raise. The device statuses
  // and warranty types below were missing until the label-map assertion in
  // `__tests__/i18n-coverage.test.ts` caught them showing Vietnamese on
  // `/devices` and `/stats`.
  //
  // Device statuses — wording copied from the Go catalog, which mirrors
  // `STATUS_LABELS` for the printed certificate:
  'Đang dùng': 'In use',
  'Hết bảo hành': 'Out of warranty',
  'Đã bán': 'Sold',
  'Hỏng': 'Broken',
  'Mất': 'Lost',

  // Warranty types (Go: `WARRANTY_TYPE_LABELS`, used by the share certificate).
  'Tiêu chuẩn': 'Standard',
  'Mở rộng': 'Extended',
  'Bên thứ ba': 'Third party',

  // Categories. The database `Category` table is canonical for the *picker*
  // (`/v1/catalog` returns these Vietnamese names), and it only ever holds
  // these 20 codes — so translating the name at render is enough for the
  // seeded set, and an admin-added row falls back to the stored name.
  'Điện thoại': 'Phone',
  'Laptop': 'Laptop',
  'Máy tính bảng': 'Tablet',
  'Đồng hồ thông minh': 'Smartwatch',
  'Tai nghe': 'Headphones',
  'Loa': 'Speaker',
  'Máy ảnh / Quay phim': 'Camera / Camcorder',
  'Tivi': 'TV',
  'Màn hình': 'Monitor',
  'Bàn phím': 'Keyboard',
  'Chuột': 'Mouse',
  'Máy chơi game': 'Games console',
  'Điều hòa': 'Air conditioner',
  'Tủ lạnh': 'Fridge',
  'Máy giặt / Sấy': 'Washer / Dryer',
  'Đồ nhà bếp': 'Kitchen appliances',
  'Đồ gia dụng khác': 'Other appliances',
  'Điện tử khác': 'Other electronics',
  'Nội thất': 'Furniture',
  'Khác': 'Other',
  // `lib/device-paste.ts::PASTE_FIELD_LABELS.model` — identical in both
  // languages, registered anyway so the label-map invariant is uniform.
  'Model': 'Model',

  'Xem tất cả': 'View all',

  // ── Shared component defaults (`components/empty-state.tsx`) ────────────
  //
  // Only the description lives here. `<EmptyState>`'s other two defaults,
  // `Chưa có thiết bị nào, mày` and `Thêm thiết bị`, are registered by
  // `messages/devices.ts` (the component is generic, the sentences are not), so
  // the component looks them up through the merged catalog rather than getting a
  // second, duplicate entry here.
  'Bắt đầu bằng cách thêm thiết bị đầu tiên để theo dõi bảo hành.':
    'Start by adding your first device to track its warranty.',

  // ── Generic actions ─────────────────────────────────────────────────────
  'Lưu': 'Save',
  'Lưu thay đổi': 'Save changes',
  'Huỷ': 'Cancel',
  'Xoá': 'Delete',
  'Sửa': 'Edit',
  'Thêm': 'Add',
  'Tạo': 'Create',
  'Cập nhật': 'Update',
  'Tìm kiếm': 'Search',
  'Tải lại': 'Reload',
  'Thử lại': 'Try again',
  'Quay lại': 'Back',
  'Tiếp tục': 'Continue',
  // NOTE: there is deliberately no `'Bỏ qua'` entry here. That Vietnamese
  // sentence is a *finished status* in this app (`WISHLIST_STATUS.SKIPPED` in
  // `lib/wishlist-types.ts`, and the paste-import "row skipped" badge), which
  // `messages/wishlist.ts` and `messages/devices.ts` register as "Skipped".
  // This file used to carry a speculative generic "Skip" action for the same
  // key, which was a `conflicts` failure in `lib/__tests__/i18n.test.ts`; no
  // call site in `src/` ever asked for it, so it is gone. Re-add it only with a
  // dismissal button that actually needs the word.
  'Chọn...': 'Select…',
  'Chưa chọn': 'Not selected',
  'Đang tải…': 'Loading…',
  'Đang xử lý…': 'Working…',
  'Không có dữ liệu': 'No data',

  // ── Language switcher ───────────────────────────────────────────────────
  'Ngôn ngữ': 'Language',
  'Ngôn ngữ hiển thị': 'Display language',
  'Chọn ngôn ngữ cho giao diện, thông báo đẩy và email.':
    'Choose the language for the interface, push notifications and emails.',
  'Ngôn ngữ không hợp lệ': 'Unsupported language',
  'Đã đổi ngôn ngữ': 'Language changed',
  'Không lưu được lựa chọn ngôn ngữ': 'Could not save your language choice',

  // ── Document metadata (`app/layout.tsx`) ────────────────────────────────
  //
  // NOTE: the Vietnamese description was edited. It used to end "tiếng Việt
  // 100%", which this change makes false — there is no honest English for that
  // sentence, and shipping it untranslated would have advertised a Vietnamese
  // -only app to English readers. Every other Vietnamese string here is the
  // untouched original.
  'Warranty Vault — Quản lý bảo hành & gói đăng ký':
    'Warranty Vault — Warranty and subscription tracker',
  'Theo dõi thiết bị, bảo hành, gói đăng ký và wishlist — đơn giản, gọn gàng, song ngữ Việt–Anh.':
    'Track your devices, warranties, subscriptions and wishlist — simple, tidy, in Vietnamese and English.',

  // ── Transport fallbacks (`lib/api/client.ts`) ───────────────────────────
  'Bạn chưa đăng nhập': 'You are not signed in',
  'Không tìm thấy': 'Not found',
  'Đã đạt giới hạn cho phép': 'You have reached the allowed limit',
  'Thao tác quá nhanh, thử lại sau': 'Too many attempts, try again later',
  'Lỗi hệ thống, thử lại sau': 'Something went wrong, try again later',
  'Mất kết nối tới máy chủ, thử lại sau nhé.': 'Could not reach the server, please try again.',
  'Có lỗi xảy ra, thử lại sau': 'Something went wrong, try again later',
  'Phản hồi từ máy chủ không hợp lệ': 'The server sent an invalid response',
});
