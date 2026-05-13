package ratelimit

import (
	"context"
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
)

// UserIDFromCtx is the contract the auth package must satisfy: given a
// request context, return the authenticated user ID and whether one was
// found. Passed in as a callback so this package doesn't import auth.
type UserIDFromCtx func(ctx context.Context) (string, bool)

// IdentifierFromRequest extracts the auth identifier (typically lowercase
// email) from a request *without* consuming the body. Implementations are
// responsible for buffering / re-attaching the body if they read it.
type IdentifierFromRequest func(r *http.Request) string

// Auth wraps a handler with the two-bucket auth limiter.
//
// Note: identifier extraction is left to the caller because the body is a
// one-shot stream — typical pattern is to read+restore the body in the
// handler, then call CheckAuth there directly. This middleware is provided
// for the IP-only case (pass identifierFromBody=nil) or when the caller has
// already pre-buffered the body.
func Auth(limiter Limiter, action string, identifierFromBody IdentifierFromRequest) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := GetClientIP(r)
			identifier := ""
			if identifierFromBody != nil {
				identifier = identifierFromBody(r)
			}
			res, _ := CheckAuth(r.Context(), limiter, action, ip, identifier)
			if !res.Ok {
				w.Header().Set("Retry-After", itoa(res.RetryAfterSec))
				httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
					"Thao tác quá nhanh. Đợi "+FormatRetry(res.RetryAfterSec), nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// UserWrite wraps a handler with the per-user 60/min write limiter. The
// userIDFromCtx callback is supplied by the auth package so this middleware
// stays decoupled.
func UserWrite(limiter Limiter, userIDFromCtx UserIDFromCtx) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userID, ok := userIDFromCtx(r.Context())
			if !ok || userID == "" {
				next.ServeHTTP(w, r)
				return
			}
			res, _ := CheckUserWrite(r.Context(), limiter, userID)
			if !res.Ok {
				w.Header().Set("Retry-After", itoa(res.RetryAfterSec))
				httpx.WriteError(w, http.StatusTooManyRequests, "rate_limited",
					"Thao tác quá nhanh. Đợi "+FormatRetry(res.RetryAfterSec), nil)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := false
	if n < 0 {
		neg = true
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
