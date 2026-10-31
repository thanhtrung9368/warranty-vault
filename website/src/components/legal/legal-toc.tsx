'use client';

import { ChevronDown } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

/**
 * A table of contents for the three long legal documents.
 *
 * The previous legal pages were one 10,000 px column of 15 sections with no
 * index: a reader who arrived to check one clause had to scroll and scan every
 * heading. This puts the document's own section titles in a sticky rail on a
 * wide screen and in a disclosure at the top of the document on a phone. The
 * labels are the existing heading keys, with their leading "1. " removed for
 * the list — no new prose.
 *
 * It is a plain list of in-page anchors, so it works with JavaScript off. The
 * headings carry `scroll-mt-28` so the sticky page header does not cover the
 * line a link lands on.
 */
export type LegalSection = {
  id: string;
  /** The Vietnamese heading key, exactly as the section itself renders it. */
  key: string;
};

export function LegalToc({ entries }: { entries: LegalSection[] }) {
  const t = useT();
  const label = t('Mục lục');
  const items = entries.map((entry) => ({
    id: entry.id,
    text: t(entry.key).replace(/^\d+\.\s*/, ''),
  }));

  return (
    <>
      <details className="group rounded-lg border border-border bg-card lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
          {label}
          <ChevronDown
            className="h-4 w-4 shrink-0 text-ink-2/60 transition-transform duration-200 group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <ol className="border-t border-border px-5 py-4">
          {items.map((item) => (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                className="block py-1.5 text-sm leading-snug text-ink-2/80 hover:text-ink hover:underline"
              >
                {item.text}
              </a>
            </li>
          ))}
        </ol>
      </details>

      <nav aria-label={label} className="hidden self-start lg:block">
        <div className="sticky top-24">
          <p className="text-sm font-semibold text-ink-2/80">{label}</p>
          <ol className="mt-3 border-l border-border">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="-ml-px block border-l border-transparent py-1.5 pl-4 text-sm leading-snug text-ink-2/80 transition-colors hover:border-primary hover:text-ink"
                >
                  {item.text}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </nav>
    </>
  );
}
