import { NextResponse } from 'next/server';
import { getAuthCookie } from '@/lib/auth-cookie';

// POST /api/backup/import?mode=merge|replace
//
// Raw-body proxy to Go's `POST /api/v1/backup/import`. The browser posts the
// chosen file untouched, and the Go handler decides the format by ZIP magic
// bytes (`PK\x03\x04`) — never by filename or Content-Type — so this route does
// not gate on an extension either.
//
// Why a route handler instead of the server action it replaced: a
// blob-carrying archive can reach ~110 MB, and server actions cap their request
// body (`experimental.serverActions.bodySizeLimit`, currently 10 MB). This
// streams the upload straight through, so both the JSON and the `.zip` path work
// at full size without buffering the payload in the Next server.

const GO_API_URL = (process.env.GO_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const NO_STORE = 'private, no-store, max-age=0';

function jsonError(status: number, error: string, message: string) {
  return NextResponse.json({ ok: false, error, message }, { status, headers: { 'Cache-Control': NO_STORE } });
}

export async function POST(req: Request) {
  const cookie = await getAuthCookie();
  if (!cookie.accessToken) {
    return jsonError(401, 'unauthorized', 'Bạn chưa đăng nhập');
  }
  if (cookie.expiresAt && cookie.expiresAt <= Date.now()) {
    return jsonError(401, 'unauthorized', 'Phiên đăng nhập đã hết hạn — tải lại trang để đăng nhập lại.');
  }

  const incoming = new URL(req.url);
  const mode = incoming.searchParams.get('mode') === 'replace' ? 'replace' : 'merge';

  let upstream: Response;
  try {
    const init: RequestInit & { duplex?: 'half' } = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cookie.accessToken}`,
        // Deliberately generic: Go sizes its body cap from this header (50 MB
        // for `application/json`, 110 MB otherwise) and sniffs the real format
        // from the bytes. Forwarding the browser's per-file type would cap a
        // `.zip` that a user renamed to `.json` at 50 MB and reject a legitimate
        // archive with a 413.
        'Content-Type': 'application/octet-stream',
      },
      body: req.body ?? undefined,
      // Required by undici to send a streamed body.
      duplex: 'half',
      cache: 'no-store',
      signal: req.signal,
    };
    upstream = await fetch(`${GO_API_URL}/v1/backup/import?mode=${mode}`, init);
  } catch {
    return jsonError(502, 'network_error', 'Mất kết nối tới máy chủ, thử lại sau nhé.');
  }

  // Relay Go's envelope (status + JSON) unchanged: field-level 400s ("File JSON
  // không hợp lệ", "File backup quá lớn (giới hạn 110MB)", id conflicts) and the
  // 200 `{ ok, result }` with the import counters.
  const body = await upstream.text();
  const headers = new Headers({ 'Cache-Control': NO_STORE });
  const contentType = upstream.headers.get('Content-Type');
  headers.set('Content-Type', contentType ?? 'application/json; charset=utf-8');
  return new NextResponse(body, { status: upstream.status, headers });
}
