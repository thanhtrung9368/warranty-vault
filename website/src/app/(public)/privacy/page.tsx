import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/metadata';
import { PrivacyContent } from '@/components/legal/privacy-content';
import { DocumentTitleSync } from '@/components/i18n/document-title';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getI18n();
  return pageMetadata({
    title: t('Chính sách bảo mật — Warrly'),
    description: t('Chính sách bảo mật và xử lý dữ liệu của Warrly'),
    path: '/privacy',
    locale,
  });
}

// The visible copy lives in the client component so an in-place language
// switch can re-render it without a request. This file stays a Server
// Component because `generateMetadata` must run per request — the `<head>`,
// canonical and hreflang are still server-emitted.
export default function PrivacyPage() {
  return (
    <>
      <DocumentTitleSync
        title="Chính sách bảo mật — Warrly"
        description="Chính sách bảo mật và xử lý dữ liệu của Warrly"
      />
      <PrivacyContent />
    </>
  );
}
