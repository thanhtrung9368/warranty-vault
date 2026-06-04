package ratelimit

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"strings"
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

// FormatRetry mirrors website/src/lib/rate-limit.ts::formatRetry.
// >=60s -> "X phút" (ceil); else "X giây".
func FormatRetry(seconds int) string {
	if seconds >= 60 {
		minutes := (seconds + 59) / 60
		return fmt.Sprintf("%d phút", minutes)
	}
	return fmt.Sprintf("%d giây", seconds)
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
