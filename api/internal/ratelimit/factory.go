package ratelimit

import (
	"log/slog"
	"os"
	"strings"
)

// NewFromEnv reads RATE_LIMITER (default "memory"). When "redis" / "upstash"
// is set together with UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN,
// returns an UpstashLimiter. Otherwise warns and falls back to memory.
func NewFromEnv() Limiter {
	backend := strings.ToLower(strings.TrimSpace(os.Getenv("RATE_LIMITER")))
	if backend == "" {
		backend = "memory"
	}
	switch backend {
	case "memory":
		return NewMemoryLimiter()
	case "redis", "upstash":
		url := os.Getenv("UPSTASH_REDIS_REST_URL")
		token := os.Getenv("UPSTASH_REDIS_REST_TOKEN")
		if url == "" || token == "" {
			slog.Warn("rate-limit RATE_LIMITER=redis but UPSTASH_REDIS_REST_URL/TOKEN missing; using memory")
			return NewMemoryLimiter()
		}
		return NewUpstashLimiter(url, token)
	default:
		slog.Warn("rate-limit unknown backend; falling back to memory", "backend", backend)
		return NewMemoryLimiter()
	}
}
