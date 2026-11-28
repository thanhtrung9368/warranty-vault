import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { bearerHeader } from '@/lib/auth-cookie';

// GET /api/wishlist-image?url=<https://…>
//
// Same-origin proxy for the external product photo a user pastes into the
// wishlist "Link ảnh" field. The page CSP is `img-src 'self' data: blob:`
// (next.config.mjs), so pointing `<img src>` at the third-party URL directly
// makes the browser refuse it. Widening `img-src` to `https:` would leak the
// reader's IP to any host the field ever names — so the fetch happens here,
// server-side, behind the session and a set of SSRF guards, and the browser
// only ever sees `/api/wishlist-image?...` on our own origin.
//
// Guards, in order:
//   1) A valid iron-session bearer is required — an unauthenticated visitor
//      cannot use this route as an open proxy.
//   2) The URL must parse, must be `https:`, and must not carry userinfo.
//   3) The host must be public. IP literals are checked directly; DNS names
//      are resolved (all A/AAAA records) and every answer must be public —
//      loopback, private, link-local, multicast and reserved ranges are
//      refused. `localhost` and single-label (intranet) names are refused.
//   4) Redirects are disabled (`redirect: 'error'`), so a public host cannot
//      bounce us to `127.0.0.1` / cloud metadata after the check.
//   5) The whole upstream exchange is capped at 3 seconds and 2 MB, and the
//      upstream Content-Type must be one of the three browser image types.
//
// The response re-emits the same sandboxing CSP as `/api/files/[id]`.

export const runtime = 'nodejs';

const TIMEOUT_MS = 3_000;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

// Exactly the three types the wishlist thumbnails are allowed to be. SVG is
// deliberately absent (it can carry script), as are GIF/HEIC (not rendered
// consistently in browsers and not needed here).
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// Same sandboxing CSP the files proxy re-emits, plus `nosniff` so a browser
// never sniffs a mislabelled body into HTML/JS.
const SANDBOX_CSP = "default-src 'none'; sandbox; img-src 'self' data:";

// Never let a rejected/failed lookup be cached by the browser or a shared
// proxy. Successful images get an explicit private one-day cache below.
const ERROR_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': SANDBOX_CSP,
};

// IPv4 ranges that are not publicly routable, including the ranges commonly
// abused for SSRF: RFC 1918 private, loopback, link-local (cloud metadata is
// 169.254.169.254), carrier-grade NAT, benchmarking/documentation blocks, and
// multicast/reserved space. "Reserved" also covers 255.255.255.255.
const IPV4_BLOCKED = new BlockList();
const IPV4_BLOCKED_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['0.0.0.0', 8], // "this network" / unspecified
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. 169.254.169.254 metadata)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation TEST-NET-2
  ['203.0.113.0', 24], // documentation TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved / broadcast
];
for (const [network, prefix] of IPV4_BLOCKED_RANGES) {
  IPV4_BLOCKED.addSubnet(network, prefix, 'ipv4');
}

// IPv6 equivalents. IPv4-mapped (`::ffff:0:0/96`), IPv4-compatible
// (`::/96`) and NAT64/6to4/Teredo translation prefixes are blocked whole:
// each can smuggle an IPv4 literal (including a private one) past an
// IPv6-only check, and none is a legitimate public image origin.
const IPV6_BLOCKED = new BlockList();
const IPV6_BLOCKED_RANGES: ReadonlyArray<readonly [string, number]> = [
  ['::', 96], // unspecified, loopback ::1, deprecated IPv4-compatible
  ['::ffff:0:0', 96], // IPv4-mapped
  ['64:ff9b::', 96], // NAT64 well-known prefix
  ['64:ff9b:1::', 48], // NAT64 local-use prefix
  ['100::', 64], // discard-only
  ['2001::', 32], // Teredo
  ['2001:2::', 48], // benchmarking
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
];
for (const [network, prefix] of IPV6_BLOCKED_RANGES) {
  IPV6_BLOCKED.addSubnet(network, prefix, 'ipv6');
}

class ImageProxyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ImageProxyError';
  }
}

function stripBrackets(hostname: string): string {
  // WHATWG URL keeps the brackets on IPv6 hosts (`[::1]`).
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return IPV4_BLOCKED.check(address, 'ipv4');
  if (version === 6) return IPV6_BLOCKED.check(address, 'ipv6');
  // Not an IP at all — treat as hostile rather than resolving it again.
  return true;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Validates the user-supplied URL and resolves its host, returning the only
// URL we will hand to `fetch`. Throws ImageProxyError(400) on any refusal.
async function resolvePublicTarget(raw: string): Promise<URL> {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new ImageProxyError(400, 'invalid URL');
  }

  if (target.protocol !== 'https:') {
    throw new ImageProxyError(400, 'only https URLs are allowed');
  }
  // `https://user:pass@host/` is meaningless for an image and a good way to
  // confuse a naive parser; refuse it outright.
  if (target.username || target.password) {
    throw new ImageProxyError(400, 'credentials in URL are not allowed');
  }

  const hostname = stripBrackets(target.hostname).toLowerCase().replace(/\.$/, '');
  if (!hostname) throw new ImageProxyError(400, 'missing host');

  // IP literal: no DNS step, just range-check it. WHATWG URL has already
  // canonicalised odd IPv4 spellings (0x7f.1, 2130706433, 127.1) to dotted
  // decimal, so `isIP` sees the real address.
  if (isIP(hostname) !== 0) {
    if (isBlockedAddress(hostname)) {
      throw new ImageProxyError(400, 'private or reserved host');
    }
    return target;
  }

  // Names that can only resolve on the local network / search suffix.
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new ImageProxyError(400, 'private or reserved host');
  }
  // A public DNS name always has at least one dot; a single-label name is an
  // intranet host (or `localhost` spelled differently) and is not a public
  // image origin.
  if (!hostname.includes('.')) {
    throw new ImageProxyError(400, 'non-public host');
  }

  // Resolve every A/AAAA answer and refuse the whole request if any of them
  // lands in a blocked range. The resolution is bounded too, so a hostile
  // nameserver cannot hold the route open.
  let addresses: ReadonlyArray<{ address: string }>;
  try {
    addresses = await withTimeout(lookup(hostname, { all: true }), TIMEOUT_MS);
  } catch {
    throw new ImageProxyError(400, 'host could not be resolved');
  }
  if (addresses.length === 0) {
    throw new ImageProxyError(400, 'host could not be resolved');
  }
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new ImageProxyError(400, 'private or reserved host');
    }
  }

  return target;
}

function errorResponse(status: number): NextResponse {
  return new NextResponse(null, { status, headers: ERROR_HEADERS });
}

export async function GET(req: Request) {
  // 1) Session required. `bearerHeader()` returns {} when the cookie is
  // missing or expired; either way this is not a public proxy.
  const auth = await bearerHeader();
  if (!auth.Authorization) return errorResponse(401);

  const raw = new URL(req.url).searchParams.get('url');
  if (!raw) return errorResponse(400);

  // 2–3) https-only + public-host guard.
  let target: URL;
  try {
    target = await resolvePublicTarget(raw);
  } catch (err) {
    if (err instanceof ImageProxyError) return errorResponse(err.status);
    return errorResponse(400);
  }

  // 4–5) Fetch with no redirects and a hard overall budget. The abort signal
  // covers both the headers and the body, so a slow drip cannot exceed 3 s.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(target.href, {
      method: 'GET',
      // No cookies, no Authorization, no Referer: the origin only ever sees
      // this server's egress address, never the reader's.
      headers: { Accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8' },
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    return errorResponse(timedOut ? 504 : 502);
  }

  // Collapse upstream failures to a bare 502 — the caller only renders or
  // falls back on the image, and upstream error bodies are not ours to relay.
  if (!upstream.ok) {
    await upstream.body?.cancel().catch(() => {});
    clearTimeout(timer);
    return errorResponse(502);
  }

  // Only the three whitelisted browser image types are accepted; the value
  // echoed to the browser is ours, never the raw upstream header.
  const upstreamType = (upstream.headers.get('Content-Type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(upstreamType)) {
    await upstream.body?.cancel().catch(() => {});
    clearTimeout(timer);
    return errorResponse(415);
  }

  // Early reject on a declared oversize body; the streaming counter below is
  // the real cap (Content-Length is absent for chunked responses and can lie).
  const declaredLength = upstream.headers.get('Content-Length');
  if (declaredLength !== null && Number(declaredLength) > MAX_IMAGE_BYTES) {
    await upstream.body?.cancel().catch(() => {});
    clearTimeout(timer);
    return errorResponse(413);
  }

  if (!upstream.body) {
    clearTimeout(timer);
    return errorResponse(502);
  }

  // 5) Stream with a hard 2 MB cap, aborting as soon as it is crossed.
  const reader = upstream.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel().catch(() => {});
        return errorResponse(413);
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => {});
    return errorResponse(timedOut ? 504 : 502);
  } finally {
    clearTimeout(timer);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const headers = new Headers(ERROR_HEADERS);
  headers.set('Content-Type', upstreamType);
  headers.set('Content-Length', String(total));
  // Private: one reader's photo, cached on their own device only.
  headers.set('Cache-Control', 'private, max-age=86400');

  return new NextResponse(bytes, { status: 200, headers });
}
