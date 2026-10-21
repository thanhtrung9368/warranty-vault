// `?next=` — the small, security-relevant half of "a feature-card click keeps
// its destination through sign-in".
//
// A signed-out visitor who clicks a feature card lands on an `(app)` route. The
// `(app)` layout calls `requireUser()`, which redirects to `/login`; the auth
// action then redirected to `/dashboard`, so the click's intent was discarded.
// The cards now send `/login?next=<their own destination>` when signed out, the
// form carries it in a hidden field, and the action redirects there after a
// successful login/registration.
//
// The value is attacker-controlled (it is a query param and a form field), so
// this validator is deliberately strict:
//   * must start with exactly one `/` (`//host` is protocol-relative → open
//     redirect);
//   * no backslashes (the URL parser treats `/\\host` as `//host`);
//   * no control characters (a tab is stripped by the URL parser and can turn
//     `/\thost` into `//host`);
//   * after one percent-decoding, it still must not start with `//` or contain
//     a backslash;
//   * the WHATWG URL parser must resolve it to the same origin as the app
//     (catches anything the string checks missed);
//   * it must not point back at `/login` or `/register` (a loop).
//
// It does NOT try to whitelist app routes: any same-origin path is safe to
// navigate to, and `/` after sign-in is an acceptable answer. It also does not
// decide whether a destination makes sense for the user — that is the target
// page's job.

const ORIGIN = 'https://warrly.invalid';
const AUTH_PATHS = ['/login', '/register'];

function decodeOnce(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null; // malformed percent-encoding
  }
}

/** A same-origin relative path, or `null` when the value is not safe. */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (raw.includes('\\')) return null;
  // C0 controls and DEL. The URL parser strips tabs/newlines, which is exactly
  // how `/\t/evil.example` can become `//evil.example`.
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;

  const decoded = decodeOnce(raw);
  if (!decoded) return null;
  if (decoded.startsWith('//') || decoded.startsWith('/\\')) return null;
  if (decoded.includes('\\')) return null;

  try {
    const url = new URL(raw, ORIGIN);
    if (url.origin !== ORIGIN) return null;
    if (!url.pathname.startsWith('/')) return null;
  } catch {
    return null;
  }

  const pathname = decoded.split(/[?#]/, 1)[0];
  if (AUTH_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return null;
  }

  return raw;
}

/** Prefix a same-origin path with `?next=`, or return it unchanged. */
export function withNext(path: string, next: unknown): string {
  const safe = safeNextPath(next);
  if (!safe) return path;
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}next=${encodeURIComponent(safe)}`;
}

/** `/login?next=…` for a signed-out feature-card click. */
export function loginHref(next: unknown): string {
  return withNext('/login', next);
}
