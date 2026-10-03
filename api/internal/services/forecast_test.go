package services

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Spending forecast (FEATURE_IDEAS #8).
//
// Every test here uses a FIXED "now": nothing in this file may depend on the wall
// clock, so the suite cannot go red on the 1st of a month or on New Year's Eve.

// fixedNow is the clock all fixtures below are built around: mid-month, mid-day,
// so "partial current month" and "partial last bucket" are both exercised.
var fixedNow = time.Date(2026, 3, 15, 10, 30, 0, 0, time.UTC)

func tsAt(t time.Time) pgtype.Timestamp { return pgtype.Timestamp{Time: t, Valid: true} }

func i32pForTest(v int32) *int32 { return &v }

func subFixture(id, cycle string, price int32, renewal time.Time, autoRenew bool) store.Subscription {
	status := SubscriptionStatusActive
	return store.Subscription{
		ID:           id,
		Name:         id,
		BillingCycle: cycle,
		Price:        price,
		Currency:     "VND",
		RenewalDate:  tsAt(renewal),
		AutoRenew:    autoRenew,
		Status:       status,
	}
}

func bucketByMonth(f *Forecast, month string) *ForecastBucket {
	for i := range f.Buckets {
		if f.Buckets[i].Month == month {
			return &f.Buckets[i]
		}
	}
	return nil
}

func assertBucket(t *testing.T, f *Forecast, month string, want ForecastBucket) {
	t.Helper()
	got := bucketByMonth(f, month)
	if got == nil {
		t.Fatalf("no bucket %s (have %v)", month, bucketMonths(f))
	}
	if *got != want {
		t.Errorf("bucket %s = %+v, want %+v", month, *got, want)
	}
}

func bucketMonths(f *Forecast) []string {
	out := make([]string, 0, len(f.Buckets))
	for _, b := range f.Buckets {
		out = append(out, b.Month)
	}
	return out
}

// The window rule, directly: horizon = now + months calendar months, buckets = the
// months that horizon touches.
func TestForecastWindow(t *testing.T) {
	for _, tc := range []struct {
		name      string
		now       time.Time
		months    int
		wantStart time.Time
		wantEnd   time.Time
		wantKeys  []string
	}{
		{
			name:      "giữa tháng, 12 tháng → tháng hiện tại (một phần) + 12 tháng",
			now:       time.Date(2026, 3, 15, 10, 30, 0, 0, time.UTC),
			months:    12,
			wantStart: time.Date(2026, 3, 15, 10, 30, 0, 0, time.UTC),
			wantEnd:   time.Date(2027, 3, 15, 10, 30, 0, 0, time.UTC),
			wantKeys: []string{
				"2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
				"2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03",
			},
		},
		{
			name:      "đúng 00:00 ngày 1 → không có tháng lẻ phía cuối",
			now:       time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC),
			months:    12,
			wantStart: time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2027, 3, 1, 0, 0, 0, 0, time.UTC),
			wantKeys: []string{
				"2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
				"2026-10", "2026-11", "2026-12", "2027-01", "2027-02",
			},
		},
		{
			name:      "1 tháng, giữa tháng → 2 bucket",
			now:       time.Date(2026, 3, 15, 10, 30, 0, 0, time.UTC),
			months:    1,
			wantStart: time.Date(2026, 3, 15, 10, 30, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 4, 15, 10, 30, 0, 0, time.UTC),
			wantKeys:  []string{"2026-03", "2026-04"},
		},
		{
			// AddDate month-end overflow: 31/1 + 1 tháng = 3/3 (Go normalises the
			// overflow day exactly like JS Date.setMonth, which is what
			// NextRenewalDate documents and all three clients mirror).
			name:      "cuối tháng → AddDate tràn ngày như nextRenewalDate",
			now:       time.Date(2026, 1, 31, 12, 0, 0, 0, time.UTC),
			months:    1,
			wantStart: time.Date(2026, 1, 31, 12, 0, 0, 0, time.UTC),
			wantEnd:   time.Date(2026, 3, 3, 12, 0, 0, 0, time.UTC),
			wantKeys:  []string{"2026-01", "2026-02", "2026-03"},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			start, end, keys := ForecastWindow(tc.now, tc.months)
			if !start.Equal(tc.wantStart) {
				t.Errorf("start = %s, want %s", start, tc.wantStart)
			}
			if !end.Equal(tc.wantEnd) {
				t.Errorf("end = %s, want %s", end, tc.wantEnd)
			}
			if len(keys) != len(tc.wantKeys) {
				t.Fatalf("keys = %v, want %v", keys, tc.wantKeys)
			}
			for i := range keys {
				if keys[i] != tc.wantKeys[i] {
					t.Fatalf("keys = %v, want %v", keys, tc.wantKeys)
				}
			}
		})
	}
}

// Where exactly a charge lands: the left edge of the window, a month boundary, and
// the right edge.
func TestBuildForecastBucketBoundaries(t *testing.T) {
	now := time.Date(2026, 3, 15, 10, 30, 0, 0, time.UTC)
	end := now.AddDate(0, 3, 0) // 2026-06-15T10:30Z

	// YEARLY throughout: within a 3-month window each package charges at most once,
	// so the bucket a charge lands in is unambiguous.
	subs := []store.Subscription{
		// Exactly at `now` → included, in the current (partial) month.
		subFixture("at_now", BillingCycleYearly, 1, now, true),
		// Exactly on a month boundary → that month, not the previous one.
		subFixture("at_month_start", BillingCycleYearly, 10, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), true),
		// One second before the horizon → last bucket.
		subFixture("just_before_end", BillingCycleYearly, 100, end.Add(-time.Second), true),
		// Exactly ON the horizon → belongs to no bucket (right-open window).
		subFixture("at_end", BillingCycleYearly, 1000, end, true),
		// An hour before `now` → history; rolled a year forward it lands past the
		// horizon of this 3-month window, so it contributes nothing either way.
		subFixture("before_now", BillingCycleYearly, 10000, now.Add(-time.Hour), true),
	}

	f := BuildForecast(now, 3, subs, nil, nil)

	if got, want := bucketMonths(f), []string{"2026-03", "2026-04", "2026-05", "2026-06"}; len(got) != len(want) {
		t.Fatalf("buckets = %v, want %v", got, want)
	}
	if b := bucketByMonth(f, "2026-03"); b == nil || b.SubscriptionVnd != 1 {
		t.Errorf("2026-03 = %+v, want the charge made exactly at `now` (1đ)", b)
	}
	if b := bucketByMonth(f, "2026-04"); b == nil || b.SubscriptionVnd != 10 {
		t.Errorf("2026-04 = %+v, want the 00:00 1/4 charge (10đ)", b)
	}
	if b := bucketByMonth(f, "2026-05"); b == nil || b.SubscriptionVnd != 0 {
		t.Errorf("2026-05 = %+v, want nothing", b)
	}
	if b := bucketByMonth(f, "2026-06"); b == nil || b.SubscriptionVnd != 100 {
		t.Errorf("2026-06 = %+v, want the last-second charge (100đ)", b)
	}
	// 1000 (at `end`) and 10000 (before `now`) must not appear anywhere.
	if f.SubscriptionTotalVnd != 111 {
		t.Errorf("total = %d, want 111 (1 + 10 + 100): a charge exactly at the horizon or in the past must be excluded",
			f.SubscriptionTotalVnd)
	}
	if f.ChargesCount != 3 {
		t.Errorf("charges = %d, want 3 (at_end, at 1000đ, and before_now must not be counted)", f.ChargesCount)
	}
	if f.SubscriptionsCount != 3 {
		t.Errorf("subscriptionsCount = %d, want 3", f.SubscriptionsCount)
	}
}

// The full fixture: one package per billing cycle, plus the two cases that must
// contribute nothing at all.
func TestBuildForecastFixture(t *testing.T) {
	subs := []store.Subscription{
		// 12 charges, 20th of each month.
		subFixture("monthly", BillingCycleMonthly, 100_000, time.Date(2026, 3, 20, 9, 0, 0, 0, time.UTC), true),
		// 4 charges, exactly on a month boundary, manual renewal.
		subFixture("quarterly", BillingCycleQuarterly, 300_000, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), false),
		// Overdue by 14 days → rolled forward a year, landing in the partial tail
		// bucket (2027-03-01 < 2027-03-15).
		subFixture("yearly", BillingCycleYearly, 1_200_000, time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC), true),
		// Charged on the 1st: its 12th charge falls in the partial tail bucket, so a
		// 12-month forecast must still show 12 charges.
		subFixture("monthly_first", BillingCycleMonthly, 50_000, time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC), false),
		// CUSTOM with a valid intervalDays: 8 charges of 45 days.
		subFixture("custom_45d", BillingCycleCustom, 200_000, time.Date(2026, 4, 5, 0, 0, 0, 0, time.UTC), true),
	}
	custom45 := subs[4]
	custom45.IntervalDays = i32pForTest(45)
	subs[4] = custom45

	// Must contribute NOTHING:
	lifetime := subFixture("lifetime", BillingCycleLifetime, 5_000_000, time.Date(2125, 1, 1, 0, 0, 0, 0, time.UTC), false)
	customMissing := subFixture("custom_missing_interval", BillingCycleCustom, 500_000, time.Date(2026, 4, 10, 0, 0, 0, 0, time.UTC), true)
	paused := subFixture("paused", BillingCycleMonthly, 999_000, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), true)
	paused.Status = SubscriptionStatusPaused
	noRenewal := subFixture("no_renewal_date", BillingCycleMonthly, 700_000, time.Time{}, true)
	noRenewal.RenewalDate = pgtype.Timestamp{}
	subs = append(subs, lifetime, customMissing, paused, noRenewal)

	warranties := []store.ListWarrantiesExpiringBetweenRow{
		{
			ID: "w1", DeviceId: "dev1", Type: "STANDARD", Provider: strp("Apple"),
			EndDate: tsAt(time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC)), Months: 24, Cost: i32pForTest(2_500_000),
			DeviceName: "MacBook Pro",
		},
		{
			// Exactly on a month boundary, and with NO recorded cost: counts, adds 0.
			ID: "w2", DeviceId: "dev2", Type: "THIRD_PARTY",
			EndDate: tsAt(time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)), Months: 12,
			DeviceName: "Tủ lạnh",
		},
		{
			// Tail bucket.
			ID: "w3", DeviceId: "dev3", Type: "EXTENDED",
			EndDate: tsAt(time.Date(2027, 3, 10, 0, 0, 0, 0, time.UTC)), Months: 36, Cost: i32pForTest(1_000_000),
			DeviceName: "Máy giặt",
		},
		{ // After the horizon → ignored even if the caller passes it.
			ID: "w4", DeviceId: "dev4", Type: "STANDARD",
			EndDate: tsAt(time.Date(2027, 5, 1, 0, 0, 0, 0, time.UTC)), Months: 12, Cost: i32pForTest(9_000_000),
			DeviceName: "Ngoài cửa sổ",
		},
		{ // Before `now` → ignored.
			ID: "w5", DeviceId: "dev5", Type: "STANDARD",
			EndDate: tsAt(time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC)), Months: 12, Cost: i32pForTest(9_000_000),
			DeviceName: "Đã hết hạn",
		},
		{ // No end date at all.
			ID: "w6", DeviceId: "dev6", Type: "STANDARD",
			DeviceName: "Không có ngày",
		},
	}

	wishlist := []store.WishlistItem{
		{
			ID: "i1", Name: "Sony WH-1000XM6", Status: "WATCHING", Priority: "WANT",
			TargetDate: tsAt(time.Date(2026, 5, 15, 0, 0, 0, 0, time.UTC)), CurrentPrice: i32pForTest(8_500_000),
		},
		{ // Same month, no price recorded.
			ID: "i2", Name: "iPad mini", Status: "DECIDED", Priority: "MAYBE",
			TargetDate: tsAt(time.Date(2026, 5, 20, 0, 0, 0, 0, time.UTC)),
		},
		{ // Exactly on the first instant of the tail bucket's month.
			ID: "i3", Name: "Máy lọc nước", Status: "WATCHING", Priority: "MUST",
			TargetDate: tsAt(time.Date(2027, 3, 1, 0, 0, 0, 0, time.UTC)), CurrentPrice: i32pForTest(15_000_000),
		},
		{ // After the horizon.
			ID: "i4", Name: "Ngoài cửa sổ", Status: "WATCHING", Priority: "WANT",
			TargetDate: tsAt(time.Date(2027, 4, 1, 0, 0, 0, 0, time.UTC)), CurrentPrice: i32pForTest(20_000_000),
		},
		{ // No target date.
			ID: "i5", Name: "Không có ngày", Status: "WATCHING", Priority: "WANT",
			CurrentPrice: i32pForTest(1_000_000),
		},
	}

	f := BuildForecast(fixedNow, 12, subs, warranties, wishlist)

	if got := bucketMonths(f); len(got) != 13 || got[0] != "2026-03" || got[12] != "2027-03" {
		t.Fatalf("buckets = %v, want 13 buckets 2026-03 … 2027-03", got)
	}
	if f.Months != 12 {
		t.Errorf("months = %d, want 12", f.Months)
	}
	if f.WindowStart != "2026-03-15T10:30:00Z" || f.WindowEnd != "2027-03-15T10:30:00Z" {
		t.Errorf("window = %s … %s, want 2026-03-15T10:30:00Z … 2027-03-15T10:30:00Z", f.WindowStart, f.WindowEnd)
	}
	if f.Currency != "VND" {
		t.Errorf("currency = %q, want VND", f.Currency)
	}

	// Totals. The lifetime package (5.000.000đ) and the CUSTOM one without an
	// intervalDays (500.000đ) must be absent from every one of these numbers.
	if f.SubscriptionTotalVnd != 5_800_000 {
		t.Errorf("subscriptionTotalVnd = %d, want 5.800.000", f.SubscriptionTotalVnd)
	}
	// Automatic only: monthly (1.2M) + yearly (1.2M) + custom 45d (8 × 200k).
	if f.SubscriptionAutoRenewTotalVnd != 4_000_000 {
		t.Errorf("subscriptionAutoRenewTotalVnd = %d, want 4.000.000", f.SubscriptionAutoRenewTotalVnd)
	}
	if f.ChargesCount != 37 {
		t.Errorf("chargesCount = %d, want 37 (12 + 4 + 1 + 12 + 8)", f.ChargesCount)
	}
	if f.SubscriptionsCount != 5 {
		t.Errorf("subscriptionsCount = %d, want 5 (lifetime / paused / no-date / missing-interval contribute nothing)", f.SubscriptionsCount)
	}
	// The canonical monthly equivalent: 100k + 100k + 100k + 50k +
	// round(200k*30/45) + 700k for "no_renewal_date". That last row cannot be
	// scheduled (it charges nothing) but it IS an ACTIVE non-LIFETIME
	// subscription, so it counts toward the monthly average exactly as stats.sql
	// counts it — the two numbers must stay identical. (renewalDate is NOT NULL in
	// the schema, so it is a defensive fixture, not something Postgres can store.)
	if f.SubscriptionMonthlyAverageVnd != 1_183_333 {
		t.Errorf("subscriptionMonthlyAverageVnd = %d, want 1.183.333", f.SubscriptionMonthlyAverageVnd)
	}

	assertBucket(t, f, "2026-03", ForecastBucket{
		Month: "2026-03", SubscriptionVnd: 100_000, SubscriptionAutoRenewVnd: 100_000,
		SubscriptionCount: 1, WarrantyExpiringVnd: 2_500_000, WarrantyExpiringCount: 1,
	})
	// April: monthly 100k (20/4) + quarterly 300k (1/4) + custom 200k (5/4) +
	// monthly_first 50k (1/4). Auto-renew is monthly + custom.
	assertBucket(t, f, "2026-04", ForecastBucket{
		Month: "2026-04", SubscriptionVnd: 650_000, SubscriptionAutoRenewVnd: 300_000,
		SubscriptionCount: 4, WarrantyExpiringCount: 1,
	})
	assertBucket(t, f, "2026-05", ForecastBucket{
		Month: "2026-05", SubscriptionVnd: 350_000, SubscriptionAutoRenewVnd: 300_000,
		SubscriptionCount: 3, WishlistTargetVnd: 8_500_000, WishlistTargetCount: 2,
	})
	// The tail bucket is partial (1–15 March 2027) and holds the yearly renewal.
	assertBucket(t, f, "2027-03", ForecastBucket{
		Month: "2027-03", SubscriptionVnd: 1_250_000, SubscriptionAutoRenewVnd: 1_200_000,
		SubscriptionCount: 2, WarrantyExpiringVnd: 1_000_000, WarrantyExpiringCount: 1,
		WishlistTargetVnd: 15_000_000, WishlistTargetCount: 1,
	})
	// June: monthly 100k (20/6) + monthly_first 50k (1/6), no warranty or wishlist.
	assertBucket(t, f, "2026-06", ForecastBucket{
		Month: "2026-06", SubscriptionVnd: 150_000, SubscriptionAutoRenewVnd: 100_000, SubscriptionCount: 2,
	})

	// The per-item lists carry only in-window rows, in date order, and the money is
	// int64 with nil for "not recorded".
	if len(f.UpcomingWarranties) != 3 {
		t.Fatalf("upcomingWarranties = %d rows, want 3: %+v", len(f.UpcomingWarranties), f.UpcomingWarranties)
	}
	if f.UpcomingWarranties[1].CostVnd != nil {
		t.Errorf("w2.costVnd = %v, want null (no cost recorded ≠ 0đ)", *f.UpcomingWarranties[1].CostVnd)
	}
	if f.UpcomingWarranties[0].CostVnd == nil || *f.UpcomingWarranties[0].CostVnd != 2_500_000 {
		t.Errorf("w1.costVnd = %v, want 2.500.000", f.UpcomingWarranties[0].CostVnd)
	}
	if f.UpcomingWarranties[0].DeviceName != "MacBook Pro" || f.UpcomingWarranties[0].Month != "2026-03" {
		t.Errorf("w1 = %+v, want the device name and its bucket month", f.UpcomingWarranties[0])
	}
	if f.UpcomingWarranties[2].Month != "2027-03" {
		t.Errorf("w3 month = %q, want 2027-03", f.UpcomingWarranties[2].Month)
	}

	if len(f.UpcomingWishlist) != 3 {
		t.Fatalf("upcomingWishlist = %d rows, want 3: %+v", len(f.UpcomingWishlist), f.UpcomingWishlist)
	}
	if f.UpcomingWishlist[1].CurrentPriceVnd != nil {
		t.Errorf("i2.currentPriceVnd = %v, want null", *f.UpcomingWishlist[1].CurrentPriceVnd)
	}
	if f.UpcomingWishlist[2].Month != "2027-03" {
		t.Errorf("i3 month = %q, want 2027-03", f.UpcomingWishlist[2].Month)
	}

	// Non-nil slices and a non-empty Vietnamese note: the JSON contract.
	if f.Buckets == nil || f.UpcomingWishlist == nil || f.UpcomingWarranties == nil {
		t.Error("a slice is nil; the contract is [] not null")
	}
	if f.Note == "" {
		t.Error("note is empty, want the Vietnamese honesty line")
	}
}

// Only ACTIVE rows can still charge: a PAUSED copy of the same package must not
// appear in any bucket.
func TestBuildForecastIgnoresNonActiveStatuses(t *testing.T) {
	for _, status := range []string{
		SubscriptionStatusPaused, SubscriptionStatusCanceled, SubscriptionStatusExpired,
	} {
		t.Run(status, func(t *testing.T) {
			s := subFixture("s", BillingCycleMonthly, 100_000, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), true)
			s.Status = status
			f := BuildForecast(fixedNow, 12, []store.Subscription{s}, nil, nil)
			if f.SubscriptionTotalVnd != 0 || f.ChargesCount != 0 || f.SubscriptionsCount != 0 {
				t.Errorf("%s contributed: total=%d charges=%d subs=%d",
					status, f.SubscriptionTotalVnd, f.ChargesCount, f.SubscriptionsCount)
			}
			if f.SubscriptionMonthlyAverageVnd != 0 {
				t.Errorf("%s monthly average = %d, want 0 (stats.sql also filters on ACTIVE)",
					status, f.SubscriptionMonthlyAverageVnd)
			}
		})
	}
}

// A LIFETIME package is not a charge and must not be visible as a zero either.
func TestBuildForecastLifetimeNeverCharges(t *testing.T) {
	lifetime := subFixture("life", BillingCycleLifetime, 5_000_000, time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC), true)
	f := BuildForecast(fixedNow, 12, []store.Subscription{lifetime}, nil, nil)
	for _, b := range f.Buckets {
		if b.SubscriptionCount != 0 || b.SubscriptionVnd != 0 || b.SubscriptionAutoRenewVnd != 0 {
			t.Fatalf("LIFETIME appeared in bucket %s: %+v", b.Month, b)
		}
	}
	if f.SubscriptionTotalVnd != 0 || f.SubscriptionMonthlyAverageVnd != 0 {
		t.Errorf("LIFETIME totals = %d / %d, want 0 / 0", f.SubscriptionTotalVnd, f.SubscriptionMonthlyAverageVnd)
	}
}

// ParseForecastMonths: default, bounds, and a typo that must not silently change
// the window.
func TestParseForecastMonths(t *testing.T) {
	for _, tc := range []struct {
		raw     string
		want    int
		wantErr bool
	}{
		{raw: "", want: ForecastMonthsDefault},
		{raw: "1", want: 1},
		{raw: "12", want: 12},
		{raw: "24", want: 24},
		{raw: "0", wantErr: true},
		{raw: "25", wantErr: true},
		{raw: "-3", wantErr: true},
		{raw: "abc", wantErr: true},
		{raw: "12.5", wantErr: true},
	} {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := ParseForecastMonths(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("ParseForecastMonths(%q) = %d, want an error", tc.raw, got)
				}
				if svc, ok := As(err); !ok || svc.Code != "VALIDATION" {
					t.Errorf("error = %v, want a VALIDATION domain error", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("ParseForecastMonths(%q) error: %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("ParseForecastMonths(%q) = %d, want %d", tc.raw, got, tc.want)
			}
		})
	}
}

// ---- real-database assertions ----------------------------------------------

// End-to-end: rows out of Postgres, buckets out of the pure function, and the
// monthly figure cross-checked against GET /stats — the same canonical arithmetic,
// not a third variant.
func TestGetForecastAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_forecast_user"
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	// now is fixed, so the fixture rows are absolute dates rather than "now + N".
	subs := []struct {
		id       string
		cycle    string
		price    int32
		renewal  string
		auto     bool
		status   string
		interval *int32
	}{
		{id: "fc_sub_month", cycle: "MONTHLY", price: 100_000, renewal: "2026-03-20", auto: true, status: "ACTIVE"},
		{id: "fc_sub_year", cycle: "YEARLY", price: 1_200_000, renewal: "2027-01-10", auto: true, status: "ACTIVE"},
		{id: "fc_sub_life", cycle: "LIFETIME", price: 5_000_000, renewal: "2125-01-01", status: "ACTIVE"},
		{id: "fc_sub_custom", cycle: "CUSTOM", price: 200_000, renewal: "2026-04-05", auto: true, status: "ACTIVE", interval: i32pForTest(45)},
		{id: "fc_sub_noint", cycle: "CUSTOM", price: 500_000, renewal: "2026-04-10", auto: true, status: "ACTIVE"},
		{id: "fc_sub_paused", cycle: "MONTHLY", price: 999_000, renewal: "2026-04-01", auto: true, status: "PAUSED"},
	}
	for _, s := range subs {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "Subscription" (id, "userId", name, "billingCycle", "intervalDays", price, currency,
			                             "startedAt", "renewalDate", "autoRenew", status, "createdAt", "updatedAt")
			 VALUES ($1, $2, $1, $3, $4, $5, 'VND', '2025-01-01', $6, $7, $8, NOW(), NOW())`,
			s.id, userID, s.cycle, s.interval, s.price, s.renewal, s.auto, s.status); err != nil {
			t.Fatalf("insert subscription %s: %v", s.id, err)
		}
	}

	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		 VALUES ('fc_dev_1', $1, 'MacBook Pro', 'LAPTOP', '2025-01-01', 30000000, 'ACTIVE', NOW()),
		        ('fc_dev_sold', $1, 'Máy đã bán', 'PHONE', '2025-01-01', 5000000, 'SOLD', NOW())`, userID); err != nil {
		t.Fatalf("insert devices: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Warranty" (id, "deviceId", type, provider, "startDate", "endDate", months, cost, "createdAt", "updatedAt")
		 VALUES ('fc_war_1', 'fc_dev_1', 'STANDARD', 'Apple', '2025-03-20', '2026-03-20', 12, 2500000, NOW(), NOW()),
		        ('fc_war_2', 'fc_dev_1', 'EXTENDED', NULL, '2026-01-01', '2026-04-01', 3, NULL, NOW(), NOW()),
		        ('fc_war_sold', 'fc_dev_sold', 'STANDARD', NULL, '2025-01-01', '2026-03-25', 12, 4000000, NOW(), NOW()),
		        ('fc_war_late', 'fc_dev_1', 'STANDARD', NULL, '2026-01-01', '2027-06-01', 18, 9000000, NOW(), NOW())`); err != nil {
		t.Fatalf("insert warranties: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "WishlistItem" (id, "userId", name, "currentPrice", "targetDate", priority, status, "createdAt", "updatedAt")
		 VALUES ('fc_wish_1', $1, 'Sony XM6', 8500000, '2026-05-15', 'WANT', 'WATCHING', NOW(), NOW()),
		        ('fc_wish_skip', $1, 'Đã bỏ', 1000000, '2026-05-20', 'WANT', 'SKIPPED', NOW(), NOW()),
		        ('fc_wish_late', $1, 'Ngoài cửa sổ', 20000000, '2027-04-01', 'WANT', 'WATCHING', NOW(), NOW())`, userID); err != nil {
		t.Fatalf("insert wishlist: %v", err)
	}

	f, err := GetForecast(ctx, pool, userID, 12, fixedNow)
	if err != nil {
		t.Fatalf("GetForecast: %v", err)
	}

	// monthly 100k ×12 + yearly 1.2M + custom 45d 200k ×8 = 1.2M + 1.2M + 1.6M.
	if f.SubscriptionTotalVnd != 4_000_000 {
		t.Errorf("subscriptionTotalVnd = %d, want 4.000.000 (LIFETIME and the CUSTOM without intervalDays contribute nothing)",
			f.SubscriptionTotalVnd)
	}
	if f.SubscriptionAutoRenewTotalVnd != 4_000_000 {
		t.Errorf("subscriptionAutoRenewTotalVnd = %d, want 4.000.000 (all three charging packages auto-renew; "+
			"the paused and the interval-less ones contribute nothing)", f.SubscriptionAutoRenewTotalVnd)
	}
	if f.ChargesCount != 21 {
		t.Errorf("chargesCount = %d, want 21 (12 monthly + 1 yearly + 8 custom)", f.ChargesCount)
	}
	if f.Months != 12 || len(f.Buckets) != 13 {
		t.Errorf("months/buckets = %d/%d, want 12/13", f.Months, len(f.Buckets))
	}

	// Warranties: the ACTIVE device's two in-window packages only. The SOLD
	// device's warranty and the 2027-06 one are out (query + window).
	if len(f.UpcomingWarranties) != 2 {
		t.Fatalf("upcomingWarranties = %+v, want 2 rows", f.UpcomingWarranties)
	}
	if f.UpcomingWarranties[0].ID != "fc_war_1" || f.UpcomingWarranties[1].ID != "fc_war_2" {
		t.Errorf("upcomingWarranties = %s, %s; want fc_war_1, fc_war_2",
			f.UpcomingWarranties[0].ID, f.UpcomingWarranties[1].ID)
	}
	if f.UpcomingWarranties[1].CostVnd != nil {
		t.Errorf("fc_war_2 costVnd = %v, want null", *f.UpcomingWarranties[1].CostVnd)
	}
	// The device name rides along, so a client does not need an extra round trip.
	if f.UpcomingWarranties[0].DeviceName != "MacBook Pro" {
		t.Errorf("deviceName = %q, want MacBook Pro", f.UpcomingWarranties[0].DeviceName)
	}

	// Wishlist: WATCHING|DECIDED only, inside the window only.
	if len(f.UpcomingWishlist) != 1 || f.UpcomingWishlist[0].ID != "fc_wish_1" {
		t.Fatalf("upcomingWishlist = %+v, want only fc_wish_1", f.UpcomingWishlist)
	}
	if f.UpcomingWishlist[0].CurrentPriceVnd == nil || *f.UpcomingWishlist[0].CurrentPriceVnd != 8_500_000 {
		t.Errorf("fc_wish_1 price = %v, want 8.500.000", f.UpcomingWishlist[0].CurrentPriceVnd)
	}

	// The bucket the yearly package lands in is the one and only 2027-01 charge.
	jan := bucketByMonth(f, "2027-01")
	if jan == nil || jan.SubscriptionVnd != 1_300_000 || jan.SubscriptionCount != 2 {
		t.Errorf("2027-01 = %+v, want monthly 100k + yearly 1.2M", jan)
	}

	// Cross-check the shared arithmetic: the forecast's monthly average must equal
	// GET /api/v1/stats's subscriptions.totalMonthlyVnd for the same rows. If a
	// third variant of the money math ever appears, this fails.
	stats, err := Snapshot(ctx, pool, userID)
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if f.SubscriptionMonthlyAverageVnd != stats.Subscriptions.TotalMonthlyVnd {
		t.Errorf("forecast monthly average = %d, /stats totalMonthlyVnd = %d — the two must use the same arithmetic",
			f.SubscriptionMonthlyAverageVnd, stats.Subscriptions.TotalMonthlyVnd)
	}

	// An out-of-range months value is refused by the service too, not only by the
	// query parser.
	for _, bad := range []int{0, -1, ForecastMonthsMax + 1} {
		if _, err := GetForecast(ctx, pool, userID, bad, fixedNow); err == nil {
			t.Errorf("GetForecast(months=%d) = nil error, want VALIDATION", bad)
		}
	}
}
