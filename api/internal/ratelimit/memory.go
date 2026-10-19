package ratelimit

import (
	"context"
	"sync"
	"time"
)

type bucket struct {
	count   int
	resetAt time.Time
}

// MemoryLimiter is a single-process in-memory limiter. Safe for one server
// instance / local dev — not safe across multiple instances.
type MemoryLimiter struct {
	mu    sync.Mutex
	store map[string]*bucket
	now   func() time.Time
}

func NewMemoryLimiter() *MemoryLimiter {
	return &MemoryLimiter{
		store: make(map[string]*bucket),
		now:   time.Now,
	}
}

func (m *MemoryLimiter) Check(ctx context.Context, key string, max int, windowMs int) (Result, error) {
	return m.check(ctx, key, 1, max, windowMs)
}

// CheckN implements CostLimiter: it charges `cost` tokens atomically. The
// refusal rule is the same as Check's — a request is allowed only if the whole
// cost fits, so a 50-row batch can never be charged as a partial 30 and then
// leave the bucket in a state where the caller was refused after consuming
// capacity.
func (m *MemoryLimiter) CheckN(ctx context.Context, key string, cost, max int, windowMs int) (Result, error) {
	return m.check(ctx, key, cost, max, windowMs)
}

func (m *MemoryLimiter) check(_ context.Context, key string, cost, max int, windowMs int) (Result, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if cost < 1 {
		cost = 1
	}

	now := m.now()
	b, ok := m.store[key]
	if !ok || !b.resetAt.After(now) {
		if cost > max {
			// Can never fit in this window. Report the full window as the retry
			// delay rather than creating a bucket that is born over budget.
			return Result{Ok: false, Remaining: 0, RetryAfterSec: windowSeconds(windowMs)}, nil
		}
		m.store[key] = &bucket{
			count:   cost,
			resetAt: now.Add(time.Duration(windowMs) * time.Millisecond),
		}
		return Result{Ok: true, Remaining: max - cost, RetryAfterSec: 0}, nil
	}
	if b.count+cost > max {
		retry := int((b.resetAt.Sub(now) + time.Second - 1) / time.Second)
		if retry < 1 {
			retry = 1
		}
		return Result{Ok: false, Remaining: 0, RetryAfterSec: retry}, nil
	}
	b.count += cost
	return Result{Ok: true, Remaining: max - b.count, RetryAfterSec: 0}, nil
}

// windowSeconds is the retry hint for a cost that can never fit in one window.
// Kept in seconds (the Result unit) and at least 1 so a caller never sees a
// Retry-After of zero on a refusal.
func windowSeconds(windowMs int) int {
	sec := (windowMs + 999) / 1000
	if sec < 1 {
		return 1
	}
	return sec
}
