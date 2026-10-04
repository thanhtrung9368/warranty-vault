package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// Phase 0's proof of the i18n pattern, over HTTP, on the auth slice
// (docs/I18N_PLAN.md §3). What this file pins, and why each one matters:
//
//  1. `Accept-Language` reaches a handler and changes the response — the whole
//     point of the header-parsing work;
//  2. `fieldErrors` are translated, not just `message` — they are what the web
//     forms actually render, and a half-translated envelope is worse than none;
//  3. the precedence order holds end to end, including the stored preference
//     (level 3), which is only reachable through a real bearer token;
//  4. an unsupported language is a FALLBACK, never a 400;
//  5. `PATCH /auth/me` round-trips `locale`, and an absent `locale` key leaves the
//     stored preference alone — the compatibility guarantee for every client that
//     does not know the field exists.
//
// Everything asserts BOTH languages rather than one, so no case can pass because
// of the machine's locale.

// authI18nEnv is a migrated scratch database plus a mux wired the way the server
// wires it: the i18n middleware outermost, then auth.RequireUser for the
// authenticated routes. Wiring it here rather than calling handlers directly is
// deliberate — the middleware IS part of what is under test.
type authI18nEnv struct {
	pool   *pgxpool.Pool
	mux    *http.ServeMux
	userID string
	token  string
}

func setupAuthI18nEnv(t *testing.T) *authI18nEnv {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, err := auth.Hash("MatKhau12345")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	const userID = "zz_test_i18n_user"
	insertUser(t, pool, userID, "i18n@example.invalid", hash)
	deleteUsers(t, pool, userID)

	issued, err := auth.IssueToken(context.Background(), pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/auth/login", Login(deps))
	mux.HandleFunc("GET /api/v1/auth/me", Me(deps))
	RegisterProfile(mux, deps)

	return &authI18nEnv{pool: pool, mux: mux, userID: userID, token: issued.AccessToken}
}

// do issues one request through the full middleware chain.
func (e *authI18nEnv) do(t *testing.T, method, path, bearer string, body any, acceptLanguage string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if acceptLanguage != "" {
		req.Header.Set("Accept-Language", acceptLanguage)
	}
	rr := httptest.NewRecorder()
	i18n.Middleware(e.mux).ServeHTTP(rr, req)
	return rr
}

func (e *authI18nEnv) patchProfile(t *testing.T, lang, acceptLanguage string, body map[string]any) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/v1/auth/me"
	if lang != "" {
		path += "?lang=" + lang
	}
	return e.do(t, http.MethodPatch, path, e.token, body, acceptLanguage)
}

// storedLocale reads the column directly, so the tests assert what was PERSISTED
// rather than only what was echoed back.
func (e *authI18nEnv) storedLocale(t *testing.T) *string {
	t.Helper()
	var locale *string
	if err := e.pool.QueryRow(context.Background(),
		`SELECT locale FROM "User" WHERE id = $1`, e.userID).Scan(&locale); err != nil {
		t.Fatalf("read locale: %v", err)
	}
	return locale
}

// ── 1. Accept-Language reaches the handler ──────────────────────────────────

// One validation failure, two languages, on the same endpoint and the same body.
// Both `message` and `fieldErrors` must move together: the web forms render the
// field errors and would otherwise show Vietnamese help text under an English
// headline.
func TestLoginValidationErrorIsTranslated(t *testing.T) {
	env := setupAuthI18nEnv(t)
	badLogin := map[string]string{"email": "not-an-email", "password": "any-pass"}

	for _, tc := range []struct {
		name           string
		acceptLanguage string
		wantMessage    string
		wantFieldError string
	}{
		{
			name:           "Accept-Language: vi",
			acceptLanguage: "vi",
			wantMessage:    "Dữ liệu không hợp lệ",
			wantFieldError: "Email không hợp lệ",
		},
		{
			name:           "Accept-Language: en",
			acceptLanguage: "en-US,en;q=0.9",
			wantMessage:    "Invalid input",
			wantFieldError: "Invalid email address",
		},
		{
			// No header at all: the product default is English.
			name:           "no language signal",
			wantMessage:    "Invalid input",
			wantFieldError: "Invalid email address",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := env.do(t, http.MethodPost, "/api/v1/auth/login", "", badLogin, tc.acceptLanguage)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			var body struct {
				Error       string              `json:"error"`
				Message     string              `json:"message"`
				FieldErrors map[string][]string `json:"fieldErrors"`
			}
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode %s: %v", rr.Body.String(), err)
			}
			if body.Message != tc.wantMessage {
				t.Errorf("message = %q, want %q", body.Message, tc.wantMessage)
			}
			if got := body.FieldErrors["email"]; len(got) != 1 || got[0] != tc.wantFieldError {
				t.Errorf("fieldErrors.email = %v, want [%q]", got, tc.wantFieldError)
			}
			// The machine-readable code is language-independent and must not move.
			if body.Error != "bad_input" {
				t.Errorf("error = %q, want the stable code %q", body.Error, "bad_input")
			}
		})
	}
}

// Credentials that are simply wrong (not malformed) take a different branch, so
// pin that one too.
func TestLoginInvalidCredentialsIsTranslated(t *testing.T) {
	env := setupAuthI18nEnv(t)
	creds := map[string]string{"email": "i18n@example.invalid", "password": "wrong-password"}

	for _, tc := range []struct {
		acceptLanguage string
		want           string
	}{
		{"vi", "Email hoặc mật khẩu không đúng"},
		{"en", "Incorrect email or password"},
	} {
		rr := env.do(t, http.MethodPost, "/api/v1/auth/login", "", creds, tc.acceptLanguage)
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401 (%s)", rr.Code, rr.Body.String())
		}
		if msg := decodeBody(t, rr)["message"]; msg != tc.want {
			t.Errorf("Accept-Language %q → message %q, want %q", tc.acceptLanguage, msg, tc.want)
		}
	}
}

// ── 2. Precedence, end to end ───────────────────────────────────────────────

// Levels 1, 2 and 3, over HTTP, in one table.
//
// Level 3 needs an AUTHENTICATED request — the stored preference is only known
// once a bearer token has resolved — so the table uses two endpoints: `login`
// (unauthenticated) for levels 1-2 and `PATCH /auth/me` (authenticated) for level
// 3 and for every combination that has to beat it.
//
// One validation failure is used as the probe because it produces both a
// `message` and a `fieldErrors` entry, each of which is asserted to move
// together.
func TestLocalePrecedenceOverHTTP(t *testing.T) {
	env := setupAuthI18nEnv(t)

	// Store 'vi' so level 3 is a real, reachable level. The write itself asks for
	// English, so the value stored cannot be a side effect of what we assert.
	if rr := env.patchProfile(t, "en", "", map[string]any{"locale": "vi"}); rr.Code != http.StatusOK {
		t.Fatalf("seed locale = %d (%s)", rr.Code, rr.Body.String())
	}
	if got := env.storedLocale(t); got == nil || *got != "vi" {
		t.Fatalf("stored locale = %v, want \"vi\"", got)
	}

	const (
		viMessage = "Dữ liệu không hợp lệ"
		viField   = "Email không hợp lệ"
		enMessage = "Invalid input"
		enField   = "Invalid email address"
		// The authenticated probe is a body with neither accepted field, so its
		// fieldError lands on `displayName` rather than `email`.
		viNameField = "Thiếu displayName"
		enNameField = "Missing displayName"
	)

	for _, tc := range []struct {
		name           string
		auth           bool // true → PATCH /auth/me (goes through RequireUser)
		lang           string
		acceptLanguage string
		wantMessage    string
		wantField      string
		field          string // which fieldErrors key the probe produces
	}{
		{
			name: "1 — ?lang=en beats Accept-Language and the stored preference",
			auth: true, lang: "en", acceptLanguage: "vi",
			wantMessage: enMessage, wantField: enNameField, field: "displayName",
		},
		{
			name: "1 — ?lang=vi beats an English header",
			lang: "vi", acceptLanguage: "en-US,en;q=0.9",
			wantMessage: viMessage, wantField: viField, field: "email",
		},
		{
			name: "2 — Accept-Language beats the stored preference",
			auth: true, acceptLanguage: "en",
			wantMessage: enMessage, wantField: enNameField, field: "displayName",
		},
		{
			name:        "3 — the stored preference applies when nothing is asked",
			auth:        true,
			wantMessage: viMessage, wantField: viNameField, field: "displayName",
		},
		{
			name: "an unsupported ?lang falls through to the header",
			lang: "fr", acceptLanguage: "en",
			wantMessage: enMessage, wantField: enField, field: "email",
		},
		{
			// The case that makes the confidence check in HeaderTag
			// load-bearing: recording the default for an unmatched header would
			// pin English and make level 3 unreachable for every client that
			// sends a header — i.e. for all of them.
			name: "an unsupported header falls through to the stored preference",
			auth: true, acceptLanguage: "fr-CA,fr;q=0.9",
			wantMessage: viMessage, wantField: viNameField, field: "displayName",
		},
		{
			name: "?lang=vi wins even against an unsupported header",
			auth: true, lang: "vi", acceptLanguage: "de",
			wantMessage: viMessage, wantField: viNameField, field: "displayName",
		},
		{
			name: "?lang=en wins over an unsupported header and the stored preference",
			auth: true, lang: "en", acceptLanguage: "de",
			wantMessage: enMessage, wantField: enNameField, field: "displayName",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var rr *httptest.ResponseRecorder
			if tc.auth {
				// An empty body is a 400 on this endpoint (neither accepted field
				// is present), which is exactly the probe we want.
				path := "/api/v1/auth/me"
				if tc.lang != "" {
					path += "?lang=" + tc.lang
				}
				rr = env.do(t, http.MethodPatch, path, env.token, map[string]any{}, tc.acceptLanguage)
			} else {
				path := "/api/v1/auth/login"
				if tc.lang != "" {
					path += "?lang=" + tc.lang
				}
				rr = env.do(t, http.MethodPost, path, "",
					map[string]string{"email": "not-an-email", "password": "any-pass"}, tc.acceptLanguage)
			}
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 — an unsupported language must never be a 400 of its own (%s)",
					rr.Code, rr.Body.String())
			}
			body := decodeBody(t, rr)
			if body["message"] != tc.wantMessage {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMessage)
			}
			fieldErrors, _ := body["fieldErrors"].(map[string]any)
			msgs, _ := fieldErrors[tc.field].([]any)
			if len(msgs) != 1 || msgs[0] != tc.wantField {
				t.Errorf("fieldErrors.%s = %v, want [%q]", tc.field, fieldErrors[tc.field], tc.wantField)
			}
		})
	}
}

// An unsupported language is a fallback on EVERY level, and never changes the
// status code. This is the brief's explicit requirement.
func TestUnsupportedLanguageIsNeverA400(t *testing.T) {
	env := setupAuthI18nEnv(t)
	creds := map[string]string{"email": "i18n@example.invalid", "password": "MatKhau12345"}

	for _, acceptLanguage := range []string{"fr", "de-DE,de;q=0.9", "zh-Hans-CN", "!!not-a-language!!", "*"} {
		rr := env.do(t, http.MethodPost, "/api/v1/auth/login", "", creds, acceptLanguage)
		if rr.Code == http.StatusBadRequest {
			t.Errorf("Accept-Language %q produced a 400: %s", acceptLanguage, rr.Body.String())
		}
		if rr.Code != http.StatusOK {
			t.Errorf("Accept-Language %q → status %d, want 200 (the login itself is valid)", acceptLanguage, rr.Code)
		}
		// It must have been served in the default language.
		var body struct {
			User struct {
				Locale *string `json:"locale"`
			} `json:"user"`
		}
		_ = json.Unmarshal(rr.Body.Bytes(), &body)
		if got := rr.Header().Get("Content-Language"); got != "en" {
			t.Errorf("Accept-Language %q → Content-Language %q, want %q", acceptLanguage, got, "en")
		}
	}

	// And on the query-parameter level, where the value is not one of the two
	// documented literals.
	rr := env.do(t, http.MethodPost, "/api/v1/auth/login?lang=fr", "", creds, "")
	if rr.Code != http.StatusOK {
		t.Errorf("?lang=fr → status %d, want 200", rr.Code)
	}
}

// ── 3. PATCH /auth/me round-trip ────────────────────────────────────────────

// Set → read back → clear, with the response body checked at each step and the
// column verified in the database.
func TestPatchMeLocaleRoundTrip(t *testing.T) {
	env := setupAuthI18nEnv(t)

	// Initially unset: the column has never been written.
	if got := env.storedLocale(t); got != nil {
		t.Fatalf("fresh user has locale %q, want NULL", *got)
	}

	// GET /auth/me must not invent one. `omitempty` keeps the field out of the
	// body entirely for a user who has never chosen a language, which is what
	// keeps the response byte-identical for existing clients.
	rr := env.do(t, http.MethodGet, "/api/v1/auth/me", env.token, nil, "")
	if rr.Code != http.StatusOK {
		t.Fatalf("GET me = %d (%s)", rr.Code, rr.Body.String())
	}
	if strings.Contains(rr.Body.String(), "locale") {
		t.Errorf("GET me emitted a locale for a user who has none: %s", rr.Body.String())
	}

	// Set it. The response carries the new value so a client can update its
	// cached user object from the PATCH itself.
	rr = env.patchProfile(t, "", "", map[string]any{"displayName": "Nguyễn Văn A", "locale": "vi"})
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH set locale = %d (%s)", rr.Code, rr.Body.String())
	}
	user := decodeBody(t, rr)["user"].(map[string]any)
	if user["locale"] != "vi" {
		t.Errorf("PATCH response user.locale = %v, want \"vi\"", user["locale"])
	}
	if user["name"] != "Nguyễn Văn A" {
		t.Errorf("PATCH response user.name = %v, want the new display name", user["name"])
	}
	if got := env.storedLocale(t); got == nil || *got != "vi" {
		t.Fatalf("persisted locale = %v, want \"vi\"", got)
	}

	// GET now reports it.
	rr = env.do(t, http.MethodGet, "/api/v1/auth/me", env.token, nil, "")
	if got := decodeBody(t, rr)["user"].(map[string]any)["locale"]; got != "vi" {
		t.Errorf("GET me after set → locale %v, want \"vi\"", got)
	}

	// Change it.
	rr = env.patchProfile(t, "", "", map[string]any{"locale": "en"})
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH change locale = %d (%s)", rr.Code, rr.Body.String())
	}
	if got := env.storedLocale(t); got == nil || *got != "en" {
		t.Fatalf("persisted locale = %v, want \"en\"", got)
	}

	// A full tag from a native client is accepted and stored as the base code.
	rr = env.patchProfile(t, "", "", map[string]any{"locale": "vi-VN"})
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH locale=vi-VN = %d (%s)", rr.Code, rr.Body.String())
	}
	if got := env.storedLocale(t); got == nil || *got != "vi" {
		t.Errorf("'vi-VN' stored as %v, want the base code \"vi\"", got)
	}

	// Clear with an explicit null: the user goes back to "let the request decide".
	rr = env.patchProfile(t, "", "", map[string]any{"locale": nil})
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH locale=null = %d (%s)", rr.Code, rr.Body.String())
	}
	if got := env.storedLocale(t); got != nil {
		t.Errorf("after null, locale = %q, want NULL", *got)
	}

	// And with an empty string, which clears for the same reason "" clears a
	// display name: a form encoder sends "" for an emptied field.
	if rr := env.patchProfile(t, "", "", map[string]any{"locale": "vi"}); rr.Code != http.StatusOK {
		t.Fatalf("PATCH locale=vi = %d", rr.Code)
	}
	rr = env.patchProfile(t, "", "", map[string]any{"locale": ""})
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH locale=\"\" = %d (%s)", rr.Code, rr.Body.String())
	}
	if got := env.storedLocale(t); got != nil {
		t.Errorf("after empty string, locale = %q, want NULL", *got)
	}
}

// The compatibility guarantee. A client that has never heard of `locale` sends
// only `displayName`; the stored preference must survive untouched. This is the
// difference between "absent means unchanged" and "absent means clear", and
// getting it wrong would silently reset the language of every existing user on
// their next profile edit.
func TestPatchMeAbsentLocaleLeavesStoredPreferenceAlone(t *testing.T) {
	env := setupAuthI18nEnv(t)

	if rr := env.patchProfile(t, "", "", map[string]any{"locale": "vi"}); rr.Code != http.StatusOK {
		t.Fatalf("seed = %d (%s)", rr.Code, rr.Body.String())
	}

	for _, tc := range []struct {
		name string
		body map[string]any
	}{
		{"displayName only", map[string]any{"displayName": "Tên mới"}},
		{"displayName cleared", map[string]any{"displayName": nil}},
		{"displayName unchanged but present", map[string]any{"displayName": "Tên mới"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := env.patchProfile(t, "", "", tc.body)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			got := env.storedLocale(t)
			if got == nil || *got != "vi" {
				t.Fatalf("locale after a body with no `locale` key = %v, want \"vi\" — an ABSENT key must mean unchanged", got)
			}
			// The response echoes it, so a client that reads only the PATCH
			// response still sees the truth.
			if v := decodeBody(t, rr)["user"].(map[string]any)["locale"]; v != "vi" {
				t.Errorf("response locale = %v, want \"vi\"", v)
			}
		})
	}
}

// An unsupported VALUE is a 400 with a translated fieldError — unlike an
// unsupported Accept-Language, which is a silent fallback. The difference is
// deliberate: one is a client bug on a write, the other is a preference we simply
// do not ship.
func TestPatchMeRejectsUnsupportedLocale(t *testing.T) {
	env := setupAuthI18nEnv(t)

	for _, tc := range []struct {
		name           string
		lang           string
		acceptLanguage string
		want           string
	}{
		// Each case signals its language explicitly. The Vietnamese one uses
		// ?lang=vi rather than an empty header, because "no signal at all" is a
		// different level of the precedence chain (the stored preference, which is
		// NULL here) and would fall through to the default.
		{"English", "", "en", "Unsupported language"},
		{"Vietnamese", "vi", "", "Ngôn ngữ không hợp lệ"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := "/api/v1/auth/me"
			if tc.lang != "" {
				path += "?lang=" + tc.lang
			}
			rr := env.do(t, http.MethodPatch, path, env.token, map[string]any{"locale": "fr"}, tc.acceptLanguage)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := decodeBody(t, rr)
			fieldErrors, _ := body["fieldErrors"].(map[string]any)
			msgs, _ := fieldErrors["locale"].([]any)
			if len(msgs) != 1 || msgs[0] != tc.want {
				t.Errorf("fieldErrors.locale = %v, want [%q]", fieldErrors["locale"], tc.want)
			}
			if body["message"] != tc.want {
				t.Errorf("message = %v, want %q", body["message"], tc.want)
			}
		})
	}

	// The stored value is untouched by a rejected write.
	if got := env.storedLocale(t); got != nil {
		t.Errorf("a rejected locale left %q in the column, want NULL", *got)
	}
}

// `locale` is now an accepted field, so it must not fall into the unknown-field
// branch that answers "unsupported field" — while `email` still must.
func TestPatchMeFieldSurface(t *testing.T) {
	env := setupAuthI18nEnv(t)

	rr := env.patchProfile(t, "", "en", map[string]any{"displayName": "A", "locale": "en", "nickname": "x"})
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("unknown field status = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeBody(t, rr)
	fieldErrors, _ := body["fieldErrors"].(map[string]any)
	if _, ok := fieldErrors["nickname"]; !ok {
		t.Errorf("fieldErrors = %v, want an entry for `nickname`", fieldErrors)
	}
	if _, ok := fieldErrors["locale"]; ok {
		t.Errorf("fieldErrors = %v — `locale` is an accepted field and must not be reported as unsupported", fieldErrors)
	}
	if body["message"] != "Only the display name can be edited here. Changing the email has its own flow (change-email + confirm-email-change)." {
		t.Errorf("message = %v, want the translated headline", body["message"])
	}
	// A rejected request writes nothing.
	if got := env.storedLocale(t); got != nil {
		t.Errorf("a rejected request changed the locale to %q", *got)
	}

	rr = env.patchProfile(t, "", "en", map[string]any{"email": "other@example.invalid"})
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("email field status = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "/api/v1/auth/change-email") {
		t.Errorf("body = %s, want it to point at the change-email flow", rr.Body.String())
	}
}

// ── 4. The stored preference drives what an authenticated request renders ───

// A user who picked Vietnamese in the app must get Vietnamese error text from an
// authenticated call even when the client sends no Accept-Language at all — this
// is what makes the picker worth having.
func TestStoredLocaleDrivesAuthenticatedResponses(t *testing.T) {
	env := setupAuthI18nEnv(t)

	// Set the preference to Vietnamese, using an English request so the write
	// itself is in the "wrong" language and cannot be what makes the later
	// assertion pass.
	if rr := env.patchProfile(t, "", "en", map[string]any{"locale": "vi"}); rr.Code != http.StatusOK {
		t.Fatalf("seed locale = %d", rr.Code)
	}

	rr := env.patchProfile(t, "", "", map[string]any{"nickname": "x"})
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d", rr.Code)
	}
	if msg := decodeBody(t, rr)["message"]; msg != "Chỉ hỗ trợ sửa tên hiển thị. Đổi email có luồng riêng (change-email + confirm-email-change)." {
		t.Errorf("message = %v, want the Vietnamese one from the stored preference", msg)
	}

	// An explicit ?lang=en still wins over the stored preference.
	rr = env.patchProfile(t, "en", "", map[string]any{"nickname": "x"})
	if msg := decodeBody(t, rr)["message"]; msg != "Only the display name can be edited here. Changing the email has its own flow (change-email + confirm-email-change)." {
		t.Errorf("?lang=en → message = %v, want English to win over the stored preference", msg)
	}
}

// Every user-facing string the auth slice renders for a validation failure must
// actually BE in the catalog. Without this, a typo in a key would silently serve
// the Vietnamese source text to an English client — the documented fallback, so
// nothing would fail, and the mistranslation would ship.
//
// The scan is over the REAL response, so it covers whatever the handlers render,
// including messages nested in `fieldErrors`.
func TestAuthSliceCopyIsInTheCatalog(t *testing.T) {
	env := setupAuthI18nEnv(t)

	// Pull every human-readable string out of a response, keyed by its JSON path.
	scan := func(rr *httptest.ResponseRecorder) map[string]string {
		t.Helper()
		out := map[string]string{}
		var walk func(prefix string, v any)
		walk = func(prefix string, v any) {
			switch val := v.(type) {
			case string:
				// Only human text: `error` is the machine-readable code and is
				// the same in every language by design.
				if prefix == "error" || strings.HasSuffix(prefix, ".error") {
					return
				}
				out[prefix] = val
			case map[string]any:
				for k, sub := range val {
					walk(prefix+"."+k, sub)
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

	// Request set chosen to reach every branch of the auth slice that has copy.
	requestSet := []struct {
		name string
		call func(lang string) *httptest.ResponseRecorder
	}{
		{"login validation", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodPost, "/api/v1/auth/login?lang="+lang, "",
				map[string]string{"email": "bad", "password": "x"}, "")
		}},
		{"patch unknown field", func(lang string) *httptest.ResponseRecorder {
			path := "/api/v1/auth/me?lang=" + lang
			return env.do(t, http.MethodPatch, path, env.token,
				map[string]any{"displayName": "A", "nope": 1}, "")
		}},
		{"patch bad locale", func(lang string) *httptest.ResponseRecorder {
			path := "/api/v1/auth/me?lang=" + lang
			return env.do(t, http.MethodPatch, path, env.token, map[string]any{"locale": "fr"}, "")
		}},
		{"patch empty body", func(lang string) *httptest.ResponseRecorder {
			path := "/api/v1/auth/me?lang=" + lang
			return env.do(t, http.MethodPatch, path, env.token, map[string]any{}, "")
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
					// Identical in both languages: either it is not in the catalog
					// (the fallback served the Vietnamese source), or the two
					// translations happen to match. The second is only acceptable
					// for a handful of entries, so name the key explicitly rather
					// than allowing a blanket exception.
					if _, known := allowedIdenticalTranslations[v]; known {
						continue
					}
					t.Errorf("%s is identical in both languages (%q) — most likely the key is not in the catalog, so English got the Vietnamese fallback", path, v)
				}
			}
		})
	}
}

// Keys whose two translations are legitimately the same word.
var allowedIdenticalTranslations = map[string]struct{}{
	"Required": {},
}

// The status code, the error CODE and the response SHAPE are language-independent.
// Only the human-readable parts move. A client that keys off `error` must not
// care which language it asked for.
func TestTranslationDoesNotChangeTheContract(t *testing.T) {
	env := setupAuthI18nEnv(t)
	badLogin := map[string]string{"email": "not-an-email", "password": "any-pass"}

	type shape struct {
		keys    []string
		code    string
		status  int
		headers string
	}
	var shapes []shape
	for _, acceptLanguage := range []string{"vi", "en"} {
		rr := env.do(t, http.MethodPost, "/api/v1/auth/login", "", badLogin, acceptLanguage)
		var body map[string]any
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode: %v", err)
		}
		keys := make([]string, 0, len(body))
		for k := range body {
			keys = append(keys, k)
		}
		// Map iteration order is deliberately random in Go, so compare sorted.
		sort.Strings(keys)
		shapes = append(shapes, shape{
			keys:    keys,
			code:    body["error"].(string),
			status:  rr.Code,
			headers: rr.Header().Get("Content-Type"),
		})
	}
	if shapes[0].status != shapes[1].status {
		t.Errorf("status differs by language: %d vs %d", shapes[0].status, shapes[1].status)
	}
	if shapes[0].code != shapes[1].code {
		t.Errorf("error code differs by language: %q vs %q", shapes[0].code, shapes[1].code)
	}
	if strings.Join(shapes[0].keys, ",") != strings.Join(shapes[1].keys, ",") {
		t.Errorf("envelope keys differ by language: %v vs %v", shapes[0].keys, shapes[1].keys)
	}
	if shapes[0].headers != shapes[1].headers {
		t.Errorf("Content-Type differs by language: %q vs %q", shapes[0].headers, shapes[1].headers)
	}
}
