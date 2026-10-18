package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
)

// Warranty-claim HTTP surface (migration 0021). The service rules are covered in
// internal/services/claims_test.go; this file pins the wire contract the three
// clients implement against:
//
//   GET    /api/v1/claims              { claims: [...] }, filters, always []
//   POST   /api/v1/claims              201, 400, 404, 409 limit_reached
//   GET    /api/v1/claims/{id}         200, 404 (owned by another user)
//   PATCH  /api/v1/claims/{id}         full replacement, automatic closedAt
//   DELETE /api/v1/claims/{id}         200, then 404
//   GET    /api/v1/devices/{id}        gains `claims`, always [], never null
//
// Each handler test gets its own freshly created database (testhelpers_test.go).

type claimsHTTPEnv struct {
	mux          *http.ServeMux
	pool         *pgxpool.Pool
	token        string
	userID       string
	otherUserID  string
	deviceA      string
	deviceB      string
	warrantyA    string
	warrantyB    string
	otherDevice  string
	otherClaimID string
}

func setupClaimsHTTPEnv(t *testing.T) *claimsHTTPEnv {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect scratch: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userID      = "zz_claim_http_user"
		otherUserID = "zz_claim_http_other"
	)
	insertUser(t, pool, userID, "claim-http@example.invalid", "x")
	insertUser(t, pool, otherUserID, "claim-http-other@example.invalid", "x")
	deleteUsers(t, pool, userID, otherUserID)

	env := &claimsHTTPEnv{
		pool:         pool,
		userID:       userID,
		otherUserID:  otherUserID,
		deviceA:      "zz_claim_http_dev_a",
		deviceB:      "zz_claim_http_dev_b",
		warrantyA:    "zz_claim_http_war_a",
		warrantyB:    "zz_claim_http_war_b",
		otherDevice:  "zz_claim_http_other_dev",
		otherClaimID: "zz_claim_http_other_claim",
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("exec %q: %v", q, err)
		}
	}
	exec(`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
	      VALUES ($1, $2, 'iPhone', 'PHONE', '2025-01-01', 20000000, NOW())`, env.deviceA, userID)
	exec(`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
	      VALUES ($1, $2, 'Pixel', 'PHONE', '2025-01-01', 15000000, NOW())`, env.deviceB, userID)
	exec(`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
	      VALUES ($1, $2, 'Máy người khác', 'PHONE', '2025-01-01', 10000000, NOW())`, env.otherDevice, otherUserID)
	exec(`INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, "updatedAt")
	      VALUES ($1, $2, 'STANDARD', '2025-01-01', '2027-01-01', 24, NOW())`, env.warrantyA, env.deviceA)
	exec(`INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, "updatedAt")
	      VALUES ($1, $2, 'STANDARD', '2025-01-01', '2027-01-01', 24, NOW())`, env.warrantyB, env.deviceB)
	exec(`INSERT INTO "Claim" (id, "deviceId", status, "openedAt", issue, "updatedAt")
	      VALUES ($1, $2, 'OPEN', NOW() - interval '1 day', 'Của người khác', NOW())`,
		env.otherClaimID, env.otherDevice)

	token, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	env.token = token.AccessToken

	mux := http.NewServeMux()
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	RegisterClaims(mux, deps)
	RegisterDevices(mux, deps)
	env.mux = mux
	return env
}

func doClaims(t *testing.T, env *claimsHTTPEnv, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer "+env.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	return rr
}

type claimWire struct {
	ID                string  `json:"id"`
	DeviceID          string  `json:"deviceId"`
	WarrantyID        *string `json:"warrantyId"`
	Status            string  `json:"status"`
	OpenedAt          string  `json:"openedAt"`
	ExpectedReturnAt  *string `json:"expectedReturnAt"`
	ClosedAt          *string `json:"closedAt"`
	TicketNumber      *string `json:"ticketNumber"`
	ServiceCenter     *string `json:"serviceCenter"`
	Issue             string  `json:"issue"`
	Diagnosis         *string `json:"diagnosis"`
	Outcome           *string `json:"outcome"`
	Cost              *int32  `json:"cost"`
	CoveredByWarranty *bool   `json:"coveredByWarranty"`
}

func decodeClaimResponse(t *testing.T, rr *httptest.ResponseRecorder, wantStatus int) claimWire {
	t.Helper()
	if rr.Code != wantStatus {
		t.Fatalf("status = %d, want %d (%s)", rr.Code, wantStatus, rr.Body.String())
	}
	var body struct {
		Claim claimWire `json:"claim"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode claim response %q: %v", rr.Body.String(), err)
	}
	if body.Claim.ID == "" {
		t.Fatalf("response has no claim id: %s", rr.Body.String())
	}
	return body.Claim
}

func decodeClaimList(t *testing.T, rr *httptest.ResponseRecorder) []claimWire {
	t.Helper()
	if rr.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Claims []claimWire `json:"claims"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode claim list %q: %v", rr.Body.String(), err)
	}
	if body.Claims == nil {
		t.Fatalf("claims = null, want []: %s", rr.Body.String())
	}
	return body.Claims
}

func claimErrorBody(t *testing.T, rr *httptest.ResponseRecorder, wantStatus int) map[string]any {
	t.Helper()
	if rr.Code != wantStatus {
		t.Fatalf("status = %d, want %d (%s)", rr.Code, wantStatus, rr.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode error envelope %q: %v", rr.Body.String(), err)
	}
	return out
}

// ── 1. CRUD over the wire, including the 409 and the closedAt rule ──────────

func TestClaimsOverHTTPCRUD(t *testing.T) {
	env := setupClaimsHTTPEnv(t)

	// POST: defaults are applied server-side.
	rr := doClaims(t, env, http.MethodPost, "/api/v1/claims?lang=vi", map[string]any{
		"deviceId":          env.deviceA,
		"warrantyId":        env.warrantyA,
		"issue":             "Hỏng màn hình",
		"ticketNumber":      "SC-001",
		"serviceCenter":     "TTBH Q1",
		"cost":              150000,
		"coveredByWarranty": true,
	})
	created := decodeClaimResponse(t, rr, http.StatusCreated)
	if created.Status != "OPEN" {
		t.Errorf("status = %q, want OPEN", created.Status)
	}
	if created.ClosedAt != nil {
		t.Errorf("closedAt = %v, want null for a new OPEN claim", *created.ClosedAt)
	}
	if created.OpenedAt == "" {
		t.Error("openedAt is empty; POST must default it to now, not omit it")
	}
	if created.WarrantyID == nil || *created.WarrantyID != env.warrantyA {
		t.Errorf("warrantyId = %v, want %q", created.WarrantyID, env.warrantyA)
	}
	if created.Cost == nil || *created.Cost != 150000 {
		t.Errorf("cost = %v, want 150000", created.Cost)
	}
	if created.CoveredByWarranty == nil || !*created.CoveredByWarranty {
		t.Errorf("coveredByWarranty = %v, want true", created.CoveredByWarranty)
	}

	// The second open claim is a 409 with the documented code, in the requested
	// language.
	rr = doClaims(t, env, http.MethodPost, "/api/v1/claims?lang=en", map[string]any{
		"deviceId": env.deviceA,
		"issue":    "Cửa hàng thứ hai",
	})
	body := claimErrorBody(t, rr, http.StatusConflict)
	if body["error"] != "limit_reached" {
		t.Errorf("error code = %v, want limit_reached (%v)", body["error"], body)
	}
	if msg, _ := body["message"].(string); !strings.Contains(msg, "open claim") {
		t.Errorf("English 409 message = %q", msg)
	}

	// A CLOSED claim on another device is fine and gets closedAt automatically.
	rr = doClaims(t, env, http.MethodPost, "/api/v1/claims?lang=vi", map[string]any{
		"deviceId": env.deviceB,
		"issue":    "Đã thay pin",
		"status":   "RESOLVED",
		"openedAt": "2026-01-01T09:00:00Z",
	})
	closed := decodeClaimResponse(t, rr, http.StatusCreated)
	if closed.ClosedAt == nil {
		t.Fatal("RESOLVED claim created without closedAt")
	}
	if closed.Status != "RESOLVED" {
		t.Errorf("status = %q, want RESOLVED", closed.Status)
	}

	// GET list: newest openedAt first, always an array.
	list := decodeClaimList(t, doClaims(t, env, http.MethodGet, "/api/v1/claims", nil))
	if len(list) != 2 {
		t.Fatalf("claims = %d, want 2", len(list))
	}
	if list[0].ID != created.ID {
		t.Errorf("list[0] = %q, want the newest-opened %q", list[0].ID, created.ID)
	}

	// Filters: deviceId + status, exactly like the device list.
	filtered := decodeClaimList(t, doClaims(t, env, http.MethodGet,
		"/api/v1/claims?deviceId="+env.deviceB+"&status=RESOLVED", nil))
	if len(filtered) != 1 || filtered[0].ID != closed.ID {
		t.Errorf("filtered claims = %+v, want only %q", filtered, closed.ID)
	}
	empty := decodeClaimList(t, doClaims(t, env, http.MethodGet, "/api/v1/claims?status=WAITING", nil))
	if len(empty) != 0 {
		t.Errorf("unknown status returned %d claims, want 0", len(empty))
	}

	// GET one.
	single := decodeClaimResponse(t,
		doClaims(t, env, http.MethodGet, "/api/v1/claims/"+created.ID, nil), http.StatusOK)
	if single.ID != created.ID {
		t.Errorf("GET claim id = %q, want %q", single.ID, created.ID)
	}

	// PATCH full replacement: entering a terminal status sets closedAt.
	rr = doClaims(t, env, http.MethodPatch, "/api/v1/claims/"+created.ID+"?lang=vi", map[string]any{
		"deviceId": env.deviceA,
		"issue":    "Đã sửa xong",
		"status":   "RESOLVED",
	})
	updated := decodeClaimResponse(t, rr, http.StatusOK)
	if updated.ClosedAt == nil {
		t.Fatal("PATCH to RESOLVED did not set closedAt")
	}
	if updated.OpenedAt != created.OpenedAt {
		t.Errorf("openedAt changed on PATCH: %q → %q", created.OpenedAt, updated.OpenedAt)
	}

	// Moving back to OPEN clears closedAt.
	rr = doClaims(t, env, http.MethodPatch, "/api/v1/claims/"+created.ID, map[string]any{
		"deviceId": env.deviceA,
		"issue":    "Mở lại",
		"status":   "OPEN",
		"closedAt": "2000-01-01T00:00:00Z",
	})
	reopened := decodeClaimResponse(t, rr, http.StatusOK)
	if reopened.ClosedAt != nil {
		t.Errorf("closedAt = %v after reopening, want null", *reopened.ClosedAt)
	}

	// DELETE then GET/DELETE → 404.
	rr = doClaims(t, env, http.MethodDelete, "/api/v1/claims/"+created.ID, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("DELETE = %d (%s)", rr.Code, rr.Body.String())
	}
	claimErrorBody(t, doClaims(t, env, http.MethodGet, "/api/v1/claims/"+created.ID, nil), http.StatusNotFound)
	claimErrorBody(t, doClaims(t, env, http.MethodDelete, "/api/v1/claims/"+created.ID, nil), http.StatusNotFound)
}

// ── 2. Cross-device warranty, ownership, validation, device detail ──────────

func TestClaimsOverHTTPRulesAndDeviceDetail(t *testing.T) {
	env := setupClaimsHTTPEnv(t)

	// Warranty of the SAME user but a DIFFERENT device → 400 fieldErrors.warrantyId.
	rr := doClaims(t, env, http.MethodPost, "/api/v1/claims?lang=vi", map[string]any{
		"deviceId":   env.deviceA,
		"warrantyId": env.warrantyB,
		"issue":      "Sai gói",
	})
	body := claimErrorBody(t, rr, http.StatusBadRequest)
	if body["error"] != "validation" {
		t.Errorf("error code = %v, want validation", body["error"])
	}
	fieldErrors, _ := body["fieldErrors"].(map[string]any)
	if _, ok := fieldErrors["warrantyId"]; !ok {
		t.Errorf("fieldErrors = %v, want a warrantyId entry", body["fieldErrors"])
	}

	// Missing required issue.
	rr = doClaims(t, env, http.MethodPost, "/api/v1/claims", map[string]any{
		"deviceId": env.deviceA,
	})
	body = claimErrorBody(t, rr, http.StatusBadRequest)
	fieldErrors, _ = body["fieldErrors"].(map[string]any)
	if _, ok := fieldErrors["issue"]; !ok {
		t.Errorf("fieldErrors = %v, want an issue entry", body["fieldErrors"])
	}

	// Someone else's device is a 404.
	claimErrorBody(t, doClaims(t, env, http.MethodPost, "/api/v1/claims", map[string]any{
		"deviceId": env.otherDevice,
		"issue":    "Chiếm máy người khác",
	}), http.StatusNotFound)

	// The device detail for a device with no claims still carries `claims: []`
	// and the pre-existing keys.
	rr = doClaims(t, env, http.MethodGet, "/api/v1/devices/"+env.deviceA, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET device = %d (%s)", rr.Code, rr.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rr.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode device envelope: %v", err)
	}
	var device map[string]json.RawMessage
	if err := json.Unmarshal(raw["device"], &device); err != nil {
		t.Fatalf("decode device: %v", err)
	}
	if got := string(device["claims"]); got != "[]" {
		t.Errorf("device.claims = %s, want [] (never null)", got)
	}
	for _, key := range []string{"warranties", "attachments", "returnDeadline"} {
		if _, ok := device[key]; !ok {
			t.Errorf("device detail lost the pre-existing key %q", key)
		}
	}

	// Create a claim on device A, then the detail carries exactly one.
	created := decodeClaimResponse(t, doClaims(t, env, http.MethodPost, "/api/v1/claims", map[string]any{
		"deviceId":   env.deviceA,
		"warrantyId": env.warrantyA,
		"issue":      "Hỏng loa",
	}), http.StatusCreated)
	var detail struct {
		Device struct {
			Claims []claimWire `json:"claims"`
		} `json:"device"`
	}
	rr = doClaims(t, env, http.MethodGet, "/api/v1/devices/"+env.deviceA, nil)
	if err := json.Unmarshal(rr.Body.Bytes(), &detail); err != nil {
		t.Fatalf("decode device detail: %v", err)
	}
	if len(detail.Device.Claims) != 1 || detail.Device.Claims[0].ID != created.ID {
		t.Errorf("device claims = %+v, want the new claim %q", detail.Device.Claims, created.ID)
	}

	// Another user's claim is invisible: GET/PATCH/DELETE all 404.
	claimErrorBody(t, doClaims(t, env, http.MethodGet, "/api/v1/claims/"+env.otherClaimID, nil), http.StatusNotFound)
	claimErrorBody(t, doClaims(t, env, http.MethodPatch, "/api/v1/claims/"+env.otherClaimID, map[string]any{
		"deviceId": env.deviceA, "issue": "Chiếm", "status": "RESOLVED",
	}), http.StatusNotFound)
	claimErrorBody(t, doClaims(t, env, http.MethodDelete, "/api/v1/claims/"+env.otherClaimID, nil), http.StatusNotFound)

	// Moving the claim to device B while naming device A's warranty is a 400.
	rr = doClaims(t, env, http.MethodPatch, "/api/v1/claims/"+created.ID+"?lang=vi", map[string]any{
		"deviceId":   env.deviceB,
		"warrantyId": env.warrantyA,
		"issue":      "Hỏng loa",
	})
	body = claimErrorBody(t, rr, http.StatusBadRequest)
	fieldErrors, _ = body["fieldErrors"].(map[string]any)
	if _, ok := fieldErrors["warrantyId"]; !ok {
		t.Errorf("fieldErrors = %v, want a warrantyId entry", body["fieldErrors"])
	}

	// A user with no claims sees `claims: []` on the list endpoint too.
	rr = doClaims(t, env, http.MethodGet, "/api/v1/claims?deviceId=zz_khong_ton_tai", nil)
	if got := strings.TrimSpace(rr.Body.String()); got != `{"claims":[]}` {
		t.Errorf("empty claim list body = %s, want {\"claims\":[]}", got)
	}
}
