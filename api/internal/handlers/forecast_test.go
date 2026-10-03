package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// GET /api/v1/forecast over HTTP: auth, the `months` parameter, and the two
// LIFETIME/window rules that must hold end-to-end (FEATURE_IDEAS #8).
func TestForecastOverHTTP(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	const userID = "zz_test_forecast_http_user"
	insertUser(t, pool, userID, "forecast-http@example.invalid", hash)
	deleteUsers(t, pool, userID)
	issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	// Fixtures are relative to the wall clock on purpose: the handler calls
	// time.Now(), so absolute dates would drift out of the window. Bucketing itself
	// is covered deterministically in services/forecast_test.go.
	now := time.Now().UTC()
	endDate := now.AddDate(0, 0, 10)
	targetDate := now.AddDate(0, 0, 20)
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, currency, "startedAt",
		                             "renewalDate", "autoRenew", status, "createdAt", "updatedAt")
		 VALUES ('fc_http_life', $1, 'Lifetime tool', 'LIFETIME', 9900000, 'VND', $2, $3, false, 'ACTIVE', NOW(), NOW())`,
		userID, now.AddDate(-1, 0, 0), now.AddDate(100, 0, 0)); err != nil {
		t.Fatalf("insert lifetime sub: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		 VALUES ('fc_http_dev', $1, 'MacBook Pro', 'LAPTOP', $2, 30000000, 'ACTIVE', NOW())`, userID, now.AddDate(-1, 0, 0)); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, cost, "createdAt", "updatedAt")
		 VALUES ('fc_http_war', 'fc_http_dev', 'STANDARD', $1, $2, 12, 2500000, NOW(), NOW())`, now.AddDate(-1, 0, 0), endDate); err != nil {
		t.Fatalf("insert warranty: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "WishlistItem" (id, "userId", name, "currentPrice", "targetDate", priority, status, "createdAt", "updatedAt")
		 VALUES ('fc_http_wish', $1, 'Sony XM6', 8500000, $2, 'WANT', 'WATCHING', NOW(), NOW())`, userID, targetDate); err != nil {
		t.Fatalf("insert wishlist: %v", err)
	}

	mux := http.NewServeMux()
	RegisterForecast(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})

	get := func(url, bearer string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, url, nil)
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		return rr
	}

	// No bearer → 401.
	if rr := get("/api/v1/forecast", ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated forecast = %d, want 401", rr.Code)
	}

	rr := get("/api/v1/forecast", issued.AccessToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("forecast = %d (%s)", rr.Code, rr.Body.String())
	}
	var f services.Forecast
	if err := json.Unmarshal(rr.Body.Bytes(), &f); err != nil {
		t.Fatalf("decode forecast: %v", err)
	}
	if f.Months != services.ForecastMonthsDefault {
		t.Errorf("months = %d, want the %d default", f.Months, services.ForecastMonthsDefault)
	}
	if f.Currency != "VND" {
		t.Errorf("currency = %q, want VND", f.Currency)
	}
	if len(f.Buckets) != f.Months+1 && len(f.Buckets) != f.Months {
		t.Errorf("buckets = %d, want Months+1 (partial current month) or Months", len(f.Buckets))
	}
	if got := f.Buckets[0].Month; got != now.Format("2006-01") {
		t.Errorf("first bucket = %q, want the current month %q", got, now.Format("2006-01"))
	}

	// LIFETIME must not charge — not even as a zero row: with it as the only
	// subscription every money field is 0 and nothing was counted.
	if f.SubscriptionTotalVnd != 0 || f.ChargesCount != 0 || f.SubscriptionsCount != 0 {
		t.Errorf("LIFETIME charged something: total=%d charges=%d subs=%d",
			f.SubscriptionTotalVnd, f.ChargesCount, f.SubscriptionsCount)
	}
	if f.SubscriptionMonthlyAverageVnd != 0 {
		t.Errorf("LIFETIME monthly average = %d, want 0", f.SubscriptionMonthlyAverageVnd)
	}
	for _, b := range f.Buckets {
		if b.SubscriptionVnd != 0 || b.SubscriptionCount != 0 || b.SubscriptionAutoRenewVnd != 0 {
			t.Errorf("LIFETIME appeared in bucket %s: %+v", b.Month, b)
		}
	}

	// The warranty expiry and wishlist target date are in the window.
	if len(f.UpcomingWarranties) != 1 {
		t.Fatalf("upcomingWarranties = %+v, want 1", f.UpcomingWarranties)
	}
	if f.UpcomingWarranties[0].DeviceName != "MacBook Pro" || f.UpcomingWarranties[0].CostVnd == nil ||
		*f.UpcomingWarranties[0].CostVnd != 2_500_000 {
		t.Errorf("upcomingWarranties[0] = %+v", f.UpcomingWarranties[0])
	}
	if len(f.UpcomingWishlist) != 1 || f.UpcomingWishlist[0].CurrentPriceVnd == nil ||
		*f.UpcomingWishlist[0].CurrentPriceVnd != 8_500_000 {
		t.Fatalf("upcomingWishlist = %+v, want 1 item with its price", f.UpcomingWishlist)
	}
	// Bucket totals and the item lists agree — a client can drill into either.
	var warrantySum, wishlistSum int64
	for _, b := range f.Buckets {
		warrantySum += b.WarrantyExpiringVnd
		wishlistSum += b.WishlistTargetVnd
	}
	if warrantySum != 2_500_000 || wishlistSum != 8_500_000 {
		t.Errorf("bucket sums = %d / %d, want 2.500.000 / 8.500.000", warrantySum, wishlistSum)
	}
	if f.Note == "" {
		t.Error("note is empty, want the Vietnamese honesty line")
	}

	// months=3 shrinks the horizon.
	rr3 := get("/api/v1/forecast?months=3", issued.AccessToken)
	if rr3.Code != http.StatusOK {
		t.Fatalf("months=3 = %d (%s)", rr3.Code, rr3.Body.String())
	}
	var f3 services.Forecast
	if err := json.Unmarshal(rr3.Body.Bytes(), &f3); err != nil {
		t.Fatalf("decode months=3: %v", err)
	}
	if f3.Months != 3 || len(f3.Buckets) > 4 {
		t.Errorf("months=3 → Months=%d buckets=%d, want 3 buckets and at most 4", f3.Months, len(f3.Buckets))
	}

	// Garbage / out-of-range months → 400 with a field error, never a silent default.
	for _, raw := range []string{"abc", "0", "25", "-1", "12.5"} {
		rrBad := get("/api/v1/forecast?months="+raw, issued.AccessToken)
		if rrBad.Code != http.StatusBadRequest {
			t.Errorf("months=%s = %d, want 400 (%s)", raw, rrBad.Code, rrBad.Body.String())
			continue
		}
		var body struct {
			FieldErrors map[string][]string `json:"fieldErrors"`
		}
		if err := json.Unmarshal(rrBad.Body.Bytes(), &body); err != nil {
			t.Errorf("months=%s decode error body: %v", raw, err)
			continue
		}
		if len(body.FieldErrors["months"]) == 0 {
			t.Errorf("months=%s fieldErrors = %v, want a months message", raw, body.FieldErrors)
		}
	}
}
