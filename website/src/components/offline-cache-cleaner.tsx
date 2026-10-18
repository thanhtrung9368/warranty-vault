'use client';

// Belt-and-braces privacy guard for the signed-out auth pages.
//
// `logoutUser` is a Server Action and cannot touch Cache Storage, so the
// explicit sign-out path (`components/user-menu.tsx`) clears the cached pages
// in the browser before calling it. This component covers the paths where the
// user never clicks "sign out":
//
//   * the session expired and `requireUser()` redirected to `/login`;
//   * a shared browser landed on `/login` or `/register` without a sign-out.
//
// `/confirm-email/<token>` is deliberately excluded: it lives in the same
// `(auth)` layout and is routinely opened by a signed-in user confirming an
// email change. Clearing their offline cache there would be a surprising data
// loss, not a privacy fix.

import { useEffect } from 'react';
import { clearOfflinePageCache } from '@/lib/offline/cache-client';

export function OfflineCacheCleaner() {
  useEffect(() => {
    if (window.location.pathname.startsWith('/confirm-email/')) return;
    void clearOfflinePageCache();
  }, []);

  return null;
}
