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

func (m *MemoryLimiter) Check(_ context.Context, key string, max int, windowMs int) (Result, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := m.now()
	b, ok := m.store[key]
	if !ok || !b.resetAt.After(now) {
		m.store[key] = &bucket{
			count:   1,
			resetAt: now.Add(time.Duration(windowMs) * time.Millisecond),
		}
		return Result{Ok: true, Remaining: max - 1, RetryAfterSec: 0}, nil
	}
	if b.count >= max {
		retry := int((b.resetAt.Sub(now) + time.Second - 1) / time.Second)
		if retry < 1 {
			retry = 1
		}
		return Result{Ok: false, Remaining: 0, RetryAfterSec: retry}, nil
	}
	b.count++
	return Result{Ok: true, Remaining: max - b.count, RetryAfterSec: 0}, nil
}
