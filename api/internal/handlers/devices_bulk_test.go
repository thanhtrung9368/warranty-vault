package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
)

// HTTP-level tests for POST /api/v1/devices/bulk (gap #20).
//
// Everything here runs against its own scratch database via testDatabaseURL()
// and exercises the REAL mux: auth, i18n middleware (well, ?lang= is attached by
// the handler), rate limiter, service and transaction. The tests are grouped by
// the contract's rules: partial success, request-index mapping, both ceilings,
// batch shape, atomicity on a write error, rate limiting, and the
// no-behaviour-change proof for the single create.
//
// Assertions that read a message use `?lang=vi` and pin the Vietnamese source
// sentence, because that is the copy this app shipped before i18n and the copy
// the existing quota suite pins. The English column is covered by the service
// tests for the two new batch sentences.

const bulkTestUser = "zz_test_bulk_user"

type bulkTestEnv struct {
	pool    *pgxpool.Pool
	mux     *http.ServeMux
	token   string
	limiter ratelimit.Limiter
}

func setupBulkTest(t *testing.T) *bulkTestEnv {
	t.Helper()
	return setupBulkTestWithLimiter(t, &permissiveLimiter{})
}

func setupBulkTestWithLimiter(t *testing.T, limiter ratelimit.Limiter) *bulkTestEnv {
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
	insertUser(t, pool, bulkTestUser, "bulk@example.invalid", hash)
	deleteUsers(t, pool, bulkTestUser)

	issued, err := auth.IssueToken(ctx, pool, bulkTestUser, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	mux := http.NewServeMux()
	RegisterDevices(mux, Deps{DB: pool, Limiter: limiter})
	return &bulkTestEnv{pool: pool, mux: mux, token: issued.AccessToken, limiter: limiter}
}

// bulkInput is one valid DeviceInput-shaped row. Names are zero-padded so a
// reordered response is obvious.
func bulkInput(i int) map[string]any {
	return map[string]any{
		"name":          fmt.Sprintf("Máy %02d", i),
		"category":      "PHONE",
		"purchaseDate":  "2026-01-15",
		"purchasePrice": 1_000_000 + i,
	}
}

func postBulkRaw(t *testing.T, env *bulkTestEnv, raw []byte) *httptest.ResponseRecorder {
	t.Helper()
	// ?lang=vi pins the language of every message assertion below.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/devices/bulk?lang=vi", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+env.token)
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	return rr
}

func postBulkDevices(t *testing.T, env *bulkTestEnv, devices []map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"devices": devices})
	if err != nil {
		t.Fatalf("marshal bulk body: %v", err)
	}
	return postBulkRaw(t, env, raw)
}

func postSingleDevice(t *testing.T, env *bulkTestEnv, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal single body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/devices?lang=vi", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+env.token)
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	return rr
}

type bulkHTTPFailure struct {
	Index       int                 `json:"index"`
	Code        string              `json:"code"`
	Message     string              `json:"message"`
	FieldErrors map[string][]string `json:"fieldErrors"`
}

type bulkHTTPDevice struct {
	ID               string  `json:"id"`
	Name             string  `json:"name"`
	Category         string  `json:"category"`
	PurchasePrice    int32   `json:"purchasePrice"`
	Currency         string  `json:"currency"`
	PurchasePriceVnd *int64  `json:"purchasePriceVnd"`
	Status           string  `json:"status"`
	LeadDays         []int32 `json:"leadDays"`
}

type bulkHTTPBody struct {
	Created []bulkHTTPDevice  `json:"created"`
	Failed  []bulkHTTPFailure `json:"failed"`
}

type bulkAPIError struct {
	Error       string              `json:"error"`
	Message     string              `json:"message"`
	FieldErrors map[string][]string `json:"fieldErrors"`
}

func decodeBulkBody(t *testing.T, rr *httptest.ResponseRecorder) bulkHTTPBody {
	t.Helper()
	var body bulkHTTPBody
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode bulk response %q: %v", rr.Body.String(), err)
	}
	return body
}

func decodeBulkAPIError(t *testing.T, rr *httptest.ResponseRecorder) bulkAPIError {
	t.Helper()
	var body bulkAPIError
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error response %q: %v", rr.Body.String(), err)
	}
	return body
}

func countBulkDevices(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM "Device" WHERE "userId" = $1`, bulkTestUser).Scan(&n); err != nil {
		t.Fatalf("count devices: %v", err)
	}
	return n
}

func seedBulkDevices(t *testing.T, pool *pgxpool.Pool, prefix, status string, n int) {
	t.Helper()
	if n == 0 {
		return
	}
	_, err := pool.Exec(context.Background(), `
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		SELECT $1 || g::text, $2, 'Seed ' || g::text, 'PHONE', '2025-01-01', 1000000, $3, NOW()
		FROM generate_series(1, $4) AS g`, prefix, bulkTestUser, status, n)
	if err != nil {
		t.Fatalf("seed %s devices: %v", status, err)
	}
}

// 50 good rows: the maximum batch succeeds in request order, every row is a real
// Device, and the write bucket is charged once per row rather than once per
// request.
func TestBulkCreateFiftyGoodRows(t *testing.T) {
	env := setupBulkTest(t)

	devices := make([]map[string]any, 50)
	for i := range devices {
		devices[i] = bulkInput(i)
	}
	rr := postBulkDevices(t, env, devices)
	if rr.Code != http.StatusOK {
		t.Fatalf("bulk create 50 = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBulkBody(t, rr)
	if len(body.Created) != 50 || len(body.Failed) != 0 {
		t.Fatalf("created=%d failed=%d, want 50/0 (%s)", len(body.Created), len(body.Failed), rr.Body.String())
	}
	// The contract says both arrays are always present and never null. A nil Go
	// slice would marshal as `null` and still satisfy len()==0, so pin the bytes.
	if !strings.Contains(rr.Body.String(), `"failed":[]`) {
		t.Errorf("50-good body must carry an empty `failed` array, not null: %s", rr.Body.String())
	}
	for i, d := range body.Created {
		if want := fmt.Sprintf("Máy %02d", i); d.Name != want {
			t.Errorf("created[%d].name = %q, want %q (request order)", i, d.Name, want)
		}
		if d.Currency != "VND" || d.Status != "ACTIVE" {
			t.Errorf("created[%d] currency/status = %q/%q, want VND/ACTIVE", i, d.Currency, d.Status)
		}
		if d.PurchasePriceVnd == nil || *d.PurchasePriceVnd != int64(1_000_000+i) {
			t.Errorf("created[%d].purchasePriceVnd = %v, want %d", i, d.PurchasePriceVnd, 1_000_000+i)
		}
		if !reflect.DeepEqual(d.LeadDays, []int32{30, 7}) {
			t.Errorf("created[%d].leadDays = %v, want [30 7] (same create default as the single path)", i, d.LeadDays)
		}
	}
	if got := countBulkDevices(t, env.pool); got != 50 {
		t.Errorf("devices in DB = %d, want 50", got)
	}

	// The batch is ONE request but 50 writes. The fallback path of
	// CheckUserWriteN (used by this permissive test limiter) calls Check once per
	// row, so calls == 50 proves the cost is not silently 1.
	permissive, ok := env.limiter.(*permissiveLimiter)
	if !ok {
		t.Fatalf("test limiter is %T, want *permissiveLimiter", env.limiter)
	}
	if permissive.calls != 50 {
		t.Errorf("rate limiter charged %d writes, want 50 (one per row)", permissive.calls)
	}
}

// One bad row must not fail the other rows, and `failed[].index` must point at
// the request array, not the failure array.
func TestBulkCreatePartialSuccessMapsFailuresToRequestIndex(t *testing.T) {
	env := setupBulkTest(t)

	missingName := bulkInput(1)
	missingName["name"] = ""
	badCategory := bulkInput(3)
	badCategory["category"] = "NOT_A_CATEGORY"
	badDate := bulkInput(4)
	badDate["purchaseDate"] = "31/12/2025"

	devices := []map[string]any{
		bulkInput(0),
		missingName,
		bulkInput(2),
		badCategory,
		badDate,
	}
	rr := postBulkDevices(t, env, devices)
	if rr.Code != http.StatusOK {
		t.Fatalf("partial bulk = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBulkBody(t, rr)

	if len(body.Created) != 2 {
		t.Fatalf("created = %d, want 2 (%s)", len(body.Created), rr.Body.String())
	}
	if body.Created[0].Name != "Máy 00" || body.Created[1].Name != "Máy 02" {
		t.Errorf("created order = %q,%q, want Máy 00,Máy 02", body.Created[0].Name, body.Created[1].Name)
	}

	wantFailures := []struct {
		index int
		code  string
		field string
		msg   string
	}{
		{1, "validation", "name", "Tên thiết bị bắt buộc"},
		{3, "category_invalid", "category", "Loại thiết bị không hợp lệ"},
		{4, "validation", "purchaseDate", "Ngày mua không hợp lệ"},
	}
	if len(body.Failed) != len(wantFailures) {
		t.Fatalf("failed = %d, want %d (%s)", len(body.Failed), len(wantFailures), rr.Body.String())
	}
	for i, want := range wantFailures {
		f := body.Failed[i]
		if f.Index != want.index {
			t.Errorf("failed[%d].index = %d, want request index %d", i, f.Index, want.index)
		}
		if f.Code != want.code {
			t.Errorf("failed[%d].code = %q, want %q", i, f.Code, want.code)
		}
		messages := f.FieldErrors[want.field]
		if len(messages) == 0 || messages[0] != want.msg {
			t.Errorf("failed[%d].fieldErrors[%q] = %v, want [%q]", i, want.field, messages, want.msg)
		}
		if strings.TrimSpace(f.Message) == "" {
			t.Errorf("failed[%d].message is empty", i)
		}
	}

	if got := countBulkDevices(t, env.pool); got != 2 {
		t.Errorf("devices in DB = %d, want 2 (only the passing rows)", got)
	}
}

// A wholly invalid batch is a 200 with every row in `failed`, not a 409 and not
// a 400: the request shape was valid, the rows were not.
func TestBulkCreateAllRowsFail(t *testing.T) {
	env := setupBulkTest(t)

	devices := []map[string]any{
		{"name": "", "category": "PHONE", "purchaseDate": "2026-01-15"},
		{"name": "Máy", "category": "", "purchaseDate": "2026-01-15"},
		{"name": "Máy", "category": "PHONE", "purchaseDate": ""},
	}
	rr := postBulkDevices(t, env, devices)
	if rr.Code != http.StatusOK {
		t.Fatalf("all-invalid bulk = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBulkBody(t, rr)
	if len(body.Created) != 0 {
		t.Errorf("created = %d, want 0", len(body.Created))
	}
	if !strings.Contains(rr.Body.String(), `"created":[]`) {
		t.Errorf("all-invalid body must carry an empty `created` array, not null: %s", rr.Body.String())
	}
	if len(body.Failed) != 3 {
		t.Fatalf("failed = %d, want 3 (%s)", len(body.Failed), rr.Body.String())
	}
	for i, f := range body.Failed {
		if f.Index != i {
			t.Errorf("failed[%d].index = %d, want %d", i, f.Index, i)
		}
		if len(f.FieldErrors) == 0 {
			t.Errorf("failed[%d] has no fieldErrors", i)
		}
	}
	if got := countBulkDevices(t, env.pool); got != 0 {
		t.Errorf("devices in DB = %d, want 0", got)
	}
}

func TestBulkCreateEmptyArrayRejected(t *testing.T) {
	env := setupBulkTest(t)

	rr := postBulkRaw(t, env, []byte(`{"devices":[]}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("empty devices = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBulkAPIError(t, rr)
	if body.Error != "validation" {
		t.Errorf("error code = %q, want validation", body.Error)
	}
	if len(body.FieldErrors["devices"]) == 0 {
		t.Errorf("fieldErrors = %v, want a `devices` entry", body.FieldErrors)
	}
	if got := countBulkDevices(t, env.pool); got != 0 {
		t.Errorf("devices in DB = %d, want 0", got)
	}

	// The cap check runs before the rate limiter: a 51-row request must not be
	// charged for 51 writes it is not going to make.
	if permissive, ok := env.limiter.(*permissiveLimiter); ok && permissive.calls != 0 {
		t.Errorf("rate limiter charged %d writes for an empty batch, want 0", permissive.calls)
	}
}

func TestBulkCreateOverCapRejected(t *testing.T) {
	env := setupBulkTest(t)

	devices := make([]map[string]any, 51)
	for i := range devices {
		devices[i] = bulkInput(i)
	}
	rr := postBulkDevices(t, env, devices)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("51 devices = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBulkAPIError(t, rr)
	if body.Error != "validation" {
		t.Errorf("error code = %q, want validation", body.Error)
	}
	if len(body.FieldErrors["devices"]) == 0 {
		t.Errorf("fieldErrors = %v, want a `devices` entry", body.FieldErrors)
	}
	if got := countBulkDevices(t, env.pool); got != 0 {
		t.Errorf("devices in DB = %d, want 0 (over-cap batches create nothing)", got)
	}
	if permissive, ok := env.limiter.(*permissiveLimiter); ok && permissive.calls != 0 {
		t.Errorf("rate limiter charged %d writes for an over-cap batch, want 0", permissive.calls)
	}
}

// The active ceiling is a whole-batch refusal: 45 existing + 6 incoming would be
// 51, so the server creates NONE of the six and leaves the 45 untouched. Then a
// five-row batch that fits is accepted, which proves the refusal was about the
// batch total rather than a broken endpoint.
func TestBulkCreateRejectsWholeBatchAtActiveCeiling(t *testing.T) {
	env := setupBulkTest(t)
	seedBulkDevices(t, env.pool, "act", "ACTIVE", 45)

	six := make([]map[string]any, 6)
	for i := range six {
		six[i] = bulkInput(i)
	}
	rr := postBulkDevices(t, env, six)
	if rr.Code != http.StatusConflict {
		t.Fatalf("45+6 active = %d, want 409 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBulkAPIError(t, rr)
	if body.Error != "limit_reached" {
		t.Errorf("error code = %q, want limit_reached", body.Error)
	}
	if !strings.Contains(body.Message, "50") || !strings.Contains(body.Message, "không chiếm suất") {
		t.Errorf("message = %q, want the active-ceiling sentence", body.Message)
	}
	if got := countBulkDevices(t, env.pool); got != 45 {
		t.Errorf("devices after refusal = %d, want 45 (no partial batch)", got)
	}

	five := make([]map[string]any, 5)
	for i := range five {
		five[i] = bulkInput(i)
	}
	rr = postBulkDevices(t, env, five)
	if rr.Code != http.StatusOK {
		t.Fatalf("45+5 active = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	bodyOK := decodeBulkBody(t, rr)
	if len(bodyOK.Created) != 5 || len(bodyOK.Failed) != 0 {
		t.Errorf("created=%d failed=%d, want 5/0", len(bodyOK.Created), len(bodyOK.Failed))
	}
	if got := countBulkDevices(t, env.pool); got != 50 {
		t.Errorf("devices after accepted batch = %d, want 50", got)
	}
}

// The 500-row storage ceiling counts sold devices too, so a single new row at
// 500 total is refused even though the active count is 0. This is the second
// ceiling, and it is the one a "mark sold, add, repeat" loop would otherwise
// bypass.
func TestBulkCreateRejectsWholeBatchAtStorageCeiling(t *testing.T) {
	env := setupBulkTest(t)
	seedBulkDevices(t, env.pool, "sold", "SOLD", 500)

	rr := postBulkDevices(t, env, []map[string]any{bulkInput(0)})
	if rr.Code != http.StatusConflict {
		t.Fatalf("500 sold + 1 = %d, want 409 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBulkAPIError(t, rr)
	if body.Error != "limit_reached" {
		t.Errorf("error code = %q, want limit_reached", body.Error)
	}
	if !strings.Contains(body.Message, "500") || !strings.Contains(body.Message, "lưu trữ") {
		t.Errorf("message = %q, want the storage-ceiling sentence", body.Message)
	}
	if got := countBulkDevices(t, env.pool); got != 500 {
		t.Errorf("devices after refusal = %d, want 500", got)
	}
}

// Atomicity on a WRITE error: validation passed for all four rows, the first two
// INSERTs succeeded, the third hit a database trigger. The whole transaction must
// roll back, leaving zero rows rather than two.
func TestBulkCreateWriteErrorRollsBackWholeBatch(t *testing.T) {
	env := setupBulkTest(t)
	ctx := context.Background()

	if _, err := env.pool.Exec(ctx, `
		CREATE OR REPLACE FUNCTION wv_bulk_boom() RETURNS trigger AS $$
		BEGIN
			IF NEW.name = 'ZZ_BOOM' THEN
				RAISE EXCEPTION 'forced bulk write failure';
			END IF;
			RETURN NEW;
		END;
		$$ LANGUAGE plpgsql`); err != nil {
		t.Fatalf("create trigger function: %v", err)
	}
	if _, err := env.pool.Exec(ctx,
		`CREATE TRIGGER wv_bulk_boom BEFORE INSERT ON "Device"
		 FOR EACH ROW EXECUTE FUNCTION wv_bulk_boom()`); err != nil {
		t.Fatalf("create trigger: %v", err)
	}
	t.Cleanup(func() {
		_, _ = env.pool.Exec(context.Background(), `DROP TRIGGER IF EXISTS wv_bulk_boom ON "Device"`)
		_, _ = env.pool.Exec(context.Background(), `DROP FUNCTION IF EXISTS wv_bulk_boom()`)
	})

	devices := []map[string]any{bulkInput(0), bulkInput(1), bulkInput(2), bulkInput(3)}
	devices[2]["name"] = "ZZ_BOOM"

	rr := postBulkDevices(t, env, devices)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("forced write error = %d, want 500 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBulkAPIError(t, rr)
	if body.Error != "internal_error" {
		t.Errorf("error code = %q, want internal_error", body.Error)
	}
	if got := countBulkDevices(t, env.pool); got != 0 {
		t.Errorf("devices after rolled-back batch = %d, want 0 (all-or-nothing)", got)
	}
}

func TestBulkCreateIsRateLimited(t *testing.T) {
	env := setupBulkTestWithLimiter(t, denyLimiter{})

	rr := postBulkDevices(t, env, []map[string]any{bulkInput(0)})
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("denied bulk = %d, want 429 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBulkAPIError(t, rr)
	if body.Error != "rate_limited" {
		t.Errorf("error code = %q, want rate_limited", body.Error)
	}
	if got := countBulkDevices(t, env.pool); got != 0 {
		t.Errorf("devices in DB = %d, want 0", got)
	}
}

// No-behaviour-change proof for POST /api/v1/devices:
//
//   - the same input creates the same Device through the single path and through
//     the bulk path (volatile ids/timestamps stripped), including the computed
//     purchasePriceVnd and leadDays defaults;
//   - the single path's `warnings` array is still present;
//   - an invalid date still produces the same field error and sentence in both
//     paths, so the shared preparation step did not change the single path's
//     validation.
func TestSingleCreateStillMatchesBulkDevice(t *testing.T) {
	env := setupBulkTest(t)

	payload := map[string]any{
		"name":           "Máy so sánh",
		"category":       "PHONE",
		"purchaseDate":   "2026-02-03",
		"purchasePrice":  999,
		"currency":       "USD",
		"fxRate":         26_000,
		"warrantyMonths": 24,
		"brand":          "Apple",
		"status":         "ACTIVE",
	}

	rr := postSingleDevice(t, env, payload)
	if rr.Code != http.StatusCreated {
		t.Fatalf("single create = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	var single struct {
		Device   map[string]any `json:"device"`
		Warnings []any          `json:"warnings"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &single); err != nil {
		t.Fatalf("decode single create: %v", err)
	}
	if single.Device == nil {
		t.Fatal("single create response has no device")
	}
	if single.Warnings == nil {
		t.Error("single create response lost its `warnings` array — behaviour changed")
	}

	bulkRR := postBulkDevices(t, env, []map[string]any{payload})
	if bulkRR.Code != http.StatusOK {
		t.Fatalf("bulk create = %d, want 200 (%s)", bulkRR.Code, bulkRR.Body.String())
	}
	var bulk struct {
		Created []map[string]any `json:"created"`
		Failed  []any            `json:"failed"`
	}
	if err := json.Unmarshal(bulkRR.Body.Bytes(), &bulk); err != nil {
		t.Fatalf("decode bulk create: %v", err)
	}
	if len(bulk.Created) != 1 || len(bulk.Failed) != 0 {
		t.Fatalf("bulk created=%d failed=%d, want 1/0", len(bulk.Created), len(bulk.Failed))
	}

	for _, m := range []map[string]any{single.Device, bulk.Created[0]} {
		delete(m, "id")
		delete(m, "createdAt")
		delete(m, "updatedAt")
	}
	if !reflect.DeepEqual(single.Device, bulk.Created[0]) {
		t.Errorf("single and bulk device payloads differ:\nsingle: %#v\nbulk:   %#v", single.Device, bulk.Created[0])
	}

	// Same invalid input, same field error. The single path answers 400 with an
	// envelope; the bulk path reports the row in `failed` with the same sentence.
	bad := map[string]any{
		"name":         "Máy ngày sai",
		"category":     "PHONE",
		"purchaseDate": "31/12/2025",
	}
	singleBad := postSingleDevice(t, env, bad)
	if singleBad.Code != http.StatusBadRequest {
		t.Fatalf("single invalid date = %d, want 400 (%s)", singleBad.Code, singleBad.Body.String())
	}
	singleErr := decodeBulkAPIError(t, singleBad)
	bulkBad := postBulkDevices(t, env, []map[string]any{bad})
	if bulkBad.Code != http.StatusOK {
		t.Fatalf("bulk invalid date = %d, want 200 (%s)", bulkBad.Code, bulkBad.Body.String())
	}
	bulkBody := decodeBulkBody(t, bulkBad)
	if len(bulkBody.Failed) != 1 {
		t.Fatalf("bulk failed = %d, want 1", len(bulkBody.Failed))
	}
	singleMessages := singleErr.FieldErrors["purchaseDate"]
	bulkMessages := bulkBody.Failed[0].FieldErrors["purchaseDate"]
	if !reflect.DeepEqual(singleMessages, bulkMessages) {
		t.Errorf("purchaseDate messages differ: single=%v bulk=%v", singleMessages, bulkMessages)
	}
	if singleErr.Error != bulkBody.Failed[0].Code {
		t.Errorf("codes differ: single=%q bulk=%q", singleErr.Error, bulkBody.Failed[0].Code)
	}
}

// Concurrency proof for the quota lock. At 49 active devices, two creates race
// for the 50th slot. Without the per-user advisory lock both transactions can
// read "49" and both insert; with it, one wins and the other gets the documented
// 409. The test is written to be order-independent: it asserts the multiset of
// statuses, not which request won.
func TestConcurrentCreatesCannotExceedActiveCeiling(t *testing.T) {
	env := setupBulkTestWithLimiter(t, ratelimit.NewMemoryLimiter())
	seedBulkDevices(t, env.pool, "race", "ACTIVE", 49)

	payload := map[string]any{
		"name":          "Máy tranh suất",
		"category":      "PHONE",
		"purchaseDate":  "2026-03-01",
		"purchasePrice": 2_000_000,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	start := make(chan struct{})
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			req := httptest.NewRequest(http.MethodPost, "/api/v1/devices?lang=vi", bytes.NewReader(raw))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+env.token)
			rr := httptest.NewRecorder()
			env.mux.ServeHTTP(rr, req)
			statuses <- rr.Code
		}()
	}
	close(start)
	wg.Wait()
	close(statuses)

	got := map[int]int{}
	for status := range statuses {
		got[status]++
	}
	if got[http.StatusCreated] != 1 || got[http.StatusConflict] != 1 {
		t.Fatalf("concurrent statuses = %v, want exactly one 201 and one 409 (no 51st active row)", got)
	}
	var active int
	if err := env.pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM "Device" WHERE "userId" = $1 AND status <> 'SOLD'`,
		bulkTestUser).Scan(&active); err != nil {
		t.Fatalf("count active: %v", err)
	}
	if active != 50 {
		t.Fatalf("active after the race = %d, want 50", active)
	}
}
