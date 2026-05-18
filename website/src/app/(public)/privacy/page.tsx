import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chính sách bảo mật — WarrantyVault',
  description: 'Chính sách bảo mật và xử lý dữ liệu của WarrantyVault',
};

export default function PrivacyPage() {
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1 className="display text-3xl">Chính sách bảo mật</h1>
      <p className="text-sm text-muted">
        Cập nhật lần cuối: {new Date().toLocaleDateString('vi-VN')}
      </p>

      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-ink-2">
        <p>Nội dung chính sách bảo mật sẽ được cập nhật. Đây là bản placeholder.</p>
        <div>
          <h3 className="display text-lg">1. Cam kết về dữ liệu</h3>
          <p className="mt-2">
            Dữ liệu của bạn thuộc về bạn. Bọn tao không bán, không chia sẻ với bên thứ ba.
          </p>
        </div>
        <div>
          <h3 className="display text-lg">2. Không quảng cáo, không tracking</h3>
          <p className="mt-2">
            Không gắn pixel, không Google Analytics, không Facebook SDK.
          </p>
        </div>
      </div>
    </article>
  );
}
