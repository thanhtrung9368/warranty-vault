import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/metadata';
import { TermsContent } from '@/components/legal/terms-content';
import { DocumentTitleSync } from '@/components/i18n/document-title';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getI18n();
  return pageMetadata({
    title: t('Điều khoản sử dụng — Warrly'),
    description: t('Điều khoản sử dụng dịch vụ Warrly'),
    path: '/terms',
    locale,
  });
}

// The visible copy lives in the client component so an in-place language
// switch can re-render it without a request. This file stays a Server
// Component because `generateMetadata` must run per request — the `<head>`,
// canonical and hreflang are still server-emitted.
export default function TermsPage() {
  return (
    <>
      <DocumentTitleSync
        title="Điều khoản sử dụng — Warrly"
        description="Điều khoản sử dụng dịch vụ Warrly"
      />
      <TermsContent />
    </>
  );
}
