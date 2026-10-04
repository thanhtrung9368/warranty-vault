package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Wave 4's proof of the i18n pattern over HTTP, on the slice this wave converted:
// AI receipt extraction, shares (including the PUBLIC certificate page), search and
// the service directory (docs/I18N_PLAN.md §3).
//
// What each test is for, and why the assertions are written the way they are:
//
//  1. `message` AND `fieldErrors` move together, in both languages. The `limit`
//     refusal on /search is the case that carries both, and an English headline
//     above a Vietnamese per-field hint is worse than an untranslated response.
//  2. The PUBLIC CERTIFICATE is the one document in this service with no
//     authenticated user behind it, so it is the only place where "which language?"
//     is a product decision rather than a lookup. It is asserted in BOTH languages,
//     including the <html lang> attribute, the dates and the footer note — and the
//     four failure cases are asserted to be byte-identical WITHIN each language,
//     which is the property that keeps the route from being an enumeration oracle.
//  3. The AI refusals prove the two packages with no request context still render
//     in the request's language: internal/files (called DIRECTLY by the AI handler,
//     not through a service) and internal/ai (whose messages arrive via
//     services.mapAIError). The one internal/ai message that carries an upstream
//     status code is deliberately NOT translated, and that is asserted too.
//  4. The error CODE and the HTTP status never move with the language.
//
// Every case pins its language explicitly (`?lang=`), and the raw bodies are logged
// so a run with -v shows exactly what a client receives.
//
// Each DB-backed test gets its own scratch database, like every other DB-backed
// handler test (testDatabaseURL → newScratchDatabaseDSN), and drops it afterwards.

const wave4Device = "zz_test_wave4_dev"

type wave4Env struct {
	mux    *http.ServeMux
	token  string
	pool   *pgxpool.Pool
	userID string
}

// setupWave4Env builds one mux carrying every endpoint this wave converted, with
// the AI client DISABLED (Deps.AI nil). One fixture serves all four domains, which
// is also the point: they were converted in the same wave and have to agree on the
// language rules. The disabled client is what makes the `feature_disabled` branch
// reachable without a key, a model or a network call.
func setupWave4Env(t *testing.T) *wave4Env {
	t.Helper()
	return setupWave4Mux(t, nil)
}

// setupWave4EnvWithAI is setupWave4Env with a CONFIGURED — but never called — AI
// client.
//
// `ai.NewFromEnv` only needs an API key to report Enabled()==true, and every case
// that uses this fixture is refused by the handler's own gates (the Content-Type
// switch, then ai.IsSupportedReceiptType) long before any request could be sent.
// No test in this file reaches the network, and no endpoint here is pointed at a
// live model. Tests that need the disabled branch use setupWave4Env instead.
func setupWave4EnvWithAI(t *testing.T) *wave4Env {
	t.Helper()
	t.Setenv("ANTHROPIC_API_KEY", "test-key-never-used")
	return setupWave4Mux(t, ai.NewFromEnv())
}

func setupWave4Mux(t *testing.T, aiClient *ai.Client) *wave4Env {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect scratch: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	const userID = "zz_test_wave4_user"
	insertUser(t, pool, userID, "wave4@example.invalid", hash)
	deleteUsers(t, pool, userID)

	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, brand, "serialNumber",
		                       "purchaseDate", "purchasePrice", "purchasePlace", status, "updatedAt")
		 VALUES ($1, $2, 'iPhone 15 Pro', 'PHONE', 'Apple', '356938035643809',
		         '2024-11-20', 28990000, 'FPT Shop', 'SOLD', NOW())`, wave4Device, userID); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Warranty" (id, "deviceId", type, provider, "startDate", "endDate", months, cost,
		                        address, phone, "updatedAt")
		 VALUES ('zz_test_wave4_war', $1, 'STANDARD', 'Trung tâm bảo hành Apple uỷ quyền',
		         '2024-11-20', '2026-11-20', 24, 2500000, 'Số 1 Lê Duẩn, Q.1', '028 3822 9999', NOW())`,
		wave4Device); err != nil {
		t.Fatalf("insert warranty: %v", err)
	}

	issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	mux := http.NewServeMux()
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}, AI: aiClient}
	RegisterAI(mux, deps)
	RegisterShares(mux, deps)
	RegisterSearch(mux, deps)
	RegisterDirectory(mux, deps)
	return &wave4Env{mux: mux, token: issued.AccessToken, pool: pool, userID: userID}
}

// do issues one authenticated request with the language pinned by `?lang=`. The
// handlers call i18n.Attach themselves, so no middleware is needed — the mux here
// is the same shape the tests have always built.
func (e *wave4Env) do(t *testing.T, method, path, contentType string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer "+e.token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rr := httptest.NewRecorder()
	e.mux.ServeHTTP(rr, req)
	return rr
}

// envelope decodes an error response and logs its RAW body, so a run with -v shows
// exactly what a client receives in each language.
func wave4Envelope(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	t.Logf("HTTP %d %s", rr.Code, strings.TrimSpace(rr.Body.String()))
	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode envelope %q: %v", rr.Body.String(), err)
	}
	return out
}

func wave4FieldErrors(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	fields, ok := body["fieldErrors"].(map[string]any)
	if !ok {
		t.Fatalf("fieldErrors = %v, want an object", body["fieldErrors"])
	}
	return fields
}

// ── 1. one message + one fieldErrors entry, both languages ───────────────────

// GET /api/v1/search?limit=abc is the case that carries BOTH halves of an error
// envelope, so it is the one that proves they move together. The `limit` field
// message is a printf-shaped sentence ("… from 1 to 50") and the headline is a
// separate key — the two must be in the same language, and the wire code
// (`bad_input`) must be the same in both.
func TestSearchLimitRefusalCarriesBothHalvesInBothLanguages(t *testing.T) {
	env := setupWave4Env(t)

	for _, tc := range []struct {
		lang      string
		wantMsg   string
		wantField string
		wantCode  string
	}{
		{"vi",
			"Tham số limit không hợp lệ",
			"Phải là số nguyên từ 1 tới 50",
			"bad_input"},
		{"en",
			"Invalid limit parameter",
			"Must be an integer from 1 to 50",
			"bad_input"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			for _, bad := range []string{"abc", "0", "51", "-3"} {
				rr := env.do(t, http.MethodGet, "/api/v1/search?limit="+bad+"&lang="+tc.lang, "", nil)
				if rr.Code != http.StatusBadRequest {
					t.Fatalf("limit=%s status = %d, want 400 (%s)", bad, rr.Code, rr.Body.String())
				}
				body := wave4Envelope(t, rr)
				if body["error"] != tc.wantCode {
					t.Errorf("limit=%s error = %v, want %q — the code is contract and does not move with the language",
						bad, body["error"], tc.wantCode)
				}
				if body["message"] != tc.wantMsg {
					t.Errorf("limit=%s message = %v, want %q", bad, body["message"], tc.wantMsg)
				}
				fields := wave4FieldErrors(t, body)
				got, ok := fields["limit"].([]any)
				if !ok || len(got) != 1 || got[0] != tc.wantField {
					t.Errorf("limit=%s fieldErrors.limit = %v, want [%q]", bad, fields["limit"], tc.wantField)
				}
			}
		})
	}
}

// The service-owned refusal: `services.Search` builds the error (with no
// MessageKey — see its comment), so this proves the ctx reaches the service and
// that the rendering happens there. It also proves the CODE and the status do not
// follow the language.
func TestSearchOverlongQueryIsTranslated(t *testing.T) {
	env := setupWave4Env(t)
	long := strings.Repeat("a", services.MaxSearchQueryRunes+1)

	for _, tc := range []struct {
		lang     string
		wantMsg  string
		wantCode string
	}{
		{"vi", fmt.Sprintf("Từ khoá tìm kiếm quá dài (tối đa %d ký tự)", services.MaxSearchQueryRunes), "validation"},
		{"en", fmt.Sprintf("The search query is too long (at most %d characters)", services.MaxSearchQueryRunes), "validation"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := env.do(t, http.MethodGet, "/api/v1/search?q="+long+"&lang="+tc.lang, "", nil)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := wave4Envelope(t, rr)
			if body["error"] != tc.wantCode {
				t.Errorf("error = %v, want %q", body["error"], tc.wantCode)
			}
			if body["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMsg)
			}
		})
	}

	// A BLANK query is still a 200 with empty groups in both languages. The
	// conversion must not have turned "the search box was cleared" into an error.
	for _, lang := range []string{"vi", "en"} {
		rr := env.do(t, http.MethodGet, "/api/v1/search?q=&lang="+lang, "", nil)
		if rr.Code != http.StatusOK {
			t.Errorf("blank q (%s) = %d, want 200 (%s)", lang, rr.Code, rr.Body.String())
		}
	}
}

// ── 2. the service directory: a service-owned sentence, both languages ───────

// The disclaimer is the reason the response has so many nulls, and it is rendered
// by `services.BuildServiceDirectory` from a named constant (which is also the
// catalog key). This is the HTTP proof that the constant and the catalog entry
// agree, in both languages, and that the user's own text is untouched by either.
func TestDirectoryDisclaimerIsTranslated(t *testing.T) {
	env := setupWave4Env(t)

	for _, tc := range []struct {
		lang         string
		wantContains string
		wantNot      string
	}{
		{"vi", "App không lưu sẵn hotline", "The app does not ship hotlines"},
		{"en", "The app does not ship hotlines", "App không lưu sẵn hotline"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := env.do(t, http.MethodGet, "/api/v1/devices/"+wave4Device+"/service-directory?lang="+tc.lang, "", nil)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			var body struct {
				Directory services.ServiceDirectory `json:"directory"`
			}
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode directory: %v", err)
			}
			t.Logf("disclaimer = %q", body.Directory.Disclaimer)
			if !strings.Contains(body.Directory.Disclaimer, tc.wantContains) {
				t.Errorf("disclaimer = %q, want it to contain %q", body.Directory.Disclaimer, tc.wantContains)
			}
			if strings.Contains(body.Directory.Disclaimer, tc.wantNot) {
				t.Errorf("disclaimer = %q still contains the other language's copy %q", body.Directory.Disclaimer, tc.wantNot)
			}
			// What the USER typed is not copy and must not be translated.
			if body.Directory.BrandInput == nil || *body.Directory.BrandInput != "Apple" {
				t.Errorf("brandInput = %v, want the user's own text", body.Directory.BrandInput)
			}
		})
	}
}

// ── 3. AI: the two packages with no request context ─────────────────────────

// The refusals the AI handler owns. `feature_disabled` is reachable from BOTH the
// handler (no client configured) and the service, and both render the same catalog
// key, so the two paths cannot drift into two sentences.
// Two DIFFERENT fixtures, because the two `feature_disabled` cases and the two
// request-shape cases reach opposite sides of the same gate: with no client
// configured the handler refuses before it looks at the body at all, and with one
// configured the body is the thing under test.
func TestAIRefusalsAreTranslated(t *testing.T) {
	disabled := setupWave4Env(t)
	enabled := setupWave4EnvWithAI(t)

	for _, tc := range []struct {
		name     string
		lang     string
		method   string
		path     string
		ctype    string
		body     []byte
		wantCode string
		wantMsg  string
		env      *wave4Env
	}{
		{
			name: "feature disabled, vi", lang: "vi",
			method: http.MethodPost, path: "/api/v1/ai/extract-receipt?lang=vi",
			ctype: "application/json", body: []byte(`{"attachmentId":"whatever"}`),
			wantCode: "feature_disabled", wantMsg: "Tính năng quét hoá đơn chưa được bật",
			env: disabled,
		},
		{
			name: "feature disabled, en", lang: "en",
			method: http.MethodPost, path: "/api/v1/ai/extract-receipt?lang=en",
			ctype: "application/json", body: []byte(`{"attachmentId":"whatever"}`),
			wantCode: "feature_disabled", wantMsg: "Receipt scanning is not enabled",
			env: disabled,
		},
		{
			name: "wrong content type, vi", lang: "vi",
			method: http.MethodPost, path: "/api/v1/ai/extract-receipt?lang=vi",
			ctype: "text/plain", body: []byte("x"),
			wantCode: "bad_input", wantMsg: "Content-Type phải là application/json hoặc multipart/form-data",
			env: enabled,
		},
		{
			name: "wrong content type, en", lang: "en",
			method: http.MethodPost, path: "/api/v1/ai/extract-receipt?lang=en",
			ctype: "text/plain", body: []byte("x"),
			wantCode: "bad_input", wantMsg: "Content-Type must be application/json or multipart/form-data",
			env: enabled,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Neither branch reads the database: the feature gate is checked first,
			// and the Content-Type switch is second. The attachment id in the JSON
			// cases is never resolved.
			rr := tc.env.do(t, tc.method, tc.path, tc.ctype, tc.body)
			if rr.Code == http.StatusOK {
				t.Fatalf("status = 200, want a refusal (%s)", rr.Body.String())
			}
			body := wave4Envelope(t, rr)
			if body["error"] != tc.wantCode {
				t.Errorf("error = %v, want %q", body["error"], tc.wantCode)
			}
			if body["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMsg)
			}
		})
	}
}

// The AI multipart branch calls `files.DetectAndValidate` DIRECTLY — no service sits
// between the two, so this is where the wave-3 "files' own text is the catalog key"
// arrangement has to be applied by the handler. A GIF is the sharpest case: internal
// files ACCEPTS image/gif (attachments store it fine) and it is the AI gate
// (`ai.IsSupportedReceiptType`) that refuses it, so the sentence below is the AI
// domain's own copy rather than a MIME whitelist message.
func TestAIMultipartTypeRefusalIsTranslated(t *testing.T) {
	env := setupWave4EnvWithAI(t)

	for _, tc := range []struct {
		lang    string
		wantMsg string
	}{
		{"vi", "Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF"},
		{"en", "Only JPEG, PNG, WEBP images or PDF files are supported"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := postWave4Multipart(t, env, "/api/v1/ai/extract-receipt?lang="+tc.lang, "hoa-don.gif", "image/gif", []byte("GIF89a not really"))
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := wave4Envelope(t, rr)
			if body["error"] != "bad_input" {
				t.Errorf("error = %v, want bad_input", body["error"])
			}
			if body["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMsg)
			}
		})
	}
}

// A type internal/files itself refuses. The message is produced by a package with
// no request context and travels through the handler as its own catalog key; if the
// handler had passed `verr.Error()` through untranslated, the `en` case below would
// fail. (The attachments endpoint covers the SERVICE-side variant of this in
// backup_i18n_test.go — two call sites, two different ways in, one catalog.)
func TestAIDirectFilesRefusalIsTranslated(t *testing.T) {
	env := setupWave4EnvWithAI(t)

	for _, tc := range []struct {
		lang    string
		wantMsg string
	}{
		{"vi", "Chỉ chấp nhận JPG/PNG/WEBP/GIF/HEIC hoặc PDF"},
		{"en", "Only JPG/PNG/WEBP/GIF/HEIC or PDF files are accepted"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := postWave4Multipart(t, env, "/api/v1/ai/extract-receipt?lang="+tc.lang, "notes.txt", "text/plain", []byte("just some text"))
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := wave4Envelope(t, rr)
			if body["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMsg)
			}
		})
	}
}

// postWave4Multipart posts one form-data file. The part carries an explicit
// Content-Type because the upload path compares it against the magic bytes.
func postWave4Multipart(t *testing.T, env *wave4Env, path, filename, contentType string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	header.Set("Content-Type", contentType)
	part, err := mw.CreatePart(header)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(buf.Bytes()))
	req.Header.Set("Authorization", "Bearer "+env.token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	return rr
}
