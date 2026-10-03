package handlers

import (
	"bytes"
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

// Return / exchange window over HTTP (FEATURE_IDEAS #1):
//
//   - the two new Device fields round-trip through POST/PATCH,
//   - GET /api/v1/return-windows returns only windows that are still OPEN,
//   - the derived deadline appears on the device read paths.
//
// Runs against its own scratch database (testDatabaseURL → newScratchDatabaseDSN),
// so it cannot race the other package binaries. Fixtures are relative to the wall
// clock because the handlers call time.Now(); the deadline ARITHMETIC itself is
// covered with fixed dates in services/returnwindow_test.go.
func TestReturnWindowsOverHTTP(t *testing.T) {
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
	const userID = "zz_test_return_window_user"
	insertUser(t, pool, userID, "return-window@example.invalid", hash)
	deleteUsers(t, pool, userID)
	issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	mux := http.NewServeMux()
	RegisterDevices(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	RegisterReturnWindows(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})

	do := func(method, url, bearer, body string) *httptest.ResponseRecorder {
		t.Helper()
		var req *http.Request
		if body == "" {
			req = httptest.NewRequest(method, url, nil)
		} else {
			req = httptest.NewRequest(method, url, bytes.NewReader([]byte(body)))
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		return rr
	}

	day := func(offset int) string { return time.Now().AddDate(0, 0, offset).Format("2006-01-02") }

	// ── 1. Unknown window: the field is omitted, nothing to count down to. ──
	rr := do(http.MethodPost, "/api/v1/devices", issued.AccessToken, `{
		"name": "Chưa ghi hạn", "category": "PHONE", "purchaseDate": "`+day(-10)+`", "purchasePrice": 1000000
	}`)
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("create device (unknown window) = %d (%s)", rr.Code, rr.Body.String())
	}

	// ── 2. Open window of 30 days, received 25 days ago → 5 days left. ─────
	rr = do(http.MethodPost, "/api/v1/devices", issued.AccessToken, `{
		"name": "Còn hạn đổi trả", "category": "PHONE", "purchaseDate": "`+day(-40)+`",
		"receivedAt": "`+day(-25)+`", "returnWindowDays": 30, "purchasePrice": 20000000
	}`)
	if rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("create device (open window) = %d (%s)", rr.Code, rr.Body.String())
	}
	// POST /api/v1/devices wraps the row: {"device": {...}, "warnings": [...]}.
	var created struct {
		Device struct {
			ID               string `json:"id"`
			ReturnWindowDays *int32 `json:"returnWindowDays"`
			ReceivedAt       string `json:"receivedAt"`
		} `json:"device"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created device: %v", err)
	}
	if created.Device.ReturnWindowDays == nil || *created.Device.ReturnWindowDays != 30 {
		t.Fatalf("returnWindowDays did not round-trip: %s", rr.Body.String())
	}
	if created.Device.ReceivedAt == "" {
		t.Fatalf("receivedAt did not round-trip: %s", rr.Body.String())
	}

	// ── 3. Window already closed 5 days ago → must NOT be listed. ──────────
	if rr = do(http.MethodPost, "/api/v1/devices", issued.AccessToken, `{
		"name": "Đã hết hạn đổi trả", "category": "PHONE", "purchaseDate": "`+day(-35)+`",
		"returnWindowDays": 30, "purchasePrice": 5000000
	}`); rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("create device (closed window) = %d (%s)", rr.Code, rr.Body.String())
	}

	// ── 4. Explicit zero: the shop offers no exchange window. ──────────────
	if rr = do(http.MethodPost, "/api/v1/devices", issued.AccessToken, `{
		"name": "Không cho đổi trả", "category": "PHONE", "purchaseDate": "`+day(-1)+`",
		"returnWindowDays": 0, "purchasePrice": 3000000
	}`); rr.Code != http.StatusCreated && rr.Code != http.StatusOK {
		t.Fatalf("create device (zero window) = %d (%s)", rr.Code, rr.Body.String())
	}

	// ── 5. Out of range → 400 with a field error, never a silent clamp. ────
	for _, days := range []string{"-1", "3651"} {
		rrBad := do(http.MethodPost, "/api/v1/devices", issued.AccessToken, `{
			"name": "Sai số ngày", "category": "PHONE", "purchaseDate": "`+day(-1)+`",
			"purchasePrice": 1000000, "returnWindowDays": `+days+`
		}`)
		if rrBad.Code != http.StatusBadRequest {
			t.Errorf("returnWindowDays=%s = %d, want 400 (%s)", days, rrBad.Code, rrBad.Body.String())
			continue
		}
		var body struct {
			FieldErrors map[string][]string `json:"fieldErrors"`
		}
		_ = json.Unmarshal(rrBad.Body.Bytes(), &body)
		if len(body.FieldErrors["returnWindowDays"]) == 0 {
			t.Errorf("returnWindowDays=%s fieldErrors = %v", days, body.FieldErrors)
		}
	}

	// A malformed delivery date is rejected on its own field, not silently dropped.
	rrBad := do(http.MethodPost, "/api/v1/devices", issued.AccessToken, `{
		"name": "Ngày nhận sai", "category": "PHONE", "purchaseDate": "`+day(-1)+`",
		"purchasePrice": 1000000, "receivedAt": "không-phải-ngày", "returnWindowDays": 30
	}`)
	if rrBad.Code != http.StatusBadRequest {
		t.Fatalf("bad receivedAt = %d, want 400 (%s)", rrBad.Code, rrBad.Body.String())
	}
	var badBody struct {
		FieldErrors map[string][]string `json:"fieldErrors"`
	}
	_ = json.Unmarshal(rrBad.Body.Bytes(), &badBody)
	if len(badBody.FieldErrors["receivedAt"]) == 0 {
		t.Errorf("bad receivedAt fieldErrors = %v", badBody.FieldErrors)
	}

	// ── 6. The list itself. ────────────────────────────────────────────────
	if rr = do(http.MethodGet, "/api/v1/return-windows", "", ""); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated = %d, want 401", rr.Code)
	}

	rr = do(http.MethodGet, "/api/v1/return-windows", issued.AccessToken, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("GET return-windows = %d (%s)", rr.Code, rr.Body.String())
	}
	var list struct {
		ReturnWindows []services.ReturnWindowRow `json:"returnWindows"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list.ReturnWindows) != 1 {
		t.Fatalf("returnWindows = %d rows, want exactly the one open window (%s)", len(list.ReturnWindows), rr.Body.String())
	}
	row := list.ReturnWindows[0]
	if row.Name != "Còn hạn đổi trả" {
		t.Errorf("row name = %q", row.Name)
	}
	if row.ReturnWindowDays != 30 {
		t.Errorf("returnWindowDays = %d, want 30", row.ReturnWindowDays)
	}
	// Purchase was 40 days ago with a 30-day window (closed) and delivery 25 days
	// ago: the deadline must follow receivedAt, so 5 days are left.
	if row.DaysLeft != 5 {
		t.Errorf("daysLeft = %d, want 5 (deadline must count from receivedAt, not purchaseDate)", row.DaysLeft)
	}
	if row.ReceivedAt == nil {
		t.Error("receivedAt is nil on an open window that has one")
	}

	// ── 7. The device list carries the same derived deadline. ──────────────
	rr = do(http.MethodGet, "/api/v1/devices", issued.AccessToken, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("GET devices = %d (%s)", rr.Code, rr.Body.String())
	}
	var devs struct {
		Devices []struct {
			Name           string  `json:"name"`
			ReturnDeadline *string `json:"returnDeadline"`
		} `json:"devices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &devs); err != nil {
		t.Fatalf("decode devices: %v", err)
	}
	var withDeadline, withoutDeadline int
	for _, d := range devs.Devices {
		if d.ReturnDeadline != nil {
			withDeadline++
			if d.Name == "Chưa ghi hạn" {
				t.Errorf("device with an unknown window has a deadline: %v", *d.ReturnDeadline)
			}
		} else {
			withoutDeadline++
			if d.Name == "Còn hạn đổi trả" || d.Name == "Đã hết hạn đổi trả" {
				t.Errorf("device %q should have a derived deadline", d.Name)
			}
		}
	}
	if withDeadline != 2 || withoutDeadline != 2 {
		t.Errorf("deadlines present=%d absent=%d, want 2/2 (%s)", withDeadline, withoutDeadline, rr.Body.String())
	}
}

// A device that has been sold must drop out of the exchange-window list: the
// window is moot once the machine is gone, the same way the warranty cron only
// considers ACTIVE devices.
func TestReturnWindowsExcludesNonActiveDevices(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, _ := auth.Hash(testPassword)
	const userID = "zz_test_return_window_sold_user"
	insertUser(t, pool, userID, "return-window-sold@example.invalid", hash)
	deleteUsers(t, pool, userID)
	issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		                      status, "returnWindowDays", "updatedAt")
		VALUES ('rw_sold', $1, 'Đã bán rồi', 'PHONE', NOW() - INTERVAL '3 days', 9000000,
		        'SOLD', 30, NOW()),
		       ('rw_active', $1, 'Đang dùng', 'PHONE', NOW() - INTERVAL '3 days', 9000000,
		        'ACTIVE', 30, NOW())`, userID); err != nil {
		t.Fatalf("insert devices: %v", err)
	}

	mux := http.NewServeMux()
	RegisterReturnWindows(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/return-windows", nil)
	req.Header.Set("Authorization", "Bearer "+issued.AccessToken)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
	}
	var list struct {
		ReturnWindows []services.ReturnWindowRow `json:"returnWindows"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(list.ReturnWindows) != 1 || list.ReturnWindows[0].Name != "Đang dùng" {
		t.Fatalf("rows = %+v, want only the ACTIVE device", list.ReturnWindows)
	}
}
