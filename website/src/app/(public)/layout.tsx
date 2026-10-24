import { InstantI18nProvider } from '@/lib/i18n/client';
import { PublicStructuredData } from '@/lib/structured-data';
import { PublicBackLink, PublicHeader } from '@/components/legal/public-chrome';
import { DocumentTitleSync } from '@/components/i18n/document-title';
import { getI18n } from '@/lib/i18n/server';

/**
 * The legal pages' shell.
 *
 * The layout is a Server Component (it resolves the request's language and
 * mounts the JSON-LD), but everything below it can switch language in place:
 * `InstantI18nProvider` holds the active locale, seeded with the server's
 * answer, and the page content plus the two nav links are client components
 * that read it. The switch therefore costs no request and no reload — the
 * `(public)` surface behaves like the landing page.
 *
 * `DocumentTitleSync` is not given a title here: each page knows its own, so
 * the page passes it. The server-emitted `<head>` remains the crawler's view.
 */
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale } = await getI18n();
  return (
    <InstantI18nProvider locale={locale}>
      <div className="flex min-h-screen flex-col">
        <PublicHeader />
        <main className="flex-1 px-4 py-10 md:px-8">
          <div className="mx-auto w-full max-w-3xl">
            <PublicStructuredData />
            <PublicBackLink />
            <div className="rounded-xl border-[1.5px] border-border bg-card p-6 shadow-soft sm:p-9">
              {children}
            </div>
          </div>
        </main>
      </div>
    </InstantI18nProvider>
  );
}
