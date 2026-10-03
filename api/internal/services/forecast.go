package services

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/errgroup"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Spending forecast (FEATURE_IDEAS #8).
//
// The rest of the app looks backwards — what has been spent. This is the forward
// half: exactly what the next N calendar months will charge, plus the warranty
// expiries and wishlist target dates that fall in the same window.
//
// Money rules, all of which are pinned by forecast_test.go with a fixed "now":
//
//  1. A subscription charge is `price`, charged ONCE per occurrence — never a
//     monthly equivalent. The *cadence* comes from services.NextRenewalDate and
//     the per-month conversion comes from services.MonthlyEquivalent: the two
//     canonical functions the rest of the backend (and stats.sql) already use.
//     No third variant of the cycle arithmetic is written here.
//  2. LIFETIME contributes 0 and never appears as a charge — the same treatment
//     MonthlyEquivalent and StatsSubscriptionsMonthly give it.
//  3. CUSTOM without a positive intervalDays is skipped entirely (it cannot be
//     scheduled at all), which is exactly what MonthlyEquivalent reports as 0.
//  4. Only ACTIVE subscriptions are considered: PAUSED/CANCELED/EXPIRED rows are
//     not going to charge anything.
//  5. Totals are int64. A row's price is int32; the sum is never narrowed.

// ForecastMonthsDefault / Min / Max bound the `months` query parameter. 24 is
// enough for a two-year plan and keeps the response (and the per-charge walk)
// small.
const (
	ForecastMonthsDefault = 12
	ForecastMonthsMin     = 1
	ForecastMonthsMax     = 24
)

// maxForecastRollIterations bounds the catch-up walk for a subscription whose
// renewalDate is far in the past (a stale row the user never updated). Positive
// intervals always advance, so the loop terminates on its own; the bound exists
// so a pathological intervalDays cannot spin.
const maxForecastRollIterations = 1000

// ForecastBucket is one calendar month of the window. Every money field is a sum
// in VND (int64) and every count is int64.
//
// The subscription figures are split on purpose: `subscriptionAutoRenewVnd` is
// money that will be taken automatically, and (subscriptionVnd -
// subscriptionAutoRenewVnd) is money the user still has to decide about. The
// forecast must not present the second kind as if it were already spent.
type ForecastBucket struct {
	Month                    string `json:"month"` // "YYYY-MM", UTC
	SubscriptionVnd          int64  `json:"subscriptionVnd"`
	SubscriptionAutoRenewVnd int64  `json:"subscriptionAutoRenewVnd"`
	SubscriptionCount        int64  `json:"subscriptionCount"`
	WarrantyExpiringVnd      int64  `json:"warrantyExpiringVnd"`
	WarrantyExpiringCount    int64  `json:"warrantyExpiringCount"`
	WishlistTargetVnd        int64  `json:"wishlistTargetVnd"`
	WishlistTargetCount      int64  `json:"wishlistTargetCount"`
}

// ForecastWarranty is one upcoming warranty expiry. `costVnd` is the price of the
// package that is ending, offered as a reference for how much to set aside — it is
// NOT a charge, and it is nil when the package has no recorded cost.
type ForecastWarranty struct {
	ID         string  `json:"id"`
	DeviceID   string  `json:"deviceId"`
	DeviceName string  `json:"deviceName"`
	Type       string  `json:"type"`
	Provider   *string `json:"provider"`
	EndDate    string  `json:"endDate"` // RFC3339Nano UTC
	Month      string  `json:"month"`   // bucket it was counted in
	Months     int32   `json:"months"`
	CostVnd    *int64  `json:"costVnd"`
}

// ForecastWishlistItem is one upcoming wishlist target date. `currentPriceVnd` is
// the last recorded price (nil when none was ever entered) — a possible spend,
// not a charge.
type ForecastWishlistItem struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	TargetDate      string `json:"targetDate"` // RFC3339Nano UTC
	Month           string `json:"month"`
	Priority        string `json:"priority"`
	Status          string `json:"status"`
	CurrentPriceVnd *int64 `json:"currentPriceVnd"`
}

// Forecast is the whole read model behind GET /api/v1/forecast.
type Forecast struct {
	// GeneratedAt is the "now" the arithmetic used. Every other timestamp in the
	// payload is relative to it, so a client can render the countdown without
	// re-deriving the window.
	GeneratedAt string `json:"generatedAt"`
	// Window is [WindowStart, WindowEnd): WindowStart is inclusive (= GeneratedAt),
	// WindowEnd exclusive (the first instant `Months` calendar months from now).
	WindowStart string `json:"windowStart"`
	WindowEnd   string `json:"windowEnd"`
	// Months is the requested horizon in calendar months. `Buckets` holds the
	// calendar months that horizon touches: normally Months+1 of them (the partial
	// current month plus Months full ones), or exactly Months when now is the first
	// instant of a month. See ForecastWindow.
	Months   int    `json:"months"`
	Currency string `json:"currency"`
	// SubscriptionTotalVnd is the sum of every scheduled charge in the window.
	SubscriptionTotalVnd          int64 `json:"subscriptionTotalVnd"`
	SubscriptionAutoRenewTotalVnd int64 `json:"subscriptionAutoRenewTotalVnd"`
	// SubscriptionMonthlyAverageVnd is the canonical monthly equivalent of every
	// ACTIVE non-LIFETIME subscription — the SAME number /stats reports as
	// subscriptions.totalMonthlyVnd — so the "~X/tháng" line cannot disagree with
	// the dashboard.
	SubscriptionMonthlyAverageVnd int64 `json:"subscriptionMonthlyAverageVnd"`
	// SubscriptionsCount counts the subscriptions that contribute at least one
	// charge in the window; ChargesCount counts the charges themselves (one
	// quarterly package contributes 4).
	SubscriptionsCount int64                  `json:"subscriptionsCount"`
	ChargesCount       int64                  `json:"chargesCount"`
	Buckets            []ForecastBucket       `json:"buckets"`
	UpcomingWarranties []ForecastWarranty     `json:"upcomingWarranties"`
	UpcomingWishlist   []ForecastWishlistItem `json:"upcomingWishlist"`
	// Note is the Vietnamese honesty line about what these numbers do and do not
	// include. Clients render it as-is.
	Note string `json:"note"`
}

// forecastNote explains the model in one sentence, in the user's language. It
// deliberately avoids naming a month count: `months` is a request parameter.
const forecastNote = "Chỉ tính các gói đang ACTIVE; gói LIFETIME không bao giờ bị trừ. " +
	"Cửa sổ tính từ hôm nay, nên tháng đầu và tháng cuối chỉ tính phần nằm trong cửa sổ. " +
	"subscriptionAutoRenewVnd là tiền sẽ bị trừ tự động, phần còn lại là các gói bạn phải tự gia hạn. " +
	"Tiền bảo hành và wishlist là khoản có thể phát sinh, không phải khoản chắc chắn trả."

// ForecastWindow returns the calendar window the forecast covers, given a fixed
// `now` and a month count.
//
// Bucketing rule (documented in openapi.yaml as well):
//
//   - The horizon is [now, now + `months` calendar months). `AddDate` semantics,
//     i.e. the same month arithmetic services.NextRenewalDate uses, so the horizon
//     and the charge dates can never disagree about what "+1 month" means.
//   - Buckets are the calendar months (UTC) that horizon TOUCHES, starting with
//     the month containing `now`. That is normally `months+1` buckets — the
//     partial current month plus `months` full ones — and exactly `months` when
//     `now` is the very first instant of a month.
//     Listing the tail month matters: a monthly package renewing on the 1st would
//     otherwise show only 11 of its 12 charges in a 12-month forecast.
//   - A charge landing exactly on the first instant of a month belongs to THAT
//     month, and one landing exactly on `end` belongs to no bucket: every bucket
//     is left-closed and right-open ([monthStart, nextMonthStart)).
//   - The current month is PARTIAL: only the part from `now` onward is counted, so
//     a charge earlier this month is history, not forecast. The final bucket is
//     partial in the same way when `end` falls mid-month.
func ForecastWindow(now time.Time, months int) (start, end time.Time, keys []string) {
	now = now.UTC()
	first := monthStart(now)
	end = now.AddDate(0, months, 0)

	// Number of buckets: months between the first bucket and the month `end` lands
	// in, plus that month itself unless `end` sits exactly on its first instant.
	n := monthsBetween(first, monthStart(end))
	if !end.Equal(monthStart(end)) {
		n++
	}
	if n < 1 {
		n = 1
	}

	keys = make([]string, n)
	for i := 0; i < n; i++ {
		keys[i] = first.AddDate(0, i, 0).Format("2006-01")
	}
	return now, end, keys
}

func monthStart(t time.Time) time.Time {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC)
}

// monthsBetween counts whole calendar months from a to b (both normalised to month
// starts by the caller).
func monthsBetween(a, b time.Time) int {
	return (b.Year()-a.Year())*12 + int(b.Month()) - int(a.Month())
}

// BuildForecast is the pure half of GetForecast: rows in, buckets out. It takes a
// fixed `now` so the whole thing is deterministic and testable without a clock.
//
// Callers are expected to have fetched the rows for the window already (the two
// *_Between queries); rows outside it are simply never bucketed.
func BuildForecast(now time.Time, months int, subs []store.Subscription, warranties []store.ListWarrantiesExpiringBetweenRow, wishlist []store.WishlistItem) *Forecast {
	start, end, keys := ForecastWindow(now, months)
	n := len(keys)
	first := monthStart(start)

	f := &Forecast{
		GeneratedAt:        start.Format(time.RFC3339Nano),
		WindowStart:        start.Format(time.RFC3339Nano),
		WindowEnd:          end.Format(time.RFC3339Nano),
		Months:             months,
		Currency:           "VND",
		Buckets:            make([]ForecastBucket, n),
		UpcomingWarranties: []ForecastWarranty{},
		UpcomingWishlist:   []ForecastWishlistItem{},
		Note:               forecastNote,
	}
	for i, k := range keys {
		f.Buckets[i] = ForecastBucket{Month: k}
	}

	// bucketIndex maps an instant onto its bucket, or -1 when it is outside the
	// window. instant < start is excluded (history), as is instant >= end.
	bucketIndex := func(t time.Time) int {
		t = t.UTC()
		if t.Before(start) || !t.Before(end) {
			return -1
		}
		idx := monthsBetween(first, monthStart(t))
		if idx < 0 || idx >= n {
			return -1
		}
		return idx
	}

	for _, s := range subs {
		if s.Status != SubscriptionStatusActive {
			continue
		}
		// LIFETIME never renews and never charges: MonthlyEquivalent returns 0 for
		// it and StatsSubscriptionsMonthly filters it out. Same here — and it must
		// not even show up as a zero charge, so it is skipped before any bucketing.
		if s.BillingCycle == BillingCycleLifetime {
			continue
		}

		// Canonical per-month value, accumulated for every ACTIVE non-LIFETIME row
		// with the exact predicate StatsSubscriptionsMonthly uses, so this number is
		// equal to /stats.subscriptions.totalMonthlyVnd and the "~X/tháng" line can
		// never disagree with the dashboard. It is NOT how the 12-month total is
		// computed — charges are charged at face value.
		f.SubscriptionMonthlyAverageVnd += MonthlyEquivalent(s.Price, s.BillingCycle, s.IntervalDays)

		if !s.RenewalDate.Valid {
			continue
		}
		interval := s.IntervalDays

		// A package whose cadence cannot be computed has no schedule at all: a
		// CUSTOM cycle without a positive intervalDays (or an unknown cycle) is
		// skipped COMPLETELY — not even its current renewalDate is reported as a
		// single charge. That is exactly what MonthlyEquivalent reports as 0 for the
		// same row, and it is why this check runs before any bucketing.
		if _, err := NextRenewalDate(s.RenewalDate.Time.UTC(), s.BillingCycle, interval); err != nil {
			continue
		}

		// Catch up an overdue renewalDate (a stale row, or one the auto-billing
		// cron will roll forward on its next run) so the first charge reported is
		// the next one to actually happen rather than a date in the past.
		d := s.RenewalDate.Time.UTC()
		for rolled := 0; d.Before(start); rolled++ {
			if rolled >= maxForecastRollIterations {
				break
			}
			next, err := NextRenewalDate(d, s.BillingCycle, interval)
			if err != nil {
				break
			}
			d = next
		}
		if d.Before(start) {
			continue
		}

		contributed := false
		for i := 0; i <= maxForecastRollIterations; i++ {
			idx := bucketIndex(d)
			if idx < 0 {
				break
			}
			b := &f.Buckets[idx]
			b.SubscriptionVnd += int64(s.Price)
			b.SubscriptionCount++
			if s.AutoRenew {
				b.SubscriptionAutoRenewVnd += int64(s.Price)
				f.SubscriptionAutoRenewTotalVnd += int64(s.Price)
			}
			f.SubscriptionTotalVnd += int64(s.Price)
			f.ChargesCount++
			contributed = true

			// Cadence from the canonical helper — the same NextRenewalDate the
			// reminder/cron paths and all three clients already implement.
			next, err := NextRenewalDate(d, s.BillingCycle, interval)
			if err != nil {
				break
			}
			d = next
		}
		if contributed {
			f.SubscriptionsCount++
		}
	}

	for _, w := range warranties {
		if !w.EndDate.Valid {
			continue
		}
		idx := bucketIndex(w.EndDate.Time)
		if idx < 0 {
			continue
		}
		var cost int64
		if w.Cost != nil {
			cost = int64(*w.Cost)
		}
		f.Buckets[idx].WarrantyExpiringVnd += cost
		f.Buckets[idx].WarrantyExpiringCount++
		f.UpcomingWarranties = append(f.UpcomingWarranties, ForecastWarranty{
			ID:         w.ID,
			DeviceID:   w.DeviceId,
			DeviceName: w.DeviceName,
			Type:       w.Type,
			Provider:   w.Provider,
			EndDate:    w.EndDate.Time.UTC().Format(time.RFC3339Nano),
			Month:      f.Buckets[idx].Month,
			Months:     w.Months,
			CostVnd:    costPtr(w.Cost),
		})
	}

	for _, it := range wishlist {
		if !it.TargetDate.Valid {
			continue
		}
		idx := bucketIndex(it.TargetDate.Time)
		if idx < 0 {
			continue
		}
		var price int64
		if it.CurrentPrice != nil {
			price = int64(*it.CurrentPrice)
		}
		f.Buckets[idx].WishlistTargetVnd += price
		f.Buckets[idx].WishlistTargetCount++
		f.UpcomingWishlist = append(f.UpcomingWishlist, ForecastWishlistItem{
			ID:              it.ID,
			Name:            it.Name,
			TargetDate:      it.TargetDate.Time.UTC().Format(time.RFC3339Nano),
			Month:           f.Buckets[idx].Month,
			Priority:        it.Priority,
			Status:          it.Status,
			CurrentPriceVnd: costPtr(it.CurrentPrice),
		})
	}

	return f
}

// costPtr widens a nullable int32 VND column to the int64 the API exposes, keeping
// NULL as NULL: "no price recorded" is not the same fact as "costs 0".
func costPtr(v *int32) *int64 {
	if v == nil {
		return nil
	}
	out := int64(*v)
	return &out
}

// GetForecast fetches the candidate rows and builds the forecast. `now` is a
// parameter (not time.Now() inside) so callers — and tests — control the clock.
func GetForecast(ctx context.Context, db *pgxpool.Pool, userID string, months int, now time.Time) (*Forecast, error) {
	if months < ForecastMonthsMin || months > ForecastMonthsMax {
		return nil, ErrValidation(FieldErrors{
			"months": {fmt.Sprintf("Số tháng phải trong khoảng %d–%d", ForecastMonthsMin, ForecastMonthsMax)},
		})
	}
	start, end, _ := ForecastWindow(now, months)
	rng := pgtype.Timestamp{Time: start, Valid: true}
	rngEnd := pgtype.Timestamp{Time: end, Valid: true}

	q := store.New(db)
	var (
		subs       []store.Subscription
		warranties []store.ListWarrantiesExpiringBetweenRow
		wishlist   []store.WishlistItem
	)
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		// Reuses the existing per-user query. Column2 is its (sqlc-generated) name
		// for the status filter; "ACTIVE" is the only set that can still charge.
		rows, err := q.ListSubscriptionsByUser(gctx, store.ListSubscriptionsByUserParams{
			UserId:  userID,
			Column2: SubscriptionStatusActive,
		})
		if err != nil {
			return fmt.Errorf("list subscriptions: %w", err)
		}
		subs = rows
		return nil
	})
	g.Go(func() error {
		rows, err := q.ListWarrantiesExpiringBetween(gctx, store.ListWarrantiesExpiringBetweenParams{
			UserId:    userID,
			EndDate:   rng,
			EndDate_2: rngEnd,
		})
		if err != nil {
			return fmt.Errorf("list expiring warranties: %w", err)
		}
		warranties = rows
		return nil
	})
	g.Go(func() error {
		rows, err := q.ListWishlistTargetsBetween(gctx, store.ListWishlistTargetsBetweenParams{
			UserId:       userID,
			TargetDate:   rng,
			TargetDate_2: rngEnd,
		})
		if err != nil {
			return fmt.Errorf("list wishlist targets: %w", err)
		}
		wishlist = rows
		return nil
	})
	if err := g.Wait(); err != nil {
		return nil, err
	}

	return BuildForecast(now, months, subs, warranties, wishlist), nil
}

// ParseForecastMonths parses the optional `months` query parameter. An empty
// value means the default; anything unparseable or out of range is an error, so a
// typo cannot silently change the window.
func ParseForecastMonths(raw string) (int, error) {
	if raw == "" {
		return ForecastMonthsDefault, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < ForecastMonthsMin || n > ForecastMonthsMax {
		return 0, ErrValidation(FieldErrors{
			"months": {fmt.Sprintf("Số tháng phải là số trong khoảng %d–%d", ForecastMonthsMin, ForecastMonthsMax)},
		})
	}
	return n, nil
}
