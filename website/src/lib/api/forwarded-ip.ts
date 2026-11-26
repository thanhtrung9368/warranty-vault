// Forward the visitor's real IP from the Next server to the Go API.
//
// ── The bug ───────────────────────────────────────────────────────────────
//
// The website is the only client that reaches Go through a second hop:
//
//     browser → Caddy → Next → Go
//
// Caddy already rewrites the inbound `X-Forwarded-For` to the real client IP
// (`deploy/caddy/Caddyfile`, `header_up X-Forwarded-For {client_ip}`), but a
// `fetch` made by the Next server does NOT inherit the inbound request headers.
// Every web→Go call therefore arrived with no forwarding header at all, so Go's
// `ratelimit.GetClientIP` (api/internal/ratelimit/helpers.go) fell through to
// `RemoteAddr` — the Next container. All website visitors shared one IP, which
// turned the per-IP auth buckets into global ones: the 20-per-15-minutes login
// bucket refused the 21st visitor *on the whole site*, no matter who they were.
//
// ── What this helper does ─────────────────────────────────────────────────
//
// Reads the FIRST hop of the inbound `x-forwarded-for` and returns it as the
// `X-Forwarded-For` header to add to the outbound request. Two rules matter:
//
//   * Only the first hop. Caddy overwrites the header with the real peer, so
//     there is no legitimate second hop to pass on; anything after the first
//     comma is attacker-controlled (a browser can send its own XFF, and a chain
//     must never be able to shift the bucket it lands in).
//   * `net.isIP` or nothing. A hostname, a `host:port`, a list or junk is not an
//     address, and forwarding it would let the limiter key on a string the
//     client chose. Anything invalid is dropped rather than propagated.
//
// Never synthesize a header: when the inbound request has no XFF (local `next
// dev`, unit tests, or a deployment that does not sit behind Caddy) the caller
// gets `{}` and Go keeps using whatever it would have used anyway.
//
// ── Trust boundary ────────────────────────────────────────────────────────
//
// This is only as trustworthy as the hop in front of Next. Keep the app behind
// Caddy: `website/docker-compose.yml` publishes port 3000, and a client that
// can reach Next directly could send a forged first hop and pick its own rate
// limit bucket. The first-hop-only rule above is what keeps a forged chain from
// being worse than a forged single value.

import { isIP } from 'node:net';
import { headers } from 'next/headers';

/** Header Go's `GetClientIP` reads first. */
export const FORWARDED_IP_HEADER = 'X-Forwarded-For';

// `Headers` and Next's `ReadonlyHeaders` both satisfy this; route handlers pass
// their `req.headers`, and the implicit form reads the current request.
type HeaderSource = Pick<Headers, 'get'>;

function firstClientHop(source: HeaderSource): string | null {
  // `Headers.get` is case-insensitive, so the canonical spelling is fine here.
  const raw = source.get(FORWARDED_IP_HEADER);
  if (!raw) return null;
  const first = raw.split(',')[0].trim();
  if (!first || isIP(first) === 0) return null;
  return first;
}

/**
 * Headers to merge into a web→Go `fetch`: `{ 'X-Forwarded-For': <visitor IP> }`
 * when the inbound request has a valid first hop, `{}` otherwise.
 *
 * Callers with the incoming `Request` in hand (the route handlers) pass
 * `req.headers`; server actions have no `Request` object, so omitting the
 * argument reads the request-scoped headers via `next/headers`.
 *
 * Server-only by construction — `node:net` cannot be bundled for the browser.
 */
export async function forwardedIpHeaders(
  source?: HeaderSource,
): Promise<Record<string, string>> {
  const ip = firstClientHop(source ?? (await headers()));
  return ip ? { [FORWARDED_IP_HEADER]: ip } : {};
}
