package services

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Real-Postgres assertions for multi-currency devices (migration 0022, gap #16).
//
// They run only when WV_TEST_DATABASE_URL points at a throwaway Postgres, exactly
// like stats_test.go / category_seed_test.go (whose testDatabaseURL / gooseUp
// helpers this reuses). The target may be an empty database — the migrations are
// applied — but never point it at production.

// currencyUser creates a throwaway user and returns its id. The user row is
// deleted on cleanup, which cascades to devices, warranties and everything else.
func currencyUser(t *testing.T, pool *pgxpool.Pool, id string) string {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, id, id+"@example.invalid"); err != nil {
		t.Fatalf("insert test user %s: %v", id, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, id)
	})
	return id
}

func TestDeviceCurrencyAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_currency_devices_user"
	currencyUser(t, pool, userID)

	// 1. A create without currency is EXACTLY the pre-0022 request: VND, no rate,
	//    and purchasePriceVnd equals the price.
	vnd, err := CreateDevice(ctx, pool, userID, DeviceInput{
		Name:          "Máy VND",
		Category:      "PHONE",
		PurchaseDate:  "2025-03-01",
		PurchasePrice: 25_000_000,
	}, "")
	if err != nil {
		t.Fatalf("create VND device: %v", err)
	}
	if vnd.Currency != "VND" {
		t.Errorf("default currency = %q, want VND", vnd.Currency)
	}
	if vnd.FxRate != nil {
		t.Errorf("default fxRate = %v, want nil", vnd.FxRate)
	}
	if vnd.PurchasePriceVnd == nil || *vnd.PurchasePriceVnd != 25_000_000 {
		t.Errorf("purchasePriceVnd = %v, want 25000000", vnd.PurchasePriceVnd)
	}

	// 2. A USD device locks the rate it was given and computes from it.
	usd, err := CreateDevice(ctx, pool, userID, DeviceInput{
		Name:          "iPhone US",
		Category:      "PHONE",
		PurchaseDate:  "2025-04-01",
		PurchasePrice: 999,
		Currency:      "usd", // normalised to USD
		FxRate:        money(26100),
	}, "")
	if err != nil {
		t.Fatalf("create USD device: %v", err)
	}
	if usd.Currency != "USD" {
		t.Errorf("currency = %q, want USD", usd.Currency)
	}
	if usd.FxRate == nil || *usd.FxRate != 26100 {
		t.Errorf("fxRate = %v, want 26100 (locked)", usd.FxRate)
	}
	if usd.PurchasePriceVnd == nil || *usd.PurchasePriceVnd != 999*26100 {
		t.Errorf("purchasePriceVnd = %v, want %d", usd.PurchasePriceVnd, 999*26100)
	}
	// The stored price is NOT converted on write: the row keeps 999 USD.
	if usd.PurchasePrice != 999 {
		t.Errorf("stored purchasePrice = %d, want 999 (the device's own currency)", usd.PurchasePrice)
	}
	var storedCurrency string
	var storedRate *int32
	if err := pool.QueryRow(ctx,
		`SELECT currency, "fxRate" FROM "Device" WHERE id = $1`, usd.ID).Scan(&storedCurrency, &storedRate); err != nil {
		t.Fatalf("read stored row: %v", err)
	}
	if storedCurrency != "USD" || storedRate == nil || *storedRate != 26100 {
		t.Errorf("stored pair = %s/%v, want USD/26100", storedCurrency, storedRate)
	}

	// 3. Every read gains the computed value — list, detail, create.
	detail, err := GetDevice(ctx, pool, userID, usd.ID)
	if err != nil {
		t.Fatalf("get device: %v", err)
	}
	if detail.PurchasePriceVnd == nil || *detail.PurchasePriceVnd != 999*26100 {
		t.Errorf("detail purchasePriceVnd = %v, want %d", detail.PurchasePriceVnd, 999*26100)
	}

	list, err := ListDevices(ctx, pool, userID, DeviceFilter{Sort: "price", Dir: "asc"})
	if err != nil {
		t.Fatalf("list devices: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("list returned %d devices, want 2", len(list))
	}
	byID := map[string]DeviceListItem{}
	for _, d := range list {
		byID[d.ID] = d
	}
	if got := byID[usd.ID].PurchasePriceVnd; got == nil || *got != 999*26100 {
		t.Errorf("list purchasePriceVnd = %v, want %d", got, 999*26100)
	}
	// sort=price must compare VND values, not face values: 999 < 25,000,000 by
	// face, but 26,073,900 > 25,000,000 in VND. Ascending must put the VND device
	// first, which the face-value comparison would not.
	if list[0].ID != vnd.ID || list[1].ID != usd.ID {
		t.Errorf("sort=price asc order = [%s %s], want the 25,000,000 VND device first", list[0].Name, list[1].Name)
	}
	desc, err := ListDevices(ctx, pool, userID, DeviceFilter{Sort: "price", Dir: "desc"})
	if err != nil {
		t.Fatalf("list devices desc: %v", err)
	}
	if desc[0].ID != usd.ID {
		t.Errorf("sort=price desc first = %s, want the USD device (26,073,900 VND)", desc[0].Name)
	}

	// 4. Update semantics. An OLD client (no currency/fxRate in the body) must
	//    keep the locked pair: resetting it to VND would reinterpret 999 USD as
	//    999 VND.
	updateInput := DeviceInput{
		Name:          usd.Name,
		Category:      usd.Category,
		PurchaseDate:  "2025-04-01",
		PurchasePrice: usd.PurchasePrice,
	}
	kept, err := UpdateDevice(ctx, pool, userID, usd.ID, updateInput)
	if err != nil {
		t.Fatalf("update without currency: %v", err)
	}
	if kept.Currency != "USD" || kept.FxRate == nil || *kept.FxRate != 26100 {
		t.Errorf("update without currency changed the pair to %s/%v; it must keep USD/26100", kept.Currency, kept.FxRate)
	}

	// 5. Explicit VND clears the rate (the currency-change rule).
	toVND := updateInput
	toVND.Currency = "VND"
	cleared, err := UpdateDevice(ctx, pool, userID, usd.ID, toVND)
	if err != nil {
		t.Fatalf("update to VND: %v", err)
	}
	if cleared.Currency != "VND" || cleared.FxRate != nil {
		t.Errorf("after changing to VND the pair = %s/%v, want VND/nil", cleared.Currency, cleared.FxRate)
	}
	if cleared.PurchasePriceVnd == nil || *cleared.PurchasePriceVnd != 999 {
		t.Errorf("purchasePriceVnd after VND change = %v, want 999 (reinterpreted in VND)", cleared.PurchasePriceVnd)
	}

	// 6. Changing to a foreign currency without a rate is refused, and nothing is
	//    written: the old rate must never be carried across units.
	toEUR := updateInput
	toEUR.Currency = "EUR"
	_, err = UpdateDevice(ctx, pool, userID, usd.ID, toEUR)
	if err == nil {
		t.Fatal("expected a 400 for EUR without fxRate")
	}
	if fieldError(t, err, "fxRate") == "" {
		t.Fatalf("no fieldErrors.fxRate in %#v", err)
	}
	after, err := GetDevice(ctx, pool, userID, usd.ID)
	if err != nil {
		t.Fatalf("get after refused update: %v", err)
	}
	if after.Currency != "VND" {
		t.Errorf("a refused update must not write: currency = %q, want the previous VND", after.Currency)
	}

	// 7. The same change WITH a rate succeeds and locks the new value.
	toEUR.FxRate = money(29000)
	eur, err := UpdateDevice(ctx, pool, userID, usd.ID, toEUR)
	if err != nil {
		t.Fatalf("update to EUR with rate: %v", err)
	}
	if eur.Currency != "EUR" || eur.FxRate == nil || *eur.FxRate != 29000 {
		t.Errorf("EUR pair = %s/%v, want EUR/29000", eur.Currency, eur.FxRate)
	}
	if eur.PurchasePriceVnd == nil || *eur.PurchasePriceVnd != 999*29000 {
		t.Errorf("purchasePriceVnd = %v, want %d", eur.PurchasePriceVnd, 999*29000)
	}
}

func TestStatsMixedCurrencyAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const mixedUser = "zz_test_currency_stats_mixed"
	const vndUser = "zz_test_currency_stats_vnd"
	currencyUser(t, pool, mixedUser)
	currencyUser(t, pool, vndUser)

	// Mixed account: one VND device and one USD device, each with a warranty.
	// The USD numbers are the ones a naive SUM gets wrong:
	//   purchase: 25,000,000 + 999        = 25,000,999 (wrong)
	//   purchase: 25,000,000 + 999×26,100 = 51,073,900 (correct)
	//   warranty:  1,000,000 + 99         =  1,000,099 (wrong)
	//   warranty:  1,000,000 + 99×26,100  =  3,583,900 (correct)
	vndDev, err := CreateDevice(ctx, pool, mixedUser, DeviceInput{
		Name: "Máy VND", Category: "PHONE", PurchaseDate: "2025-01-01", PurchasePrice: 25_000_000,
	}, "")
	if err != nil {
		t.Fatalf("create VND device: %v", err)
	}
	usdDev, err := CreateDevice(ctx, pool, mixedUser, DeviceInput{
		Name: "Máy USD", Category: "PHONE", PurchaseDate: "2025-02-01", PurchasePrice: 999,
		Currency: "USD", FxRate: money(26100),
	}, "")
	if err != nil {
		t.Fatalf("create USD device: %v", err)
	}
	insertWarrantyWithCost := func(id, deviceID string, cost int32) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, cost, "updatedAt")
			 VALUES ($1, $2, 'STANDARD', NOW(), NOW() + INTERVAL '12 months', 12, $3, NOW())`,
			id, deviceID, cost); err != nil {
			t.Fatalf("insert warranty %s: %v", id, err)
		}
	}
	insertWarrantyWithCost("zz_test_cur_w_vnd", vndDev.ID, 1_000_000)
	insertWarrantyWithCost("zz_test_cur_w_usd", usdDev.ID, 99)

	stats, err := Snapshot(ctx, pool, mixedUser)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	const wantPurchase int64 = 25_000_000 + 999*26100
	const wantWarranty int64 = 1_000_000 + 99*26100
	if stats.Devices.TotalPurchasePrice != wantPurchase {
		t.Errorf("totalPurchasePrice = %d, want %d (VND + USD×locked rate)", stats.Devices.TotalPurchasePrice, wantPurchase)
	}
	if stats.Devices.TotalWarrantyCost != wantWarranty {
		t.Errorf("totalWarrantyCost = %d, want %d (Warranty.cost is in the device's currency)", stats.Devices.TotalWarrantyCost, wantWarranty)
	}

	// 2. A VND-only account is UNCHANGED. This is the regression the feature must
	//    not cause: the same rows, the same numbers as before migration 0022.
	for i, price := range []int32{25_000_000, 8_000_000, 0} {
		dev, derr := CreateDevice(ctx, pool, vndUser, DeviceInput{
			Name: "Máy VND " + strconv.Itoa(i), Category: "PHONE",
			PurchaseDate: "2025-05-01", PurchasePrice: price,
		}, "")
		if derr != nil {
			t.Fatalf("create VND-only device %d: %v", i, derr)
		}
		if dev.Currency != "VND" || dev.FxRate != nil {
			t.Fatalf("VND-only device has %s/%v", dev.Currency, dev.FxRate)
		}
		if dev.PurchasePriceVnd == nil || *dev.PurchasePriceVnd != int64(price) {
			t.Errorf("purchasePriceVnd = %v, want the price itself (%d)", dev.PurchasePriceVnd, price)
		}
		if i == 0 {
			insertWarrantyWithCost("zz_test_cur_w_vndonly", dev.ID, 2_000_000)
		}
	}

	var wantSum, wantCost int64
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM("purchasePrice"), 0)::bigint FROM "Device" WHERE "userId" = $1`,
		vndUser).Scan(&wantSum); err != nil {
		t.Fatalf("sum purchases: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(w.cost), 0)::bigint FROM "Warranty" w
		 JOIN "Device" d ON d.id = w."deviceId" WHERE d."userId" = $1`,
		vndUser).Scan(&wantCost); err != nil {
		t.Fatalf("sum warranty costs: %v", err)
	}
	vndStats, err := Snapshot(ctx, pool, vndUser)
	if err != nil {
		t.Fatalf("snapshot VND-only: %v", err)
	}
	if vndStats.Devices.TotalPurchasePrice != wantSum {
		t.Errorf("VND-only totalPurchasePrice = %d, want the plain SUM %d (unchanged behaviour)",
			vndStats.Devices.TotalPurchasePrice, wantSum)
	}
	if vndStats.Devices.TotalWarrantyCost != wantCost {
		t.Errorf("VND-only totalWarrantyCost = %d, want the plain SUM %d (unchanged behaviour)",
			vndStats.Devices.TotalWarrantyCost, wantCost)
	}

	// 3. The VND-only backup payload must not grow the two new keys. The export
	//    uses `omitempty` for exactly this reason; a VND user's file must stay
	//    byte-identical to the pre-0022 format.
	payload, err := ExportBackup(ctx, pool, vndUser)
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal export: %v", err)
	}
	if strings.Contains(string(raw), `"currency"`) {
		t.Error(`a VND-only backup must not contain "currency" (the payload would change for every existing user)`)
	}
	if strings.Contains(string(raw), `"fxRate"`) {
		t.Error(`a VND-only backup must not contain "fxRate"`)
	}
}

// The wishlist -> PURCHASED transition is the SECOND write path into "Device"
// (services/wishlist.go calls store.CreateDevice directly, not CreateDevice).
// That device must still come out as VND with no rate — otherwise a purchase
// made from the wishlist would store an empty currency, and the read path would
// treat a legitimate VND device as an unknown foreign one.
func TestWishlistPurchaseCreatesVNDDevice(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_currency_wishlist_user"
	currencyUser(t, pool, userID)

	item, err := CreateWishlist(ctx, pool, userID, WishlistInput{
		Name:         "Tai nghe Sony",
		Category:     strPtr("HEADPHONE"),
		CurrentPrice: money(4_500_000),
	})
	if err != nil {
		t.Fatalf("create wishlist item: %v", err)
	}
	updated, err := UpdateWishlist(ctx, pool, userID, item.ID, WishlistInput{
		Name:         item.Name,
		Category:     item.Category,
		CurrentPrice: money(4_500_000),
		Status:       "PURCHASED",
	})
	if err != nil {
		t.Fatalf("mark purchased: %v", err)
	}
	if updated.PurchasedDeviceId == nil {
		t.Fatal("purchase did not create a device")
	}
	dev, err := GetDevice(ctx, pool, userID, *updated.PurchasedDeviceId)
	if err != nil {
		t.Fatalf("get device created by the wishlist transition: %v", err)
	}
	if dev.Currency != "VND" || dev.FxRate != nil {
		t.Errorf("wishlist-created device pair = %q/%v, want VND/nil", dev.Currency, dev.FxRate)
	}
	if dev.PurchasePriceVnd == nil || *dev.PurchasePriceVnd != 4_500_000 {
		t.Errorf("purchasePriceVnd = %v, want 4500000", dev.PurchasePriceVnd)
	}
}

func strPtr(s string) *string { return &s }
