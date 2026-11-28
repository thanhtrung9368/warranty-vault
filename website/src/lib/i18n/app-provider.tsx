'use client';

// The signed-in app's provider — the ONE place that deliberately ships the full
// merged dictionary to the browser.
//
// Why not pass it down from `(app)/layout.tsx` like the public bundles? Because
// that layout is part of every app route's RSC payload: a ~80 KB-gzip prop would
// be serialized into the flight data of every signed-in page load (and possibly
// every client navigation), trading a one-time 80 KB JS chunk for a recurring
// payload cost. The group already paid for this chunk before the split, so
// importing it here keeps `(app)` initial JS exactly as it was while moving the
// catalog OUT of the root providers that public routes mount.
//
// This module is imported by the `(app)` layout only. The root layout and the
// public/auth layouts never reach it, so `/`, `/login`, `/privacy` and the
// handoff claim cannot pull `messages/index.ts` back into their graph.

import * as React from 'react';
import { I18nProvider } from './client';
import type { Locale } from './locale';
import { messages } from './messages';

export function AppI18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <I18nProvider locale={locale} catalog={messages}>
      {children}
    </I18nProvider>
  );
}
