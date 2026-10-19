package ratelimit

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

const (
	authWindowMs = 15 * 60 * 1000
	writeWindow  = 60 * 1000
	writeLimit   = 60
)

// CheckAuth runs the two-bucket auth limiter (per-IP and per-IP+identifier)
// using the supplied limiter. `identifier` is normally the lowercase email;
// pass empty to skip the second bucket.
func CheckAuth(ctx context.Context, limiter Limiter, action, ip, identifier string) (Result, error) {
	ipLimit := 10
	if action == "login" {
		ipLimit = 20
	}

	r, err := limiter.Check(ctx, fmt.Sprintf("%s:ip:%s", action, ip), ipLimit, authWindowMs)
	if err != nil || !r.Ok {
		return r, err
	}
	if identifier != "" {
		r2, err := limiter.Check(ctx,
			fmt.Sprintf("%s:ipid:%s:%s", action, ip, strings.ToLower(identifier)),
			5, authWindowMs)
		if err != nil || !r2.Ok {
			return r2, err
		}
	}
	return r, nil
}

// CheckUserWrite enforces 60 writes/60s per authenticated user.
func CheckUserWrite(ctx context.Context, limiter Limiter, userID string) (Result, error) {
	return limiter.Check(ctx, "write:user:"+userID, writeLimit, writeWindow)
}

// CheckFXRate rate-limits GET /api/v1/fx/rates per authenticated user: 60
// requests / 60s, the same budget as a write.
//
// The endpoint is normally nearly free (a 12-hour in-process cache), but a cache
// MISS reaches a free third-party upstream — and a cache that is stale because
// the upstream is down retries on every call. The bucket exists so one client
// stuck in a retry loop cannot turn this service into a proxy for that upstream.
//
// It is a separate bucket from CheckUserWrite so prefilling the device form does
// not eat into the 60 writes/minute a user actually has.
func CheckFXRate(ctx context.Context, limiter Limiter, userID string) (Result, error) {
	return limiter.Check(ctx, "fx:rates:user:"+userID, 60, writeWindow)
}

// CheckAIExtract enforces a tighter per-user limit on the OCR endpoint (each
// call hits a paid third-party API): 10 requests / 60s.
func CheckAIExtract(ctx context.Context, limiter Limiter, userID string) (Result, error) {
	return limiter.Check(ctx, "ai:extract:user:"+userID, 10, writeWindow)
}

// CheckAIAssess is the claim-assessment sibling of CheckAIExtract: the same
// 10 requests / 60s budget, because it makes the same kind of paid model call,
// but a separate bucket so the two AI features cannot starve each other.
func CheckAIAssess(ctx context.Context, limiter Limiter, userID string) (Result, error) {
	return limiter.Check(ctx, "ai:assess:user:"+userID, 10, writeWindow)
}

// CheckInsurancePack rate-limits GET /api/v1/insurance-pack: 5 requests / 60 s
// per authenticated user.
//
// This is the most expensive read in the service: it can decrypt and re-encode
// 100 images, read five batched tables and render a multi-hundred-page PDF. The
// shared write bucket (60/min) would let one account start sixty of those in a
// minute. Five is enough to retry a failed download or regenerate after adding a
// device, and low enough that the per-request work cannot be amplified.
func CheckInsurancePack(ctx context.Context, limiter Limiter, userID string) (Result, error) {
	return limiter.Check(ctx, "insurance:pack:user:"+userID, 5, writeWindow)
}

// CheckShareView rate-limits the PUBLIC share endpoint (FEATURE_IDEAS #2) by IP.
// This is the only unauthenticated read in the service, so its bucket is the
// first line of defence against someone walking the token space — even though
// the token is 256 random bits and that walk is hopeless.
//
// 60 / 15 min per IP: generous enough for a link forwarded into a group chat
// (several readers behind one NAT, each loading the page a couple of times) and
// tight enough that brute force is not worth attempting. The bucket is keyed by
// action name, so it does not consume (or interfere with) the login/forgot
// budget that CheckAuth manages.
func CheckShareView(ctx context.Context, limiter Limiter, ip string) (Result, error) {
	return limiter.Check(ctx, "share:view:ip:"+ip, 60, authWindowMs)
}

// CheckInboundEmail rate-limits POST /api/v1/inbox/email by IP.
//
// This is the service's only unauthenticated WRITE (the share view above is the
// only unauthenticated read). 60 / 15 min per IP, the same budget as a share
// view: an inbound provider delivers in bursts (a handful of messages, then
// nothing), so a low per-minute ceiling would drop legitimate mail, while 60 in
// 15 minutes still bounds the expensive part — each request can encrypt and write
// up to ten 5 MB files.
//
// The bucket is keyed by action name, so it neither consumes nor interferes with
// the login/forgot budget CheckAuth manages. When RATE_LIMITER=upstash this is
// shared across instances; with the default memory backend it is per process,
// exactly like every other bucket in this package.
func CheckInboundEmail(ctx context.Context, limiter Limiter, ip string) (Result, error) {
	return limiter.Check(ctx, "inbound:email:ip:"+ip, 60, authWindowMs)
}

// FormatRetry mirrors website/src/lib/rate-limit.ts::formatRetry, and renders it
// in `tag`: >=60s -> "X phút" / "X minutes" (ceil); else "X giây" / "X seconds".
//
// The tag is a PARAMETER rather than something read from a context because this
// package has no request in two of its three callers: the 429 the middleware
// writes has one, but the sentence is also composed by handlers.rateLimited from
// a `RetryAfterSec` an endpoint already computed. Making the language explicit
// keeps this a pure function of (language, seconds).
//
// It was Vietnamese-only until wave 5, which is what produced the two-language
// sentence "Too many attempts. Try again in 2 phút" on every converted endpoint:
// the surrounding sentence came from the catalog and the unit did not. Both the
// unit and its singular form ("1 phút" / "1 minute" — reachable, because 60s
// rounds up to exactly one minute) are ordinary catalog entries now.
func FormatRetry(tag i18n.Tag, seconds int) string {
	if seconds >= 60 {
		minutes := (seconds + 59) / 60
		if minutes == 1 {
			return i18n.Translate(tag, "1 phút")
		}
		return i18n.Translate(tag, "%d phút", minutes)
	}
	if seconds == 1 {
		return i18n.Translate(tag, "1 giây")
	}
	return i18n.Translate(tag, "%d giây", seconds)
}

// RetryMessage renders the whole 429 sentence — "Thao tác quá nhanh. Đợi X" —
// so the middleware and the handlers' shared `rateLimited` helper cannot drift
// into two different sentences for the same status. The context-taking wrapper
// lives in internal/handlers (which imports this package, so the dependency only
// runs one way).
func RetryMessage(tag i18n.Tag, seconds int) string {
	return i18n.Translate(tag, "Thao tác quá nhanh. Đợi %s", FormatRetry(tag, seconds))
}

// GetClientIP returns the best-effort client IP. Reads X-Forwarded-For first
// (first hop), then X-Real-IP, then strips the port from RemoteAddr.
func GetClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		first := strings.SplitN(xff, ",", 2)[0]
		if ip := strings.TrimSpace(first); ip != "" {
			return ip
		}
	}
	if real := r.Header.Get("X-Real-IP"); real != "" {
		return strings.TrimSpace(real)
	}
	if r.RemoteAddr != "" {
		host, _, err := net.SplitHostPort(r.RemoteAddr)
		if err == nil {
			return host
		}
		return r.RemoteAddr
	}
	return "unknown"
}
