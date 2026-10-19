import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { getAuthCookie } from '@/lib/auth-cookie';
import { attachmentRuleRejection } from '@/lib/attachment-rules';
import {
  SHARE_FILE_FIELD,
  SHARE_SUCCESS_PATH,
  mapShareUploadFailure,
  selectSharedFile,
  shareResultPath,
  type ShareFailureReason,
} from '@/lib/share-target';

// POST /share-target — the Web Share Target receiver.
//
// The manifest (`app/manifest.ts`, served at `/manifest.webmanifest`) registers
// this exact URL as the app's share destination:
//
//   "share_target": {
//     "action": "/share-target",
//     "method": "POST",
//     "enctype": "multipart/form-data",
//     "params": { "files": [{ "name": "file", "accept": [...] }] }
//   }
//
// When someone taps "Share → Warrly" on an image/PDF in another Android app,
// the browser launches this PWA and POSTs that multipart form here as a
// full-document navigation. We are NOT called by fetch/XHR, so the response
// must be a redirect the browser can follow, never JSON.
//
// ── POST-then-redirect, and whether the file survives ────────────────────
//
// The file is uploaded to Go FIRST (`POST /v1/attachments` with no `deviceId`
// → an inbox item). Only after Go answers 201 do we redirect. The redirect is
// **303 See Other**, never Next's default 307: 307 preserves the method and
// would make the browser re-POST the multipart body to `/inbox`, which only
// accepts GET. 303 tells the browser to follow with GET. The file is not in
// the redirect — it is already persisted server-side — so HTTP's rule that a
// redirect body is ignored does not matter here. If anything fails before a
// successful upload — offline, session expired, >5 MB, wrong type — the share
// is sent to `/share/result?reason=...` with a visible explanation; it is never
// dropped silently.
//
// ── Auth ─────────────────────────────────────────────────────────────────
//
// `getAuthCookie()` reads the iron-session cookie without redirecting. A
// cross-site POST cannot carry this cookie (SameSite=Lax), and the OS share
// navigation is same-origin, so the cookie arrives when the user is signed in.
// No cookie → `auth` result page. The multipart body is not stored while
// signed out (there is nowhere safe to put it), and the copy says so.
//
// ── Size and file count ──────────────────────────────────────────────────
//
// The 5 MB file cap is shared with the two uploaders (`attachment-rules.ts`),
// and Go re-checks it. We accept exactly ONE file per share: `selectSharedFile`
// refuses a multi-part form rather than taking the first part and dropping the
// rest (Android's multi-select can put several parts under the same field).
// That mirrors the native clients, which deliberately ship `ACTION_SEND` and
// not `ACTION_SEND_MULTIPLE`; a multi-file inbox flow is a different feature.
//
// There is no envelope-level `Content-Length` shortcut: with more than one part
// it cannot tell "one 40 MB file" from "five valid 4 MB files", and guessing
// would put the wrong reason on the result screen. The request is authenticated
// before the body is parsed, and the parsed file's own size is the accurate
// check.
//
// ── Why no CSP change ────────────────────────────────────────────────────
//
// This request is a browser navigation started by the OS share sheet, not a
// form rendered in one of our documents. `form-action 'self'` (next.config.mjs)
// governs forms in our pages and already permits same-origin actions; it is
// not consulted for the share-sheet POST. The response is a 303 to a
// same-origin path. Nothing in the CSP needs to move.

export const runtime = 'nodejs';

/**
 * A 303 with a RELATIVE `Location`. Relative is deliberate: HTTP allows it
 * (RFC 9110 §10.2.2) and the browser resolves it against the request URL, so
 * the redirect cannot leak an internal host (`localhost:3000`) when the app is
 * behind Caddy/Docker and the framework's reconstruction of `request.url`
 * disagrees with the public origin. `NextResponse.redirect()` requires an
 * absolute URL, so this builds the response directly.
 *
 * 303 (not 307): the follow-up request must be a GET, not a replay of the
 * multipart POST.
 */
function seeOther(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { Location: location },
  });
}

/**
 * Send the browser to the public confirmation screen. Never a silent drop:
 * every caller below reaches this instead of returning a bare 4xx/5xx.
 */
function failed(reason: ShareFailureReason): NextResponse {
  return seeOther(shareResultPath(reason));
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Check the local cookie before touching the body: signed out means the
    // upload cannot succeed, and consuming a file we cannot store would make
    // the failure slower without making it better.
    const session = await getAuthCookie();
    if (!session.accessToken) return failed('auth');
    if (session.expiresAt && session.expiresAt <= Date.now()) return failed('auth');

    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
      // A share target always posts multipart; this protects the route against
      // being used as a generic JSON/urlencoded endpoint.
      return failed('malformed');
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      // Broken boundary, truncated body, or a client that lied about the
      // content type. Nothing was persisted.
      return failed('malformed');
    }

    // `getAll`, not `get`: a second part under `file` must not be ignored.
    const selected = selectSharedFile(form.getAll(SHARE_FILE_FIELD));
    if (!selected.ok) return failed(selected.reason);
    const file = selected.file;

    const rejection = attachmentRuleRejection(file);
    if (rejection === 'too_large') return failed('too_large');
    if (rejection === 'wrong_type') return failed('unsupported_type');

    // No `deviceId` on purpose: this is the capture-first inbox. Description is
    // also omitted — the share sheet has no description field in our manifest,
    // and inventing one from the filename would be noise.
    const res = await api.attachments.upload({ file });
    if (!res.ok) {
      if (res.status >= 500) {
        console.error('[share-target] upload failed:', res.status, res.error);
      }
      return failed(mapShareUploadFailure(res));
    }

    // The inbox is `force-dynamic`, so the redirect's GET re-renders it with
    // the new row. Revalidate anyway because the sidebar badge and any other
    // route reading the inbox should not keep a stale count.
    revalidatePath('/inbox');

    // 303: the new item is the response to the POST; the GET of /inbox is a
    // separate, safe request. `?shared=1` only drives the confirmation banner.
    return seeOther(SHARE_SUCCESS_PATH);
  } catch (err) {
    // Never let an unexpected throw turn into a bare 500: the browser would
    // show an error page and the user would have no idea whether the file was
    // received. The result screen says "may not have been saved — check the
    // inbox", which is the honest answer for an unknown outcome.
    console.error('[share-target] unexpected failure:', err);
    return failed('failed');
  }
}
