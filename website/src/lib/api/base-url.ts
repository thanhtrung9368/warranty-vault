// Base URLs of the Go service.
//
// Its own module so the two callers that must not import each other can share
// it: `client.ts` (the typed client) and `lib/auth.ts` (which resolves the user
// without going through the typed client — see the note there).
//
// It is also the one place that decides whether `PUBLIC_API_URL` — the API's
// PUBLIC origin — may be used to build a link a third party opens. `GO_API_URL`
// cannot answer that: it is a private address (the compose stack sets it to
// `http://api:4000/api`, which resolves only inside the docker network), so a
// link built from it is dead outside the box and leaks the internal hostname to
// whoever the seller forwards it to.
//
// ── Two variables, two jobs ────────────────────────────────────────────────
//
//   GO_API_URL      where THIS SERVER calls the API (may be private, any
//                   scheme — compose uses http inside the network).
//   PUBLIC_API_URL  where a THIRD PARTY reaches the API (a buyer opening a
//                   handover certificate on their phone). Must be https on a
//                   public host.
//
// `PUBLIC_API_URL` has no `NEXT_PUBLIC_` prefix on purpose: it is read on the
// server by the share server action, and the browser never needs it — the
// action returns the finished URL.

export const GO_API_URL = (process.env.GO_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

// ---- Public API origin (`PUBLIC_API_URL`) ------------------------------------

// Go serves the certificate at `GET /api/v1/public/shares/<token>` and returns
// only `sharePath` (`/api/v1/public/shares/<token>`, no host): the host is the
// deployment's decision, and the server cannot know which address the caller's
// buyer will reach it through. That decision is `PUBLIC_API_URL`, and it is
// validated here so the share action can refuse to mint a link it cannot build.
//
// There is deliberately NO fallback to `GO_API_URL`: in production that is
// `http://api:4000/api`, so the fallback would produce an unreachable link that
// also leaks an internal hostname — and Go stores only the token hash, so a
// share created without a displayable URL loses its token for good. Failing
// before the POST is the only outcome that leaves the account untouched.

/** Why `PUBLIC_API_URL` cannot be used. Logged server-side; never shown verbatim. */
export type PublicApiBaseFailure = 'missing' | 'invalid' | 'insecure' | 'private';

export type PublicApiBaseResult =
  | { ok: true; url: string }
  | { ok: false; reason: PublicApiBaseFailure };

/** Bare hostnames that only ever resolve inside a machine or orchestrator. */
const INTERNAL_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'host.docker.internal',
  'gateway.docker.internal',
  'host.containers.internal',
  'metadata.google.internal',
  'kubernetes.default',
]);

/** DNS zones reserved for private use (mDNS, Kubernetes, ICANN `.internal`). */
const INTERNAL_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.cluster.local',
  '.svc',
];

/** `a.b.c.d` → its four octets, or `null` when the host is not an IPv4 literal. */
function ipv4Octets(host: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  // `999.1.1.1` is not a literal at all; treat it as a name (it also fails DNS,
  // but rejecting it here would mislabel the reason in the log).
  return octets.some((n) => n > 255) ? null : octets;
}

/** Non-routable / private IPv4 ranges — none of them can be a public origin. */
function isPrivateIpv4([a, b, c]: number[]): boolean {
  // 0.0.0.0/8 "this host", 10/8 private, 127/8 loopback.
  if (a === 0 || a === 10 || a === 127) return true;
  // 100.64/10 carrier-grade NAT.
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 169.254/16 link-local — includes the cloud metadata address 169.254.169.254.
  if (a === 169 && b === 254) return true;
  // 172.16/12 private.
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168/16 private, 192.0.0/24 and 192.0.2/24 documentation.
  if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return true;
  // 198.18/15 benchmarking, 198.51.100/24 documentation.
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
  // 203.0.113/24 documentation.
  if (a === 203 && b === 0 && c === 113) return true;
  // 224/4 multicast, 240/4 reserved (including 255.255.255.255).
  return a >= 224;
}

/**
 * Whether a hostname is private, internal or otherwise not a public origin.
 *
 * IPv6 literals are refused outright rather than range-checked: a certificate
 * link is meant to be a DNS name, and every private form (`::1`, ULA
 * `fc00::/7`, link-local `fe80::/10`) uses the same bracketed syntax, so the
 * fail-closed answer costs nothing a real deployment needs.
 */
function isPrivateHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, '');
  if (host === '') return true;
  if (host.startsWith('[')) return true;
  if (INTERNAL_HOSTNAMES.has(host)) return true;
  if (INTERNAL_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;

  const octets = ipv4Octets(host);
  if (octets) return isPrivateIpv4(octets);

  // A single-label name (`api`, `web`, `postgres`, `cron`) only resolves inside
  // the container network — never from a buyer's phone.
  return !host.includes('.');
}

/**
 * Validate `PUBLIC_API_URL`'s value.
 *
 * Accepted: an absolute `https://` URL on a public host, optionally under a
 * path prefix, ideally ending in `/api` like `GO_API_URL`
 * (`https://api.warrly.com/api`). Rejected — with a reason worth logging:
 *
 *   - missing  — unset or blank;
 *   - invalid  — not an absolute `https://` URL, or it carries credentials /
 *                a query / a fragment (this value is a PREFIX that a path is
 *                appended to);
 *   - insecure — any scheme other than https, including plain http (the link
 *                must open from a phone, and an `http://` one would be a
 *                downgrade of the very URL the feature hands out);
 *   - private  — localhost, a private IP, a single-label docker service name,
 *                an IPv6 literal, or an internal DNS suffix.
 *
 * The returned `url` is the configured string minus trailing slashes — not
 * `URL.toString()`, so a deployment prefix survives byte-for-byte. The caller
 * joins the path (`shareCertificateUrl`), which also keeps the `/api` suffix
 * from being duplicated.
 */
export function validatePublicApiBaseUrl(configured: string | null | undefined): PublicApiBaseResult {
  const raw = (configured ?? '').trim();
  if (raw === '') return { ok: false, reason: 'missing' };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'insecure' };

  // `new URL('https:api.example.com')` succeeds with the https scheme but no
  // `//`, and `shareCertificateUrl` only recognises an absolute `https://…`
  // base. Insisting on the explicit form here keeps "validation passed" and
  // "a URL can be built" the same statement.
  if (!/^https:\/\//i.test(raw)) return { ok: false, reason: 'invalid' };

  // Credentials would be handed to every recipient, and a query/fragment would
  // be glued in front of the path this value is a prefix for.
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return { ok: false, reason: 'invalid' };
  }

  if (isPrivateHostname(url.hostname)) return { ok: false, reason: 'private' };

  return { ok: true, url: raw.replace(/\/+$/, '') };
}

/**
 * The validated public origin, read from `PUBLIC_API_URL` at CALL time.
 *
 * A function rather than a module constant on purpose: the container image is
 * built without `PUBLIC_API_URL` (it is a runtime env var, like `APP_URL` — see
 * `siteBaseUrl()`), and reading it at import would freeze whatever the first
 * evaluation saw.
 */
export function publicApiBaseUrl(): PublicApiBaseResult {
  return validatePublicApiBaseUrl(process.env.PUBLIC_API_URL);
}
