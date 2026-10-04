import { NextResponse } from 'next/server';
import { getAuthCookie } from '@/lib/auth-cookie';
import { getI18n } from '@/lib/i18n/server';

// GET /api/backup/export[?includeBlobs=true]
//
// Streaming proxy to Go's `GET /api/v1/backup/export`. It exists for the
// blob-carrying export: that response is a real `.zip` of up to ~110 MB
// (each attachment's encrypted bytes plus `data.json`), so it must stream
// straight to the browser instead of being buffered through a server action —
// the JSON export keeps using the server action, which needs to parse the
// payload to count devices.
//
// Go owns both formats and picks one from `includeBlobs` (default: the v5 JSON,
// byte-for-byte unchanged). We only carry the cookie's bearer token and relay
// the response headers the browser needs for a download.

const GO_API_URL = (process.env.GO_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const NO_STORE = 'private, no-store, max-age=0';

export async function GET(req: Request) {
  const { t } = await getI18n();
  const cookie = await getAuthCookie();
  if (!cookie.accessToken) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized', message: t('Bạn chưa đăng nhập') },
      { status: 401, headers: { 'Cache-Control': NO_STORE } },
    );
  }
  if (cookie.expiresAt && cookie.expiresAt <= Date.now()) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized', message: t('Phiên đăng nhập đã hết hạn') },
      { status: 401, headers: { 'Cache-Control': NO_STORE } },
    );
  }

  // Pass `includeBlobs` (and any other query param) through untouched — Go
  // validates the value and answers 400 with a Vietnamese message for anything
  // that is not true/false/1/0. That message is forwarded as-is.
  const incoming = new URL(req.url);
  const upstreamUrl = `${GO_API_URL}/v1/backup/export${incoming.search}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cookie.accessToken}` },
      cache: 'no-store',
      // A closed tab cancels the export mid-stream.
      signal: req.signal,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: 'network_error',
        message: t('Mất kết nối tới máy chủ, thử lại sau nhé.'),
      },
      { status: 502, headers: { 'Cache-Control': NO_STORE } },
    );
  }

  if (!upstream.ok) {
    // Error envelopes are JSON with a Vietnamese `message`; hand both the status
    // and the body to the client so it can show exactly what Go said.
    const body = await upstream.text();
    const headers = new Headers({ 'Cache-Control': NO_STORE });
    const ct = upstream.headers.get('Content-Type');
    if (ct) headers.set('Content-Type', ct);
    return new NextResponse(body, { status: upstream.status, headers });
  }

  const headers = new Headers({ 'Cache-Control': NO_STORE });
  const contentType = upstream.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  // Go named the file (`warranty-vault-<user>-<date>.zip|.json`); keep it.
  const disposition = upstream.headers.get('Content-Disposition');
  if (disposition) headers.set('Content-Disposition', disposition);
  const contentLength = upstream.headers.get('Content-Length');
  if (contentLength) headers.set('Content-Length', contentLength);

  return new NextResponse(upstream.body, { status: 200, headers });
}
