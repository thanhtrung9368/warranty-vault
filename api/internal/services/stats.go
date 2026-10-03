package services

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/errgroup"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Status taxonomies — kept in sync with website/src/lib/services/stats.ts.
var statsDeviceStatuses = []string{"ACTIVE", "EXPIRED", "SOLD", "BROKEN", "LOST"}
var statsSubscriptionStatuses = []string{"ACTIVE", "PAUSED", "CANCELED", "EXPIRED"}
var statsWishlistStatuses = []string{"WATCHING", "DECIDED", "SKIPPED", "PURCHASED"}

// DeviceStats mirrors the `devices` slot in the TS UserStats shape.
type DeviceStats struct {
	Total              int64            `json:"total"`
	ByStatus           map[string]int64 `json:"byStatus"`
	TotalPurchasePrice int64            `json:"totalPurchasePrice"`
	// TotalWarrantyCost is the sum of Warranty.cost across every package on the
	// user's devices. The Android stats screen already reads exactly
	// `devices.totalWarrantyCost`; web/iOS used to recompute it with one
	// warranties call per device (the N+1 this field exists to kill).
	//
	// int64 on purpose: money is stored as int32 per row, so the sum must not be
	// narrowed back to int32.
	TotalWarrantyCost int64 `json:"totalWarrantyCost"`
}

// SubscriptionStats mirrors the `subscriptions` slot.
type SubscriptionStats struct {
	Total           int64            `json:"total"`
	ByStatus        map[string]int64 `json:"byStatus"`
	TotalMonthlyVnd int64            `json:"totalMonthlyVnd"`
}

// WishlistStats mirrors the `wishlist` slot.
type WishlistStats struct {
	Total                     int64            `json:"total"`
	ByStatus                  map[string]int64 `json:"byStatus"`
	TotalCurrentPriceWatching int64            `json:"totalCurrentPriceWatching"`
}

// Stats mirrors website/src/lib/services/stats.ts::UserStats.
type Stats struct {
	Devices       DeviceStats       `json:"devices"`
	Subscriptions SubscriptionStats `json:"subscriptions"`
	Wishlist      WishlistStats     `json:"wishlist"`
}

// statsQuerier is the slice of store.Queries that Snapshot needs. Declaring it
// as an interface (instead of taking *pgxpool.Pool all the way down) keeps the
// composition logic unit-testable: production passes store.New(db), while
// stats_test.go passes an in-memory querier so it can prove that
// `devices.totalWarrantyCost` is wired to StatsTotalWarrantyCost without a live
// database. Same pattern as categoryLookup in devices.go.
type statsQuerier interface {
	StatsDevicesByStatus(ctx context.Context, userID string) ([]store.StatsDevicesByStatusRow, error)
	StatsDevicesTotal(ctx context.Context, userID string) (store.StatsDevicesTotalRow, error)
	StatsTotalWarrantyCost(ctx context.Context, userID string) (int64, error)
	StatsSubscriptionsByStatus(ctx context.Context, userID string) ([]store.StatsSubscriptionsByStatusRow, error)
	StatsSubscriptionsMonthly(ctx context.Context, userID string) (int64, error)
	StatsWishlistByStatus(ctx context.Context, userID string) ([]store.StatsWishlistByStatusRow, error)
	StatsWishlistActiveValue(ctx context.Context, userID string) (int64, error)
}

// Snapshot returns aggregate stats for the dashboard / mobile home screen.
//
// Implementation choice: subscription monthly total uses the SQL CASE-based
// aggregator (`StatsSubscriptionsMonthly`) because it returns the SAME value
// the TS Go-side `monthlyVnd()` produces:
//   - MONTHLY    → price            (SQL: price)
//   - QUARTERLY  → floor(price/3)   (SQL: integer division price/3)
//   - YEARLY     → floor(price/12)  (SQL: integer division price/12)
//   - CUSTOM     → round(price*30/intervalDays) (SQL: ROUND(...))
//   - LIFETIME   → 0                (filtered by predicate)
//
// Verified: integer floor division in Postgres matches Math.floor for
// non-negative inputs, and ROUND vs Math.round both half-away-from-zero. The
// TS value for the test fixture (480_000 + floor(1_200_000/12) = 580_000)
// equals the SQL value.
//
// Active asset value is NOT used by the TS stats endpoint — it lives in
// website/src/lib/stats.ts (`activeAssetValue`) and is only surfaced on the
// /stats page via separate calls. We expose `Snapshot` to mirror exactly what
// `GET /api/v1/stats` returns, keeping `test_stats.sh` parity tight.
func Snapshot(ctx context.Context, db *pgxpool.Pool, userID string) (*Stats, error) {
	return snapshot(ctx, store.New(db), userID)
}

// snapshot is Snapshot's body, written against statsQuerier so the composition
// can be exercised without Postgres.
func snapshot(ctx context.Context, q statsQuerier, userID string) (*Stats, error) {
	var (
		deviceByStatus    []store.StatsDevicesByStatusRow
		deviceTotal       store.StatsDevicesTotalRow
		warrantyCostTotal int64
		subByStatus       []store.StatsSubscriptionsByStatusRow
		subMonthly        int64
		wishlistByStatus  []store.StatsWishlistByStatusRow
		wishlistActiveAgg int64
	)

	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		rows, err := q.StatsDevicesByStatus(gctx, userID)
		if err != nil {
			return fmt.Errorf("devices by status: %w", err)
		}
		deviceByStatus = rows
		return nil
	})
	g.Go(func() error {
		row, err := q.StatsDevicesTotal(gctx, userID)
		if err != nil {
			return fmt.Errorf("devices total: %w", err)
		}
		deviceTotal = row
		return nil
	})
	g.Go(func() error {
		v, err := q.StatsTotalWarrantyCost(gctx, userID)
		if err != nil {
			return fmt.Errorf("warranty cost total: %w", err)
		}
		warrantyCostTotal = v
		return nil
	})
	g.Go(func() error {
		rows, err := q.StatsSubscriptionsByStatus(gctx, userID)
		if err != nil {
			return fmt.Errorf("subs by status: %w", err)
		}
		subByStatus = rows
		return nil
	})
	g.Go(func() error {
		v, err := q.StatsSubscriptionsMonthly(gctx, userID)
		if err != nil {
			return fmt.Errorf("subs monthly: %w", err)
		}
		subMonthly = v
		return nil
	})
	g.Go(func() error {
		rows, err := q.StatsWishlistByStatus(gctx, userID)
		if err != nil {
			return fmt.Errorf("wishlist by status: %w", err)
		}
		wishlistByStatus = rows
		return nil
	})
	g.Go(func() error {
		v, err := q.StatsWishlistActiveValue(gctx, userID)
		if err != nil {
			return fmt.Errorf("wishlist active value: %w", err)
		}
		wishlistActiveAgg = v
		return nil
	})

	if err := g.Wait(); err != nil {
		return nil, err
	}

	out := &Stats{
		Devices: DeviceStats{
			Total:              deviceTotal.Total,
			ByStatus:           emptyStatusMap(statsDeviceStatuses),
			TotalPurchasePrice: deviceTotal.TotalPurchasePrice,
			TotalWarrantyCost:  warrantyCostTotal,
		},
		Subscriptions: SubscriptionStats{
			ByStatus:        emptyStatusMap(statsSubscriptionStatuses),
			TotalMonthlyVnd: subMonthly,
		},
		Wishlist: WishlistStats{
			ByStatus:                  emptyStatusMap(statsWishlistStatuses),
			TotalCurrentPriceWatching: wishlistActiveAgg,
		},
	}

	for _, r := range deviceByStatus {
		if _, ok := out.Devices.ByStatus[r.Status]; ok {
			out.Devices.ByStatus[r.Status] = r.Count
		}
	}
	for _, r := range subByStatus {
		out.Subscriptions.Total += r.Count
		if _, ok := out.Subscriptions.ByStatus[r.Status]; ok {
			out.Subscriptions.ByStatus[r.Status] = r.Count
		}
	}
	for _, r := range wishlistByStatus {
		out.Wishlist.Total += r.Count
		if _, ok := out.Wishlist.ByStatus[r.Status]; ok {
			out.Wishlist.ByStatus[r.Status] = r.Count
		}
	}

	return out, nil
}

func emptyStatusMap(keys []string) map[string]int64 {
	m := make(map[string]int64, len(keys))
	for _, k := range keys {
		m[k] = 0
	}
	return m
}
