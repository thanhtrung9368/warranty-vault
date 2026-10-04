import type { Metadata } from 'next';
import Script from 'next/script';
import { Fraunces, Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { PwaRegister } from '@/components/pwa-register';

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

export const metadata: Metadata = {
  title: 'Warranty Vault — Quản lý bảo hành & gói đăng ký',
  description: 'Theo dõi thiết bị, bảo hành, gói đăng ký và wishlist — đơn giản, gọn, tiếng Việt 100%.',
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

export const viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFF7EE' },
    { media: '(prefers-color-scheme: dark)', color: '#0E1018' },
  ],
};

const PREFS_BOOTSTRAP = `try { var p = JSON.parse(localStorage.getItem('wv:prefs') || '{}'); ['radius','density','font','accent','sidebar'].forEach(function(k){ if(p[k]) document.documentElement.setAttribute('data-' + k, p[k]); }); } catch(e) {}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${jakarta.variable} ${inter.variable} ${fraunces.variable}`}
    >
      <body className={jakarta.className}>
        <Script id="wv-prefs" strategy="beforeInteractive">
          {PREFS_BOOTSTRAP}
        </Script>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <div className="app-bg" aria-hidden />
          {children}
          <Toaster richColors closeButton position="top-right" />
          <PwaRegister />
        </ThemeProvider>
      </body>
    </html>
  );
}
