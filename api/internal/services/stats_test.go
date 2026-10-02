package services

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// ---- pure composition tests -------------------------------------------------
//
// statsQuerier exists so the aggregation wiring can be asserted without
// Postgres. These tests are the DB-free half of the totalWarrantyCost coverage:
// they prove the value read by StatsTotalWarrantyCost lands at exactly
// `devices.totalWarrantyCost` (the JSON path the Android stats screen and the
// web/iOS rollups read) and that a failing query is propagated, not swallowed
// by the errgroup.

// fakeStatsQuerier is an in-memory statsQuerier. Zero values are valid — a fake
// with no warranty rows stands for "user has no warranty → 0".
type fakeStatsQuerier struct {
	deviceByStatus    []store.StatsDevicesByStatusRow
	deviceTotal       store.StatsDevicesTotalRow
	warrantyCost      int64
	subsByStatus      []store.StatsSubscriptionsByStatusRow
	subsMonthly       int64
	wishlistByStatus  []store.StatsWishlistByStatusRow
	wishlistActiveVal int64

	// warrantyCostErr, when set, makes StatsTotalWarrantyCost fail.
	warrantyCostErr error

	// seenUserID records the scoping argument the composition passed down.
	seenUserID string
}

func (f *fakeStatsQuerier) StatsDevicesByStatus(_ context.Context, userID string) ([]store.StatsDevicesByStatusRow, error) {
	f.seenUserID = userID
	return f.deviceByStatus, nil
}

func (f *fakeStatsQuerier) StatsDevicesTotal(context.Context, string) (store.StatsDevicesTotalRow, error) {
	return f.deviceTotal, nil
}

func (f *fakeStatsQuerier) StatsTotalWarrantyCost(context.Context, string) (int64, error) {
	if f.warrantyCostErr != nil {
		return 0, f.warrantyCostErr
	}
	return f.warrantyCost, nil
}

func (f *fakeStatsQuerier) StatsSubscriptionsByStatus(context.Context, string) ([]store.StatsSubscriptionsByStatusRow, error) {
	return f.subsByStatus, nil
}

func (f *fakeStatsQuerier) StatsSubscriptionsMonthly(context.Context, string) (int64, error) {
	return f.subsMonthly, nil
}

func (f *fakeStatsQuerier) StatsWishlistByStatus(context.Context, string) ([]store.StatsWishlistByStatusRow, error) {
	return f.wishlistByStatus, nil
}

func (f *fakeStatsQuerier) StatsWishlistActiveValue(context.Context, string) (int64, error) {
	return f.wishlistActiveVal, nil
}

// TestSnapshotComposesWarrantyTotal is the aggregate-logic test: the number the
// store returns must be copied verbatim into devices.totalWarrantyCost, beside
// totalPurchasePrice, and must stay an int64.
func TestSnapshotComposesWarrantyTotal(t *testing.T) {
	// Deliberately larger than math.MaxInt32: three top-of-the-line packages can
	// exceed int32 VND, the exact overflow class Android was fixed for. If the
	// total were narrowed back to int32 anywhere this would come back negative.
	const want int64 = 4_500_000_000 // 3 × 1.5 tỷ

	fake := &fakeStatsQuerier{
		deviceTotal:  store.StatsDevicesTotalRow{Total: 2, TotalPurchasePrice: 42_000_000},
		warrantyCost: want,
	}
	got, err := snapshot(context.Background(), fake, "user-1")
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}

	if got.Devices.TotalWarrantyCost != want {
		t.Errorf("Devices.TotalWarrantyCost = %d, want %d", got.Devices.TotalWarrantyCost, want)
	}
	// The new total must not disturb the existing slots.
	if got.Devices.TotalPurchasePrice != 42_000_000 || got.Devices.Total != 2 {
		t.Errorf("device totals drifted: total=%d purchasePrice=%d, want 2 / 42000000",
			got.Devices.Total, got.Devices.TotalPurchasePrice)
	}
	if _, ok := got.Devices.ByStatus["ACTIVE"]; !ok {
		t.Errorf("byStatus lost its zero-filled keys: %v", got.Devices.ByStatus)
	}
	if fake.seenUserID != "user-1" {
		t.Errorf("queries were scoped to %q, want \"user-1\"", fake.seenUserID)
	}

	// The wire shape is the contract: Android decodes `devices.totalWarrantyCost`
	// as a Long. A rename or a move to another block must fail here, not in the app.
	raw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal stats: %v", err)
	}
	var decoded struct {
		Devices map[string]json.RawMessage `json:"devices"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal stats: %v", err)
	}
	field, ok := decoded.Devices["totalWarrantyCost"]
	if !ok {
		t.Fatalf("devices block has no totalWarrantyCost key — got keys %v", sortedKeys(decoded.Devices))
	}
	var asNumber int64
	if err := json.Unmarshal(field, &asNumber); err != nil {
		t.Fatalf("devices.totalWarrantyCost is not an integer: %s (%v)", field, err)
	}
	if asNumber != want {
		t.Errorf("JSON devices.totalWarrantyCost = %d, want %d", asNumber, want)
	}
	// Always present — never omitted when zero, otherwise Android would fall back
	// to hiding the tile.
	empty := &fakeStatsQuerier{}
	stats, err := snapshot(context.Background(), empty, "user-2")
	if err != nil {
		t.Fatalf("snapshot (no warranties): %v", err)
	}
	rawEmpty, err := json.Marshal(stats)
	if err != nil {
		t.Fatalf("marshal empty stats: %v", err)
	}
	if !strings.Contains(string(rawEmpty), `"totalWarrantyCost":0`) {
		t.Errorf("a user without warranties must still emit totalWarrantyCost:0, got %s", rawEmpty)
	}
}

// TestSnapshotPropagatesWarrantyCostError pins the errgroup wiring: the new
// query runs concurrently with the others, so its failure has to abort the whole
// snapshot rather than silently reporting 0.
func TestSnapshotPropagatesWarrantyCostError(t *testing.T) {
	boom := errors.New("connection reset")
	_, err := snapshot(context.Background(), &fakeStatsQuerier{warrantyCostErr: boom}, "user-1")
	if err == nil {
		t.Fatal("snapshot returned nil error while StatsTotalWarrantyCost failed")
	}
	if !errors.Is(err, boom) {
		t.Errorf("error %v does not wrap the query failure", err)
	}
	if !strings.Contains(err.Error(), "warranty cost total") {
		t.Errorf("error %q does not name the failing aggregate", err)
	}
}

func sortedKeys(m map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// ---- real-database assertions ----------------------------------------------
//
// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres, exactly
// like category_seed_test.go (whose testDatabaseURL / gooseUp helpers this
// reuses). The target may be an empty database — the migrations are applied —
// but never point it at production.

func TestStatsWarrantyCostAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	// LIFO: registered before the row cleanup below so the deletes run first.
	t.Cleanup(pool.Close)

	const (
		userID   = "zz_test_stats_warranty_user"
		otherID  = "zz_test_stats_warranty_other"
		noWarr   = "zz_test_stats_warranty_empty"
		devA     = "zz_test_stats_warranty_dev_a"
		devB     = "zz_test_stats_warranty_dev_b"
		devOther = "zz_test_stats_warranty_dev_other"
	)
	for _, u := range []string{userID, otherID, noWarr} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, $3, NOW())
			 ON CONFLICT (id) DO NOTHING`, u, u+"@example.invalid", "x"); err != nil {
			t.Fatalf("insert test user %s: %v", u, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`,
			[]string{userID, otherID, noWarr})
	})

	// devA carries three packages (NULL cost, an explicit 0, and a real price),
	// devB one package. devOther belongs to a second user and must never leak
	// into the first user's total.
	for _, d := range []struct {
		id, owner string
	}{{devA, userID}, {devB, userID}, {devOther, otherID}} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
			 VALUES ($1, $2, $3, 'PHONE', NOW(), 10_000_000, NOW())`, d.id, d.owner, "Thiết bị test"); err != nil {
			t.Fatalf("insert device %s: %v", d.id, err)
		}
	}

	// Hand-computed expectations:
	//   user   : 1_200_000 + NULL + 0 + 2_500_000      = 3_700_000
	//   other  : 9_999_999                             = 9_999_999 (must not leak)
	//   noWarr : (no device, no warranty)              = 0
	insertWarranty := func(id, deviceID string, cost *int32) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, cost, "updatedAt")
			 VALUES ($1, $2, 'STANDARD', NOW(), NOW() + INTERVAL '12 months', 12, $3, NOW())`,
			id, deviceID, cost); err != nil {
			t.Fatalf("insert warranty %s: %v", id, err)
		}
	}
	money := func(v int32) *int32 { return &v }
	insertWarranty("zz_test_stats_w_a1", devA, money(1_200_000))
	insertWarranty("zz_test_stats_w_a2", devA, nil) // nullable cost
	insertWarranty("zz_test_stats_w_a3", devA, money(0))
	insertWarranty("zz_test_stats_w_b1", devB, money(2_500_000))
	insertWarranty("zz_test_stats_w_other1", devOther, money(9_999_999))

	const wantUserCost int64 = 3_700_000
	q := store.New(pool)

	// 1. The query itself.
	gotQuery, err := q.StatsTotalWarrantyCost(ctx, userID)
	if err != nil {
		t.Fatalf("StatsTotalWarrantyCost: %v", err)
	}
	if gotQuery != wantUserCost {
		t.Errorf("StatsTotalWarrantyCost(%s) = %d, want %d (hand-computed: 1200000 + NULL + 0 + 2500000)",
			userID, gotQuery, wantUserCost)
	}

	// 2. The user is scoped: the other user's 9_999_999 must be excluded, and the
	//    same query for that other user must see only its own package.
	if gotOther, err := q.StatsTotalWarrantyCost(ctx, otherID); err != nil {
		t.Fatalf("StatsTotalWarrantyCost(other): %v", err)
	} else if gotOther != 9_999_999 {
		t.Errorf("StatsTotalWarrantyCost(%s) = %d, want 9999999 — the WHERE clause must scope by userId, not sum everything",
			otherID, gotOther)
	}

	// 3. No device / no warranty at all: COALESCE(SUM(...), 0) must yield 0, not NULL.
	if gotEmpty, err := q.StatsTotalWarrantyCost(ctx, noWarr); err != nil {
		t.Fatalf("StatsTotalWarrantyCost(no warranties): %v", err)
	} else if gotEmpty != 0 {
		t.Errorf("StatsTotalWarrantyCost(user without warranties) = %d, want 0", gotEmpty)
	}

	// 4. End-to-end through the service, which is what GET /api/v1/stats returns.
	stats, err := Snapshot(ctx, pool, userID)
	if err != nil {
		t.Fatalf("Snapshot: %v", err)
	}
	if stats.Devices.TotalWarrantyCost != wantUserCost {
		t.Errorf("Snapshot devices.totalWarrantyCost = %d, want %d", stats.Devices.TotalWarrantyCost, wantUserCost)
	}
	t.Logf("expected devices.totalWarrantyCost = %d, observed = %d", wantUserCost, stats.Devices.TotalWarrantyCost)

	// 5. Overflow guard: the sum stays int64 past math.MaxInt32 (2_147_483_647).
	//    Each row is a valid int32; only the total is wide.
	insertWarranty("zz_test_stats_w_big", devB, money(1_500_000_000))
	insertWarranty("zz_test_stats_w_big2", devB, money(1_500_000_000))
	insertWarranty("zz_test_stats_w_big3", devB, money(1_500_000_000))
	const wantBig int64 = 3_700_000 + 4_500_000_000
	gotBig, err := q.StatsTotalWarrantyCost(ctx, userID)
	if err != nil {
		t.Fatalf("StatsTotalWarrantyCost (bigint): %v", err)
	}
	if gotBig != wantBig {
		t.Errorf("StatsTotalWarrantyCost after big rows = %d, want %d (past MaxInt32: the total must not be narrowed)",
			gotBig, wantBig)
	}
}
