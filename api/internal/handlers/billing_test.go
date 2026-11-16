package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Premium lapse Phase 0 (docs/FEATURE_RESEARCH_2026-11 §6.4).
//
// Three things are pinned here, all against a real Postgres because two of them
// live in SQL:
//
//  1. the active predicate is grace-aware, and a legacy row with a NULL
//     gracePeriodExpiresAt behaves exactly as it did before 0029;
//  2. GET /api/v1/billing/status reports the state/usage/limits honestly, and
//     canExport stays true for an account that is over the free ceiling;
//  3. export is NOT blocked by a lapse, while a new device still is — with copy
//     that names the lapse instead of telling the user to "mark a device sold".
//
// Every test gets its own scratch database (testDatabaseURL), so it cannot race
// the services package's shared-database migration round-trip.

var billingTestSeq atomic.Int64

func billingTestID(prefix string) string {
	return fmt.Sprintf("zz_billing_%s_%d", prefix, billingTestSeq.Add(1))
}

func billingTimePtr(t time.Time) *time.Time { return &t }

func setupBillingTest(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// addBillingSubject creates a throwaway account. The predicate matrix never
// authenticates, so it must not pay for a bcrypt hash per case.
func addBillingSubject(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	userID := billingTestID("user")
	insertUser(t, pool, userID, userID+"@billing.invalid", "x")
	deleteUsers(t, pool, userID)
	return userID
}

// addBillingUser is addBillingSubject plus a bearer token, for the HTTP cases.
func addBillingUser(t *testing.T, pool *pgxpool.Pool) (string, string) {
	t.Helper()
	userID := addBillingSubject(t, pool)
	issued, err := auth.IssueToken(context.Background(), pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	return userID, issued.AccessToken
}

// billingEntitlement is the subset of a PremiumEntitlement row the predicate
// reads. A nil pointer is SQL NULL; a nil slice of rows means "never bought".
type billingEntitlement struct {
	expiresAt time.Time
	grace     *time.Time
	revoked   *time.Time
	retry     bool
}

func insertBillingEntitlement(t *testing.T, pool *pgxpool.Pool, userID string, e billingEntitlement) {
	t.Helper()
	txID := billingTestID("txn")
	var graceAt, revokedAt any
	if e.grace != nil {
		graceAt = e.grace.UTC()
	}
	if e.revoked != nil {
		revokedAt = e.revoked.UTC()
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO "PremiumEntitlement"
			("transactionId", "originalTransactionId", "userId", "productId",
			 "expiresAt", "revokedAt", "environment", "gracePeriodExpiresAt",
			 "inBillingRetryPeriod", "updatedAt")
		VALUES ($1, $1, $2, 'com.warrly.premium.monthly', $3, $4, 'Production', $5, $6,
		        (now() AT TIME ZONE 'UTC'))`,
		txID, userID, e.expiresAt.UTC(), revokedAt, graceAt, e.retry); err != nil {
		t.Fatalf("insert entitlement: %v", err)
	}
}

func insertBillingDevices(t *testing.T, pool *pgxpool.Pool, userID string, n int) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		SELECT $1 || g::text, $2, 'Máy ' || g::text, 'PHONE', '2025-01-01', 1000000, 'ACTIVE', NOW()
		FROM generate_series(1, $3) AS g`, billingTestID("dev"), userID, n); err != nil {
		t.Fatalf("seed devices: %v", err)
	}
}

// getBillingStatus decodes GET /api/v1/billing/status through the real service
// struct, so the wire field names are part of what this test pins.
func getBillingStatus(t *testing.T, h http.Handler, token string) services.BillingStatus {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/status", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	h.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("billing status = %d (%s)", rr.Code, rr.Body.String())
	}
	var status services.BillingStatus
	if err := json.Unmarshal(rr.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode BillingStatus: %v", err)
	}
	return status
}

// The predicate matrix. Each case is a fresh account so one row can never leak
// into another case; the LEGACY cases (grace NULL) are the regression pin for
// migration 0027 rows, whose meaning must not change.
func TestPremiumActivePredicateIsGraceAware(t *testing.T) {
	pool := setupBillingTest(t)
	ctx := context.Background()
	now := time.Now().UTC()
	day := 24 * time.Hour

	cases := []struct {
		name        string
		rows        []billingEntitlement
		wantState   services.PremiumState
		wantPremium bool
	}{
		{
			name:        "never bought Premium",
			wantState:   services.StateNever,
			wantPremium: false,
		},
		{
			name:        "legacy row still running (NULL grace)",
			rows:        []billingEntitlement{{expiresAt: now.Add(30 * day)}},
			wantState:   services.StatePremium,
			wantPremium: true,
		},
		{
			name:        "legacy row expired (NULL grace)",
			rows:        []billingEntitlement{{expiresAt: now.Add(-day)}},
			wantState:   services.StateExpired,
			wantPremium: false,
		},
		{
			name:        "paid period over, grace still running",
			rows:        []billingEntitlement{{expiresAt: now.Add(-day), grace: billingTimePtr(now.Add(3 * day))}},
			wantState:   services.StateGracePeriod,
			wantPremium: true,
		},
		{
			name:        "grace also over",
			rows:        []billingEntitlement{{expiresAt: now.Add(-3 * day), grace: billingTimePtr(now.Add(-day))}},
			wantState:   services.StateExpired,
			wantPremium: false,
		},
		{
			name:        "revoked while still running",
			rows:        []billingEntitlement{{expiresAt: now.Add(30 * day), revoked: billingTimePtr(now.Add(-time.Hour))}},
			wantState:   services.StateRevoked,
			wantPremium: false,
		},
		{
			name: "revoked during grace",
			rows: []billingEntitlement{{
				expiresAt: now.Add(-day),
				grace:     billingTimePtr(now.Add(3 * day)),
				revoked:   billingTimePtr(now.Add(-time.Hour)),
			}},
			wantState:   services.StateRevoked,
			wantPremium: false,
		},
		{
			name:        "billing retry after expiry",
			rows:        []billingEntitlement{{expiresAt: now.Add(-day), retry: true}},
			wantState:   services.StateBillingRetry,
			wantPremium: false,
		},
		{
			name:        "retry does not shorten a running period",
			rows:        []billingEntitlement{{expiresAt: now.Add(30 * day), retry: true}},
			wantState:   services.StatePremium,
			wantPremium: true,
		},
		{
			name: "a running row wins over an older grace row",
			rows: []billingEntitlement{
				{expiresAt: now.Add(-day), grace: billingTimePtr(now.Add(2 * day))},
				{expiresAt: now.Add(20 * day)},
			},
			wantState:   services.StatePremium,
			wantPremium: true,
		},
		{
			name: "a running row still wins when the newest row was revoked",
			rows: []billingEntitlement{
				{expiresAt: now.Add(10 * day)},
				{expiresAt: now.Add(40 * day), revoked: billingTimePtr(now.Add(-time.Hour))},
			},
			wantState:   services.StatePremium,
			wantPremium: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			userID := addBillingSubject(t, pool)
			for _, row := range tc.rows {
				insertBillingEntitlement(t, pool, userID, row)
			}

			premium, err := services.IsPremium(ctx, pool, userID)
			if err != nil {
				t.Fatalf("IsPremium: %v", err)
			}
			if premium != tc.wantPremium {
				t.Errorf("IsPremium = %v, want %v", premium, tc.wantPremium)
			}

			status, err := services.BillingStatusFor(ctx, pool, userID)
			if err != nil {
				t.Fatalf("BillingStatusFor: %v", err)
			}
			if status.State != tc.wantState {
				t.Errorf("state = %s, want %s", status.State, tc.wantState)
			}
			if !status.CanExport {
				t.Error("canExport = false, want true for every state")
			}
		})
	}
}

// The HTTP surface: a lapsed account that Premium had pushed above the free
// ceiling can still export everything, can read its status, and gets a 409 whose
// copy names the lapse.
func TestBillingStatusAndExportForLapsedOverCapAccount(t *testing.T) {
	pool := setupBillingTest(t)
	userID, token := addBillingUser(t, pool)
	insertBillingDevices(t, pool, userID, services.MaxDevicesPerUser+5)
	insertBillingEntitlement(t, pool, userID, billingEntitlement{
		expiresAt: time.Now().UTC().Add(-24 * time.Hour),
	})
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}

	status := getBillingStatus(t, BillingStatus(deps), token)
	if status.State != services.StateExpired {
		t.Errorf("state = %s, want EXPIRED", status.State)
	}
	if got := status.Usage.DevicesActive; got != services.MaxDevicesPerUser+5 {
		t.Errorf("usage.devicesActive = %d, want %d", got, services.MaxDevicesPerUser+5)
	}
	if got := status.Usage.DevicesTotal; got != services.MaxDevicesPerUser+5 {
		t.Errorf("usage.devicesTotal = %d, want %d", got, services.MaxDevicesPerUser+5)
	}
	if got := status.Limits.DevicesActive; got != services.MaxDevicesPerUser {
		t.Errorf("limits.devicesActive = %d, want the free ceiling %d", got, services.MaxDevicesPerUser)
	}
	if got := status.Limits.DevicesTotal; got != services.MaxDevicesTotalPerUser {
		t.Errorf("limits.devicesTotal = %d, want the free ceiling %d", got, services.MaxDevicesTotalPerUser)
	}
	if !status.OverCap {
		t.Error("overCap = false, want true (55 active > free 50)")
	}
	if !status.AddsBlocked {
		t.Error("addsBlocked = false, want true")
	}
	if !status.CanExport {
		t.Error("canExport = false, want true — losing Premium never blocks export")
	}

	// Export is a read of data the user already owns: 200 with every device,
	// not a 409/402 because the account is above the free ceiling.
	exportH := auth.RequireUser(pool)(http.HandlerFunc(exportBackupHandler(deps)))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/backup/export", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	exportH.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("over-cap export = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	var export services.BackupExport
	if err := json.Unmarshal(rr.Body.Bytes(), &export); err != nil {
		t.Fatalf("decode export: %v", err)
	}
	if got := len(export.Devices); got != services.MaxDevicesPerUser+5 {
		t.Errorf("exported devices = %d, want %d", got, services.MaxDevicesPerUser+5)
	}

	// The write path is refused, and the sentence must not send this user to
	// "mark a device sold": the cause is the lapse, not the device count.
	_, err := services.CreateDevice(viCtx(), pool, userID, services.DeviceInput{
		Name:          "Máy mới",
		Category:      "PHONE",
		PurchaseDate:  "2026-01-01",
		PurchasePrice: 1_000_000,
	}, "")
	if err == nil {
		t.Fatal("creating a device over the free ceiling must be refused")
	}
	svcErr, ok := services.As(err)
	if !ok || svcErr.Code != "LIMIT_REACHED" || svcErr.HTTPStatus() != http.StatusConflict {
		t.Fatalf("create refusal = %#v, want a 409 LIMIT_REACHED", err)
	}
	if strings.Contains(err.Error(), "đánh dấu đã bán") {
		t.Errorf("lapsed 409 = %q, must not tell the user to mark a device sold", err.Error())
	}
	for _, want := range []string{"Premium", "không còn hiệu lực", "50"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("lapsed 409 = %q, must mention %q", err.Error(), want)
		}
	}
}

// The other side of the same boundary: an account that NEVER bought Premium is
// not "lapsed", so its refusal copy stays byte-identical to the pre-0029 one.
func TestBillingStatusNeverBoughtKeepsTheFreeCopy(t *testing.T) {
	pool := setupBillingTest(t)
	userID, token := addBillingUser(t, pool)
	insertBillingDevices(t, pool, userID, services.MaxDevicesPerUser)
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}

	status := getBillingStatus(t, BillingStatus(deps), token)
	if status.State != services.StateNever {
		t.Errorf("state = %s, want NEVER", status.State)
	}
	if status.OverCap {
		t.Error("overCap = true at exactly 50 active, want false (at the ceiling is not over it)")
	}
	if !status.AddsBlocked {
		t.Error("addsBlocked = false at exactly 50 active, want true")
	}

	_, err := services.CreateDevice(viCtx(), pool, userID, services.DeviceInput{
		Name:          "Máy mới",
		Category:      "PHONE",
		PurchaseDate:  "2026-01-01",
		PurchasePrice: 1_000_000,
	}, "")
	const wantFree = "Đã đạt giới hạn 50 thiết bị chưa bán. Thiết bị đã đánh dấu \"Đã bán\" không chiếm suất — đánh dấu đã bán một thiết bị rồi thử lại."
	if err == nil || err.Error() != wantFree {
		t.Fatalf("free-account refusal = %v, want the unchanged %q", err, wantFree)
	}
}
