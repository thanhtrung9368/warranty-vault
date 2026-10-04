package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// FEATURE_IDEAS #2 — phiếu bàn giao bảo hành + link chia sẻ có token.
//
// GET /api/v1/public/shares/{token} is the ONLY read path in this service that
// does not require a bearer token, so the assertions below are the security
// contract, not a smoke test:
//
//  1. a foreign, an expired and a revoked token all fail IDENTICALLY;
//  2. a valid token exposes ONLY the intended projection — an unrelated field
//     (notes, prices, the device id, another device, an attachment) must be
//     ABSENT from the raw response body;
//  3. the owner-scoped routes are auth-gated and ownership-scoped;
//  4. the response cannot be cached, indexed or leaked through the Referer
//     header.
//
// Each test gets its own scratch database (testhelpers_test.go).

const (
	shareOwner = "zz_test_share_owner"
	shareOther = "zz_test_share_other"
)

type shareTestEnv struct {
	pool  *pgxpool.Pool
	mux   *http.ServeMux
	token string
}

func setupShareTest(t *testing.T) shareTestEnv {
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
	insertUser(t, pool, shareOwner, "share-owner@example.invalid", hash)
	insertUser(t, pool, shareOther, "share-other@example.invalid", hash)
	deleteUsers(t, pool, shareOwner, shareOther)

	issued, err := auth.IssueToken(ctx, pool, shareOwner, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	mux := http.NewServeMux()
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	RegisterShares(mux, deps)
	RegisterDevices(mux, deps)
	return shareTestEnv{pool: pool, mux: mux, token: issued.AccessToken}
}

// seedShareFixture creates the device the certificate is about, plus a SECOND
// device and an attachment that must never appear in it.
func seedShareFixture(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	type stmt struct {
		sql  string
		args []any
	}
	statements := []stmt{
		{sql: `INSERT INTO "Device" (id, "userId", name, category, brand, model, "serialNumber",
		                       "purchaseDate", "purchasePrice", "purchasePlace", status,
		                       notes, "soldAt", "soldPrice", "updatedAt")
		 VALUES ('share_dev', $1, 'iPhone 15 Pro', 'PHONE', 'Apple', 'A2848', '356938035643809',
		         '2024-11-20', 28990000, 'FPT Shop', 'SOLD',
		         'GHI CHU RIENG TU KHONG DUOC LO RA', '2026-05-02', 21000000, NOW())`,
			args: []any{shareOwner}},
		{sql: `INSERT INTO "Warranty" (id, "deviceId", type, provider, "startDate", "endDate", months, cost,
		                        address, phone, notes, "updatedAt")
		 VALUES ('share_war', 'share_dev', 'STANDARD', 'Trung tâm bảo hành Apple uỷ quyền',
		         '2024-11-20', '2026-11-20', 24, 2500000,
		         'Số 1 Lê Duẩn, Q.1', '028 3822 9999', 'GHI CHU BAO HANH RIENG TU', NOW())`},
		{sql: `INSERT INTO "Attachment" (id, "deviceId", "fileName", "storagePath", "fileType", "fileSize",
		                           iv, "wrappedKey", description, "uploadedAt")
		 VALUES ('share_att', 'share_dev', 'hoa-don.jpg', 'share_dev/hoa-don.jpg.enc', 'image/jpeg', 1234,
		         '\x00112233445566778899aabb', '\x00112233445566778899aabbccddeeff00112233445566',
		         'Hoá đơn gốc', NOW())`},
		{sql: `INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ('share_dev_other', $1, 'THIET BI KHAC CUA CUNG NGUOI DUNG', 'LAPTOP', '2025-01-01', 999, NOW())`,
			args: []any{shareOwner}},
	}
	for _, st := range statements {
		if _, err := pool.Exec(ctx, st.sql, st.args...); err != nil {
			t.Fatalf("seed fixture (%s): %v", st.sql[:40], err)
		}
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ('share_dev_foreign', $1, 'MAY CUA NGUOI KHAC', 'PHONE', '2025-01-01', 1, NOW())`,
		shareOther); err != nil {
		t.Fatalf("seed foreign device: %v", err)
	}
}

// createShare POSTs to the owner endpoint and returns the raw token.
func createShare(t *testing.T, env shareTestEnv, deviceID, body string) (string, *httptest.ResponseRecorder) {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/devices/"+deviceID+"/shares", reader)
	req.Header.Set("Content-Type", "application/json")
	if env.token != "" {
		req.Header.Set("Authorization", "Bearer "+env.token)
	}
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		return "", rr
	}
	var out struct {
		Share services.CreatedDeviceShare `json:"share"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode create-share: %v", err)
	}
	return out.Share.Token, rr
}

// shareIDFrom reads the id the create endpoint returned.
//
// Use this rather than "the newest row" whenever a test has to act on one
// specific link. DeviceShare.createdAt is timestamp(3), so two links minted
// inside the same millisecond tie, and `ORDER BY "createdAt" DESC LIMIT 1` then
// returns an arbitrary one of them — which made the revoked-token case fail
// roughly once in eight full-package runs while passing in isolation. The create
// response already carries the id, so the test can name the row it means instead
// of inferring it from a timestamp that does not have the resolution to support
// the inference.
func shareIDFrom(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()
	var out struct {
		Share services.CreatedDeviceShare `json:"share"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode create-share: %v", err)
	}
	if out.Share.ID == "" {
		t.Fatalf("create-share returned no id: %s", rr.Body.String())
	}
	return out.Share.ID
}

// getPublic fetches the certificate. `accept` selects HTML ("" = browser default)
// or the JSON projection.
func getPublic(t *testing.T, env shareTestEnv, token, accept string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/public/shares/"+token, nil)
	if accept == "" {
		accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
	}
	req.Header.Set("Accept", accept)
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	return rr
}

func getPublicJSON(t *testing.T, env shareTestEnv, token string) (*httptest.ResponseRecorder, services.SharedCertificate) {
	t.Helper()
	rr := getPublic(t, env, token, "application/json")
	var body struct {
		Certificate services.SharedCertificate `json:"certificate"`
	}
	if rr.Code == http.StatusOK {
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode certificate %q: %v", rr.Body.String(), err)
		}
	}
	return rr, body.Certificate
}

// ---- 1. the projection -----------------------------------------------------

func TestPublicCertificateExposesOnlyTheIntendedProjection(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)

	token, rr := createShare(t, env, "share_dev", "")
	if token == "" {
		t.Fatalf("create share failed: %d (%s)", rr.Code, rr.Body.String())
	}

	// The raw body is what an attacker sees — assert on the BYTES, not on a decoded
	// struct, so a field that is added to the struct but must not be exposed fails
	// this test too.
	pub := getPublic(t, env, token, "application/json")
	if pub.Code != http.StatusOK {
		t.Fatalf("public read = %d (%s)", pub.Code, pub.Body.String())
	}
	raw := pub.Body.String()

	// Must be present: what the buyer needs to verify the device and the coverage.
	for _, want := range []string{
		"iPhone 15 Pro", "Apple", "A2848", "purchaseDate", "effectiveWarrantyEnd",
		"Trung tâm bảo hành Apple uỷ quyền", "Số 1 Lê Duẩn, Q.1", "028 3822 9999",
	} {
		if !strings.Contains(raw, want) {
			t.Errorf("certificate is missing %q", want)
		}
	}
	// The masked serial is the default: enough to match the sticker, not enough to
	// be a full identifier.
	if !strings.Contains(raw, "3569*******3809") {
		t.Errorf("certificate is missing the masked serial: %s", raw)
	}

	// Must be ABSENT. Each of these is a concrete leak, not a style preference.
	for _, forbidden := range []string{
		"GHI CHU RIENG TU KHONG DUOC LO RA", // Device.notes
		"GHI CHU BAO HANH RIENG TU",         // Warranty.notes
		"356938035643809",                   // the full serial, unless opted in
		"28990000",                          // Device.purchasePrice
		"21000000",                          // Device.soldPrice
		"2500000",                           // Warranty.cost
		"THIET BI KHAC CUA CUNG NGUOI DUNG", // another device of the same user
		"MAY CUA NGUOI KHAC",                // another user's device
		"share_dev",                         // the device id
		"share_att", "hoa-don.jpg",          // attachment row / its filename
		"storagePath", "wrappedKey", // at-rest encryption internals
		"share_owner", "share-owner@example.invalid", // the owner's identity
		"\"notes\"", "\"purchasePrice\"", "\"soldPrice\"", "\"cost\"", "\"attachments\"", "\"userId\"",
	} {
		if strings.Contains(raw, forbidden) {
			t.Errorf("certificate LEAKS %q: %s", forbidden, raw)
		}
	}

	// The JSON shape itself must not carry the forbidden keys, even when their
	// values happen to be uninteresting: a client binding to this contract must not
	// be handed the field at all.
	var generic map[string]any
	if err := json.Unmarshal(pub.Body.Bytes(), &generic); err != nil {
		t.Fatalf("decode generic: %v", err)
	}
	cert, _ := generic["certificate"].(map[string]any)
	if cert == nil {
		t.Fatal("certificate missing from the response")
	}
	for _, key := range []string{"id", "notes", "purchasePrice", "soldPrice", "attachments", "userId", "deviceId"} {
		if _, present := cert[key]; present {
			t.Errorf("certificate exposes key %q", key)
		}
	}
	if cert["serialNumber"] != nil {
		t.Errorf("serialNumber = %v, want null without the opt-in", cert["serialNumber"])
	}
}

func TestPublicCertificateSerialOptInIsExplicit(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)

	token, rr := createShare(t, env, "share_dev", `{"includeSerial":true}`)
	if token == "" {
		t.Fatalf("create share with includeSerial failed: %d (%s)", rr.Code, rr.Body.String())
	}
	pub := getPublic(t, env, token, "application/json")
	if pub.Code != http.StatusOK {
		t.Fatalf("public read = %d (%s)", pub.Code, pub.Body.String())
	}
	if !strings.Contains(pub.Body.String(), "356938035643809") {
		t.Error("includeSerial=true must expose the full serial")
	}
	// Even then, the masked form stays available for display.
	if !strings.Contains(pub.Body.String(), "3569*******3809") {
		t.Error("the masked serial must stay present alongside the full one")
	}
	// And the opt-in does not widen anything else.
	if strings.Contains(pub.Body.String(), "GHI CHU RIENG TU") {
		t.Error("includeSerial must not turn into a projection widening")
	}
}

func TestPublicCertificateEffectiveEndIsTheMaxOverPackages(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	// A SECOND warranty on the same device, ending later: the "remaining warranty"
	// number the buyer is paying for is the maximum, not the first row.
	if _, err := env.pool.Exec(context.Background(),
		`INSERT INTO "Warranty" (id, "deviceId", type, provider, "startDate", "endDate", months, cost, "updatedAt")
		 VALUES ('share_war2', 'share_dev', 'EXTENDED', 'AppleCare+', '2026-11-20', '2028-11-20', 24, 4000000, NOW())`); err != nil {
		t.Fatalf("insert second warranty: %v", err)
	}

	token, rr := createShare(t, env, "share_dev", "")
	if token == "" {
		t.Fatalf("create share failed: %d (%s)", rr.Code, rr.Body.String())
	}
	pub, cert := getPublicJSON(t, env, token)
	if pub.Code != http.StatusOK {
		t.Fatalf("public read = %d", pub.Code)
	}
	if len(cert.Warranties) != 2 {
		t.Fatalf("warranties = %d, want 2", len(cert.Warranties))
	}
	if cert.EffectiveWarrantyEnd == nil || !strings.HasPrefix(*cert.EffectiveWarrantyEnd, "2028-11-20") {
		t.Fatalf("effectiveWarrantyEnd = %v, want the later of the two packages", cert.EffectiveWarrantyEnd)
	}
}

// ---- 2. the three failure modes are indistinguishable ----------------------

func TestPublicCertificateForeignExpiredRevokedAllFailIdentically(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	ctx := context.Background()

	// A valid link, to prove the route works at all before breaking it.
	liveToken, _ := createShare(t, env, "share_dev", "")
	if rr := getPublic(t, env, liveToken, "application/json"); rr.Code != http.StatusOK {
		t.Fatalf("valid token = %d (%s)", rr.Code, rr.Body.String())
	}

	// (a) FOREIGN: a live link belonging to ANOTHER USER's device. The token is a
	// valid capability — for its own device — which is exactly why it must be
	// checked: it may never reach into this user's device. It is therefore asserted
	// to work for its own subject and to expose nothing of the owner's, rather than
	// to 404 (a 404 here would mean the capability model was broken, not that it was
	// safe).
	otherIssued, err := auth.IssueToken(ctx, env.pool, shareOther, nil, nil)
	if err != nil {
		t.Fatalf("issue the other user's token: %v", err)
	}
	otherEnv := shareTestEnv{pool: env.pool, mux: env.mux, token: otherIssued.AccessToken}
	foreignToken, rr := createShare(t, otherEnv, "share_dev_foreign", "")
	if foreignToken == "" {
		t.Fatalf("could not mint the other user's share: %d (%s)", rr.Code, rr.Body.String())
	}
	foreignBody := getPublic(t, env, foreignToken, "application/json")
	if foreignBody.Code != http.StatusOK {
		t.Fatalf("a live foreign link = %d, want 200 for its own device", foreignBody.Code)
	}
	if !strings.Contains(foreignBody.Body.String(), "MAY CUA NGUOI KHAC") {
		t.Error("the foreign link does not describe its own device")
	}
	for _, leak := range []string{"iPhone 15 Pro", "GHI CHU RIENG TU", "356938035643809", "share_war"} {
		if strings.Contains(foreignBody.Body.String(), leak) {
			t.Errorf("a link for another user's device exposed %q of THIS user's device", leak)
		}
	}

	// (b) EXPIRED: pushed into the past. The handler compares against the caller's
	// clock, so the row must be unambiguously older than now.
	expiredToken, _ := createShare(t, env, "share_dev", "")
	if _, err := env.pool.Exec(ctx,
		`UPDATE "DeviceShare" SET "expiresAt" = NOW() - INTERVAL '1 day' WHERE "deviceId" = 'share_dev' AND "expiresAt" > NOW() + INTERVAL '29 days'`); err != nil {
		t.Fatalf("expire share: %v", err)
	}

	// (c) REVOKED: through the real endpoint, not SQL — that is the path clients use.
	revokedToken, revokedRR := createShare(t, env, "share_dev", "")
	shareID := shareIDFrom(t, revokedRR)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/shares/"+shareID, nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	rec := httptest.NewRecorder()
	env.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke = %d (%s)", rec.Code, rec.Body.String())
	}

	randomToken := "not-a-real-token-at-all"
	cases := map[string]string{
		"expired":      expiredToken,
		"revoked":      revokedToken,
		"never minted": randomToken,
		"empty-ish":    "-",
	}

	var baseline string
	for name, tok := range cases {
		rr := getPublic(t, env, tok, "application/json")
		if rr.Code != http.StatusNotFound {
			t.Errorf("%s token = %d, want 404 (%s)", name, rr.Code, rr.Body.String())
			continue
		}
		body := rr.Body.String()
		if baseline == "" {
			baseline = body
			continue
		}
		if body != baseline {
			t.Errorf("%s token body = %q, want the identical body %q — an attacker must not be able to tell the cases apart",
				name, body, baseline)
		}
	}
	if baseline == "" {
		t.Fatal("no 404 body was observed")
	}
	if !strings.Contains(baseline, "không tồn tại, đã hết hạn hoặc đã bị thu hồi") {
		t.Errorf("404 body = %q, want the single combined Vietnamese message", baseline)
	}
}

func TestPublicCertificateHtmlFailureSaysTheSameThing(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	rr := getPublic(t, env, "definitely-not-a-token", "")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("html failure = %d", rr.Code)
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q, want the HTML error page", ct)
	}
	if !strings.Contains(rr.Body.String(), "Không mở được phiếu") {
		t.Errorf("html failure body = %q", rr.Body.String())
	}
	// The page must not hint at WHY it failed.
	for _, leak := range []string{"hết hạn</", "đã thu hồi</", "expired", "revoked"} {
		if strings.Contains(strings.ToLower(rr.Body.String()), strings.ToLower(leak)) {
			t.Errorf("failure page distinguishes the reason (%q)", leak)
		}
	}
}

// ---- 3. abuse: caching, indexing, referrer, framing ------------------------

func TestPublicCertificateHeadersBlockCachingIndexingAndReferrerLeak(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	token, _ := createShare(t, env, "share_dev", "")

	for _, rr := range []*httptest.ResponseRecorder{
		getPublic(t, env, token, "application/json"), // 200 JSON
		getPublic(t, env, token, ""),                 // 200 HTML
		getPublic(t, env, "bad-token", "application/json"),
		getPublic(t, env, "bad-token", ""),
	} {
		h := rr.Header()
		if cc := h.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
			t.Errorf("Cache-Control = %q, want no-store on every response (status %d)", cc, rr.Code)
		}
		if xr := h.Get("X-Robots-Tag"); !strings.Contains(xr, "noindex") {
			t.Errorf("X-Robots-Tag = %q, want noindex (status %d)", xr, rr.Code)
		}
		if rp := h.Get("Referrer-Policy"); rp != "no-referrer" {
			t.Errorf("Referrer-Policy = %q, want no-referrer — the token is in the path (status %d)", rp, rr.Code)
		}
		if csp := h.Get("Content-Security-Policy"); !strings.Contains(csp, "default-src 'none'") {
			t.Errorf("CSP = %q", csp)
		}
		if xf := h.Get("X-Frame-Options"); xf != "DENY" {
			t.Errorf("X-Frame-Options = %q, want DENY", xf)
		}
		if xcto := h.Get("X-Content-Type-Options"); xcto != "nosniff" {
			t.Errorf("X-Content-Type-Options = %q", xcto)
		}
	}
}

func TestPublicCertificateHtmlIsSelfContainedAndPrintable(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	token, _ := createShare(t, env, "share_dev", "")

	rr := getPublic(t, env, token, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d", rr.Code)
	}
	html := rr.Body.String()
	if !strings.HasPrefix(rr.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("Content-Type = %q, want text/html by default", rr.Header().Get("Content-Type"))
	}
	for _, want := range []string{
		`<html lang="vi">`, `name="robots" content="noindex`, "@media print",
		"Phiếu bàn giao bảo hành", "iPhone 15 Pro", "3569*******3809", "02/05/2026",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("html is missing %q", want)
		}
	}
	// Self-contained: no scripts and no remote resources, so the CSP holds and the
	// page cannot phone home with the token in a Referer.
	for _, forbidden := range []string{"<script", "http://", "https://", "<link", "<iframe"} {
		if strings.Contains(html, forbidden) {
			t.Errorf("html is not self-contained: contains %q", forbidden)
		}
	}
	// The token itself must not be echoed into the document (it would then leak via
	// copy-paste, bookmarks or a screenshot).
	if strings.Contains(html, token) {
		t.Error("html echoes the raw token")
	}
}

func TestPublicCertificateRateLimitIsEnforced(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	// A limiter that allows exactly one request, to prove the bucket is consulted
	// BEFORE the lookup (the second request must not reach the service).
	deps := Deps{DB: env.pool, Limiter: &countingLimiter{allow: 1}}
	mux := http.NewServeMux()
	RegisterShares(mux, deps)
	token, _ := createShare(t, env, "share_dev", "")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/public/shares/"+token, nil)
	req.Header.Set("Accept", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("first request = %d, want 200", rr.Code)
	}
	rr = httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("second request = %d, want 429", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("429 must carry Retry-After")
	}
	if !strings.Contains(rr.Body.String(), "rate_limited") {
		t.Errorf("429 body = %q", rr.Body.String())
	}
}

// countingLimiter allows `allow` requests and then refuses.
type countingLimiter struct {
	allow int
	used  int
}

func (c *countingLimiter) Check(context.Context, string, int, int) (ratelimit.Result, error) {
	c.used++
	if c.used > c.allow {
		return ratelimit.Result{Ok: false, RetryAfterSec: 42}, nil
	}
	return ratelimit.Result{Ok: true, Remaining: c.allow - c.used}, nil
}

// ---- 4. owner routes: auth, ownership, idempotence, limits ----------------

func TestShareOwnerRoutesRequireAuth(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)

	for _, tc := range []struct{ method, path string }{
		{http.MethodPost, "/api/v1/devices/share_dev/shares"},
		{http.MethodGet, "/api/v1/devices/share_dev/shares"},
		{http.MethodDelete, "/api/v1/shares/whatever"},
	} {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		rr := httptest.NewRecorder()
		env.mux.ServeHTTP(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without a bearer = %d, want 401", tc.method, tc.path, rr.Code)
		}
	}
}

func TestShareOwnershipIsEnforcedOnEveryOwnerRoute(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)

	// A token for the OTHER user.
	other, err := auth.IssueToken(context.Background(), env.pool, shareOther, nil, nil)
	if err != nil {
		t.Fatalf("issue other token: %v", err)
	}

	// Create: somebody else's device is a 404, identical to a device that does not
	// exist — the same answer GET /api/v1/devices/{id} gives.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/devices/share_dev/shares", bytes.NewReader(nil))
	req.Header.Set("Authorization", "Bearer "+other.AccessToken)
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("create share for a foreign device = %d, want 404 (%s)", rr.Code, rr.Body.String())
	}

	// The owner creates one; the other user must not see or revoke it.
	token, _ := createShare(t, env, "share_dev", "")
	if token == "" {
		t.Fatal("owner could not create a share")
	}
	req = httptest.NewRequest(http.MethodGet, "/api/v1/devices/share_dev/shares", nil)
	req.Header.Set("Authorization", "Bearer "+other.AccessToken)
	rr = httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list as the other user = %d", rr.Code)
	}
	var list struct {
		Shares []services.DeviceShare `json:"shares"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(list.Shares) != 0 {
		t.Errorf("the other user sees %d shares of a device they do not own", len(list.Shares))
	}

	var shareID string
	if err := env.pool.QueryRow(context.Background(),
		`SELECT id FROM "DeviceShare" LIMIT 1`).Scan(&shareID); err != nil {
		t.Fatalf("read share id: %v", err)
	}
	req = httptest.NewRequest(http.MethodDelete, "/api/v1/shares/"+shareID, nil)
	req.Header.Set("Authorization", "Bearer "+other.AccessToken)
	rr = httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("revoke somebody else's share = %d, want 404", rr.Code)
	}
	// …and the link still works, i.e. the foreign revoke really was a no-op.
	if got := getPublic(t, env, token, "application/json"); got.Code != http.StatusOK {
		t.Errorf("link after a foreign revoke attempt = %d, want 200", got.Code)
	}
}

func TestShareTokenIsStoredHashedAndShownOnce(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	token, _ := createShare(t, env, "share_dev", "")
	if token == "" {
		t.Fatal("create failed")
	}

	// The raw token must not be recoverable from the database…
	var stored string
	if err := env.pool.QueryRow(context.Background(),
		`SELECT "tokenHash" FROM "DeviceShare" LIMIT 1`).Scan(&stored); err != nil {
		t.Fatalf("read tokenHash: %v", err)
	}
	if stored == token {
		t.Fatal("the raw token is stored in the database")
	}
	if stored != auth.HashToken(token) {
		t.Fatalf("tokenHash = %q, want sha256(token) — the PasswordReset/Session scheme", stored)
	}
	// …nor from any later read. A lost token means minting a new link.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/devices/share_dev/shares", nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list = %d", rr.Code)
	}
	if strings.Contains(rr.Body.String(), token) || strings.Contains(rr.Body.String(), stored) {
		t.Fatalf("the list endpoint re-exposes credential material: %s", rr.Body.String())
	}
}

func TestShareListTracksViewsForTheOwnerOnly(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	token, _ := createShare(t, env, "share_dev", "")

	for i := 0; i < 3; i++ {
		if rr := getPublic(t, env, token, "application/json"); rr.Code != http.StatusOK {
			t.Fatalf("public read %d = %d", i, rr.Code)
		}
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/devices/share_dev/shares", nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	var list struct {
		Shares []services.DeviceShare `json:"shares"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(list.Shares) != 1 {
		t.Fatalf("shares = %d, want 1", len(list.Shares))
	}
	if list.Shares[0].ViewCount != 3 {
		t.Errorf("viewCount = %d, want 3", list.Shares[0].ViewCount)
	}
	if list.Shares[0].LastViewedAt == nil {
		t.Error("lastViewedAt not recorded")
	}
	// The RECIPIENT must not learn the view count.
	if strings.Contains(getPublic(t, env, token, "application/json").Body.String(), "viewCount") {
		t.Error("the public certificate exposes the owner's view telemetry")
	}
}

func TestShareRevokeIsIdempotentAndKillsTheLink(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	token, _ := createShare(t, env, "share_dev", "")
	var shareID string
	if err := env.pool.QueryRow(context.Background(),
		`SELECT id FROM "DeviceShare" LIMIT 1`).Scan(&shareID); err != nil {
		t.Fatalf("read share id: %v", err)
	}

	del := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodDelete, "/api/v1/shares/"+shareID, nil)
		req.Header.Set("Authorization", "Bearer "+env.token)
		rr := httptest.NewRecorder()
		env.mux.ServeHTTP(rr, req)
		return rr
	}
	if rr := del(); rr.Code != http.StatusOK {
		t.Fatalf("first revoke = %d (%s)", rr.Code, rr.Body.String())
	}
	if rr := del(); rr.Code != http.StatusOK {
		t.Fatalf("second revoke = %d, want 200 (idempotent)", rr.Code)
	}
	if rr := getPublic(t, env, token, "application/json"); rr.Code != http.StatusNotFound {
		t.Fatalf("revoked link = %d, want 404", rr.Code)
	}
	// An unknown id is a 404, exactly like somebody else's.
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/shares/nope", nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("unknown share id = %d, want 404", rr.Code)
	}
}

func TestShareDeletingTheDeviceKillsItsLinks(t *testing.T) {
	// The one automatic revocation that is unambiguously correct: the certificate
	// describes a device that no longer exists.
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	token, _ := createShare(t, env, "share_dev", "")

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/devices/share_dev", nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("delete device = %d (%s)", rr.Code, rr.Body.String())
	}
	if got := getPublic(t, env, token, "application/json"); got.Code != http.StatusNotFound {
		t.Fatalf("link after the device was deleted = %d, want 404", got.Code)
	}
}

func TestCreateShareValidationAndPerDeviceLimit(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)

	for _, body := range []string{
		`{"expiresInDays":0}`,
		`{"expiresInDays":91}`,
		`{"expiresInDays":-1}`,
		`{"expiresInDay":30}`, // the typo must not silently produce the default
	} {
		if _, rr := createShare(t, env, "share_dev", body); rr.Code != http.StatusBadRequest {
			t.Errorf("body %s = %d, want 400 (%s)", body, rr.Code, rr.Body.String())
		}
	}
	// A minimal, valid body is accepted.
	if token, rr := createShare(t, env, "share_dev", `{"expiresInDays":7,"includeSerial":true}`); token == "" {
		t.Fatalf("valid body rejected: %d (%s)", rr.Code, rr.Body.String())
	}

	// The per-device cap: 10 live links, then a truthful refusal.
	for i := 1; i < services.MaxActiveSharesPerDevice; i++ {
		if token, rr := createShare(t, env, "share_dev", ""); token == "" {
			t.Fatalf("link %d rejected early: %d (%s)", i+1, rr.Code, rr.Body.String())
		}
	}
	_, rr := createShare(t, env, "share_dev", "")
	if rr.Code != http.StatusConflict {
		t.Fatalf("link %d = %d, want 409 (%s)", services.MaxActiveSharesPerDevice+1, rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "Thu hồi bớt") {
		t.Errorf("limit message = %q, want it to name the way out", rr.Body.String())
	}

	// Revoking frees a slot.
	var shareID string
	if err := env.pool.QueryRow(context.Background(),
		`SELECT id FROM "DeviceShare" WHERE "revokedAt" IS NULL LIMIT 1`).Scan(&shareID); err != nil {
		t.Fatalf("read share id: %v", err)
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/shares/"+shareID, nil)
	req.Header.Set("Authorization", "Bearer "+env.token)
	rec := httptest.NewRecorder()
	env.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke = %d", rec.Code)
	}
	if token, rr := createShare(t, env, "share_dev", ""); token == "" {
		t.Fatalf("link after freeing a slot rejected: %d (%s)", rr.Code, rr.Body.String())
	}
}

func TestPruneExpiredSharesRemovesOnlyLongDeadLinks(t *testing.T) {
	// The cron housekeeping step (cmd/cron → PruneExpiredShares). Without a caller
	// this would be dead code; without this test the caller could be wired to a
	// query that silently deletes nothing — or everything.
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	ctx := context.Background()

	liveToken, liveRR := createShare(t, env, "share_dev", "")
	recentlyExpired, expiredRR := createShare(t, env, "share_dev", "")
	longDead, deadRR := createShare(t, env, "share_dev", "")
	if liveToken == "" || recentlyExpired == "" || longDead == "" {
		t.Fatal("could not mint the three links")
	}
	// Name each row by the id its own create response returned. Ordering by
	// createdAt cannot identify them: the column is millisecond-precision and
	// these three are minted in a tight loop, so ties are the normal case.
	longDeadID := shareIDFrom(t, deadRR)
	recentlyExpiredID := shareIDFrom(t, expiredRR)
	liveID := shareIDFrom(t, liveRR)
	ids := []string{longDeadID, recentlyExpiredID, liveID}
	if _, err := env.pool.Exec(ctx,
		`UPDATE "DeviceShare" SET "expiresAt" = $2 WHERE id = $1`,
		ids[0], time.Now().Add(-40*24*time.Hour)); err != nil { // longDead
		t.Fatalf("age a share: %v", err)
	}
	if _, err := env.pool.Exec(ctx,
		`UPDATE "DeviceShare" SET "expiresAt" = $2 WHERE id = $1`,
		ids[1], time.Now().Add(-24*time.Hour)); err != nil { // recentlyExpired
		t.Fatalf("expire a share: %v", err)
	}

	n, err := store.New(env.pool).PruneExpiredShares(ctx, pgtype.Timestamp{Time: time.Now(), Valid: true})
	if err != nil {
		t.Fatalf("prune: %v", err)
	}
	if n != 1 {
		t.Errorf("pruned = %d, want exactly the 40-day-old row", n)
	}
	var remaining int
	if err := env.pool.QueryRow(ctx, `SELECT COUNT(*) FROM "DeviceShare"`).Scan(&remaining); err != nil {
		t.Fatalf("count: %v", err)
	}
	if remaining != 2 {
		t.Errorf("remaining = %d, want 2 (live + recently expired kept for the owner to see)", remaining)
	}
	// The long-dead link is gone for a recipient too (it was already 404).
	if rr := getPublic(t, env, longDead, "application/json"); rr.Code != http.StatusNotFound {
		t.Errorf("pruned link = %d, want 404", rr.Code)
	}
}

func TestPublicShareMalformedPathsNeverReachTheDatabaseOr500(t *testing.T) {
	// A malformed URL must not be a way to probe the handler: the empty and
	// missing token cases fall through to the mux's own 404 (the wildcard does not
	// match an empty segment), and a whitespace token is answered by the service's
	// single not-found error. None of them may 500, and none may be distinguishable
	// from a real-but-dead token.
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)

	want := `{"error":"not_found","message":"` + services.ErrShareNotFound().Message + `"}` + "\n"
	for _, path := range []string{
		"/api/v1/public/shares/",
		"/api/v1/public/shares",
		"/api/v1/public/shares/%20",
		"/api/v1/public/shares/" + strings.Repeat("a", 43),
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Accept", "application/json")
		rr := httptest.NewRecorder()
		env.mux.ServeHTTP(rr, req)
		if rr.Code != http.StatusNotFound {
			t.Errorf("%s -> %d, want 404", path, rr.Code)
			continue
		}
		// The two paths handled by the handler (as opposed to the mux) must produce
		// the standard envelope, byte for byte.
		if strings.HasSuffix(path, "/") && rr.Body.String() != "404 page not found\n" {
			t.Errorf("%s -> body %q, want the mux's plain 404", path, rr.Body.String())
		}
		if strings.HasSuffix(path, "%20") || strings.HasSuffix(path, strings.Repeat("a", 43)) {
			if rr.Body.String() != want {
				t.Errorf("%s -> body %q, want %q", path, rr.Body.String(), want)
			}
		}
	}
}
