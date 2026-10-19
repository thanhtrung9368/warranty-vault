import type { MetadataRoute } from 'next';
import { getI18n } from '@/lib/i18n/server';
import { buildWebManifest } from '@/lib/pwa-manifest';

// Served at `/manifest.webmanifest` (the same URL `app/layout.tsx` advertises).
//
// This used to be a static file in `public/`, which meant every installed app
// said "Thêm thiết bị" in Vietnamese even when the reader had chosen English.
// The manifest is copy — the install prompt, the home-screen name and the
// long-press shortcuts — so it follows the same per-request language as the
// page. That makes this route dynamic on purpose; do not "optimise" it back
// to a cached constant without losing the translation.
export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const { locale } = await getI18n();
  return buildWebManifest(locale);
}
