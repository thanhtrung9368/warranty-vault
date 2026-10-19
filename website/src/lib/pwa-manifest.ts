// The PWA manifest, as data rather than a static JSON file.
//
// It has to be generated per request because the app is bilingual and the
// manifest is copy the user reads (the install prompt, the home-screen name,
// and the long-press shortcut labels). A static `public/manifest.webmanifest`
// could only ever pick one language; `app/manifest.ts` serves this object and
// resolves the same `wv_locale` → `User.locale` → `Accept-Language` → `en`
// chain as every other screen.
//
// Two contracts live here and are pinned by tests:
//
//   * every shortcut URL resolves to a real route file (`page.tsx` / `route.ts`)
//     — a shortcut to a 404 is worse than no shortcut at all;
//   * every label is a key in `lib/i18n/messages` (the Vietnamese original),
//     so English readers get English and Vietnamese readers get the source.
//
// No Next/React import is allowed at runtime: only the metadata TYPE is
// imported, so the shortcut list can be unit-tested without a server.

import type { MetadataRoute } from 'next';
import { translate } from './i18n/catalog';
import type { Locale } from './i18n/locale';
import { SHARE_FILE_FIELD, SHARE_TARGET_ACTION } from './share-target';

export type PwaShortcut = {
  /** Vietnamese sentence — the i18n catalog key. */
  name: string;
  /** Shorter Vietnamese label — also a catalog key (the OS truncates). */
  shortName: string;
  /** Same-origin destination. Must resolve to a real route (tested). */
  url: string;
};

/**
 * Actions people repeat from an installed app. Order matters: the OS shows
 * these in order, and a long list gets collapsed, so the three that matter are
 * first and there is deliberately no dashboard/statistics shortcut — those are
 * browsing, not a repeat action.
 *
 * `Thêm thiết bị` and `Nhắc nhở` already existed. `Hộp thư` is new: the
 * capture-first inbox is where a receipt goes before a device row exists, and
 * it is the screen the share sheet lands on.
 */
export const PWA_SHORTCUTS = [
  {
    name: 'Thêm thiết bị',
    shortName: 'Thêm',
    url: '/devices/new',
  },
  {
    name: 'Hộp thư',
    shortName: 'Hộp thư',
    url: '/inbox',
  },
  {
    name: 'Nhắc nhở',
    shortName: 'Nhắc',
    url: '/reminders',
  },
] as const satisfies readonly PwaShortcut[];

const SHORTCUT_ICON = {
  src: '/icon-192.png',
  sizes: '192x192',
  type: 'image/png',
} as const;

const ICONS: NonNullable<MetadataRoute.Manifest['icons']> = [
  { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png', purpose: 'any' },
];

/**
 * Build the manifest in one language.
 *
 * `lang` is the manifest's own language tag, not a display name; the browser
 * uses it for the install prompt. The two app-level strings reuse keys that
 * already existed for `generateMetadata()` in `app/layout.tsx`, so the store
 * copy and the document metadata cannot drift.
 */
export function buildWebManifest(locale: Locale): MetadataRoute.Manifest {
  return {
    name: translate(locale, 'Warrly — Quản lý bảo hành & gói đăng ký'),
    short_name: 'Warrly',
    description: translate(
      locale,
      'Theo dõi thiết bị, bảo hành, gói đăng ký và wishlist — đơn giản, gọn gàng, song ngữ Việt–Anh.',
    ),
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FFF7EE',
    theme_color: '#FF6B45',
    lang: locale,
    share_target: {
      action: SHARE_TARGET_ACTION,
      method: 'POST',
      enctype: 'multipart/form-data',
      params: {
        files: [
          {
            name: SHARE_FILE_FIELD,
            accept: ['image/*', 'application/pdf'],
          },
        ],
      },
    },
    icons: ICONS,
    shortcuts: PWA_SHORTCUTS.map((shortcut) => ({
      name: translate(locale, shortcut.name),
      short_name: translate(locale, shortcut.shortName),
      url: shortcut.url,
      icons: [SHORTCUT_ICON],
    })),
  };
}
