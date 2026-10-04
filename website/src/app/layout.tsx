import type { Metadata } from 'next';
import Script from 'next/script';
import { Fraunces, Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { PwaRegister } from '@/components/pwa-register';
import { I18nProvider } from '@/lib/i18n/client';
import { getI18n } from '@/lib/i18n/server';

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
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('Warranty Vault — Quản lý bảo hành & gói đăng ký'),
    description: t('Theo dõi thiết bị, bảo hành, gói đăng ký và wishlist — đơn giản, gọn gàng, song ngữ Việt–Anh.'),
    manifest: '/manifest.webmanifest',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'Warranty Vault',
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

const PREFS_BOOTSTRAP = `try { var p = JSON.parse(localStorage.getItem('wv:prefs') || '{}'); ['radius','density','font','accent','sidebar'].forEach(function(k){ if(p[k]) document.documentElement.setAttribute('data-' + k, p[k]); }); } catch(e) {}`;

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
      <body className={jakarta.className}>
        <Script id="wv-prefs" strategy="beforeInteractive">
          {PREFS_BOOTSTRAP}
        </Script>
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
