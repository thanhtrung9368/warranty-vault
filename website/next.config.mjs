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
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
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
      // User attachments are served through the auth-gated /api/files/[id]
      // route — that route sets its own private cache + nosniff + sandbox CSP.
    ];
  },
};

export default nextConfig;
