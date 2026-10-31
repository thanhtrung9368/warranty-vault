'use client';

import type { ReactNode } from 'react';
import { useT } from '@/lib/i18n/client';
import { LegalToc, type LegalSection } from './legal-toc';

/**
 * The shell shared by `/privacy`, `/terms` and `/cookies`.
 *
 * A legal page is a reading page, not a marketing page: one measure, a real
 * heading hierarchy, and a contents rail. The old shell wrapped the whole
 * document in a white rounded card inside a 768 px column — on a phone that
 * was a 10,000 px white slab, and on a desktop the sidebar space was empty.
 * The document now sits on the page background, with the title and its date in
 * a header rule and the sections in a 68ch measure beside a sticky contents
 * rail.
 *
 * `titleKey` and `noteKey` are Vietnamese message keys, so the in-place
 * language switch still re-renders the whole document without a request.
 */
export function LegalDocument({
  titleKey,
  updated,
  noteKey,
  sections,
  children,
}: {
  titleKey: string;
  updated: string;
  noteKey?: string;
  sections: LegalSection[];
  children: ReactNode;
}) {
  const t = useT();

  return (
    <article>
      <header className="border-b border-border pb-8">
        <p className="text-sm font-medium text-ink-2/80">
          {t('Cập nhật lần cuối: {date}', { date: updated })}
        </p>
        <h1 className="display mt-2 text-3xl leading-[1.08] tracking-[-0.02em] text-ink md:text-4xl">
          {t(titleKey)}
        </h1>
        {noteKey ? (
          <p className="mt-4 max-w-[68ch] text-base leading-relaxed text-ink-2/80">
            {t(noteKey)}
          </p>
        ) : null}
      </header>
      <div className="mt-8 grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
        <LegalToc entries={sections} />
        <div className="min-w-0 max-w-[68ch] space-y-10 text-base leading-[1.7] text-ink-2 md:text-lg">
          {children}
        </div>
      </div>
    </article>
  );
}
