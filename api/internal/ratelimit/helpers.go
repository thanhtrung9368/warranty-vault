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

// CheckAIExtract enforces a tighter per-user limit on the OCR endpoint (each
// call hits a paid third-party API): 10 requests / 60s.
func CheckAIExtract(ctx context.Context, limiter Limiter, userID string) (Result, error) {
	return limiter.Check(ctx, "ai:extract:user:"+userID, 10, writeWindow)
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
