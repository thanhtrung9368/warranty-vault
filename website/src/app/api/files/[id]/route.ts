import { NextResponse } from 'next/server';
import { getAuthCookie } from '@/lib/auth-cookie';

// GET /api/files/<attachmentId>
//
// Thin proxy to the Go service's `GET /v1/files/{id}` endpoint. The Go
// handler is auth-gated (Bearer), ownership-checked, decrypts the on-disk
// blob, and streams it back. We:
//   1) Read the iron-session cookie for the bearer token.
//   2) Forward the request to Go with `Authorization: Bearer <token>` and
//      pass `?download=` straight through.
//   3) Stream the upstream body to the browser, copying Content-Type +
//      Content-Disposition from upstream and re-asserting the security
//      headers locally (defense-in-depth — we don't trust upstream alone).
//
// The browser path stays the same (`/api/files/<id>`), so existing callers
// (<img src>, AttachmentGallery preview, "Tải xuống" link) keep working
// without changes. Mobile clients hit the Go endpoint directly.

const GO_API_URL = (process.env.GO_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

// Headers we always re-emit on the proxy response. Defensive copy of the
// previous (Prisma-backed) implementation: keep user content out of shared
// caches and sandbox any embedded JS/HTML in PDFs/SVGs.
const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox; img-src 'self' data:",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Guard against weird IDs at the edge — ulid/cuid charset only. Mirrors
  // the previous TS implementation. Avoids forwarding `..`/url-encoded
  // garbage to Go.
  if (!/^[a-z0-9_-]+$/i.test(id)) {
    return new NextResponse(null, { status: 404 });
  }

  // Pull the bearer token off the iron-session cookie. Missing/expired
  // token → 404 (not 401) so we don't leak whether the attachment exists.
  const cookie = await getAuthCookie();
  if (!cookie.accessToken) {
    return new NextResponse(null, { status: 404 });
  }
  if (cookie.expiresAt && cookie.expiresAt <= Date.now()) {
    return new NextResponse(null, { status: 404 });
  }

  // Pass `?download=1` (and any other query params) through unchanged.
  const incoming = new URL(req.url);
  const upstreamUrl = `${GO_API_URL}/v1/files/${encodeURIComponent(id)}${incoming.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cookie.accessToken}` },
      cache: 'no-store',
      // Forward the abort signal so a closed browser tab cancels the
      // upstream stream too.
      signal: req.signal,
    });
  } catch {
    // Network / Go service unreachable.
    return new NextResponse(null, { status: 502, headers: SECURITY_HEADERS });
  }

  // Don't leak Go's 4xx/5xx bodies to the browser — collapse to a bare
  // status code with no body. Caller code only ever reads the status.
  if (!upstream.ok) {
    const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
    return new NextResponse(null, { status, headers: SECURITY_HEADERS });
  }

  // Stream the body back. Copy Content-Type + Content-Disposition (Go has
  // already chosen inline vs. attachment based on the `?download=` query
  // param). Re-emit security headers locally even though Go sets them too.
  const headers = new Headers(SECURITY_HEADERS);
  const ct = upstream.headers.get('Content-Type');
  if (ct) headers.set('Content-Type', ct);
  const cd = upstream.headers.get('Content-Disposition');
  if (cd) headers.set('Content-Disposition', cd);
  const cl = upstream.headers.get('Content-Length');
  if (cl) headers.set('Content-Length', cl);

  return new NextResponse(upstream.body, { status: 200, headers });
}
