import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Điều khoản sử dụng — AssetVault',
  description: 'Điều khoản sử dụng dịch vụ AssetVault',
};

export default function TermsPage() {
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1 className="text-3xl font-bold tracking-tight">Điều khoản sử dụng</h1>
      <p className="text-sm text-muted-foreground">
        Cập nhật lần cuối: {new Date().toLocaleDateString('vi-VN')}
      </p>

      <p className="mt-6 text-muted-foreground">
        Nội dung điều khoản sử dụng sẽ được cập nhật.
      </p>
    </article>
  );
}
