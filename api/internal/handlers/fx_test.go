package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/fx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
)

// HTTP-level coverage for multi-currency devices (migration 0022, gap #16) and
// the rate-prefill endpoint.
//
// The rules are unit-tested in internal/services/currency_test.go; these tests
// prove the WIRE contract the three clients bind to: the status codes, the
// `fieldErrors` keys, the computed fields on device reads, and the FX endpoint's
// cache/stale/503 behaviour. Every test gets its own scratch database (see
// newScratchDatabaseDSN) because `go test ./...` runs package binaries in
// parallel.

// fxUpstream is a controllable stand-in for open.er-api.com.
type fxUpstream struct {
	mu    sync.Mutex
	calls int
	fail  bool
	rates map[string]float64
}

func (u *fxUpstream) setFail(v bool) {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.fail = v
}

func (u *fxUpstream) callsCount() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.calls
}

func (u *fxUpstream) handler(w http.ResponseWriter, _ *http.Request) {
	u.mu.Lock()
	u.calls++
	fail := u.fail
	rates := u.rates
	u.mu.Unlock()
	if fail {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"result": "success", "base_code": "USD", "rates": rates,
	})
}

func defaultRates() map[string]float64 {
	return map[string]float64{"USD": 1, "EUR": 0.8896, "VND": 25860.555369}
}

// fixedClock is the injectable now() for TTL assertions.
type fixedClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fixedClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fixedClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// denyLimiter refuses every request, for the 429 path.
type denyLimiter struct{}

func (denyLimiter) Check(context.Context, string, int, int) (ratelimit.Result, error) {
	return ratelimit.Result{Ok: false, RetryAfterSec: 42}, nil
}

const fxTestUser = "zz_test_fx_user"

// setupFXTest builds a migrated scratch DB, one user with a token, and a mux
// carrying the real auth middleware. `client` may be nil (httptest's client).
func setupFXTest(t *testing.T, upstream *fxUpstream, clock *fixedClock, client *http.Client, limiter ratelimit.Limiter) (*http.ServeMux, string) {
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
		t.Fatalf("hash password: %v", err)
	}
	insertUser(t, pool, fxTestUser, "fx@example.invalid", hash)
	deleteUsers(t, pool, fxTestUser)
	issued, err := auth.IssueToken(ctx, pool, fxTestUser, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	srv := httptest.NewServer(http.HandlerFunc(upstream.handler))
	t.Cleanup(srv.Close)
	if client == nil {
		client = srv.Client()
	}
	if limiter == nil {
		limiter = &permissiveLimiter{}
	}
	svc := fx.New(fx.Options{
		Endpoint: srv.URL,
		Client:   client,
		TTL:      fx.DefaultTTL,
		Now:      clock.Now,
	})

	mux := http.NewServeMux()
	RegisterFX(mux, Deps{DB: pool, Limiter: limiter, FX: svc})
	RegisterDevices(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	return mux, issued.AccessToken
}

func doRequest(t *testing.T, mux *http.ServeMux, token, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

type errorEnvelope struct {
	Error       string              `json:"error"`
	Message     string              `json:"message"`
	FieldErrors map[string][]string `json:"fieldErrors"`
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) errorEnvelope {
	t.Helper()
	var env errorEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode error envelope from %q: %v", rec.Body.String(), err)
	}
	return env
}

type fxResponse struct {
	Base      string             `json:"base"`
	Rates     map[string]float64 `json:"rates"`
	FetchedAt string             `json:"fetchedAt"`
	Stale     bool               `json:"stale"`
}

func TestFXRatesEndpointRequiresAuth(t *testing.T) {
	upstream := &fxUpstream{rates: defaultRates()}
	clock := &fixedClock{now: time.Now()}
	mux, _ := setupFXTest(t, upstream, clock, nil, nil)

	rec := doRequest(t, mux, "", http.MethodGet, "/api/v1/fx/rates?base=USD", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 without a token", rec.Code)
	}
	if upstream.callsCount() != 0 {
		t.Error("the upstream was called for an unauthenticated request")
	}
}

func TestFXRatesEndpointReturnsSnapshotAndCaches(t *testing.T) {
	upstream := &fxUpstream{rates: defaultRates()}
	clock := &fixedClock{now: time.Date(2026, 10, 19, 8, 0, 0, 0, time.UTC)}
	mux, token := setupFXTest(t, upstream, clock, nil, nil)

	rec := doRequest(t, mux, token, http.MethodGet, "/api/v1/fx/rates?base=usd", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var got fxResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Base != "USD" {
		t.Errorf("base = %q, want USD (normalised)", got.Base)
	}
	if got.Rates["VND"] != 25860.555369 {
		t.Errorf("rates.VND = %v, want the upstream value", got.Rates["VND"])
	}
	if got.Stale {
		t.Error("a fresh response must not be stale")
	}
	if got.FetchedAt != "2026-10-19T08:00:00Z" {
		t.Errorf("fetchedAt = %q, want 2026-10-19T08:00:00Z", got.FetchedAt)
	}

	// Second call inside the TTL: same body, no second upstream request.
	clock.advance(time.Hour)
	rec2 := doRequest(t, mux, token, http.MethodGet, "/api/v1/fx/rates?base=USD", nil)
	if rec2.Code != http.StatusOK {
		t.Fatalf("second status = %d, want 200", rec2.Code)
	}
	if upstream.callsCount() != 1 {
		t.Errorf("upstream calls = %d, want 1 (12h cache)", upstream.callsCount())
	}
}

func TestFXRatesEndpointServesStaleAfterFailedRefresh(t *testing.T) {
	upstream := &fxUpstream{rates: defaultRates()}
	clock := &fixedClock{now: time.Date(2026, 10, 19, 8, 0, 0, 0, time.UTC)}
	mux, token := setupFXTest(t, upstream, clock, nil, nil)

	if rec := doRequest(t, mux, token, http.MethodGet, "/api/v1/fx/rates?base=USD", nil); rec.Code != http.StatusOK {
		t.Fatalf("prime status = %d", rec.Code)
	}

	clock.advance(fx.DefaultTTL + time.Minute)
	upstream.setFail(true)

	rec := doRequest(t, mux, token, http.MethodGet, "/api/v1/fx/rates?base=USD", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("stale status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var got fxResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !got.Stale {
		t.Error("stale = false, want true when serving a past-TTL cache after a failed refresh")
	}
	if got.FetchedAt != "2026-10-19T08:00:00Z" {
		t.Errorf("fetchedAt = %q, want the original fetch time", got.FetchedAt)
	}
}

func TestFXRatesEndpoint503WhenUpstreamDownWithNoCache(t *testing.T) {
	upstream := &fxUpstream{rates: defaultRates(), fail: true}
	clock := &fixedClock{now: time.Now()}
	mux, token := setupFXTest(t, upstream, clock, nil, nil)

	rec := doRequest(t, mux, token, http.MethodGet, "/api/v1/fx/rates?base=USD&lang=vi", nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503: %s", rec.Code, rec.Body.String())
	}
	env := decodeError(t, rec)
	if env.Error != "fx_unavailable" {
		t.Errorf("error = %q, want fx_unavailable", env.Error)
	}
	if env.Message != "Không lấy được tỷ giá. Hãy tự nhập tỷ giá." {
		t.Errorf("message = %q, want the manual-entry instruction", env.Message)
	}
}

func TestFXRatesEndpointRejectsUnsupportedBase(t *testing.T) {
	upstream := &fxUpstream{rates: defaultRates()}
	clock := &fixedClock{now: time.Now()}
	mux, token := setupFXTest(t, upstream, clock, nil, nil)

	rec := doRequest(t, mux, token, http.MethodGet, "/api/v1/fx/rates?base=XYZ&lang=vi", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	env := decodeError(t, rec)
	if len(env.FieldErrors["base"]) == 0 {
		t.Errorf("fieldErrors.base missing: %+v", env)
	}
	if env.Message != "Loại tiền không hỗ trợ" {
		t.Errorf("message = %q", env.Message)
	}
	if upstream.callsCount() != 0 {
		t.Error("an unsupported base must not reach the upstream")
	}
}

func TestFXRatesEndpointRateLimited(t *testing.T) {
	upstream := &fxUpstream{rates: defaultRates()}
	clock := &fixedClock{now: time.Now()}
	mux, token := setupFXTest(t, upstream, clock, nil, denyLimiter{})

	rec := doRequest(t, mux, token, http.MethodGet, "/api/v1/fx/rates?base=USD", nil)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", rec.Code)
	}
	if got := rec.Header().Get("Retry-After"); got != "42" {
		t.Errorf("Retry-After = %q, want 42", got)
	}
	env := decodeError(t, rec)
	if env.Error != "rate_limited" {
		t.Errorf("error = %q, want rate_limited", env.Error)
	}
	if upstream.callsCount() != 0 {
		t.Error("a rate-limited request must not reach the upstream")
	}
}

// ---- device write/read rules over HTTP ------------------------------------

type deviceResponse struct {
	Device struct {
		ID               string `json:"id"`
		Currency         string `json:"currency"`
		FxRate           *int32 `json:"fxRate"`
		PurchasePrice    int32  `json:"purchasePrice"`
		PurchasePriceVnd *int64 `json:"purchasePriceVnd"`
		SoldPriceVnd     *int64 `json:"soldPriceVnd"`
	} `json:"device"`
}

func newDeviceBody(extra map[string]any) map[string]any {
	body := map[string]any{
		"name":          "iPhone US",
		"category":      "PHONE",
		"purchaseDate":  "2026-01-15",
		"purchasePrice": 999,
	}
	for k, v := range extra {
		body[k] = v
	}
	return body
}

func TestDeviceCurrencyWriteRulesOverHTTP(t *testing.T) {
	upstream := &fxUpstream{rates: defaultRates()}
	clock := &fixedClock{now: time.Now()}
	mux, token := setupFXTest(t, upstream, clock, nil, nil)

	// 1. A foreign currency without a rate is a 400 on fieldErrors.fxRate —
	//    rejected, never defaulted.
	rec := doRequest(t, mux, token, http.MethodPost, "/api/v1/devices?lang=vi", newDeviceBody(map[string]any{
		"currency": "USD",
	}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for USD without fxRate: %s", rec.Code, rec.Body.String())
	}
	env := decodeError(t, rec)
	if len(env.FieldErrors["fxRate"]) == 0 {
		t.Errorf("fieldErrors.fxRate missing: %+v", env)
	} else if env.FieldErrors["fxRate"][0] != "Thiếu tỷ giá" {
		t.Errorf("fieldErrors.fxRate = %q", env.FieldErrors["fxRate"][0])
	}

	// 2. VND with a rate is also a 400 on fieldErrors.fxRate.
	rec = doRequest(t, mux, token, http.MethodPost, "/api/v1/devices?lang=vi", newDeviceBody(map[string]any{
		"currency": "VND",
		"fxRate":   26100,
	}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for VND with a rate", rec.Code)
	}
	env = decodeError(t, rec)
	if len(env.FieldErrors["fxRate"]) == 0 {
		t.Errorf("fieldErrors.fxRate missing: %+v", env)
	}

	// 3. An unsupported code is a 400 on fieldErrors.currency.
	rec = doRequest(t, mux, token, http.MethodPost, "/api/v1/devices?lang=vi", newDeviceBody(map[string]any{
		"currency": "USDD",
		"fxRate":   26100,
	}))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for an unsupported currency", rec.Code)
	}
	if env = decodeError(t, rec); len(env.FieldErrors["currency"]) == 0 {
		t.Errorf("fieldErrors.currency missing: %+v", env)
	}

	// 4. A valid USD create returns the locked pair and the computed VND value.
	rec = doRequest(t, mux, token, http.MethodPost, "/api/v1/devices", newDeviceBody(map[string]any{
		"currency": "USD",
		"fxRate":   26100,
	}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	var created deviceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode created: %v", err)
	}
	if created.Device.Currency != "USD" {
		t.Errorf("currency = %q, want USD", created.Device.Currency)
	}
	if created.Device.FxRate == nil || *created.Device.FxRate != 26100 {
		t.Errorf("fxRate = %v, want 26100", created.Device.FxRate)
	}
	if created.Device.PurchasePriceVnd == nil || *created.Device.PurchasePriceVnd != 999*26100 {
		t.Errorf("purchasePriceVnd = %v, want %d", created.Device.PurchasePriceVnd, 999*26100)
	}
	if created.Device.PurchasePrice != 999 {
		t.Errorf("purchasePrice = %d; the stored price must stay in the device's currency", created.Device.PurchasePrice)
	}

	// 5. A plain VND create (no currency in the body) is unchanged: VND, no rate,
	//    purchasePriceVnd == purchasePrice.
	rec = doRequest(t, mux, token, http.MethodPost, "/api/v1/devices", newDeviceBody(map[string]any{
		"name":          "Máy VND",
		"purchasePrice": 25_000_000,
	}))
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 for a plain VND create: %s", rec.Code, rec.Body.String())
	}
	var vnd deviceResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &vnd); err != nil {
		t.Fatalf("decode vnd: %v", err)
	}
	if vnd.Device.Currency != "VND" || vnd.Device.FxRate != nil {
		t.Errorf("plain create pair = %s/%v, want VND/nil", vnd.Device.Currency, vnd.Device.FxRate)
	}
	if vnd.Device.PurchasePriceVnd == nil || *vnd.Device.PurchasePriceVnd != 25_000_000 {
		t.Errorf("purchasePriceVnd = %v, want 25000000", vnd.Device.PurchasePriceVnd)
	}

	// 6. The list read carries the computed value for every device.
	rec = doRequest(t, mux, token, http.MethodGet, "/api/v1/devices", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d", rec.Code)
	}
	var list struct {
		Devices []struct {
			ID               string `json:"id"`
			Currency         string `json:"currency"`
			PurchasePriceVnd *int64 `json:"purchasePriceVnd"`
		} `json:"devices"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list.Devices) != 2 {
		t.Fatalf("list has %d devices, want 2", len(list.Devices))
	}
	for _, d := range list.Devices {
		if d.PurchasePriceVnd == nil {
			t.Errorf("device %s (%s) has no purchasePriceVnd", d.ID, d.Currency)
		}
	}
}
