import { NextResponse } from 'next/server';
import { getAuthCookie } from '@/lib/auth-cookie';
import { getI18n } from '@/lib/i18n/server';
import {
  buildInsurancePackQuery,
  parseInsurancePackScope,
  resolveInsurancePackFilename,
} from '@/lib/insurance-pack';

// GET /api/insurance-pack[?deviceIds=<id>,<id>&includeSold=true]
//
// Thin streaming proxy to the Go service's `GET /api/v1/insurance-pack`. The
// browser cannot link straight at Go: the bearer token lives in the httpOnly
// iron-session cookie, so a plain `<a href>` to the API would be unauthenticated.
// This route is the cookie-authenticated hop, and it streams the PDF rather than
// buffering it through a server action: a pack with per-device photos can be
// large and should go straight to the browser.
//
// The frozen contract is forwarded as-is via `buildInsurancePackQuery`: only
// the two documented parameters, with `includeSold=false` omitted because that
// is the server default. Errors are forwarded as JSON envelopes with the
// server's own (localized) `message` and a matching HTTP status, so the client
// can always show why nothing was downloaded. A 200 whose Content-Type is not
// `application/pdf` is treated as a failure, not saved as a bogus file.

const GO_API_URL = (process.env.GO_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const NO_STORE = 'private, no-store, max-age=0';

const ERROR_HEADERS: Record<string, string> = {
  'Cache-Control': NO_STORE,
  'X-Content-Type-Options': 'nosniff',
};

// The success response is a download, but re-emit a sandbox CSP anyway if a
// browser chooses to render it inline (defense-in-depth, same as the attachment
// proxy). No global CSP change is needed or made.
const PDF_HEADERS: Record<string, string> = {
  'Cache-Control': NO_STORE,
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

function errorResponse(status: number, message: string, error: string) {
  return NextResponse.json(
    { ok: false, error, message },
    { status, headers: ERROR_HEADERS },
  );
}

export async function GET(req: Request) {
  const { t, locale } = await getI18n();

  const cookie = await getAuthCookie();
  if (!cookie.accessToken) {
    return errorResponse(401, t('Bạn chưa đăng nhập'), 'unauthorized');
  }
  if (cookie.expiresAt && cookie.expiresAt <= Date.now()) {
    return errorResponse(401, t('Phiên đăng nhập đã hết hạn'), 'unauthorized');
  }

  // Rebuild the query from the documented parameters instead of forwarding the
  // whole incoming search string. Unknown parameters never reach Go.
  const incoming = new URL(req.url);
  const scope = parseInsurancePackScope(incoming.searchParams);
  // `?lang=` so Go renders any error in the page's language rather than the
  // account's stored `User.locale` — the two can disagree when the choice lives
  // only in the `wv_locale` cookie. Every `lib/api/*` call already does this; the
  // raw proxies in this directory bypass that client and have to do it themselves.
  const upstreamUrl = `${GO_API_URL}/v1/insurance-pack${buildInsurancePackQuery(scope)}&lang=${locale}`;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cookie.accessToken}` },
      cache: 'no-store',
      // A closed tab cancels the upstream generation mid-stream.
      signal: req.signal,
    });
  } catch {
    return errorResponse(
      502,
      t('Mất kết nối tới máy chủ, thử lại sau nhé.'),
      'network_error',
    );
  }

  if (!upstream.ok) {
    // Go answers with `{ error, message }`; keep both so the UI can display the
    // exact reason (e.g. an invalid deviceIds value) and not a generic failure.
    const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
    const body = (await upstream.json().catch(() => null)) as
      | { error?: unknown; message?: unknown }
      | null;
    const message =
      typeof body?.message === 'string' && body.message.trim()
        ? body.message
        : t('Không tải được bảng kê cho bảo hiểm.');
    const error = typeof body?.error === 'string' ? body.error : `http_${status}`;
    return errorResponse(status, message, error);
  }

  const contentType = (upstream.headers.get('Content-Type') ?? '').toLowerCase();
  if (!contentType.startsWith('application/pdf')) {
    try {
      await upstream.body?.cancel();
    } catch {
      // Already closed; nothing else to do.
    }
    return errorResponse(
      502,
      t('Máy chủ trả về định dạng không phải PDF.'),
      'invalid_response',
    );
  }

  if (upstream.headers.get('Content-Length') === '0') {
    try {
      await upstream.body?.cancel();
    } catch {
      // Already closed.
    }
    return errorResponse(502, t('File bảng kê rỗng.'), 'empty_response');
  }

  // Go names the file (`warrly-insurance-pack-<user>-<date>.pdf`). Prefer that
  // name, validate that it is actually a PDF, and always force an attachment so
  // clicking the control saves rather than renders the document.
  const filename = resolveInsurancePackFilename(
    upstream.headers.get('Content-Disposition'),
  );

  const headers = new Headers(PDF_HEADERS);
  headers.set('Content-Type', 'application/pdf');
  headers.set('Content-Disposition', `attachment; filename="${filename}"`);
  const contentLength = upstream.headers.get('Content-Length');
  if (contentLength) headers.set('Content-Length', contentLength);

  return new NextResponse(upstream.body, { status: 200, headers });
}
