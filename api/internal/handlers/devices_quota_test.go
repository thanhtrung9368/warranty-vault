package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// FEATURE_IDEAS #14 — "thiết bị đã bán không còn chiếm suất 50".
//
// Every test here runs against its OWN scratch database (newScratchDatabaseDSN in
// testhelpers_test.go) because `go test ./...` runs package binaries in parallel
// and the services package's migration round-trip test drops the shared database
// back to version 3 mid-run. Seeding is done with raw SQL — 50 rows through the
// service would test the seed, not the ceiling — and the assertion is made through
// the real HTTP surface, so the message the user actually reads is what is pinned.

const quotaTestUser = "zz_test_quota_user"

func setupQuotaTest(t *testing.T) (*pgxpool.Pool, *http.ServeMux, string) {
	t.Helper()
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
	insertUser(t, pool, quotaTestUser, "quota@example.invalid", hash)
	deleteUsers(t, pool, quotaTestUser)
	issued, err := auth.IssueToken(ctx, pool, quotaTestUser, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	mux := http.NewServeMux()
	RegisterDevices(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	RegisterStats(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	RegisterWishlist(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	return pool, mux, issued.AccessToken
}

// seedDevices inserts n devices with the given status, ids prefixed so the caller
// can tell the fixture rows apart.
func seedDevices(t *testing.T, pool *pgxpool.Pool, prefix, status string, n int) {
	t.Helper()
	if n == 0 {
		return
	}
	// One statement, generated rows: inserting 500 rows one at a time dominates the
	// test runtime and proves nothing extra.
	_, err := pool.Exec(context.Background(), fmt.Sprintf(`
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		SELECT %s || g::text, $1, 'Máy ' || g::text, 'PHONE', '2025-01-01', 1000000, $2, NOW()
		FROM generate_series(1, $3) AS g`, quoteLiteral(prefix)), quotaTestUser, status, n)
	if err != nil {
		t.Fatalf("seed %s devices: %v", status, err)
	}
}

// quoteLiteral is a tiny helper so the generated ids are SQL-safe without a
// parameter (the id column is built by concatenation inside the statement).
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func postNewDevice(t *testing.T, mux *http.ServeMux, token, status string) *httptest.ResponseRecorder {
	t.Helper()
	payload := map[string]any{
		"name":          "Máy mới",
		"category":      "PHONE",
		"purchaseDate":  "2026-06-01",
		"purchasePrice": 5000000,
	}
	if status != "" {
		payload["status"] = status
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/devices", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	return rr
}

func TestQuotaSoldDevicesDoNotConsumeASlot(t *testing.T) {
	pool, mux, token := setupQuotaTest(t)

	// 50 active + 1 sold → the 51st ACTIVE device is refused, and the message says
	// what actually counts.
	seedDevices(t, pool, "act", "ACTIVE", 50)
	seedDevices(t, pool, "sold", "SOLD", 1)

	rr := postNewDevice(t, mux, token, "")
	if rr.Code != http.StatusConflict {
		t.Fatalf("51st active device = %d, want 409 (%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, want := range []string{"limit_reached", "50", "không chiếm suất", "Đã bán"} {
		if !strings.Contains(body, want) {
			t.Errorf("refusal body %q must contain %q", body, want)
		}
	}

	// The SAME request with status SOLD is allowed: it consumes no active slot.
	rr = postNewDevice(t, mux, token, "SOLD")
	if rr.Code != http.StatusCreated {
		t.Fatalf("creating a SOLD device at 50 active = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
}

func TestQuotaFortyNineActivePlusThreeSoldAllowsOneMore(t *testing.T) {
	pool, mux, token := setupQuotaTest(t)

	seedDevices(t, pool, "act", "ACTIVE", 49)
	seedDevices(t, pool, "sold", "SOLD", 3)

	rr := postNewDevice(t, mux, token, "")
	if rr.Code != http.StatusCreated {
		t.Fatalf("49 active + 3 sold, add 1 active = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}

	// …and now at 50 active it is refused again. "50 active + 1 sold → refused" is
	// the mirror of the case above.
	rr = postNewDevice(t, mux, token, "")
	if rr.Code != http.StatusConflict {
		t.Fatalf("50th active + 1 = %d, want 409 (%s)", rr.Code, rr.Body.String())
	}
}

func TestQuotaReversalOfAMistakenSaleIsStillAllowed(t *testing.T) {
	// The case the feature must not turn into a trap: the user marked a device sold
	// by mistake and wants it back. Un-selling frees no slot, it takes one back, so
	// it is permitted even at the ceiling — and the account may then sit at 51
	// active devices. Bounded by the storage ceiling (covered below), and strictly
	// better than refusing to undo a mistake.
	pool, mux, token := setupQuotaTest(t)
	seedDevices(t, pool, "act", "ACTIVE", 50)
	seedDevices(t, pool, "sold", "SOLD", 1)

	raw, _ := json.Marshal(map[string]any{
		"name": "Máy bán nhầm", "category": "PHONE",
		"purchaseDate": "2025-01-01", "purchasePrice": 1000000,
		"status": "ACTIVE",
	})
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/devices/sold1", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("reversing a sale at the ceiling = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}

	var active int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM "Device" WHERE "userId" = $1 AND status <> 'SOLD'`,
		quotaTestUser).Scan(&active); err != nil {
		t.Fatalf("count active: %v", err)
	}
	if active != 51 {
		t.Fatalf("active after the reversal = %d, want 51 (documented consequence)", active)
	}
}

func TestQuotaSoldDevicesStillAppearInListAndStats(t *testing.T) {
	// The blast-radius half of the change: the QUOTA rule counts differently, the
	// REPORTING rules must not. A sold device keeps its history and its money.
	pool, mux, token := setupQuotaTest(t)
	seedDevices(t, pool, "act", "ACTIVE", 2)
	seedDevices(t, pool, "sold", "SOLD", 3)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/devices?status=SOLD", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list sold = %d (%s)", rr.Code, rr.Body.String())
	}
	var list struct {
		Devices []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"devices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list.Devices) != 3 {
		t.Fatalf("sold devices listed = %d, want 3", len(list.Devices))
	}

	// Stats: devices.total counts every row, sold included (this is the number the
	// /stats page shows as "tổng thiết bị"), and totalPurchasePrice includes them.
	req = httptest.NewRequest(http.MethodGet, "/api/v1/stats", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("stats = %d (%s)", rr.Code, rr.Body.String())
	}
	var stats struct {
		Devices struct {
			Total              int   `json:"total"`
			TotalPurchasePrice int64 `json:"totalPurchasePrice"`
		} `json:"devices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode stats: %v", err)
	}
	if stats.Devices.Total != 5 {
		t.Errorf("stats devices.total = %d, want 5 (sold devices are still history)", stats.Devices.Total)
	}
	if stats.Devices.TotalPurchasePrice != 5_000_000 {
		t.Errorf("stats totalPurchasePrice = %d, want 5000000 (sold spend still counts)", stats.Devices.TotalPurchasePrice)
	}
}

func TestQuotaStorageCeilingStopsUnboundedArchives(t *testing.T) {
	// The anti-gaming backstop. Without it, "sold devices are free" is exploitable
	// by selling → adding → un-selling → repeating.
	pool, mux, token := setupQuotaTest(t)
	seedDevices(t, pool, "sold", "SOLD", services.MaxDevicesTotalPerUser)

	rr := postNewDevice(t, mux, token, "SOLD")
	if rr.Code != http.StatusConflict {
		t.Fatalf("501st stored device = %d, want 409 (%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, want := range []string{"limit_reached", "500", "lưu trữ", "đã bán"} {
		if !strings.Contains(body, want) {
			t.Errorf("storage-ceiling body %q must contain %q", body, want)
		}
	}
}

func TestBackupImportObeysTheSameDeviceCeilings(t *testing.T) {
	// FEATURE_IDEAS #14 hazard 2: the import path used to skip the ceiling entirely,
	// so a hand-made file could restore past it.
	pool, _, _ := setupQuotaTest(t)

	soldDevices := func(n int) []services.BackupDevice {
		out := make([]services.BackupDevice, 0, n)
		for i := 0; i < n; i++ {
			out = append(out, services.BackupDevice{
				ID:            fmt.Sprintf("imp_sold_%d", i),
				Name:          "Máy cũ",
				Category:      "PHONE",
				PurchaseDate:  "2025-01-01T00:00:00Z",
				PurchasePrice: 1000,
				Status:        "SOLD",
				CreatedAt:     "2025-01-01T00:00:00Z",
				UpdatedAt:     "2025-01-01T00:00:00Z",
			})
		}
		return out
	}

	// A merge import may not push the account past the storage ceiling…
	seedDevices(t, pool, "sold", "SOLD", services.MaxDevicesTotalPerUser-1)
	_, err := services.ImportBackup(context.Background(), pool, quotaTestUser,
		&services.BackupExport{Version: services.MetadataOnlyBackupVersion, Devices: soldDevices(2)},
		services.ImportMerge)
	if err == nil {
		t.Fatal("merge import past the storage ceiling must be refused")
	}
	if !strings.Contains(err.Error(), "500") {
		t.Errorf("import refusal = %q, want the storage-ceiling message", err.Error())
	}

	// …while a payload that fits still imports, so the check is a ceiling and not a
	// blanket refusal of sold devices.
	res, err := services.ImportBackup(context.Background(), pool, quotaTestUser,
		&services.BackupExport{Version: services.MetadataOnlyBackupVersion, Devices: soldDevices(1)},
		services.ImportMerge)
	if err != nil {
		t.Fatalf("import of one sold device (fits): %v", err)
	}
	if res.Imported != 1 {
		t.Errorf("devicesImported = %d, want 1", res.Imported)
	}
}

func TestBackupReplaceImportIsNotBlockedByRowsItIsAboutToDelete(t *testing.T) {
	// `replace` wipes the user's devices inside the transaction, so its base is
	// zero. Counting the rows it is about to delete would refuse a legitimate
	// restore of an at-the-limit account onto itself — the most common restore there
	// is.
	pool, _, _ := setupQuotaTest(t)
	seedDevices(t, pool, "act", "ACTIVE", services.MaxDevicesPerUser)

	devices := make([]services.BackupDevice, 0, services.MaxDevicesPerUser)
	for i := 0; i < services.MaxDevicesPerUser; i++ {
		devices = append(devices, services.BackupDevice{
			ID:            fmt.Sprintf("rep_%d", i),
			Name:          "Máy khôi phục",
			Category:      "PHONE",
			PurchaseDate:  "2025-01-01T00:00:00Z",
			PurchasePrice: 1000,
			Status:        "ACTIVE",
			CreatedAt:     "2025-01-01T00:00:00Z",
			UpdatedAt:     "2025-01-01T00:00:00Z",
		})
	}
	res, err := services.ImportBackup(context.Background(), pool, quotaTestUser,
		&services.BackupExport{Version: services.MetadataOnlyBackupVersion, Devices: devices},
		services.ImportReplace)
	if err != nil {
		t.Fatalf("replace import of 50 devices onto 50 devices: %v", err)
	}
	if res.Imported != services.MaxDevicesPerUser {
		t.Fatalf("devicesImported = %d, want %d", res.Imported, services.MaxDevicesPerUser)
	}
}

func TestWishlistPurchaseObeysTheDeviceCeiling(t *testing.T) {
	// The THIRD write path into "Device" (services.UpdateWishlistItem spawns a
	// device when an item is marked PURCHASED). It bypassed the quota before, which
	// would also have been a way around the 500-row storage backstop: create a
	// wishlist item, mark it purchased, repeat.
	pool, mux, token := setupQuotaTest(t)
	seedDevices(t, pool, "act", "ACTIVE", services.MaxDevicesPerUser)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "WishlistItem" (id, "userId", name, category, priority, status, "updatedAt")
		 VALUES ('zz_quota_wish', $1, 'Món muốn mua', 'PHONE', 'WANT', 'WANT', NOW())`,
		quotaTestUser); err != nil {
		t.Fatalf("insert wishlist item: %v", err)
	}

	patch := func() *httptest.ResponseRecorder {
		raw, _ := json.Marshal(map[string]any{
			"name": "Món muốn mua", "category": "PHONE", "priority": "WANT", "status": "PURCHASED",
		})
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/wishlist/zz_quota_wish", bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		return rr
	}

	rr := patch()
	if rr.Code != http.StatusConflict {
		t.Fatalf("mark PURCHASED at the ceiling = %d, want 409 (%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "không chiếm suất") {
		t.Errorf("refusal = %q, want the truthful quota message", rr.Body.String())
	}
	// The transaction rolled back: no device, and the item is still unpurchased.
	var deviceCount int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM "Device" WHERE "userId" = $1`, quotaTestUser).Scan(&deviceCount); err != nil {
		t.Fatalf("count devices: %v", err)
	}
	if deviceCount != services.MaxDevicesPerUser {
		t.Errorf("devices after the refused transition = %d, want %d", deviceCount, services.MaxDevicesPerUser)
	}
	var status string
	if err := pool.QueryRow(context.Background(),
		`SELECT status FROM "WishlistItem" WHERE id = 'zz_quota_wish'`).Scan(&status); err != nil {
		t.Fatalf("read wishlist status: %v", err)
	}
	if status != "WANT" {
		t.Errorf("wishlist status = %q, want the rollback to leave it at WANT", status)
	}

	// Freeing an active slot (by selling a device) lets the same transition through.
	if _, err := pool.Exec(context.Background(),
		`UPDATE "Device" SET status = 'SOLD' WHERE id = 'act1'`); err != nil {
		t.Fatalf("sell a device: %v", err)
	}
	rr = patch()
	if rr.Code != http.StatusOK {
		t.Fatalf("mark PURCHASED after selling a device = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM "Device" WHERE "userId" = $1`, quotaTestUser).Scan(&deviceCount); err != nil {
		t.Fatalf("count devices (2): %v", err)
	}
	if deviceCount != services.MaxDevicesPerUser+1 {
		t.Errorf("devices = %d, want %d", deviceCount, services.MaxDevicesPerUser+1)
	}
}
