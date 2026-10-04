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
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Phase 1's proof of the i18n pattern over HTTP, on the devices + warranties
// slice (docs/I18N_PLAN.md §3). Phase 0 did this for auth (auth_i18n_test.go);
// this file is the same shape for the slice the 50-device ceiling lives in.
//
// What each test is for, and why the assertions are written the way they are:
//
//  1. `message` AND `fieldErrors` move together. A response whose headline is
//     English while the per-field help text under it is Vietnamese is worse than
//     an untranslated one: the web form renders the field errors, and the user
//     cannot tell which language the app is in. Phase 0 has the same test for
//     auth.
//  2. The devices ceiling is asserted in BOTH languages through the real HTTP
//     surface, because that is the refusal a user actually reads — and the one
//     whose wording was rewritten by hand ("đã bán không chiếm suất" is not a
//     literal translation target). docs/I18N_PLAN.md §4.4.
//  3. The catalog scan catches the failure mode nothing else can: a typo'd or
//     missing key degrades to the VIETNAMESE source text by design
//     (docs/I18N_PLAN.md §3.1), so an untranslated string does not fail — it just
//     ships. The scan compares the same request in both languages and fails when
//     two strings are identical, which is what "not in the catalog" looks like
//     from the outside.
//  4. The error CODE and the status do not move with the language. A client that
//     binds to `error` / `fieldErrors` keys must not care which language it asked
//     for.
//
// Every case pins its language explicitly (`?lang=`, Accept-Language, or an
// i18n.WithTag context for the paths with no request), so no assertion here can
// pass because of the machine's locale (docs/I18N_PLAN.md §4.3).
//
// Each test gets its own scratch database, like every DB-backed handler test
// (testDatabaseURL → newScratchDatabaseDSN).

type devicesI18nEnv struct {
	mux   *http.ServeMux
	token string
}

func setupDevicesI18nEnv(t *testing.T) *devicesI18nEnv {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect scratch: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	const userID = "zz_test_dev_i18n_user"
	insertUser(t, pool, userID, "dev-i18n@example.invalid", hash)
	deleteUsers(t, pool, userID)

	issued, err := auth.IssueToken(context.Background(), pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	mux := http.NewServeMux()
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	RegisterDevices(mux, deps)
	RegisterWarranties(mux, deps)
	return &devicesI18nEnv{mux: mux, token: issued.AccessToken}
}

// do issues one request with the language pinned by `lang` (an Accept-Language
// header) against a path that may carry `?lang=`.
//
// i18n.Middleware wraps the mux the way the real server does, so this exercises
// the same path `curl '...?lang=vi'` takes. The handlers also call i18n.Attach
// themselves; both mechanisms computing the same answer is the point (see the note
// in devices.go), and this is the only place that proves the middleware path.
func (e *devicesI18nEnv) do(t *testing.T, method, path, lang, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+e.token)
	if lang != "" {
		req.Header.Set("Accept-Language", lang)
	}
	rr := httptest.NewRecorder()
	i18n.Middleware(e.mux).ServeHTTP(rr, req)
	return rr
}

// decodeResponse unmarshals a response body as an object.
func decodeResponse(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode %q: %v", rr.Body.String(), err)
	}
	return out
}

// firstFieldError reads fieldErrors[field][0], failing loudly when it is absent —
// a missing entry is a different failure from a mistranslated one.
func firstFieldError(t *testing.T, body map[string]any, field string) string {
	t.Helper()
	fe, ok := body["fieldErrors"].(map[string]any)
	if !ok {
		t.Fatalf("body has no fieldErrors object: %v", body)
	}
	msgs, ok := fe[field].([]any)
	if !ok || len(msgs) == 0 {
		t.Fatalf("fieldErrors.%s is %v, want at least one message", field, fe[field])
	}
	s, _ := msgs[0].(string)
	return s
}

// ── 1. A validation error, both languages ───────────────────────────────────

// One request, two languages: the `message` headline and the `fieldErrors` copy
// must both move, and both must be pinned explicitly.
//
// The probes cover the shapes the catalog has to handle: argument-free (`Text`),
// printf-shaped (`T`), and the shared envelope headline that the service does not
// translate (ErrValidation is unkeyed on purpose — see its doc comment).
func TestDeviceValidationErrorIsTranslated(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	for _, tc := range []struct {
		name string
		body string
		// the field whose fieldErrors entry is asserted, and its two renderings
		field  string
		wantVI string
		wantEN string
		// wantMsgVI / wantMsgEN are the expected envelope headlines. Most cases
		// share the generic "invalid input" sentence; the two that raise their own
		// keyed error (an unparseable date, an unknown category) name it instead.
		wantMsgVI string
		wantMsgEN string
	}{
		{
			name:   "missing name",
			body:   `{"category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000}`,
			field:  "name",
			wantVI: "Tên thiết bị bắt buộc",
			wantEN: "Device name is required",
		},
		{
			name:   "missing category",
			body:   `{"name":"Máy","purchaseDate":"2026-01-15","purchasePrice":1000}`,
			field:  "category",
			wantVI: "Loại thiết bị bắt buộc",
			wantEN: "Device category is required",
		},
		{
			name:   "negative price",
			body:   `{"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":-1}`,
			field:  "purchasePrice",
			wantVI: "Giá mua không hợp lệ",
			wantEN: "Invalid purchase price",
		},
		{
			name:   "half-recorded sale (date without price)",
			body:   `{"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,"soldAt":"2026-03-01"}`,
			field:  "soldPrice",
			wantVI: "Thiếu giá bán",
			wantEN: "Missing sale price",
		},
		{
			name:   "return window out of range",
			body:   `{"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,"returnWindowDays":3651}`,
			field:  "returnWindowDays",
			wantVI: fmt.Sprintf("Số ngày đổi trả phải từ %d tới %d", services.ReturnWindowDaysMin, services.ReturnWindowDaysMax),
			wantEN: fmt.Sprintf("The return window must be between %d and %d days", services.ReturnWindowDaysMin, services.ReturnWindowDaysMax),
		},
		{
			name:   "unparseable purchase date",
			body:   `{"name":"Máy","category":"PHONE","purchaseDate":"15/01/2026","purchasePrice":1000}`,
			field:  "purchaseDate",
			wantVI: "Ngày mua không hợp lệ",
			wantEN: "Invalid purchase date",
		},
		{
			name:   "invalid status",
			body:   `{"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000,"status":"BÁN"}`,
			field:  "status",
			wantVI: "Trạng thái không hợp lệ",
			wantEN: "Invalid status",
		},
		{
			// The category catalog is load-bearing for writes, and its failure is a
			// separate error type (CATEGORY_INVALID) with its own keyed headline.
			name:      "unknown category code",
			body:      `{"name":"Máy","category":"NOT_A_CATEGORY","purchaseDate":"2026-01-15","purchasePrice":1000}`,
			field:     "category",
			wantVI:    "Loại thiết bị không hợp lệ",
			wantEN:    "Invalid device category",
			wantMsgVI: "Loại thiết bị không hợp lệ",
			wantMsgEN: "Invalid device category",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Vietnamese, pinned with ?lang=vi — level 1, which outranks everything.
			rrVI := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "", tc.body)
			if rrVI.Code != http.StatusBadRequest {
				t.Fatalf("?lang=vi status = %d, want 400 (%s)", rrVI.Code, rrVI.Body.String())
			}
			bodyVI := decodeResponse(t, rrVI)
			if got := firstFieldError(t, bodyVI, tc.field); got != tc.wantVI {
				t.Errorf("?lang=vi fieldErrors.%s = %q, want %q", tc.field, got, tc.wantVI)
			}

			// English, pinned with Accept-Language — level 2, the mechanism a real
			// client uses. Asserting through a DIFFERENT level than the Vietnamese
			// case is deliberate: it proves both levels reach the service, not just
			// the query parameter.
			rrEN := env.do(t, http.MethodPost, "/api/v1/devices", "en-US,en;q=0.9", tc.body)
			if rrEN.Code != http.StatusBadRequest {
				t.Fatalf("Accept-Language en status = %d, want 400 (%s)", rrEN.Code, rrEN.Body.String())
			}
			bodyEN := decodeResponse(t, rrEN)
			if got := firstFieldError(t, bodyEN, tc.field); got != tc.wantEN {
				t.Errorf("Accept-Language en fieldErrors.%s = %q, want %q", tc.field, got, tc.wantEN)
			}

			// The headline must MOVE with the language. A response whose
			// fieldErrors are English while its headline is Vietnamese is exactly
			// the half-translated envelope this test exists to catch. Most cases
			// get the generic "invalid input" sentence — not a field-specific one,
			// because this failure can report several fields — and the two probes
			// that raise their own keyed error name it.
			wantMsgVI, wantMsgEN := tc.wantMsgVI, tc.wantMsgEN
			if wantMsgVI == "" {
				wantMsgVI, wantMsgEN = "Dữ liệu không hợp lệ", "Invalid input"
			}
			if bodyVI["message"] != wantMsgVI {
				t.Errorf("?lang=vi message = %v, want %q", bodyVI["message"], wantMsgVI)
			}
			if bodyEN["message"] != wantMsgEN {
				t.Errorf("Accept-Language en message = %v, want %q", bodyEN["message"], wantMsgEN)
			}

			// The machine-readable parts do not move with the language.
			if bodyVI["error"] != bodyEN["error"] {
				t.Errorf("error codes differ by language: %v vs %v", bodyVI["error"], bodyEN["error"])
			}
		})
	}
}

// ── 2. The devices ceiling, both languages ──────────────────────────────────

// The refusal users hit most often. Seeded straight into the table (50 rows
// through the service would test the seed, not the ceiling), then asked for in
// both languages over the real HTTP surface.
//
// The English is read aloud rather than substituted word for word
// (docs/I18N_PLAN.md §4.4): "Đã đạt giới hạn 50 thiết bị chưa bán" is "You have
// reached the limit of 50 unsold devices", and the second sentence has to keep
// carrying the one actionable fact — that marking a device SOLD frees a slot.
func TestDeviceLimitMessageIsTranslated(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect scratch: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	const userID = "zz_test_dev_limit_i18n"
	insertUser(t, pool, userID, "dev-limit-i18n@example.invalid", hash)
	deleteUsers(t, pool, userID)
	issued, err := auth.IssueToken(context.Background(), pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	// 50 ACTIVE devices: the active ceiling, not the storage one.
	if _, err := pool.Exec(context.Background(), fmt.Sprintf(`
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		SELECT 'lim' || g::text, $1, 'Máy ' || g::text, 'PHONE', '2025-01-01', 1000000, 'ACTIVE', NOW()
		FROM generate_series(1, %d) AS g`, services.MaxDevicesPerUser), userID); err != nil {
		t.Fatalf("seed devices: %v", err)
	}

	mux := http.NewServeMux()
	RegisterDevices(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	post := func(path string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, path,
			bytes.NewReader([]byte(`{"name":"Máy mới","category":"PHONE","purchaseDate":"2026-06-01","purchasePrice":5000000}`)))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+issued.AccessToken)
		rr := httptest.NewRecorder()
		i18n.Middleware(mux).ServeHTTP(rr, req)
		return rr
	}

	rrVI := post("/api/v1/devices?lang=vi")
	if rrVI.Code != http.StatusConflict {
		t.Fatalf("?lang=vi at the ceiling = %d, want 409 (%s)", rrVI.Code, rrVI.Body.String())
	}
	bodyVI := decodeResponse(t, rrVI)
	msgVI, _ := bodyVI["message"].(string)
	for _, want := range []string{"Đã đạt giới hạn 50 thiết bị chưa bán", "không chiếm suất", "Đã bán"} {
		if !strings.Contains(msgVI, want) {
			t.Errorf("?lang=vi message %q must contain %q", msgVI, want)
		}
	}
	if strings.Contains(msgVI, "%!") {
		t.Errorf("?lang=vi message %q contains a Sprintf error — an argument list that does not match the verbs", msgVI)
	}

	rrEN := post("/api/v1/devices?lang=en")
	if rrEN.Code != http.StatusConflict {
		t.Fatalf("?lang=en at the ceiling = %d, want 409 (%s)", rrEN.Code, rrEN.Body.String())
	}
	bodyEN := decodeResponse(t, rrEN)
	msgEN, _ := bodyEN["message"].(string)
	for _, want := range []string{"You have reached the limit of 50 unsold devices", "marked as sold", "do not count"} {
		if !strings.Contains(msgEN, want) {
			t.Errorf("?lang=en message %q must contain %q", msgEN, want)
		}
	}
	if strings.Contains(msgEN, "%!") {
		t.Errorf("?lang=en message %q contains a Sprintf error", msgEN)
	}
	if strings.Contains(msgEN, "thiết bị") || strings.Contains(msgEN, "Đã bán") {
		t.Errorf("?lang=en message %q still contains Vietnamese copy", msgEN)
	}

	// 409 in both languages, and the same code: only the wording may move.
	if bodyVI["error"] != "limit_reached" || bodyEN["error"] != "limit_reached" {
		t.Errorf("error codes = %v / %v, want limit_reached in both", bodyVI["error"], bodyEN["error"])
	}

	// The STORAGE ceiling is a DIFFERENT key with a different sentence (it counts
	// sold devices too), so it is driven separately rather than assumed to follow.
	//
	// It cannot be reached through POST /devices at all: every create adds exactly
	// one row on top of an account that is at 499, which is the ceiling, not past
	// it. The path that can exceed it in one step is the backup importer, which
	// shares enforceDeviceQuota with CreateDevice — so it is driven as a service,
	// with the language pinned on the CONTEXT because there is no HTTP request to
	// carry `?lang=`.
	const storageUser = "zz_test_dev_storage_i18n"
	insertUser(t, pool, storageUser, "dev-storage-i18n@example.invalid", hash)
	deleteUsers(t, pool, storageUser)
	if _, err := pool.Exec(context.Background(), fmt.Sprintf(`
		INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		SELECT 'sto' || g::text, $1, 'Máy ' || g::text, 'PHONE', '2025-01-01', 1000000, 'SOLD', NOW()
		FROM generate_series(1, %d) AS g`, services.MaxDevicesTotalPerUser-1), storageUser); err != nil {
		t.Fatalf("seed storage-ceiling devices: %v", err)
	}

	for _, tc := range []struct {
		lang string
		want string
	}{
		{"vi", "Đã đạt giới hạn 500 thiết bị lưu trữ (tính cả thiết bị đã bán). Xoá bớt hồ sơ cũ rồi thử lại."},
		{"en", "You have reached the 500-device storage limit (sold devices included). Delete some older records and try again."},
	} {
		t.Run("storage ceiling "+tc.lang, func(t *testing.T) {
			ctx := i18n.WithTag(context.Background(), i18n.Tag(tc.lang))
			_, err := services.ImportBackup(ctx, pool, storageUser, &services.BackupExport{
				Version: services.MetadataOnlyBackupVersion,
				Devices: []services.BackupDevice{
					soldDeviceFixture("over_1"),
					soldDeviceFixture("over_2"),
				},
			}, services.ImportMerge)
			if err == nil {
				t.Fatalf("?lang=%s: an import to 501 stored devices must be refused", tc.lang)
			}
			if err.Error() != tc.want {
				t.Errorf("?lang=%s storage-ceiling message = %q, want %q", tc.lang, err.Error(), tc.want)
			}
			if svc, ok := services.As(err); !ok || svc.Code != "LIMIT_REACHED" {
				t.Errorf("?lang=%s code = %v, want LIMIT_REACHED", tc.lang, err)
			}
		})
	}
}

// soldDeviceFixture is one SOLD backup device, the shape that counts toward the
// storage ceiling but not the active one.
func soldDeviceFixture(id string) services.BackupDevice {
	return services.BackupDevice{
		ID: id, Name: "Máy cũ", Category: "PHONE",
		PurchaseDate: "2025-01-01T00:00:00Z", PurchasePrice: 1000, Status: "SOLD",
		CreatedAt: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z",
	}
}

// ── 3. Warranty copy, both languages ────────────────────────────────────────

// The warranties slice shares the device error writer, so its field errors have to
// move for the same reason: the web device form renders them in the same panel as
// the device fields.
func TestWarrantyValidationErrorIsTranslated(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	// A device to hang the warranty off, created with the language pinned so this
	// fixture cannot depend on the default.
	created := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "",
		`{"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000000}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create device = %d (%s)", created.Code, created.Body.String())
	}
	var createdBody struct {
		Device struct {
			ID string `json:"id"`
		} `json:"device"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createdBody); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	deviceID := createdBody.Device.ID
	if deviceID == "" {
		t.Fatal("create returned no device id")
	}

	for _, tc := range []struct {
		name   string
		body   string
		field  string
		wantVI string
		wantEN string
	}{
		{
			name:   "invalid type",
			body:   `{"type":"NOPE","startDate":"2026-01-15","months":12}`,
			field:  "type",
			wantVI: "Loại bảo hành không hợp lệ",
			wantEN: "Invalid warranty type",
		},
		{
			name:   "missing start date",
			body:   `{"type":"STANDARD","startDate":"","months":12}`,
			field:  "startDate",
			wantVI: "Ngày bắt đầu bắt buộc",
			wantEN: "Start date is required",
		},
		{
			name:   "zero months",
			body:   `{"type":"STANDARD","startDate":"2026-01-15","months":0}`,
			field:  "months",
			wantVI: "Số tháng bảo hành >= 1",
			wantEN: "Warranty length must be at least 1 month",
		},
		{
			name:   "negative cost",
			body:   `{"type":"STANDARD","startDate":"2026-01-15","months":12,"cost":-5}`,
			field:  "cost",
			wantVI: "Chi phí không hợp lệ",
			wantEN: "Invalid cost",
		},
		{
			name:   "unparseable start date",
			body:   `{"type":"STANDARD","startDate":"15/01/2026","months":12}`,
			field:  "startDate",
			wantVI: "Ngày bắt đầu không hợp lệ",
			wantEN: "Invalid start date",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := "/api/v1/devices/" + deviceID + "/warranties"
			rrVI := env.do(t, http.MethodPost, path+"?lang=vi", "", tc.body)
			if rrVI.Code != http.StatusBadRequest {
				t.Fatalf("?lang=vi = %d, want 400 (%s)", rrVI.Code, rrVI.Body.String())
			}
			if got := firstFieldError(t, decodeResponse(t, rrVI), tc.field); got != tc.wantVI {
				t.Errorf("?lang=vi fieldErrors.%s = %q, want %q", tc.field, got, tc.wantVI)
			}

			rrEN := env.do(t, http.MethodPost, path, "en", tc.body)
			if rrEN.Code != http.StatusBadRequest {
				t.Fatalf("Accept-Language en = %d, want 400 (%s)", rrEN.Code, rrEN.Body.String())
			}
			if got := firstFieldError(t, decodeResponse(t, rrEN), tc.field); got != tc.wantEN {
				t.Errorf("Accept-Language en fieldErrors.%s = %q, want %q", tc.field, got, tc.wantEN)
			}
		})
	}
}

// ── 4. Not-found copy, both languages ───────────────────────────────────────

// The NOT_FOUND path takes a different branch of the error writer — a keyed
// ErrNotFound rather than a validation map with per-field messages — so it is
// pinned separately: a change that translated field errors but forgot to render
// MessageKey would leave exactly this branch Vietnamese.
func TestDeviceNotFoundIsTranslated(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	for _, tc := range []struct {
		name   string
		method string
		path   string
		want   string
	}{
		{"device, vi", http.MethodGet, "/api/v1/devices/does-not-exist?lang=vi", "Không tìm thấy thiết bị"},
		{"device, en", http.MethodGet, "/api/v1/devices/does-not-exist?lang=en", "Device not found"},
		// A well-formed path with no matching route would be a 405 from ServeMux
		// before the handler runs, so both of these are the REAL routes with a
		// non-empty id: the device exists check inside the service is what fails.
		{"warranty, vi", http.MethodPatch, "/api/v1/warranties/does-not-exist?lang=vi", "Không tìm thấy gói bảo hành"},
		{"warranty, en", http.MethodPatch, "/api/v1/warranties/does-not-exist?lang=en", "Warranty not found"},
		// The reminder routes share the same NOT_FOUND copy for a warranty that is
		// not the caller's.
		{"reminder, vi", http.MethodDelete, "/api/v1/warranties/does-not-exist/reminder?lang=vi", "Không tìm thấy gói bảo hành"},
		{"reminder, en", http.MethodDelete, "/api/v1/warranties/does-not-exist/reminder?lang=en", "Warranty not found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := `{"type":"STANDARD","startDate":"2026-01-15","months":12}`
			if tc.method == http.MethodDelete {
				body = ""
			}
			rr := env.do(t, tc.method, tc.path, "", body)
			if rr.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404 (%s)", rr.Code, rr.Body.String())
			}
			resp := decodeResponse(t, rr)
			if resp["message"] != tc.want {
				t.Errorf("message = %v, want %q", resp["message"], tc.want)
			}
			if resp["error"] != "not_found" {
				t.Errorf("error = %v, want %q", resp["error"], "not_found")
			}
		})
	}
}

// ── 5. The whole response is translated, not just its headline ──────────────

// Phase 0's catalog scan, applied to the devices slice. A missing catalog entry
// degrades to the Vietnamese source text (by design), so nothing FAILS when one is
// missing — the string just ships untranslated. Comparing the same request in both
// languages is what makes that visible: any string that comes back identical is
// either not in the catalog or a legitimate identity translation, and the second
// list is deliberately explicit rather than a blanket exception.
func TestDevicesSliceCopyIsInTheCatalog(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	created := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "",
		`{"name":"Máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":1000000}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create device = %d (%s)", created.Code, created.Body.String())
	}
	var createdBody struct {
		Device struct {
			ID string `json:"id"`
		} `json:"device"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createdBody); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	deviceID := createdBody.Device.ID

	scan := func(rr *httptest.ResponseRecorder) map[string]string {
		t.Helper()
		out := map[string]string{}
		// join builds a JSON path without a leading dot, so the top-level keys are
		// "message" / "fieldErrors" rather than ".message".
		join := func(prefix, key string) string {
			if prefix == "" {
				return key
			}
			return prefix + "." + key
		}
		var walk func(prefix string, v any)
		walk = func(prefix string, v any) {
			switch val := v.(type) {
			case string:
				// Only the COPY is under test. Everything else is either a
				// machine-readable code (`error`, a warning's `code`/`field`) or the
				// resource the endpoint returned (a device's name, a category code,
				// an id, a timestamp) — none of which is translated, and all of which
				// is legitimately identical in two responses.
				switch {
				case prefix == "message":
					out[prefix] = val
				case strings.HasPrefix(prefix, "fieldErrors."):
					out[prefix] = val
				case strings.HasPrefix(prefix, "warnings[") && strings.HasSuffix(prefix, ".message"):
					out[prefix] = val
				}
			case map[string]any:
				for k, sub := range val {
					walk(join(prefix, k), sub)
				}
			case []any:
				for i, sub := range val {
					walk(fmt.Sprintf("%s[%d]", prefix, i), sub)
				}
			}
		}
		var body map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode %s: %v", rr.Body.String(), err)
		}
		walk("", body)
		return out
	}

	requestSet := []struct {
		name string
		call func(lang string) *httptest.ResponseRecorder
	}{
		{"device validation", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodPost, "/api/v1/devices?lang="+lang, "",
				`{"name":"","category":"","purchaseDate":"","purchasePrice":-1,"returnWindowDays":99999}`)
		}},
		{"device not found", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodGet, "/api/v1/devices/nope?lang="+lang, "", "")
		}},
		{"warranty not found", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodDelete, "/api/v1/warranties/nope?lang="+lang, "", "")
		}},
		{"warranty validation", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodPost,
				"/api/v1/devices/"+deviceID+"/warranties?lang="+lang, "",
				`{"type":"","startDate":"","months":0,"cost":-1}`)
		}},
		{"create with a suspicious IMEI", func(lang string) *httptest.ResponseRecorder {
			// 201, not an error: the serial/IMEI advisories ride on the SUCCESS
			// response, so this is the probe that covers `warnings[].message` — the
			// strings most easily forgotten, because they are not in an envelope.
			return env.do(t, http.MethodPost, "/api/v1/devices?lang="+lang, "",
				`{"name":"Máy cảnh báo","category":"PHONE","purchaseDate":"2026-01-15",`+
					`"purchasePrice":1000000,"serialNumber":"356938035643808"}`)
		}},
	}

	for _, req := range requestSet {
		t.Run(req.name, func(t *testing.T) {
			vi := scan(req.call("vi"))
			en := scan(req.call("en"))
			if len(vi) == 0 {
				t.Fatalf("the Vietnamese probe produced no strings")
			}
			for path, v := range vi {
				english, ok := en[path]
				if !ok {
					t.Errorf("%s: missing from the English response", path)
					continue
				}
				if v == english {
					if _, known := allowedIdenticalDeviceTranslations[path]; known {
						continue
					}
					t.Errorf("%s is identical in both languages (%q) — most likely the key is not in the catalog, so English got the Vietnamese fallback", path, v)
				}
			}
		})
	}
}

// allowedIdenticalDeviceTranslations lists the JSON paths whose two renderings are
// legitimately the same string.
//
// It is EMPTY, and that is a claim rather than a placeholder: every string this
// slice puts in front of a user has a distinct English rendering, including the
// generic `message` headline (ErrValidationHeadline keys it for the converted
// validators). An entry here means "this string is deliberately the same in both
// languages"; the mechanism exists so that adding one is a reviewable decision
// rather than a blanket exception, not so that failures can be silenced. The
// out-of-scope domains DO have such strings — `"Required"` is one — which is why
// the same map is non-empty next to the auth slice in auth_i18n_test.go.
var allowedIdenticalDeviceTranslations = map[string]struct{}{}
