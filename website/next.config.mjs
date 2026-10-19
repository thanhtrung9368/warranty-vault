/** @type {import('next').NextConfig} */

const isProd = process.env.NODE_ENV === 'production';

// CSP: self-only, allow inline styles (Tailwind), no inline scripts except Next's
// hydration (needs 'unsafe-inline' for the runtime bootstrap). We scope strictly.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob:",
  // The optional serial scanner previews a camera MediaStream through
  // `<video srcObject>` (blob/MediaStream-backed). `default-src 'self'` is the
  // fallback for media, so `media-src` is opened to exactly self + blob. No
  // remote media origin is allowed. `getUserMedia` itself is not governed by
  // CSP — it is the Permissions-Policy below.
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  // Next 16 / Turbopack inlines a small bootstrap; dev needs eval for HMR.
  isProd
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    // `camera=(self)` is required by the optional serial scanner: without it
    // `getUserMedia` rejects with NotAllowedError on every browser, even after
    // the user grants permission. Only this origin may use the camera;
    // microphone and geolocation remain disabled everywhere.
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
    : []),
];

const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Tree-shake barrel-file imports so only the icons/helpers actually
    // used get bundled — cuts dead weight from these large packages.
    optimizePackageImports: ['recharts', 'lucide-react', 'date-fns'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // The manifest is generated per request (`app/manifest.ts`) because it is
      // bilingual. A metadata route otherwise gets `Cache-Control: public`,
      // which would let a shared cache hand the English manifest to a
      // Vietnamese reader (or vice versa). Keep it private to this request.
      {
        source: '/manifest.webmanifest',
        headers: [
          {
            key: 'Cache-Control',
            value: 'private, no-cache, no-store, max-age=0, must-revalidate',
          },
          { key: 'Vary', value: 'Cookie, Accept-Language' },
        ],
      },
      // User attachments are served through the auth-gated /api/files/[id]
      // route — that route sets its own private cache + nosniff + sandbox CSP.
    ];
  },
};

export default nextConfig;
