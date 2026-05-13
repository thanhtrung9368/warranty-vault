package services

import (
	"errors"
	"testing"
	"time"
)

func TestNextRenewalDate_Monthly(t *testing.T) {
	got, err := NextRenewalDate(time.Date(2026, time.January, 15, 0, 0, 0, 0, time.UTC),
		BillingCycleMonthly, nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	want := time.Date(2026, time.February, 15, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("monthly: got %v, want %v", got, want)
	}
}

func TestNextRenewalDate_MonthlyFebLeapYear(t *testing.T) {
	// Jan 31 in a leap year + 1 month: AddDate normalises to Mar 2
	// (Feb 29 + 2 day overflow). Document the behaviour.
	got, err := NextRenewalDate(time.Date(2024, time.January, 31, 0, 0, 0, 0, time.UTC),
		BillingCycleMonthly, nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	want := time.Date(2024, time.March, 2, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("monthly leap-year overflow: got %v, want %v", got, want)
	}

	// Jan 31 in a non-leap year + 1 month: Feb 31 → Mar 3.
	got2, err := NextRenewalDate(time.Date(2026, time.January, 31, 0, 0, 0, 0, time.UTC),
		BillingCycleMonthly, nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	want2 := time.Date(2026, time.March, 3, 0, 0, 0, 0, time.UTC)
	if !got2.Equal(want2) {
		t.Errorf("monthly non-leap overflow: got %v, want %v", got2, want2)
	}
}

func TestNextRenewalDate_Quarterly(t *testing.T) {
	got, err := NextRenewalDate(time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
		BillingCycleQuarterly, nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	want := time.Date(2026, time.April, 1, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("quarterly: got %v, want %v", got, want)
	}
}

func TestNextRenewalDate_Yearly(t *testing.T) {
	got, err := NextRenewalDate(time.Date(2026, time.May, 7, 0, 0, 0, 0, time.UTC),
		BillingCycleYearly, nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	want := time.Date(2027, time.May, 7, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("yearly: got %v, want %v", got, want)
	}
}

func TestNextRenewalDate_Lifetime(t *testing.T) {
	in := time.Date(2026, time.May, 7, 12, 0, 0, 0, time.UTC)
	got, err := NextRenewalDate(in, BillingCycleLifetime, nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if !got.Equal(in) {
		t.Errorf("lifetime: expected unchanged, got %v", got)
	}
}

func TestNextRenewalDate_Custom(t *testing.T) {
	intervalDays := int32(45)
	got, err := NextRenewalDate(time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC),
		BillingCycleCustom, &intervalDays)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	want := time.Date(2026, time.February, 15, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("custom 45d: got %v, want %v", got, want)
	}
}

func TestNextRenewalDate_CustomMissingInterval(t *testing.T) {
	_, err := NextRenewalDate(time.Now(), BillingCycleCustom, nil)
	if !errors.Is(err, ErrCustomCycleNeedsInterval) {
		t.Errorf("custom nil intervalDays: want ErrCustomCycleNeedsInterval, got %v", err)
	}

	zero := int32(0)
	_, err = NextRenewalDate(time.Now(), BillingCycleCustom, &zero)
	if !errors.Is(err, ErrCustomCycleNeedsInterval) {
		t.Errorf("custom zero intervalDays: want ErrCustomCycleNeedsInterval, got %v", err)
	}

	neg := int32(-3)
	_, err = NextRenewalDate(time.Now(), BillingCycleCustom, &neg)
	if !errors.Is(err, ErrCustomCycleNeedsInterval) {
		t.Errorf("custom negative intervalDays: want ErrCustomCycleNeedsInterval, got %v", err)
	}
}

func TestNextRenewalDate_RoundTripMonthly(t *testing.T) {
	// 12 monthly bumps from Jan 15 should land on Jan 15 next year.
	t0 := time.Date(2026, time.January, 15, 0, 0, 0, 0, time.UTC)
	cur := t0
	for i := 0; i < 12; i++ {
		var err error
		cur, err = NextRenewalDate(cur, BillingCycleMonthly, nil)
		if err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
	}
	want := time.Date(2027, time.January, 15, 0, 0, 0, 0, time.UTC)
	if !cur.Equal(want) {
		t.Errorf("12x monthly: got %v, want %v", cur, want)
	}
}

func TestMonthlyEquivalent(t *testing.T) {
	tests := []struct {
		name         string
		price        int32
		cycle        string
		intervalDays *int32
		want         int64
	}{
		{"monthly", 100000, BillingCycleMonthly, nil, 100000},
		{"quarterly", 300000, BillingCycleQuarterly, nil, 100000},
		{"quarterly truncates", 100000, BillingCycleQuarterly, nil, 33333},
		{"yearly", 1200000, BillingCycleYearly, nil, 100000},
		{"yearly truncates", 100000, BillingCycleYearly, nil, 8333},
		{"lifetime", 999999, BillingCycleLifetime, nil, 0},
		{"custom 30d", 100000, BillingCycleCustom, ptrInt32(30), 100000},
		{"custom 60d", 200000, BillingCycleCustom, ptrInt32(60), 100000},
		{"custom nil interval", 100000, BillingCycleCustom, nil, 0},
		{"custom zero interval", 100000, BillingCycleCustom, ptrInt32(0), 0},
		{"unknown cycle", 100000, "WHATEVER", nil, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := MonthlyEquivalent(tc.price, tc.cycle, tc.intervalDays)
			if got != tc.want {
				t.Errorf("got %d, want %d", got, tc.want)
			}
		})
	}
}

func TestEnumValidators(t *testing.T) {
	if !IsValidBillingCycle("MONTHLY") {
		t.Error("MONTHLY should be valid")
	}
	if IsValidBillingCycle("monthly") {
		t.Error("lowercase should not be valid")
	}
	if IsValidBillingCycle("") {
		t.Error("empty should not be valid")
	}

	if !IsValidSubscriptionStatus("ACTIVE") {
		t.Error("ACTIVE should be valid")
	}
	if IsValidSubscriptionStatus("UNKNOWN") {
		t.Error("UNKNOWN should not be valid")
	}
}

func ptrInt32(v int32) *int32 { return &v }
