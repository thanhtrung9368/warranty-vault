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

// CostLimiter is the optional extension for a caller whose one request is worth
// more than one token — currently POST /api/v1/devices/bulk, where "a batch is
// one request but 50 writes". CheckN charges `cost` tokens in ONE atomic step,
// which matters on the Upstash backend: charging 50 writes as 50 separate Check
// calls would be 50 network round trips for one request.
//
// It is a separate interface rather than a fourth method on Limiter so existing
// custom implementations (and the tests' permissive/deny limiters) keep
// compiling. Callers go through CheckUserWriteN, which falls back to repeated
// Check calls when the limiter does not implement this.
type CostLimiter interface {
	CheckN(ctx context.Context, key string, cost, max int, windowMs int) (Result, error)
}
