import type { Metadata } from 'next';
import { Fraunces, Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { PwaRegister } from '@/components/pwa-register';
import { I18nProvider } from '@/lib/i18n/client';
import { getI18n } from '@/lib/i18n/server';
import { pageMetadata, siteBaseUrl } from '@/lib/metadata';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'vietnamese'],
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
});

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  preload: false,
});

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  weight: ['600', '700', '800'],
  variable: '--font-fraunces',
  preload: false,
});

// Metadata follows the same per-request language as the page it describes —
// `/` is indexable, and a link preview is copy a user reads. It is
// `generateMetadata` rather than a constant because a Vietnamese visitor
// sharing the page should not hand an English headline to the chat app.
//
// This used to return only title/description/icons, so every shared link was a
// bare URL: no `metadataBase`, no canonical, no `openGraph`, no `twitter` card.
// For a Vietnam-first product that spreads through Zalo groups, the preview is
// the first landing page. `pageMetadata()` builds all four (including the real
// 1200×630 `/og` ImageResponse) from this same translated title/description;
// `metadataBase` makes the relative card URL absolute in the emitted HTML.
export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await getI18n();
  const title = t('Warrly — Quản lý bảo hành & gói đăng ký');
  const description = t(
    'Theo dõi thiết bị, bảo hành, gói đăng ký và wishlist — đơn giản, gọn gàng, song ngữ Việt–Anh.',
  );

  return {
    metadataBase: siteBaseUrl(),
    ...pageMetadata({ title, description, path: '/', locale }),
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'Warrly',
    },
    icons: {
      icon: [
        { url: '/icon.svg', type: 'image/svg+xml' },
        { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      apple: '/apple-touch-icon.png',
    },
  };
}

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFF7EE' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1018' },
  ],
};

// Runs before the first paint (Next's `beforeInteractive` strategy), so the
// document carries its motion preference from the very first frame. The CSS
// media query below already handles `prefers-reduced-motion` with no JS; the
// attribute is what lets the reveal engine agree with that first paint instead
// of arming a hidden state and discovering the preference a moment later.
const PREFS_BOOTSTRAP = `try { var p = JSON.parse(localStorage.getItem('wv:prefs') || '{}'); ['radius','density','font','accent','sidebar'].forEach(function(k){ if(p[k]) document.documentElement.setAttribute('data-' + k, p[k]); }); } catch(e) {} try { document.documentElement.setAttribute('data-motion', window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'full'); } catch(e) {}`;

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The single resolution point for the whole app: cookie → stored preference →
  // Accept-Language → `en` (`lib/i18n/server.ts`). Everything below — Server
  // Components by calling `getI18n()`, Client Components through the provider —
  // reads this same answer, so the page cannot render in two languages.
  //
  // Calling it here (rather than per page) is also what makes `cookies()` and
  // `headers()` part of every render. That is the price of a per-request
  // language: pages that used to be static (`/privacy`, `/terms`) are rendered
  // per request now. The alternative was a `/[lang]/…` route segment, which
  // would have rewritten every URL in the app and every link in the docs.
  const { locale } = await getI18n();
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${jakarta.variable} ${inter.variable} ${fraunces.variable}`}
    >
      <head>
        {/* Plain inline script, not `next/script`'s beforeInteractive queue:
            Next 16 defers that queue through a chunk, which can land after the
            browser's first paint (observed on this machine), and the whole
            point here is that the document is in its reduced-motion state on
            the very first frame. Executed while the head is parsed, it is
            synchronously ahead of any body content. Same code as before, so
            the stored appearance prefs behave exactly as they did. */}
        <script
          id="wv-prefs"
          dangerouslySetInnerHTML={{ __html: PREFS_BOOTSTRAP }}
        />
      </head>
      <body className={jakarta.className}>
        {/* Answered by the service worker: empty for a fresh page, a generated
            stale-data bar when it just served this document from cache. It is
            part of the React tree, so no DOM injection and no hydration
            mismatch. See `public/sw.js` → offlineIndicatorResponse. */}
        {/* eslint-disable-next-line @next/next/no-css-tags -- a standalone URL is the point: the service worker answers it */}
        <link rel="stylesheet" href="/offline-indicator.css" />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <I18nProvider locale={locale}>
            <div className="app-bg" aria-hidden />
            {children}
            <Toaster richColors closeButton position="top-right" />
            <PwaRegister />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
