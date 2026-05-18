import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chính sách Cookie — WarrantyVault',
  description: 'Chính sách sử dụng cookie của WarrantyVault',
};

export default function CookiesPage() {
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1 className="display text-3xl">Chính sách Cookie</h1>
      <p className="text-sm text-muted">
        Cập nhật lần cuối: {new Date().toLocaleDateString('vi-VN')}
      </p>

      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-ink-2">
        <p>Nội dung chính sách cookie sẽ được cập nhật. Đây là bản placeholder.</p>
        <div>
          <h3 className="display text-lg">1. Cookie thiết yếu</h3>
          <p className="mt-2">
            Bọn tao chỉ dùng cookie cần thiết cho phiên đăng nhập (<code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px]">wv_session</code>). Không tracking, không quảng cáo.
          </p>
        </div>
      </div>
    </article>
  );
}
