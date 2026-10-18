'use client';

// Client half of the offline story. Rendered once by the authenticated app
// layout (`src/app/(app)/layout.tsx`); it renders nothing.
//
// Two jobs:
//
//   1. PRIME. Ask the service worker to keep `/dashboard`, `/devices` and
//      `/reminders` warm. Without this, a user who never opened the device
//      list could not look anything up offline. Detail pages are not primed
//      (up to 50 renders); they are cached when opened.
//
//   2. DOCUMENT NAVIGATION WHEN OFFLINE. Next's `<Link>` normally fetches an
//      RSC payload (`?_rsc=…`), which the service worker deliberately does not
//      cache — a flight payload is tied to a router tree, not just a URL. While
//      the browser reports itself offline, intercept same-origin link clicks
//      and use a full document navigation instead. The service worker then
//      serves the cached document (or the offline page), and the stale bar is
//      injected before hydration.

import { useEffect } from 'react';

function primeOfflineCache(): void {
  if (!('serviceWorker' in navigator)) return;
  if (navigator.onLine === false) return;

  navigator.serviceWorker.ready
    .then((registration) => {
      const worker = registration.active ?? registration.waiting;
      worker?.postMessage({ type: 'WV_PRIME' });
    })
    .catch(() => undefined);
}

export function OfflineBridge() {
  useEffect(() => {
    primeOfflineCache();
    window.addEventListener('online', primeOfflineCache);
    return () => window.removeEventListener('online', primeOfflineCache);
  }, []);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (navigator.onLine !== false) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;

      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

      // A same-page hash link should not trigger a document fetch.
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        if (url.hash) window.location.hash = url.hash;
        return;
      }

      event.preventDefault();
      window.location.assign(url.href);
    }

    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
