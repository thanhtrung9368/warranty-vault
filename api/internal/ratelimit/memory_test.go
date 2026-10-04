package ratelimit

import (
	"context"
	"strings"
	"testing"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
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
		_, _ = m.Check(ctx, "k", 3, 1000)
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
			_, _ = m.Check(ctx, "race", max, 60_000)
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

// FormatRetry is language-dependent since wave 5, so every case pins the
// language it is asserting: the Vietnamese column is byte-for-byte what this
// function produced before i18n existed (it is the source text), and the English
// column is the translation that fixes the two-language sentence
// "Too many attempts. Try again in 2 phút".
func TestFormatRetry(t *testing.T) {
	cases := []struct {
		in      int
		wantVI  string
		wantEN  string
		comment string
	}{
		{1, "1 giây", "1 second", "singular seconds"},
		{59, "59 giây", "59 seconds", "plural seconds"},
		{60, "1 phút", "1 minute", "ceil(60/60) == 1 — the singular minute IS reachable"},
		{61, "2 phút", "2 minutes", "rounds up"},
		{120, "2 phút", "2 minutes", "exact"},
		{121, "3 phút", "3 minutes", "rounds up again"},
	}
	for _, c := range cases {
		if got := FormatRetry(i18n.VI, c.in); got != c.wantVI {
			t.Errorf("FormatRetry(vi, %d) = %q want %q (%s)", c.in, got, c.wantVI, c.comment)
		}
		if got := FormatRetry(i18n.EN, c.in); got != c.wantEN {
			t.Errorf("FormatRetry(en, %d) = %q want %q (%s)", c.in, got, c.wantEN, c.comment)
		}
	}
}

// The sentence the two 429 writers share must not contain a unit in the other
// language — that is the exact defect wave 3 found and deferred ("Try again in
// 2 phút"), and it is invisible to a test that only checks the leading words.
func TestRetryMessageIsMonolingual(t *testing.T) {
	for _, tc := range []struct {
		tag     i18n.Tag
		want    string
		foreign string
	}{
		{i18n.VI, "Thao tác quá nhanh. Đợi 2 phút", "minutes"},
		{i18n.EN, "Too many attempts. Try again in 2 minutes", "phút"},
	} {
		got := RetryMessage(tc.tag, 100)
		if got != tc.want {
			t.Errorf("RetryMessage(%s, 100) = %q, want %q", tc.tag, got, tc.want)
		}
		if strings.Contains(got, tc.foreign) {
			t.Errorf("RetryMessage(%s, 100) = %q still contains the other language's %q", tc.tag, got, tc.foreign)
		}
	}
}
