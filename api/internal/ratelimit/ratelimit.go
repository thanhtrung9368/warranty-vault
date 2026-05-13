// Package ratelimit provides in-memory and Upstash-backed rate limiting.
package ratelimit

import "context"

type Result struct {
	Ok            bool
	Remaining     int
	RetryAfterSec int
}

// Limiter atomically increments a counter for `key` within a fixed window
// of `windowMs`. Returns Ok=false with RetryAfterSec when the counter would
// exceed `max`. Implementations must be safe for concurrent use.
type Limiter interface {
	Check(ctx context.Context, key string, max int, windowMs int) (Result, error)
}
