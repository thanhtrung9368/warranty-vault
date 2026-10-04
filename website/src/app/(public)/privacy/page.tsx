import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chính sách bảo mật — Warranty Vault',
  description: 'Chính sách bảo mật và xử lý dữ liệu của Warranty Vault',
};

const UPDATED = '05/06/2026';

export default function PrivacyPage() {
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1 className="display text-3xl">Chính sách bảo mật</h1>
      <p className="text-sm text-muted">Cập nhật lần cuối: {UPDATED}</p>

      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-ink-2">
        <p>
          Warranty Vault là công cụ cá nhân để theo dõi thiết bị, bảo hành, gói đăng ký và danh sách
          “thèm”. Trang này mô tả bọn tao thu thập gì, lưu thế nào và chia sẻ với ai. Nguyên tắc gọn
          lại: <b>dữ liệu của mày là của mày</b> — bọn tao không bán, không quảng cáo, không tracking.
        </p>

        <div>
          <h3 className="display text-lg">1. Dữ liệu bọn tao lưu</h3>
          <p className="mt-2">
            Email và mật khẩu (lưu dưới dạng băm bcrypt, không bao giờ lưu mật khẩu gốc); các bản ghi
            mày tự nhập (thiết bị, gói bảo hành, subscription, wishlist); file đính kèm mày tải lên
            (ảnh hoá đơn / phiếu bảo hành); và token thông báo đẩy của thiết bị nếu mày bật push.
          </p>
        </div>

        <div>
          <h3 className="display text-lg">2. Mã hoá &amp; lưu trữ</h3>
          <p className="mt-2">
            File đính kèm được mã hoá <b>AES-256-GCM</b> khi lưu trên máy chủ, mỗi file một khoá riêng
            (khoá này lại được bọc bởi khoá chủ của hệ thống). Phiên đăng nhập nằm trong một cookie đã
            mã hoá (<code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px]">wv_session</code>).
            Toàn bộ dữ liệu nằm trên cơ sở dữ liệu do bọn tao tự vận hành.
          </p>
        </div>

        <div>
          <h3 className="display text-lg">3. Tính năng AI quét hoá đơn (tự chọn bật)</h3>
          <p className="mt-2">
            Mặc định tính năng này <b>TẮT</b>. Chỉ khi mày tự bật trong Cài đặt, ảnh hoá đơn mày chọn
            mới được <b>giải mã và gửi tới nhà cung cấp AI bên thứ ba (Anthropic)</b> để tự đọc thông
            tin điền vào form. Kết quả luôn là bản nháp — mày kiểm tra lại rồi mới lưu. Không bật thì
            ảnh không bao giờ rời máy chủ ở dạng đã giải mã. Mày có thể tắt lại bất cứ lúc nào.
          </p>
        </div>

        <div>
          <h3 className="display text-lg">4. Bên thứ ba bọn tao dùng</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li><b>Anthropic</b> — chỉ khi mày bật AI quét hoá đơn (xem mục 3).</li>
            <li><b>Resend</b> — gửi email đặt lại mật khẩu khi mày yêu cầu.</li>
            <li>
              <b>Apple (APNs), Google (FCM), trình duyệt (Web Push)</b> — chuyển thông báo nhắc bảo
              hành tới thiết bị, chỉ khi mày bật push.
            </li>
          </ul>
          <p className="mt-2">Ngoài các dịch vụ trên, bọn tao không chia sẻ dữ liệu với ai.</p>
        </div>

        <div>
          <h3 className="display text-lg">5. Không quảng cáo, không tracking</h3>
          <p className="mt-2">
            Không gắn pixel, không Google Analytics, không Facebook SDK, không cookie quảng cáo.
          </p>
        </div>

        <div>
          <h3 className="display text-lg">6. Quyền của mày</h3>
          <p className="mt-2">
            Mày có thể <b>xuất toàn bộ dữ liệu</b> ra file JSON (Cài đặt → Dữ liệu) bất cứ lúc nào, và
            <b> xoá tài khoản</b> để xoá vĩnh viễn mọi thiết bị, hoá đơn, ảnh và cài đặt. Thao tác xoá
            không thể hoàn tác.
          </p>
        </div>

        <div>
          <h3 className="display text-lg">7. Liên hệ</h3>
          <p className="mt-2">
            Có thắc mắc về dữ liệu:{' '}
            <a href="mailto:hi@warrantyvault.app" className="font-semibold text-primary hover:underline">
              hi@warrantyvault.app
            </a>
          </p>
        </div>
      </div>
    </article>
  );
}
