package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Warrly 2.0 resale handoff — the security contract, asserted end to end.
//
// The assertions here are not a smoke test; they are the three properties the
// feature cannot ship without:
//
//  1. TOKEN: the code exists exactly once (in the create response) and only its
//     sha256 is stored; a dead code gives the SAME 404 on the public preview no
//     matter why it is dead, so that unauthenticated route is not an oracle.
//  2. OWNERSHIP: the seller cannot claim their own device, a foreign device can
//     not be handed off, and the copy is keyed on ids that came out of the handoff
//     row — not on anything a caller sent.
//  3. SINGLE-USE / QUOTA: a code transfers once, the same buyer's retry is
//     idempotent, another buyer gets 409, and the buyer's device ceiling is
//     enforced through the same plan-aware predicate every other Device write
//     uses.
//
// Everything else about this feature is copy and shape; those are covered by the
// OpenAPI contract and the i18n catalog tests instead.

const (
	handoffSellerID = "zz_test_handoff_seller"
	handoffBuyerID  = "zz_test_handoff_buyer"
	handoffOtherID  = "zz_test_handoff_other"
)

type handoffEnv struct {
	pool   *pgxpool.Pool
	mux    *http.ServeMux
	seller string // bearer token
	buyer  string
	other  string
}

func setupHandoffTest(t *testing.T) handoffEnv {
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
	insertUser(t, pool, handoffSellerID, "handoff-seller@example.invalid", hash)
	insertUser(t, pool, handoffBuyerID, "handoff-buyer@example.invalid", hash)
	insertUser(t, pool, handoffOtherID, "handoff-other@example.invalid", hash)
	deleteUsers(t, pool, handoffSellerID, handoffBuyerID, handoffOtherID)
	// The seller's display name is what the buyer sees as `handoffSellerName`
	// (id/email must never travel); set it so the assertions can distinguish the
	// two.
	if _, err := pool.Exec(ctx, `UPDATE "User" SET name = 'Người bán A' WHERE id = $1`, handoffSellerID); err != nil {
		t.Fatalf("set seller name: %v", err)
	}

	issue := func(userID string) string {
		t.Helper()
		issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
		if err != nil {
			t.Fatalf("issue token for %s: %v", userID, err)
		}
		return issued.AccessToken
	}
	mux := http.NewServeMux()
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	RegisterHandoff(mux, deps)
	RegisterDevices(mux, deps)
	return handoffEnv{
		pool:   pool,
		mux:    mux,
		seller: issue(handoffSellerID),
		buyer:  issue(handoffBuyerID),
		other:  issue(handoffOtherID),
	}
}

// seedHandoffDevice creates one ACTIVE device with everything a handoff moves: a
// warranty with a cost and a note, one attachment with an encrypted-blob path, and
// one closed repair claim. Every private field carries a marker the preview test
// greps for, so a leak is a failed assertion rather than a silent regression.
func seedHandoffDevice(t *testing.T, pool *pgxpool.Pool, ownerID, deviceID string) {
	t.Helper()
	ctx := context.Background()
	statements := []struct {
		sql  string
		args []any
	}{
		{sql: `INSERT INTO "Device" (
		           id, "userId", name, category, brand, model, "serialNumber",
		           "purchaseDate", "purchasePrice", "purchasePlace", status, notes, "updatedAt")
		       VALUES ($1, $2, 'iPhone 15 Pro', 'PHONE', 'Apple', 'A2848', '356938035643809',
		               '2024-11-20', 28990000, 'FPT Shop', 'ACTIVE', 'GHI CHU RIENG TU', NOW())`,
			args: []any{deviceID, ownerID}},
		{sql: `INSERT INTO "Warranty" (id, "deviceId", type, provider, "startDate", "endDate", months,
		           cost, notes, "updatedAt")
		       VALUES ($1, $2, 'STANDARD', 'Trung tâm bảo hành Apple uỷ quyền',
		               '2024-11-20', '2026-11-20', 24, 2500000,
		               'GHI CHU BAO HANH RIENG TU', NOW())`,
			args: []any{deviceID + "_war", deviceID}},
		{sql: `INSERT INTO "Attachment" (id, "userId", "deviceId", "fileName", "storagePath",
		           "fileType", "fileSize", iv, "wrappedKey", description, "uploadedAt")
		       VALUES ($1, $2, $3, 'hoa-don.jpg', $4, 'image/jpeg', 1234,
		               '\x00112233445566778899aabb', '\x00112233445566778899aabbccddeeff',
		               'Hoá đơn gốc', NOW())`,
			args: []any{deviceID + "_att", ownerID, deviceID, deviceID + "/hoa-don.jpg.enc"}},
		{sql: `INSERT INTO "Claim" (id, "deviceId", "warrantyId", status, "openedAt", "closedAt",
		           issue, cost, "coveredByWarranty", "updatedAt")
		       VALUES ($1, $2, $3, 'RESOLVED', '2025-06-01', '2025-06-05',
		               'Màn hình lỗi', 500000, true, NOW())`,
			args: []any{deviceID + "_claim", deviceID, deviceID + "_war"}},
	}
	for _, st := range statements {
		if _, err := pool.Exec(ctx, st.sql, st.args...); err != nil {
			t.Fatalf("seed handoff fixture (%s): %v", st.sql[:60], err)
		}
	}
}

func handoffDo(t *testing.T, env handoffEnv, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	return rr
}

func createHandoff(t *testing.T, env handoffEnv, deviceID, body string) services.CreatedHandoff {
	t.Helper()
	rr := handoffDo(t, env, http.MethodPost, "/api/v1/devices/"+deviceID+"/handoff", env.seller, body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create handoff: want 201, got %d: %s", rr.Code, rr.Body.String())
	}
	var out struct {
		Handoff services.CreatedHandoff `json:"handoff"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode create handoff: %v", err)
	}
	return out.Handoff
}

// TestHandoffCreateShowsTheCodeOnce is the token half: the code exists in the
// create response, is exactly the frozen shape, and the owner status read cannot
// re-display it (only its sha256 is stored, so there is nothing to re-display).
func TestHandoffCreateShowsTheCodeOnce(t *testing.T) {
	env := setupHandoffTest(t)
	seedHandoffDevice(t, env.pool, handoffSellerID, "hd_dev")

	created := createHandoff(t, env, "hd_dev", `{"attachmentIds":["hd_dev_att"]}`)
	if len(created.Code) != 6 {
		t.Fatalf("code length = %d, want 6 (%q)", len(created.Code), created.Code)
	}
	if created.ClaimPath != "/handoff/"+created.Code {
		t.Errorf("claimPath = %q, want /handoff/<code>", created.ClaimPath)
	}
	if created.Status != services.HandoffStatusPending {
		t.Errorf("status = %q, want PENDING", created.Status)
	}

	rr := handoffDo(t, env, http.MethodGet, "/api/v1/devices/hd_dev/handoff", env.seller, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("get status: want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	var status map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &status); err != nil {
		t.Fatalf("decode status: %v", err)
	}
	handoff, _ := status["handoff"].(map[string]any)
	if handoff == nil {
		t.Fatalf("status response has no handoff: %s", rr.Body.String())
	}
	for _, forbidden := range []string{"code", "claimPath", "codeHash"} {
		if _, ok := handoff[forbidden]; ok {
			t.Errorf("GET status exposes %q; the code must be shown exactly once", forbidden)
		}
	}
	// The raw code must not be recoverable from the status body at all.
	if strings.Contains(rr.Body.String(), created.Code) {
		t.Error("GET status body contains the raw code")
	}

	// The hash is stored, never the code.
	var stored string
	if err := env.pool.QueryRow(context.Background(),
		`SELECT "codeHash" FROM "DeviceHandoff" WHERE "deviceId" = 'hd_dev'`).Scan(&stored); err != nil {
		t.Fatalf("read codeHash: %v", err)
	}
	if stored == created.Code || stored != auth.HashToken(created.Code) {
		t.Errorf("stored codeHash is not sha256(code) — got %q", stored)
	}
}

// TestHandoffPreviewLeaksNothingPrivate pins the unauthenticated projection: the
// banned markers below are the exact values the fixture put in the private fields.
func TestHandoffPreviewLeaksNothingPrivate(t *testing.T) {
	env := setupHandoffTest(t)
	seedHandoffDevice(t, env.pool, handoffSellerID, "hd_dev")
	created := createHandoff(t, env, "hd_dev", `{"attachmentIds":["hd_dev_att"]}`)

	rr := handoffDo(t, env, http.MethodGet, "/api/v1/public/handoff/"+created.Code, "", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("public preview: want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	banned := []string{
		"28990000",                       // purchasePrice
		"GHI CHU RIENG TU",               // Device.notes
		"GHI CHU BAO HANH RIENG TU",      // Warranty.notes
		"2500000",                        // Warranty.cost
		"500000",                         // Claim.cost
		"356938035643809",                // full serial
		"hd_dev_att",                     // attachment id
		"hoa-don.jpg.enc",                // storage path
		`"id":"hd_dev"`,                  // device id
		handoffSellerID,                  // seller user id
		"handoff-seller@example.invalid", // seller email
		"codeHash",
	}
	for _, b := range banned {
		if strings.Contains(body, b) {
			t.Errorf("public preview leaks %q:\n%s", b, body)
		}
	}
	for _, want := range []string{
		`"serialMasked":"3569*******3809"`,
		`"sellerName":"Người bán A"`,
		`"fileName":"hoa-don.jpg"`,
		`"mimeType":"image/jpeg"`,
		`"sizeBytes":1234`,
		`"disclaimer":`,
		`"warranties":[`,
		`"claims":[`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("public preview is missing %q:\n%s", want, body)
		}
	}

	// The public artifact's copy follows the recipient's language, not the
	// product default: `?lang=en` renders the English disclaimer, and the
	// Content-Language header says so.
	en := handoffDo(t, env, http.MethodGet, "/api/v1/public/handoff/"+created.Code+"?lang=en", "", "")
	if en.Code != http.StatusOK {
		t.Fatalf("public preview ?lang=en: want 200, got %d: %s", en.Code, en.Body.String())
	}
	if !strings.Contains(en.Body.String(), "The app only moves data") {
		t.Errorf("English preview does not render the English disclaimer:\n%s", en.Body.String())
	}
	if got := en.Header().Get("Content-Language"); got != "en" {
		t.Errorf("Content-Language = %q, want en", got)
	}

	// Every dead state is the SAME 404. An unknown code and an explicitly
	// cancelled one must be byte-identical, or the route is an enumeration oracle.
	unknown := handoffDo(t, env, http.MethodGet, "/api/v1/public/handoff/ABCDEF", "", "")
	if unknown.Code != http.StatusNotFound {
		t.Fatalf("unknown code: want 404, got %d", unknown.Code)
	}
	if rr := handoffDo(t, env, http.MethodDelete, "/api/v1/devices/hd_dev/handoff", env.seller, ""); rr.Code != http.StatusOK {
		t.Fatalf("cancel: want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	cancelled := handoffDo(t, env, http.MethodGet, "/api/v1/public/handoff/"+created.Code, "", "")
	if cancelled.Code != http.StatusNotFound {
		t.Fatalf("cancelled code: want 404, got %d: %s", cancelled.Code, cancelled.Body.String())
	}
	if cancelled.Body.String() != unknown.Body.String() {
		t.Errorf("cancelled and unknown codes answer differently:\n cancelled: %s\n unknown:   %s",
			cancelled.Body.String(), unknown.Body.String())
	}
}

// TestHandoffClaimOwnershipAndSingleUse covers the two rules a bug would silently
// break: the seller cannot re-import their own device, and the code moves data
// exactly once while the buyer's retry stays a success.
func TestHandoffClaimOwnershipAndSingleUse(t *testing.T) {
	env := setupHandoffTest(t)
	seedHandoffDevice(t, env.pool, handoffSellerID, "hd_dev")
	created := createHandoff(t, env, "hd_dev", `{"attachmentIds":["hd_dev_att"]}`)
	claimPath := "/api/v1/handoff/" + created.Code + "/claim"

	if rr := handoffDo(t, env, http.MethodPost, claimPath, env.seller, ""); rr.Code != http.StatusForbidden {
		t.Fatalf("seller claiming own code: want 403, got %d: %s", rr.Code, rr.Body.String())
	}

	type claimDevice struct {
		ID                string  `json:"id"`
		PurchasePrice     int32   `json:"purchasePrice"`
		SoldPrice         *int32  `json:"soldPrice"`
		Notes             *string `json:"notes"`
		HandoffReceivedAt *string `json:"handoffReceivedAt"`
		HandoffSellerName *string `json:"handoffSellerName"`
		Warranties        []struct {
			Cost  *int32  `json:"cost"`
			Notes *string `json:"notes"`
		} `json:"warranties"`
		Claims []struct {
			ID string `json:"id"`
		} `json:"claims"`
	}
	decode := func(rr *httptest.ResponseRecorder) (claimDevice, services.HandoffClaimSummary) {
		t.Helper()
		var out struct {
			Handoff services.HandoffClaimSummary `json:"handoff"`
			Device  claimDevice                  `json:"device"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode claim: %v (%s)", err, rr.Body.String())
		}
		return out.Device, out.Handoff
	}

	rr := handoffDo(t, env, http.MethodPost, claimPath, env.buyer, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("buyer claim: want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	device, summary := decode(rr)
	if device.ID == "" || device.ID == "hd_dev" {
		t.Fatalf("claim returned an unexpected device id %q", device.ID)
	}
	if summary.Status != services.HandoffStatusClaimed || summary.ClaimedAt == "" {
		t.Errorf("claim summary = %+v, want status CLAIMED and a claimedAt", summary)
	}
	// Price and private notes must not travel; provenance must.
	if device.PurchasePrice != 0 {
		t.Errorf("copied purchasePrice = %d, want 0", device.PurchasePrice)
	}
	if device.SoldPrice != nil || device.Notes != nil {
		t.Errorf("copied soldPrice/notes = %v/%v, want null/null", device.SoldPrice, device.Notes)
	}
	if device.HandoffReceivedAt == nil || device.HandoffSellerName == nil || *device.HandoffSellerName != "Người bán A" {
		t.Errorf("provenance missing: receivedAt=%v sellerName=%v", device.HandoffReceivedAt, device.HandoffSellerName)
	}
	if len(device.Warranties) != 1 {
		t.Fatalf("copied %d warranties, want 1", len(device.Warranties))
	}
	if device.Warranties[0].Cost != nil || device.Warranties[0].Notes != nil {
		t.Errorf("copied warranty cost/notes = %v/%v, want null/null", device.Warranties[0].Cost, device.Warranties[0].Notes)
	}
	if len(device.Claims) != 1 {
		t.Errorf("copied %d claims, want 1", len(device.Claims))
	}

	// The seller keeps a SOLD row marked "đã chuyển".
	var sellerStatus string
	var sentAt *time.Time
	if err := env.pool.QueryRow(context.Background(),
		`SELECT status, "handoffSentAt" FROM "Device" WHERE id = 'hd_dev'`).Scan(&sellerStatus, &sentAt); err != nil {
		t.Fatalf("read seller device: %v", err)
	}
	if sellerStatus != "SOLD" || sentAt == nil {
		t.Errorf("seller device after claim = %s/%v, want SOLD + handoffSentAt", sellerStatus, sentAt)
	}

	// Same buyer retry: idempotent success with the SAME device, no second copy.
	replay := handoffDo(t, env, http.MethodPost, claimPath, env.buyer, "")
	if replay.Code != http.StatusOK {
		t.Fatalf("same-buyer replay: want 200, got %d: %s", replay.Code, replay.Body.String())
	}
	if again, _ := decode(replay); again.ID != device.ID {
		t.Errorf("replay returned device %q, want the original %q", again.ID, device.ID)
	}
	var copies int
	if err := env.pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM "Device" WHERE "userId" = $1`, handoffBuyerID).Scan(&copies); err != nil {
		t.Fatalf("count buyer devices: %v", err)
	}
	if copies != 1 {
		t.Errorf("buyer has %d devices after a retry, want 1", copies)
	}

	// A different account cannot reuse the code.
	if rr := handoffDo(t, env, http.MethodPost, claimPath, env.other, ""); rr.Code != http.StatusConflict {
		t.Errorf("other buyer: want 409, got %d: %s", rr.Code, rr.Body.String())
	}

	// And the public preview is dead in the same uniform 404 as any unknown code.
	if rr := handoffDo(t, env, http.MethodGet, "/api/v1/public/handoff/"+created.Code, "", ""); rr.Code != http.StatusNotFound {
		t.Errorf("preview after claim: want 404, got %d", rr.Code)
	}
}

// TestHandoffCreateCooldownAndCancel pins the 1/device/30-days rule and the fact
// that cancelling does NOT reset it (cancel is a revocation, not a refund of the
// rate limit).
func TestHandoffCreateCooldownAndCancel(t *testing.T) {
	env := setupHandoffTest(t)
	seedHandoffDevice(t, env.pool, handoffSellerID, "hd_dev")
	createHandoff(t, env, "hd_dev", "")

	// A second code while the first one is still PENDING is refused as a CONFLICT:
	// cancelling is a deliberate act, not something a duplicate POST does silently.
	second := handoffDo(t, env, http.MethodPost, "/api/v1/devices/hd_dev/handoff", env.seller, "")
	if second.Code != http.StatusConflict || !strings.Contains(second.Body.String(), `"conflict"`) {
		t.Fatalf("second create: want 409 conflict, got %d: %s", second.Code, second.Body.String())
	}

	if rr := handoffDo(t, env, http.MethodDelete, "/api/v1/devices/hd_dev/handoff", env.seller, ""); rr.Code != http.StatusOK {
		t.Fatalf("cancel: want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	// Cancelling twice is a success: the seller's intent is already true.
	if rr := handoffDo(t, env, http.MethodDelete, "/api/v1/devices/hd_dev/handoff", env.seller, ""); rr.Code != http.StatusOK {
		t.Errorf("second cancel: want 200, got %d: %s", rr.Code, rr.Body.String())
	}
	// A cancelled code keeps the 30-day cooldown: cancelling revokes the offer, it
	// does not refund the rate limit.
	after := handoffDo(t, env, http.MethodPost, "/api/v1/devices/hd_dev/handoff", env.seller, "")
	if after.Code != http.StatusConflict || !strings.Contains(after.Body.String(), "limit_reached") {
		t.Errorf("create after cancel: want 409 limit_reached, got %d: %s", after.Code, after.Body.String())
	}
}

// TestHandoffClaimRespectsBuyerQuota is the quota assertion: a handoff cannot be
// used to exceed the buyer's device ceiling, and a refused claim moves nothing.
func TestHandoffClaimRespectsBuyerQuota(t *testing.T) {
	env := setupHandoffTest(t)
	seedHandoffDevice(t, env.pool, handoffSellerID, "hd_dev")
	created := createHandoff(t, env, "hd_dev", "")
	ctx := context.Background()

	// Fill the buyer to the FREE active ceiling (50). The 51st would be this
	// handoff's copy.
	if _, err := env.pool.Exec(ctx, `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		SELECT 'zz_quota_' || g, $1, 'Quota ' || g, 'PHONE', '2025-01-01', 1000, NOW()
		FROM generate_series(1, 50) g`, handoffBuyerID); err != nil {
		t.Fatalf("seed quota devices: %v", err)
	}

	rr := handoffDo(t, env, http.MethodPost, "/api/v1/handoff/"+created.Code+"/claim", env.buyer, "")
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "limit_reached") {
		t.Fatalf("over-quota claim: want 409 limit_reached, got %d: %s", rr.Code, rr.Body.String())
	}

	// Nothing moved: the seller's row is untouched and the code is still usable.
	var sellerStatus string
	if err := env.pool.QueryRow(ctx,
		`SELECT status FROM "Device" WHERE id = 'hd_dev'`).Scan(&sellerStatus); err != nil {
		t.Fatalf("read seller device: %v", err)
	}
	if sellerStatus != "ACTIVE" {
		t.Errorf("seller device status = %q after a refused claim, want ACTIVE", sellerStatus)
	}
	var handoffStatus string
	if err := env.pool.QueryRow(ctx,
		`SELECT status FROM "DeviceHandoff" WHERE "deviceId" = 'hd_dev'`).Scan(&handoffStatus); err != nil {
		t.Fatalf("read handoff status: %v", err)
	}
	if handoffStatus != services.HandoffStatusPending {
		t.Errorf("handoff status = %q after a refused claim, want PENDING", handoffStatus)
	}
}

// TestDeadHandoffCodesGive410OnClaim covers the one place the server is allowed to
// distinguish a dead code: a signed-in buyer holding a real one needs to know
// whether to ask for a new link. The public read stays uniform (previous test).
func TestDeadHandoffCodesGive410OnClaim(t *testing.T) {
	env := setupHandoffTest(t)
	seedHandoffDevice(t, env.pool, handoffSellerID, "hd_dev")
	ctx := context.Background()

	now := time.Now().UTC()
	insertHandoff := func(id, code, status string, expiresAt time.Time) {
		t.Helper()
		if _, err := env.pool.Exec(ctx, `
			INSERT INTO "DeviceHandoff" (id, "deviceId", "fromUserId", "codeHash",
			    "sharedFields", "expiresAt", status, "createdAt")
			VALUES ($1, 'hd_dev', $2, $3, '{}'::jsonb, $4, $5, NOW())`,
			id, handoffSellerID, auth.HashToken(code), expiresAt, status); err != nil {
			t.Fatalf("insert handoff %s: %v", id, err)
		}
	}
	insertHandoff("hd_expired", "ABCDEF", services.HandoffStatusPending, now.Add(-time.Hour))
	insertHandoff("hd_cancelled", "GHJKLM", services.HandoffStatusCancelled, now.Add(24*time.Hour))

	for _, tc := range []struct {
		name, code string
	}{
		{"expired", "ABCDEF"},
		{"cancelled", "GHJKLM"},
		{"unknown", "NPQRST"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := handoffDo(t, env, http.MethodPost, "/api/v1/handoff/"+tc.code+"/claim", env.buyer, "")
			want := http.StatusGone
			if tc.name == "unknown" {
				want = http.StatusNotFound
			}
			if rr.Code != want {
				t.Fatalf("claim %s: want %d, got %d: %s", tc.name, want, rr.Code, rr.Body.String())
			}
		})
	}

	// Case-insensitive input: the code a human typed in lowercase still works.
	lower := strings.ToLower("GHJKLM")
	if rr := handoffDo(t, env, http.MethodPost, "/api/v1/handoff/"+lower+"/claim", env.buyer, ""); rr.Code != http.StatusGone {
		t.Errorf("lowercase cancelled code: want 410, got %d: %s", rr.Code, rr.Body.String())
	}
}

// TestHandoffPublicPreviewIsRateLimitedPerIP proves the 6-character code is not
// the only defence: a refusing limiter must stop the request before the lookup.
func TestHandoffPublicPreviewIsRateLimitedPerIP(t *testing.T) {
	env := setupHandoffTest(t)
	seedHandoffDevice(t, env.pool, handoffSellerID, "hd_dev")
	created := createHandoff(t, env, "hd_dev", "")

	denied := http.NewServeMux()
	RegisterHandoff(denied, Deps{DB: env.pool, Limiter: handoffDenyLimiter{}})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/public/handoff/"+created.Code, nil)
	rr := httptest.NewRecorder()
	denied.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("denied preview: want 429, got %d: %s", rr.Code, rr.Body.String())
	}
	// The response must still carry the defensive headers: a 429 for a path
	// containing a credential is not cacheable either.
	if got := rr.Header().Get("Cache-Control"); !strings.Contains(got, "no-store") {
		t.Errorf("429 Cache-Control = %q, want no-store", got)
	}
	if got := rr.Header().Get("Referrer-Policy"); got != "no-referrer" {
		t.Errorf("429 Referrer-Policy = %q, want no-referrer", got)
	}
}

// handoffDenyLimiter refuses every bucket; used to prove the limiter is consulted at all.
type handoffDenyLimiter struct{}

func (handoffDenyLimiter) Check(context.Context, string, int, int) (ratelimit.Result, error) {
	return ratelimit.Result{Ok: false, RetryAfterSec: 60}, nil
}
