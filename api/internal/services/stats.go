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

// Snapshot returns aggregate stats for the dashboard / mobile home screen.
//
// Implementation choice: subscription monthly total uses the SQL CASE-based
// aggregator (`StatsSubscriptionsMonthly`) because it returns the SAME value
// the TS Go-side `monthlyVnd()` produces:
//   * MONTHLY    → price            (SQL: price)
//   * QUARTERLY  → floor(price/3)   (SQL: integer division price/3)
//   * YEARLY     → floor(price/12)  (SQL: integer division price/12)
//   * CUSTOM     → round(price*30/intervalDays) (SQL: ROUND(...))
//   * LIFETIME   → 0                (filtered by predicate)
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
	q := store.New(db)

	var (
		deviceByStatus    []store.StatsDevicesByStatusRow
		deviceTotal       store.StatsDevicesTotalRow
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
