package ratelimit

import (
	"context"
	"testing"
	"time"
)

func TestMemoryLimiter_WithinWindow(t *testing.T) {
	t.Parallel()
	m := NewMemoryLimiter()
	ctx := context.Background()

	for i := 1; i <= 4; i++ {
		r, err := m.Check(ctx, "k", 5, 60_000)
		if err != nil {
			t.Fatalf("hit %d: unexpected err %v", i, err)
		}
		if !r.Ok {
			t.Fatalf("hit %d: expected ok=true", i)
		}
		wantRem := 5 - i
		if r.Remaining != wantRem {
			t.Fatalf("hit %d: remaining=%d want %d", i, r.Remaining, wantRem)
		}
		if r.RetryAfterSec != 0 {
			t.Fatalf("hit %d: retry should be 0, got %d", i, r.RetryAfterSec)
		}
	}

	// 5th hit reaches max and increments to 5 — still ok with 0 remaining.
	r, _ := m.Check(ctx, "k", 5, 60_000)
	if !r.Ok || r.Remaining != 0 {
		t.Fatalf("5th hit: want ok=true rem=0, got ok=%v rem=%d", r.Ok, r.Remaining)
	}

	// 6th hit must be blocked.
	r6, _ := m.Check(ctx, "k", 5, 60_000)
	if r6.Ok {
		t.Fatalf("6th hit: expected ok=false, got ok=true")
	}
	if r6.RetryAfterSec <= 0 {
		t.Fatalf("6th hit: retry should be >0, got %d", r6.RetryAfterSec)
	}
}

func TestMemoryLimiter_WindowResets(t *testing.T) {
	t.Parallel()
	m := NewMemoryLimiter()
	now := time.Unix(1_700_000_000, 0)
	m.now = func() time.Time { return now }
	ctx := context.Background()

	// Burn the bucket.
	for i := 0; i < 3; i++ {
		m.Check(ctx, "k", 3, 1000)
	}
	r, _ := m.Check(ctx, "k", 3, 1000)
	if r.Ok {
		t.Fatalf("expected blocked before window expiry")
	}

	// Advance past the window.
	now = now.Add(2 * time.Second)
	r2, _ := m.Check(ctx, "k", 3, 1000)
	if !r2.Ok {
		t.Fatalf("expected ok after window reset")
	}
	if r2.Remaining != 2 {
		t.Fatalf("remaining=%d want 2", r2.Remaining)
	}
}

func TestMemoryLimiter_Concurrent(t *testing.T) {
	t.Parallel()
	m := NewMemoryLimiter()
	ctx := context.Background()
	const max = 100
	done := make(chan struct{}, max+10)
	for i := 0; i < max+10; i++ {
		go func() {
			m.Check(ctx, "race", max, 60_000)
			done <- struct{}{}
		}()
	}
	for i := 0; i < max+10; i++ {
		<-done
	}
	// One extra check should now be blocked since max writes already happened.
	r, _ := m.Check(ctx, "race", max, 60_000)
	if r.Ok {
		t.Fatalf("expected blocked after %d concurrent writes", max+10)
	}
}

func TestFormatRetry(t *testing.T) {
	cases := []struct {
		in   int
		want string
	}{
		{1, "1 giây"},
		{59, "59 giây"},
		{60, "1 phút"},
		{61, "2 phút"},
		{120, "2 phút"},
		{121, "3 phút"},
	}
	for _, c := range cases {
		got := FormatRetry(c.in)
		if got != c.want {
			t.Errorf("FormatRetry(%d) = %q want %q", c.in, got, c.want)
		}
	}
}
