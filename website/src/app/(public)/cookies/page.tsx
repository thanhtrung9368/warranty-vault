import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';
import { pageMetadata } from '@/lib/metadata';
import { CookiesContent } from '@/components/legal/cookies-content';
import { DocumentTitleSync } from '@/components/i18n/document-title';

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getI18n();
  return pageMetadata({
    title: t('Chính sách Cookie — Warrly'),
    description: t('Chính sách sử dụng cookie của Warrly'),
    path: '/cookies',
    locale,
  });
}

// The visible copy lives in the client component so an in-place language
// switch can re-render it without a request. This file stays a Server
// Component because `generateMetadata` must run per request — the `<head>`,
// canonical and hreflang are still server-emitted.
export default function CookiesPage() {
  return (
    <>
      <DocumentTitleSync
        title="Chính sách Cookie — Warrly"
        description="Chính sách sử dụng cookie của Warrly"
      />
      <CookiesContent />
    </>
  );
}
