'use client';

import * as React from 'react';
import { useLocale, useT } from '@/lib/i18n/client';

/**
 * Keep the tab title (and the `<meta name="description">` a visitor might see
 * in a browser UI) in the language that is on screen.
 *
 * The server already emits the right `<head>` for the request — that is what
 * crawlers and link unfurlers read, and it does not change. This component only
 * catches up after an in-place switch: the document was served with the title
 * in language A and the page is now language B, so a Vietnamese reader should
 * not still see an English tab.
 *
 * It runs in an effect, i.e. one paint behind the body text: a tab title is not
 * part of the "same frame" guarantee the page body has, and writing it during
 * render would mutate the DOM React owns. The keys are the same catalog keys
 * `generateMetadata` uses, so the copy cannot drift.
 */
export function DocumentTitleSync({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const locale = useLocale();
  const t = useT();

  React.useEffect(() => {
    document.title = t(title);
    if (description) {
      const meta = document.querySelector('meta[name="description"]');
      if (meta) meta.setAttribute('content', t(description));
    }
  }, [locale, t, title, description]);

  return null;
}
