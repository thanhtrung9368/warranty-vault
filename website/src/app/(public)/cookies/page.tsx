import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chính sách Cookie — WarrantyVault',
  description: 'Chính sách sử dụng cookie của WarrantyVault',
};

const UPDATED = '05/06/2026';

export default function CookiesPage() {
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1 className="display text-3xl">Chính sách Cookie</h1>
      <p className="text-sm text-muted">Cập nhật lần cuối: {UPDATED}</p>

      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-ink-2">
        <p>
          WarrantyVault dùng cookie ở mức tối thiểu — chỉ đủ để mày đăng nhập và giữ phiên. Không có
          cookie quảng cáo hay theo dõi.
        </p>

        <div>
          <h3 className="display text-lg">1. Cookie thiết yếu</h3>
          <p className="mt-2">
            Bọn tao dùng đúng một cookie cho phiên đăng nhập:{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px]">wv_session</code>.
            Nó được mã hoá, chỉ chứa token phiên và thời hạn — không có thông tin cá nhân đọc được. Tắt
            cookie này thì không đăng nhập được.
          </p>
        </div>

        <div>
          <h3 className="display text-lg">2. Lưu trữ cục bộ trên máy</h3>
          <p className="mt-2">
            Một vài tuỳ chọn giao diện (ví dụ chế độ sáng/tối) được lưu trong bộ nhớ cục bộ của trình
            duyệt (localStorage) trên máy mày, không gửi về máy chủ.
          </p>
        </div>

        <div>
          <h3 className="display text-lg">3. Không cookie bên thứ ba</h3>
          <p className="mt-2">
            Không Google Analytics, không pixel mạng xã hội, không cookie quảng cáo hay tracking xuyên
            trang.
          </p>
        </div>
      </div>
    </article>
  );
}
