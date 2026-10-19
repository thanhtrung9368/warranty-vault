'use client';

// Renders nothing. Keeps the installed-PWA icon badge in sync with the number
// of deadlines due soon.
//
// The count is a PROP, not a fetch: `(app)/layout.tsx` already reads
// `GET /v1/reminders?withinDays=30` for the sidebar badge, and this component
// is mounted by that same layout, so every authenticated page updates the
// badge without a second request. On the public/auth pages no reminder feed is
// read and no badge is set.
//
// Feature detection lives in `applyAppBadge`; Safari and Firefox simply no-op.

import { useEffect } from 'react';
import { applyAppBadge, type AppBadgeNavigator } from '@/lib/app-badge';

function badgeNavigator(): AppBadgeNavigator | null {
  if (typeof navigator === 'undefined') return null;
  return navigator as AppBadgeNavigator;
}

export function AppBadge({ count }: { count: number }) {
  useEffect(() => {
    applyAppBadge(badgeNavigator(), count);
  }, [count]);

  // Leaving the authenticated app (sign-out, expired session) must not leave a
  // stale "3 deadlines due" number on the home screen.
  useEffect(
    () => () => {
      applyAppBadge(badgeNavigator(), 0);
    },
    [],
  );

  return null;
}
