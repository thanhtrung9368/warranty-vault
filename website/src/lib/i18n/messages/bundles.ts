// The route-specific catalogs the browser is allowed to receive.
//
// `index.ts` merges all 18 domain files for the SERVER (pages, server actions,
// metadata, the transactional copy helpers). That full map is ~80 KB gzip and
// has no business in the first-load JS of `/`, `/login`, `/privacy` or the
// public handoff page — those surfaces cannot render settings, claims, handoff
// or device-form copy.
//
// Each layout resolves the bundle it owns here, on the server, and hands it to
// `I18nProvider`/`InstantI18nProvider` as a prop. The client provider no longer
// imports `index.ts`, so the full map cannot follow a public route into the
// browser. The `(app)` group is different: it ships the full dictionary from a
// client module (`../app-provider.tsx`) exactly as before, so its initial JS is
// unchanged instead of paying for the map a second time in its RSC payload.
//
// ── Why some bundles mix whole files with a key list ──────────────────────
//
// A domain file is included whole when the surface genuinely renders that
// domain (the public pages render `public.ts`, the auth forms render
// `auth.ts`, the handoff claim renders `handoff.ts`).
//
// A handful of sentences are shared across domains: the landing page's product
// shot needs the warranty-pill wording, the offline page needs the dashboard's
// "Tổng quan" label, the privacy policy quotes four AI settings sentences. `pick`
// borrows exactly those KEYS from the merged map rather than pulling a 30–50 KB
// domain file in for them. The keys are copied from the domain files' own
// `t('…')` / `translate(…)` call sites; `pick` throws at module load if one is
// renamed, so a stale list fails the build/render instead of silently leaving
// an English screen showing Vietnamese.
//
// No message key or translation is changed here — this file only decides which
// subset a surface receives.

import type { Catalog } from '../types';
import { auth } from './auth';
import { common } from './common';
import { handoff } from './handoff';
import { messages } from './index';
import { publicPages } from './public';

/**
 * The exact keys one surface borrows from domains it does not otherwise ship.
 * Returns entries from the merged map so the translation stays single-sourced.
 */
function pick(keys: readonly string[]): Catalog {
  const out: Catalog = {};
  for (const key of keys) {
    const message = messages[key];
    if (!message) {
      throw new Error(
        `i18n bundle references an unregistered message: ${JSON.stringify(key)}`,
      );
    }
    out[key] = message;
  }
  return out;
}

// ── Root: shared vocabulary only ─────────────────────────────────────────
//
// Every route inherits this from `app/layout.tsx`. It is the shell's own copy
// (nav, theme/locale switcher, generic actions), not any page's.
export const rootCatalog: Catalog = common;

// ── Landing page (`app/page.tsx`, `/` and `/vi`) ─────────────────────────
//
// `public.ts` is the landing/legal dictionary. The product shot borrows the
// real app's warranty-pill wording and reminder sentence, so those keys travel
// with it; the landing does not render the device form, dashboards or settings.
export const landingCatalog: Catalog = {
  ...publicPages,
  ...pick([
    // components/landing/landing-product.tsx — device rows and summary
    'Bảo hành',
    'Giá',
    'Thêm thiết bị',
    'Tổng quan bảo hành',
    'Có {count} gói bảo hành. Gói xa nhất hết {date}.',
    '{count} thiết bị',
    // components/landing/landing-product.tsx -> lib/warranty-state.ts
    'Đã hết {days} ngày',
    'Hết hôm nay',
    'Còn {days} ngày',
    'Còn {months} tháng',
    // components/landing/landing-product.tsx -> lib/lead-days-label.ts
    'Nhắc trước {days} ngày',
    'Nhắc trước {days} ngày và đúng ngày',
    'Nhắc đúng ngày',
    'Chưa đặt mốc nhắc',
    '{head} và {last}',
  ]),
};

// ── Legal pages (`(public)/privacy|terms|cookies`, `share/result`) ───────
//
// The legal contents are `public.ts`; the privacy policy quotes four sentences
// from the AI settings copy, which is all it borrows from `settings.ts`.
export const legalCatalog: Catalog = {
  ...publicPages,
  ...pick([
    'Đọc ảnh/PDF hoá đơn hoặc thẻ bảo hành để tự điền thông tin. File đã giải mã được gửi tới Anthropic, dịch vụ AI ở Mỹ (ngoài Việt Nam).',
    'Đọc chín điều khoản hợp đồng từ thẻ bảo hành.',
    'Đánh giá một lần sửa chữa có thuộc diện bảo hành không và soạn đơn gửi trung tâm. Nội dung phiếu sửa chữa, thông tin thiết bị và điều khoản hợp đồng cũng được gửi tới Anthropic.',
    'Anthropic tự động xoá đầu vào/đầu ra trong vòng 30 ngày (trừ khi pháp luật hoặc chính sách của họ yêu cầu giữ lâu hơn) và mặc định không dùng dữ liệu API để huấn luyện.',
  ]),
};

// ── Auth flows (`(auth)/login|register|forgot|reset|confirm-email`) ──────
//
// The forms are `auth.ts`; they link to the two legal documents and reuse the
// email label from `public.ts`, whose cookie banner the auth shell also mounts.
// Three password/profile labels are shared with `settings.ts` because the same
// form copy appears in Cài đặt.
export const authCatalog: Catalog = {
  ...auth,
  ...pick([
    // components/auth-form.tsx — legal links and the email label
    'Email',
    'Tạo tài khoản miễn phí',
    'Đăng ký mất 30 giây. Không thẻ tín dụng. Gói miễn phí có quảng cáo; Warrly Premium thì không.',
    'Điều khoản sử dụng',
    'Chính sách bảo mật',
    // components/consent/consent-banner.tsx — the cookie notice/tray
    'Quản lý cookie',
    'Cookie trên Warrly',
    'Cookie thiết yếu',
    'Luôn bật',
    'Phiên đăng nhập, ngôn ngữ và giao diện. Luôn bật vì trang không chạy đúng nếu thiếu.',
    'Quảng cáo',
    'Cookie và định danh thiết bị dùng cho quảng cáo bên thứ ba, chỉ khi bạn đồng ý. Mặc định tắt.',
    'Warrly dùng cookie thiết yếu để đăng nhập và ghi nhớ ngôn ngữ, giao diện. Cookie quảng cáo là tuỳ chọn và mặc định tắt; chỉ bật khi bạn đồng ý.',
    'Bạn có thể đổi lựa chọn bất cứ lúc nào qua “Tuỳ chọn cookie” ở chân trang.',
    'Lưu lựa chọn',
    'Từ chối không cần thiết',
    'Chấp nhận tất cả',
    'Quản lý',
    'Tuỳ chọn cookie',
    // The three password/profile labels shared with `settings.ts`.
    'Tên hiển thị',
    'Đổi mật khẩu',
    'Mật khẩu mới',
  ]),
};

// ── Public resale-handoff claim (`/handoff/[code]`) ──────────────────────
//
// The claim UI is `handoff.ts`; its shell is the public header/footer, which
// uses five `public.ts` sentences (four links + the consent control).
export const handoffCatalog: Catalog = {
  ...handoff,
  ...pick([
    'Chính sách bảo mật',
    'Điều khoản sử dụng',
    'Chính sách Cookie',
    'Hỗ trợ',
    'Tuỳ chọn cookie',
  ]),
};

// ── Offline fallback (`/offline`) ────────────────────────────────────────
//
// The page itself is server-rendered; only the saved-pages list is client
// code, and it renders three `public.ts` sentences plus the dashboard label.
export const offlineCatalog: Catalog = pick([
  'Tổng quan',
  'Trang đã lưu để xem ngoại tuyến',
  'Chưa có trang nào được lưu. Khi còn mạng, mở một thiết bị hoặc trang tổng quan rồi quay lại đây.',
  'Đã lưu lúc {time}',
]);
