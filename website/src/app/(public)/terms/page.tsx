import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Điều khoản sử dụng — WarrantyVault',
  description: 'Điều khoản sử dụng dịch vụ WarrantyVault',
};

export default function TermsPage() {
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1 className="display text-3xl">Điều khoản sử dụng</h1>
      <p className="text-sm text-muted">
        Cập nhật lần cuối: {new Date().toLocaleDateString('vi-VN')}
      </p>

      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-ink-2">
        <p>Nội dung điều khoản sử dụng sẽ được cập nhật. Đây là bản placeholder.</p>
        <div>
          <h3 className="display text-lg">1. Sử dụng cá nhân</h3>
          <p className="mt-2">
            WarrantyVault là công cụ cá nhân. Đừng dùng để lưu trữ dữ liệu của người khác mà không được sự cho phép.
          </p>
        </div>
        <div>
          <h3 className="display text-lg">2. Liên hệ</h3>
          <p className="mt-2">
            Có thắc mắc:{' '}
            <a href="mailto:hi@warrantyvault.app" className="font-semibold text-primary hover:underline">
              hi@warrantyvault.app
            </a>
          </p>
        </div>
      </div>
    </article>
  );
}
