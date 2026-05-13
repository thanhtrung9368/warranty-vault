import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Chính sách bảo mật — AssetVault',
  description: 'Chính sách bảo mật và xử lý dữ liệu của AssetVault',
};

export default function PrivacyPage() {
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1 className="text-3xl font-bold tracking-tight">Chính sách bảo mật</h1>
      <p className="text-sm text-muted-foreground">
        Cập nhật lần cuối: {new Date().toLocaleDateString('vi-VN')}
      </p>

      <p className="mt-6 text-muted-foreground">
        Nội dung chính sách bảo mật sẽ được cập nhật.
      </p>
    </article>
  );
}
