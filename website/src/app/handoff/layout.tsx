import type { Metadata } from 'next';
import { PublicFooter, PublicHeader } from '@/components/legal/public-chrome';
import { I18nProvider } from '@/lib/i18n/client';
import { handoffCatalog } from '@/lib/i18n/messages/bundles';
import { getI18n } from '@/lib/i18n/server';

/**
 * Chrome for the public resale-handoff claim page (`/handoff/[code]`).
 *
 * Deliberately NOT under `(public)`: that group mounts the landing page's
 * JSON-LD and its instant language switcher, both of which assume indexable
 * marketing copy. A claim page carries a credential in its URL and is rendered
 * per request. It is also not under `(auth)` — its form is not a sign-in.
 *
 * `noindex` + no canonical + `no-referrer`: a code belongs in a link someone
 * was given, never in a search result, and it must not leak in the Referer
 * header when the buyer follows a support link from this page.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  alternates: { canonical: null },
  referrer: 'no-referrer',
};

export default async function HandoffLayout({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return (
    <I18nProvider locale={locale} catalog={handoffCatalog}>
      <div className="flex min-h-screen flex-col bg-background">
        <PublicHeader />
        <main className="flex-1 px-4 py-10 md:px-8">
          <div className="mx-auto w-full max-w-2xl">{children}</div>
        </main>
        <div className="px-4 pb-8 md:px-8">
          <div className="mx-auto max-w-2xl">
            <PublicFooter />
          </div>
        </div>
      </div>
    </I18nProvider>
  );
}
