package services

import (
	"testing"
	"time"
)

// Return / exchange window (FEATURE_IDEAS #1) — the pure rule.
//
// Every case here is fixed in absolute dates: nothing in this file may depend on
// the wall clock, so the suite cannot go red at a month boundary or on New Year's
// Eve. The DB-backed half lives in internal/handlers (per-test scratch database).

func d(y int, m time.Month, day int) time.Time {
	return time.Date(y, m, day, 0, 0, 0, 0, time.UTC)
}

func i32(v int32) *int32 { return &v }

func TestReturnDeadline(t *testing.T) {
	received := d(2026, time.March, 10)

	for _, tc := range []struct {
		name         string
		purchase     time.Time
		receivedAt   *time.Time
		windowDays   *int32
		wantOK       bool
		wantDeadline time.Time
	}{
		{
			name:       "nil window means unknown",
			purchase:   d(2026, time.March, 1),
			windowDays: nil,
			wantOK:     false,
		},
		{
			name:       "zero window means the shop offers none",
			purchase:   d(2026, time.March, 1),
			windowDays: i32(0),
			wantOK:     false,
		},
		{
			name:       "negative window is not a window",
			purchase:   d(2026, time.March, 1),
			windowDays: i32(-5),
			wantOK:     false,
		},
		{
			name:       "beyond the maximum is rejected rather than overflowing the year",
			purchase:   d(2026, time.March, 1),
			windowDays: i32(ReturnWindowDaysMax + 1),
			wantOK:     false,
		},
		{
			name:         "30 days from purchaseDate when no delivery date is recorded",
			purchase:     d(2026, time.March, 1),
			windowDays:   i32(30),
			wantOK:       true,
			wantDeadline: d(2026, time.March, 31),
		},
		{
			name:         "receivedAt wins over purchaseDate (online order invoiced early)",
			purchase:     d(2026, time.March, 1),
			receivedAt:   &received,
			windowDays:   i32(30),
			wantOK:       true,
			wantDeadline: d(2026, time.April, 9),
		},
		{
			name:         "365-day accessory window",
			purchase:     d(2026, time.March, 1),
			windowDays:   i32(365),
			wantOK:       true,
			wantDeadline: d(2027, time.March, 1),
		},
		{
			name:         "one-day window still counts down",
			purchase:     d(2026, time.March, 1),
			windowDays:   i32(1),
			wantOK:       true,
			wantDeadline: d(2026, time.March, 2),
		},
		{
			name:         "leap day is handled by calendar arithmetic",
			purchase:     d(2028, time.February, 28),
			windowDays:   i32(2),
			wantOK:       true,
			wantDeadline: d(2028, time.March, 1),
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ReturnDeadline(tc.purchase, tc.receivedAt, tc.windowDays)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if !got.Equal(tc.wantDeadline) {
				t.Errorf("deadline = %s, want %s", got.Format("2006-01-02"), tc.wantDeadline.Format("2006-01-02"))
			}
		})
	}
}

func TestReturnDeadlineIgnoresZeroReceivedAt(t *testing.T) {
	// A zero time is what an unset *time.Time looks like after a round trip
	// through some clients. It must fall back to purchaseDate rather than
	// producing a deadline in year 1.
	zero := time.Time{}
	got, ok := ReturnDeadline(d(2026, time.March, 1), &zero, i32(30))
	if !ok {
		t.Fatal("expected ok")
	}
	if want := d(2026, time.March, 31); !got.Equal(want) {
		t.Errorf("deadline = %s, want %s", got, want)
	}
}

func TestDaysUntil(t *testing.T) {
	now := time.Date(2026, time.March, 15, 14, 30, 0, 0, time.UTC)

	for _, tc := range []struct {
		name     string
		deadline time.Time
		want     int
	}{
		{"today is the last day", d(2026, time.March, 15), 0},
		{"tomorrow", d(2026, time.March, 16), 1},
		{"yesterday is negative", d(2026, time.March, 14), -1},
		{"a month out", d(2026, time.April, 14), 30},
		{"across a year boundary", d(2027, time.January, 1), 292},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := DaysUntil(tc.deadline, now); got != tc.want {
				t.Errorf("DaysUntil = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestDaysUntilIsDateBasedNotInstantBased(t *testing.T) {
	// The stored deadlines are wall-clock midnight-of-day timestamps. Subtracting
	// instants from a mid-afternoon "now" would report 0 days left for most of the
	// final day and then jump straight to -1 after local midnight — a countdown
	// that skips the day it is counting. The helper must compare calendar dates.
	deadline := d(2026, time.March, 15)
	for _, hour := range []int{0, 6, 12, 18, 23} {
		now := time.Date(2026, time.March, 15, hour, 59, 0, 0, time.UTC)
		if got := DaysUntil(deadline, now); got != 0 {
			t.Errorf("at hour %d: DaysUntil = %d, want 0", hour, got)
		}
	}
}
