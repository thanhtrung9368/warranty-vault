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

// Wave 2's proof of the i18n pattern over HTTP, on the subscriptions + wishlist
// slice (docs/I18N_PLAN.md §3). Phase 0 did this for auth (auth_i18n_test.go),
// wave 1 for devices + warranties (devices_i18n_test.go); this file is the same
// shape for the two domains that are all counts and money.
//
// What each test is for, and why the assertions are written the way they are:
//
//  1. `message` AND `fieldErrors` move together (same as every earlier wave): a
//     response whose headline is English while the per-field help text under it is
//     Vietnamese is worse than an untranslated one.
//  2. The ceiling refusals are asserted in BOTH languages, and the singular form
//     is driven EXPLICITLY. Subscriptions are where the plural/Sprintf bug class
//     lands — wave 0 shipped `"expires in 1 day%!(EXTRA int=7)"` by handing one
//     argument list to two forms — so the singular template is exercised rather
//     than assumed unreachable.
//  3. The audit findings are the only place in this wave where MONEY and DATES
//     are rendered inside a sentence. They are asserted as copy: "1.200.000 ₫" is
//     not "₫1,200,000", and 07/05 reads as 5 July to one reader and 7 May to the
//     other. A test that only checked the headline would miss both.
//  4. The catalog scan catches the failure mode nothing else can: a typo'd or
//     missing key degrades to the VIETNAMESE source text by design, so an
//     untranslated string does not fail — it just ships. Comparing the same
//     request in both languages is what makes that visible.
//  5. The error CODE and the status do not move with the language.
//
// Every case pins its language explicitly (`?lang=`, Accept-Language, or an
// i18n.WithTag context for the pure-service paths), so no assertion here can pass
// because of the machine's locale (docs/I18N_PLAN.md §4.3).
//
// Each test gets its own scratch database, like every DB-backed handler test
// (testDatabaseURL → newScratchDatabaseDSN).

type subsI18nEnv struct {
	mux   *http.ServeMux
	token string
	pool  *pgxpool.Pool
	user  string
}

func setupSubsI18nEnv(t *testing.T) *subsI18nEnv {
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
	const userID = "zz_test_subs_i18n_user"
	insertUser(t, pool, userID, "subs-i18n@example.invalid", hash)
	deleteUsers(t, pool, userID)

	issued, err := auth.IssueToken(context.Background(), pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	mux := http.NewServeMux()
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	RegisterSubscriptions(mux, deps)
	RegisterWishlist(mux, deps)
	return &subsI18nEnv{mux: mux, token: issued.AccessToken, pool: pool, user: userID}
}

// do issues one request against the mux, optionally wrapped in i18n.Middleware
// (the way the real server runs it) and with the language pinned by `lang` as the
// `Accept-Language` header.
//
// Both mechanisms are exercised across this file: `?lang=` (level 1) is used for
// the Vietnamese cases, an Accept-Language header (level 2, what a real client
// sends) for most English ones. A third case pins the language on a CONTEXT
// instead, for the service-level paths that have no request to carry it.
func (e *subsI18nEnv) do(t *testing.T, method, path, lang, body string) *httptest.ResponseRecorder {
	t.Helper()
	return e.doWithMiddleware(t, method, path, lang, body, true)
}

func (e *subsI18nEnv) doWithMiddleware(
	t *testing.T, method, path, lang, body string, useMiddleware bool,
) *httptest.ResponseRecorder {
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
	handler := http.Handler(e.mux)
	if useMiddleware {
		handler = i18n.Middleware(e.mux)
	}
	handler.ServeHTTP(rr, req)
	return rr
}

// ── 1. A validation error, both languages ───────────────────────────────────

// One request, two languages: the `message` headline and the `fieldErrors` copy
// must both move.
//
// The probes cover the shapes the catalog has to handle (`Text`, `T`, the shared
// headline, and the two single-field keyed failures where the sentence IS the
// whole story), and the fields that carry money and dates.
func TestSubscriptionValidationErrorIsTranslated(t *testing.T) {
	env := setupSubsI18nEnv(t)

	for _, tc := range []struct {
		name   string
		body   string
		field  string
		wantVI string
		wantEN string
		// wantMsgVI / wantMsgEN are the expected envelope headlines. Most cases
		// share the generic "invalid input" sentence; the ones that raise their
		// own keyed error name it instead.
		wantMsgVI string
		wantMsgEN string
	}{
		{
			name:   "missing name",
			body:   `{"name":"","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-01-15"}`,
			field:  "name",
			wantVI: "Tên gói bắt buộc",
			wantEN: "Subscription name is required",
		},
		{
			name:   "name too long",
			body:   `{"name":"` + strings.Repeat("a", 201) + `","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-01-15"}`,
			field:  "name",
			wantVI: "Tên gói tối đa 200 ký tự",
			wantEN: "Subscription name must be at most 200 characters",
		},
		{
			name:   "unknown billing cycle",
			body:   `{"name":"Netflix","billingCycle":"WEEKLY","price":1000,"startedAt":"2026-01-15"}`,
			field:  "billingCycle",
			wantVI: "Chu kỳ không hợp lệ",
			wantEN: "Invalid billing cycle",
		},
		{
			name:   "interval out of range",
			body:   `{"name":"Netflix","billingCycle":"CUSTOM","intervalDays":3651,"price":1000,"startedAt":"2026-01-15"}`,
			field:  "intervalDays",
			wantVI: "Số ngày phải từ 1 đến 3650",
			wantEN: "Number of days must be between 1 and 3650",
		},
		{
			name:   "negative price",
			body:   `{"name":"Netflix","billingCycle":"MONTHLY","price":-1,"startedAt":"2026-01-15"}`,
			field:  "price",
			wantVI: "Giá phải ≥ 0",
			wantEN: "Price must be at least 0",
		},
		{
			name:   "missing start date",
			body:   `{"name":"Netflix","billingCycle":"MONTHLY","price":1000,"startedAt":""}`,
			field:  "startedAt",
			wantVI: "Ngày bắt đầu bắt buộc",
			wantEN: "Start date is required",
		},
		{
			name:   "invalid status",
			body:   `{"name":"Netflix","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-01-15","status":"NOPE"}`,
			field:  "status",
			wantVI: "Trạng thái không hợp lệ",
			wantEN: "Invalid status",
		},
		{
			// A CUSTOM cycle with no interval is the one failure whose headline names
			// itself instead of saying "invalid input".
			name:      "custom cycle without an interval",
			body:      `{"name":"Netflix","billingCycle":"CUSTOM","price":1000,"startedAt":"2026-01-15"}`,
			field:     "intervalDays",
			wantVI:    "Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh",
			wantEN:    "Enter the number of days when the cycle is Custom",
			wantMsgVI: "Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh",
			wantMsgEN: "Enter the number of days when the cycle is Custom",
		},
		{
			// Unparseable dates never reach the validator: the HANDLER builds these
			// field errors, which is the other call site the rule about translating
			// at the call site applies to.
			name:      "unparseable start date",
			body:      `{"name":"Netflix","billingCycle":"MONTHLY","price":1000,"startedAt":"15/01/2026"}`,
			field:     "startedAt",
			wantVI:    "Ngày bắt đầu không hợp lệ",
			wantEN:    "Invalid start date",
			wantMsgVI: "Dữ liệu không hợp lệ",
			wantMsgEN: "Invalid input",
		},
		{
			name:      "unparseable renewal date",
			body:      `{"name":"Netflix","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-01-15","renewalDate":"15/02/2026"}`,
			field:     "renewalDate",
			wantVI:    "Ngày gia hạn không hợp lệ",
			wantEN:    "Invalid renewal date",
			wantMsgVI: "Dữ liệu không hợp lệ",
			wantMsgEN: "Invalid input",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			// Vietnamese, pinned with ?lang=vi — level 1, which outranks everything.
			rrVI := env.do(t, http.MethodPost, "/api/v1/subscriptions?lang=vi", "", tc.body)
			if rrVI.Code != http.StatusBadRequest {
				t.Fatalf("?lang=vi status = %d, want 400 (%s)", rrVI.Code, rrVI.Body.String())
			}
			bodyVI := decodeResponse(t, rrVI)
			if got := firstFieldError(t, bodyVI, tc.field); got != tc.wantVI {
				t.Errorf("?lang=vi fieldErrors.%s = %q, want %q", tc.field, got, tc.wantVI)
			}

			// English, pinned with Accept-Language — level 2, the mechanism a real
			// client uses.
			rrEN := env.do(t, http.MethodPost, "/api/v1/subscriptions", "en-US,en;q=0.9", tc.body)
			if rrEN.Code != http.StatusBadRequest {
				t.Fatalf("Accept-Language en status = %d, want 400 (%s)", rrEN.Code, rrEN.Body.String())
			}
			bodyEN := decodeResponse(t, rrEN)
			if got := firstFieldError(t, bodyEN, tc.field); got != tc.wantEN {
				t.Errorf("Accept-Language en fieldErrors.%s = %q, want %q", tc.field, got, tc.wantEN)
			}

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

			// Neither language may leak fmt's error text. This is the direct
			// assertion for the bug class the brief names.
			for _, msg := range []string{fmt.Sprint(bodyVI["message"]), fmt.Sprint(bodyEN["message"])} {
				if strings.Contains(msg, "%!") {
					t.Errorf("message %q contains a Sprintf error — an argument list that does not match the verbs", msg)
				}
			}

			// The machine-readable parts do not move with the language.
			if bodyVI["error"] != bodyEN["error"] {
				t.Errorf("error codes differ by language: %v vs %v", bodyVI["error"], bodyEN["error"])
			}
		})
	}
}

// The wire CODE of the body-level validation failures on this path must not move
// when the copy does.
//
// `POST /api/v1/subscriptions` has always answered `{"error":"bad_input"}` for
// these (openapi.yaml documents it), while the service's own validator answers
// `validation`. The conversion replaced an unkeyed local `errBadInput` helper with
// ErrBadInputKeyed precisely to keep that: ErrValidationKeyed would have kept the
// 400 and the translation while renaming the code, and nothing would have failed.
func TestSubscriptionBodyErrorCodesAreStable(t *testing.T) {
	env := setupSubsI18nEnv(t)

	for _, tc := range []struct {
		name string
		body string
		want string
	}{
		{
			name: "unparseable date, built by the handler",
			body: `{"name":"Netflix","billingCycle":"MONTHLY","price":1000,"startedAt":"15/01/2026"}`,
			want: "bad_input",
		},
		{
			name: "custom cycle without an interval, built by the service",
			body: `{"name":"Netflix","billingCycle":"CUSTOM","price":1000,"startedAt":"2026-01-15"}`,
			want: "bad_input",
		},
		{
			name: "field validation, built by the service validator",
			body: `{"name":"","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-01-15"}`,
			want: "validation",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, lang := range []string{"vi", "en"} {
				rr := env.do(t, http.MethodPost, "/api/v1/subscriptions?lang="+lang, "", tc.body)
				body := decodeResponse(t, rr)
				if body["error"] != tc.want {
					t.Errorf("?lang=%s error = %v, want %q (%s)", lang, body["error"], tc.want, rr.Body.String())
				}
			}
		})
	}

	// The renew refusal goes through the same writer, on a different route.
	created := env.do(t, http.MethodPost, "/api/v1/subscriptions?lang=vi", "",
		`{"name":"Vĩnh viễn","billingCycle":"LIFETIME","price":1000,"startedAt":"2026-01-15"}`)
	var createdBody struct {
		Subscription struct {
			ID string `json:"id"`
		} `json:"subscription"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createdBody); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	for _, lang := range []string{"vi", "en"} {
		rr := env.do(t, http.MethodPost,
			"/api/v1/subscriptions/"+createdBody.Subscription.ID+"/renew?lang="+lang, "", "")
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("?lang=%s renew of a LIFETIME row = %d, want 400 (%s)", lang, rr.Code, rr.Body.String())
		}
		if got := decodeResponse(t, rr)["error"]; got != "bad_input" {
			t.Errorf("?lang=%s renew error = %v, want bad_input", lang, got)
		}
	}
}

// ── 2. The two ceilings, both languages ─────────────────────────────────────

// Seed the subscriptions table straight to the ceiling (100 rows through the
// service would test the seed, not the ceiling), then ask for the refusal in both
// languages over the real HTTP surface.
func TestSubscriptionLimitMessageIsTranslated(t *testing.T) {
	env := setupSubsI18nEnv(t)

	if _, err := env.pool.Exec(context.Background(), fmt.Sprintf(`
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, currency,
		                            "startedAt", "renewalDate", "autoRenew", status,
		                            "createdAt", "updatedAt")
		SELECT 'lim' || g::text, $1, 'Gói ' || g::text, 'MONTHLY', 1000, 'VND',
		       '2025-01-01', '2026-01-01', true, 'ACTIVE', NOW(), NOW()
		FROM generate_series(1, %d) AS g`, services.MaxSubscriptionsPerUser), env.user); err != nil {
		t.Fatalf("seed subscriptions: %v", err)
	}

	body := `{"name":"Gói mới","billingCycle":"MONTHLY","price":1000,"startedAt":"2026-06-01"}`

	rrVI := env.do(t, http.MethodPost, "/api/v1/subscriptions?lang=vi", "", body)
	if rrVI.Code != http.StatusConflict {
		t.Fatalf("?lang=vi at the ceiling = %d, want 409 (%s)", rrVI.Code, rrVI.Body.String())
	}
	msgVI, _ := decodeResponse(t, rrVI)["message"].(string)
	wantVI := "Đã đạt giới hạn 100 gói. Xoá bớt rồi thử lại."
	if msgVI != wantVI {
		t.Errorf("?lang=vi message = %q, want %q", msgVI, wantVI)
	}

	rrEN := env.do(t, http.MethodPost, "/api/v1/subscriptions?lang=en", "", body)
	if rrEN.Code != http.StatusConflict {
		t.Fatalf("?lang=en at the ceiling = %d, want 409 (%s)", rrEN.Code, rrEN.Body.String())
	}
	bodyEN := decodeResponse(t, rrEN)
	msgEN, _ := bodyEN["message"].(string)
	wantEN := "You have reached the limit of 100 subscriptions. Delete some and try again."
	if msgEN != wantEN {
		t.Errorf("?lang=en message = %q, want %q", msgEN, wantEN)
	}
	if strings.Contains(msgEN, "gói") || strings.Contains(msgEN, "%!") {
		t.Errorf("?lang=en message %q still contains Vietnamese copy or a Sprintf error", msgEN)
	}
	if bodyEN["error"] != "limit_reached" {
		t.Errorf("error = %v, want limit_reached", bodyEN["error"])
	}

	// The SINGULAR form is covered in internal/services/subscriptions_i18n_test.go:
	// a ceiling of 1 is not reachable over HTTP (the service compares against
	// MaxSubscriptionsPerUser), and the point of the pair is the TEMPLATE, which is
	// unit-testable without a fixture. What this HTTP test proves is that the
	// rendered sentence carries the interpolated count and no `%!`.
}

// ── 3. Wishlist validation, both languages ──────────────────────────────────

func TestWishlistValidationErrorIsTranslated(t *testing.T) {
	env := setupSubsI18nEnv(t)

	for _, tc := range []struct {
		name      string
		body      string
		field     string
		wantVI    string
		wantEN    string
		wantMsgVI string
		wantMsgEN string
	}{
		{
			name:   "missing name",
			body:   `{"name":""}`,
			field:  "name",
			wantVI: "Tên sản phẩm bắt buộc",
			wantEN: "Wishlist item name is required",
		},
		{
			name:   "name too long",
			body:   `{"name":"` + strings.Repeat("a", 201) + `"}`,
			field:  "name",
			wantVI: "Tên sản phẩm tối đa 200 ký tự",
			wantEN: "Wishlist item name must be at most 200 characters",
		},
		{
			name:   "negative current price",
			body:   `{"name":"Tai nghe","currentPrice":-1}`,
			field:  "currentPrice",
			wantVI: "Giá không hợp lệ",
			wantEN: "Invalid price",
		},
		{
			name:   "buy url is not a url",
			body:   `{"name":"Tai nghe","buyUrl":"shopee.vn/tai-nghe"}`,
			field:  "buyUrl",
			wantVI: "URL không hợp lệ",
			wantEN: "Invalid URL",
		},
		{
			name:   "reminder interval out of range",
			body:   `{"name":"Tai nghe","reminderIntervalDays":4000}`,
			field:  "reminderIntervalDays",
			wantVI: "Số ngày nhắc không hợp lệ",
			wantEN: "Invalid reminder interval in days",
		},
		{
			name:   "unknown priority",
			body:   `{"name":"Tai nghe","priority":"SOMEDAY"}`,
			field:  "priority",
			wantVI: "Mức ưu tiên không hợp lệ",
			wantEN: "Invalid priority",
		},
		{
			name:   "unknown status",
			body:   `{"name":"Tai nghe","status":"MAYBE"}`,
			field:  "status",
			wantVI: "Trạng thái không hợp lệ",
			wantEN: "Invalid status",
		},
		{
			name:   "unknown category code",
			body:   `{"name":"Tai nghe","category":"NOT_A_CATEGORY"}`,
			field:  "category",
			wantVI: "Loại sản phẩm không hợp lệ",
			wantEN: "Invalid wishlist category",
			// CATEGORY_INVALID, whose headline is the wishlist spelling on purpose:
			// "Loại SẢN PHẨM", not the device slice's "Loại THIẾT BỊ".
			wantMsgVI: "Loại sản phẩm không hợp lệ",
			wantMsgEN: "Invalid wishlist category",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rrVI := env.do(t, http.MethodPost, "/api/v1/wishlist?lang=vi", "", tc.body)
			if rrVI.Code != http.StatusBadRequest {
				t.Fatalf("?lang=vi status = %d, want 400 (%s)", rrVI.Code, rrVI.Body.String())
			}
			bodyVI := decodeResponse(t, rrVI)
			if got := firstFieldError(t, bodyVI, tc.field); got != tc.wantVI {
				t.Errorf("?lang=vi fieldErrors.%s = %q, want %q", tc.field, got, tc.wantVI)
			}

			rrEN := env.do(t, http.MethodPost, "/api/v1/wishlist", "en", tc.body)
			if rrEN.Code != http.StatusBadRequest {
				t.Fatalf("Accept-Language en status = %d, want 400 (%s)", rrEN.Code, rrEN.Body.String())
			}
			bodyEN := decodeResponse(t, rrEN)
			if got := firstFieldError(t, bodyEN, tc.field); got != tc.wantEN {
				t.Errorf("Accept-Language en fieldErrors.%s = %q, want %q", tc.field, got, tc.wantEN)
			}

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
		})
	}
}

// The wishlist ceiling. One key, not a pair: MaxWishlistPerUser is 200 and no
// user-supplied count reaches the sentence, so the assertion is a single sentence
// per language — and it still has to carry the interpolated number and no `%!`.
func TestWishlistLimitMessageIsTranslated(t *testing.T) {
	env := setupSubsI18nEnv(t)

	if _, err := env.pool.Exec(context.Background(), fmt.Sprintf(`
		INSERT INTO "WishlistItem" (id, "userId", name, priority, status, "createdAt", "updatedAt")
		SELECT 'wlim' || g::text, $1, 'Món ' || g::text, 'WANT', 'WATCHING', NOW(), NOW()
		FROM generate_series(1, %d) AS g`, services.MaxWishlistPerUser), env.user); err != nil {
		t.Fatalf("seed wishlist: %v", err)
	}

	body := `{"name":"Món mới"}`

	rrVI := env.do(t, http.MethodPost, "/api/v1/wishlist?lang=vi", "", body)
	if rrVI.Code != http.StatusConflict {
		t.Fatalf("?lang=vi at the ceiling = %d, want 409 (%s)", rrVI.Code, rrVI.Body.String())
	}
	msgVI, _ := decodeResponse(t, rrVI)["message"].(string)
	if want := "Đã đạt giới hạn 200 món. Xoá bớt rồi thử lại."; msgVI != want {
		t.Errorf("?lang=vi message = %q, want %q", msgVI, want)
	}

	rrEN := env.do(t, http.MethodPost, "/api/v1/wishlist?lang=en", "", body)
	if rrEN.Code != http.StatusConflict {
		t.Fatalf("?lang=en at the ceiling = %d, want 409 (%s)", rrEN.Code, rrEN.Body.String())
	}
	msgEN, _ := decodeResponse(t, rrEN)["message"].(string)
	if want := "You have reached the limit of 200 wishlist items. Delete some and try again."; msgEN != want {
		t.Errorf("?lang=en message = %q, want %q", msgEN, want)
	}
	if strings.Contains(msgEN, "món") || strings.Contains(msgEN, "%!") {
		t.Errorf("?lang=en message %q still contains Vietnamese copy or a Sprintf error", msgEN)
	}
}

// ── 4. Not-found copy, both languages ───────────────────────────────────────

// The NOT_FOUND path takes a different branch of the error writer — a keyed
// ErrNotFound rather than a validation map — so it is pinned separately: a change
// that translated field errors but forgot to render MessageKey would leave
// exactly this branch Vietnamese.
func TestSubscriptionAndWishlistNotFoundAreTranslated(t *testing.T) {
	env := setupSubsI18nEnv(t)

	for _, tc := range []struct {
		name   string
		method string
		path   string
		want   string
	}{
		{"subscription, vi", http.MethodGet, "/api/v1/subscriptions/does-not-exist?lang=vi", "Không tìm thấy gói"},
		{"subscription, en", http.MethodGet, "/api/v1/subscriptions/does-not-exist?lang=en", "Subscription not found"},
		{"wishlist, vi", http.MethodGet, "/api/v1/wishlist/does-not-exist?lang=vi", "Không tìm thấy món"},
		{"wishlist, en", http.MethodGet, "/api/v1/wishlist/does-not-exist?lang=en", "Wishlist item not found"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := env.do(t, tc.method, tc.path, "", "")
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

// ── 5. The audit's money and dates follow the language ──────────────────────

// The audit is the one endpoint in this wave whose sentences are built by the
// SERVICE and contain MONEY and DATES. Both have to follow the language:
//
//	vi → "177.000 ₫" and "07/05/2026"   (dd/mm/yyyy — the Vietnamese convention)
//	en → "₫177,000" and "05/07/2026"    (mm/dd/yyyy — the US convention)
//
// Those two dates are genuinely ambiguous against each other, which is why a
// single server-side format could not serve both readers. The fixture is seeded
// with a payment whose amount and date are both known, and the assertion is on the
// rendered SENTENCE rather than on the number alone — a client renders `detail`
// straight, so that is the string the user reads.
func TestSubscriptionAuditCopyIsTranslated(t *testing.T) {
	env := setupSubsI18nEnv(t)
	ctx := context.Background()

	if _, err := env.pool.Exec(ctx, `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, currency,
		                            "startedAt", "renewalDate", "autoRenew", status,
		                            "createdAt", "updatedAt")
		VALUES ('aud_i18n', $1, 'Apple One', 'MONTHLY', 59000, 'VND',
		        NOW() - INTERVAL '400 days', NOW() + INTERVAL '20 days', true, 'ACTIVE', NOW(), NOW())`,
		env.user); err != nil {
		t.Fatalf("seed subscription: %v", err)
	}
	// Three automatic charges, the oldest well past AuditQuietMinMonths, so the
	// QUIET_AUTO_RENEW finding fires. The dates are absolute so the suite cannot go
	// red on a particular day.
	autoNote := "Auto-renew"
	for i, paidAt := range []string{"2026-01-05", "2026-02-05", "2026-03-05"} {
		if _, err := env.pool.Exec(ctx, `
			INSERT INTO "SubscriptionPayment" (id, "subscriptionId", amount, "paidAt", note, "createdAt")
			VALUES ($1, 'aud_i18n', 59000, $2::timestamp, $3, NOW())`,
			fmt.Sprintf("aud_i18n_p%d", i), paidAt, autoNote); err != nil {
			t.Fatalf("seed payment: %v", err)
		}
	}

	findQuiet := func(lang string) services.AuditFinding {
		t.Helper()
		rr := env.do(t, http.MethodGet, "/api/v1/subscriptions/audit?lang="+lang, "", "")
		if rr.Code != http.StatusOK {
			t.Fatalf("audit ?lang=%s = %d (%s)", lang, rr.Code, rr.Body.String())
		}
		var audit services.SubscriptionAudit
		if err := json.Unmarshal(rr.Body.Bytes(), &audit); err != nil {
			t.Fatalf("decode audit: %v", err)
		}
		for _, f := range audit.Findings {
			if f.Kind == services.AuditQuietAutoRenew {
				return f
			}
		}
		t.Fatalf("?lang=%s: no QUIET_AUTO_RENEW finding (%+v)", lang, audit.Findings)
		return services.AuditFinding{}
	}

	vi := findQuiet("vi")
	en := findQuiet("en")

	// Vietnamese: the ORIGINAL wording, dot grouping and dd/mm/yyyy. Byte-for-byte
	// what the endpoint produced before i18n existed.
	if want := "Gói tự trừ tiền đã lâu mà không thấy ghi nhận gì"; vi.Title != want {
		t.Errorf("vi title = %q, want %q", vi.Title, want)
	}
	for _, want := range []string{"Apple One", "3 lần", "177.000 ₫", "05/01/2026"} {
		if !strings.Contains(vi.Detail, want) {
			t.Errorf("vi detail %q must contain %q", vi.Detail, want)
		}
	}

	// English: read aloud, not substituted word for word — and with the money and
	// the date in the English forms.
	if want := "This subscription has been auto-charging for a long time with nothing recorded by you"; en.Title != want {
		t.Errorf("en title = %q, want %q", en.Title, want)
	}
	for _, want := range []string{"Apple One", "3 times", "₫177,000", "01/05/2026"} {
		if !strings.Contains(en.Detail, want) {
			t.Errorf("en detail %q must contain %q", en.Detail, want)
		}
	}
	if strings.Contains(en.Detail, "lần") || strings.Contains(en.Detail, "₫ ") {
		t.Errorf("en detail %q still contains Vietnamese formatting", en.Detail)
	}
	for _, f := range []struct{ name, text string }{
		{"vi title", vi.Title}, {"en title", en.Title},
		{"vi detail", vi.Detail}, {"en detail", en.Detail},
	} {
		if strings.Contains(f.text, "%!") {
			t.Errorf("%s contains a Sprintf error: %q", f.name, f.text)
		}
	}

	// The report's `note` is a sentence, not a code: it has to move too.
	rr := env.do(t, http.MethodGet, "/api/v1/subscriptions/audit?lang=en", "", "")
	var auditEN services.SubscriptionAudit
	if err := json.Unmarshal(rr.Body.Bytes(), &auditEN); err != nil {
		t.Fatalf("decode audit: %v", err)
	}
	if !strings.Contains(auditEN.Note, "SELF-AUDIT") {
		t.Errorf("en note = %q, want the English sentence", auditEN.Note)
	}
	if strings.Contains(auditEN.Note, "TỰ SOÁT") {
		t.Errorf("en note %q is still the Vietnamese sentence", auditEN.Note)
	}
}

// ── 6. The whole response is translated, not just its headline ──────────────

// The catalog scan from the earlier waves, applied to subscriptions + wishlist.
// A missing catalog entry degrades to the Vietnamese source text (by design), so
// nothing FAILS when one is missing — the string just ships untranslated.
// Comparing the same request in both languages is what makes that visible.
func TestSubscriptionsSliceCopyIsInTheCatalog(t *testing.T) {
	env := setupSubsI18nEnv(t)

	// One real row of each kind, so the audit probe has something to find and the
	// update/delete probes have a target.
	created := env.do(t, http.MethodPost, "/api/v1/subscriptions?lang=vi", "",
		`{"name":"Netflix","billingCycle":"MONTHLY","price":260000,"startedAt":"2026-01-15"}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create subscription = %d (%s)", created.Code, created.Body.String())
	}
	var createdBody struct {
		Subscription struct {
			ID string `json:"id"`
		} `json:"subscription"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &createdBody); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	subID := createdBody.Subscription.ID
	if subID == "" {
		t.Fatal("create returned no subscription id")
	}

	createdItem := env.do(t, http.MethodPost, "/api/v1/wishlist?lang=vi", "",
		`{"name":"Tai nghe","currentPrice":500000}`)
	if createdItem.Code != http.StatusCreated {
		t.Fatalf("create wishlist = %d (%s)", createdItem.Code, createdItem.Body.String())
	}
	var createdItemBody struct {
		Item struct {
			ID string `json:"id"`
		} `json:"item"`
	}
	if err := json.Unmarshal(createdItem.Body.Bytes(), &createdItemBody); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	itemID := createdItemBody.Item.ID
	if itemID == "" {
		t.Fatal("create returned no wishlist id")
	}

	// Payment history for the subscription created above, so the audit probe
	// actually produces a PRICE_INCREASED finding: without it the audit response
	// carries only `note` and the finding copy (title + a detail full of money and
	// dates) would never be compared. The pair is deliberately 59.000 → 79.000, a
	// rise above AuditPriceRiseMinPercent; a rise below it is still reported and is
	// covered in services/subscription_audit_test.go.
	//
	// Both payments are logged by HAND, which is what keeps this fixture from also
	// firing QUIET_AUTO_RENEW (a manual payment clears it outright).
	for _, p := range []struct {
		id     string
		amount int
		paidAt string
	}{
		{"price_i18n_old", 59000, "2026-01-05"},
		{"price_i18n_new", 79000, "2026-02-05"},
	} {
		if _, err := env.pool.Exec(context.Background(), `
			INSERT INTO "SubscriptionPayment" (id, "subscriptionId", amount, "paidAt", note, "createdAt")
			VALUES ($1, $2, $3, $4::timestamp, 'Tự trả', NOW())`, p.id, subID, p.amount, p.paidAt); err != nil {
			t.Fatalf("seed payment %s: %v", p.id, err)
		}
	}

	// Two rows whose names differ only in case, so the audit's DUPLICATE rule fires
	// on a normalized-name match (`wv_unaccent` folds case): the duplicate titles
	// and details are copy of their own and would otherwise never be compared.
	for _, d := range []struct{ id, name string }{
		{"dup_i18n_a", "icloud+"},
		{"dup_i18n_b", "iCloud+"},
	} {
		if _, err := env.pool.Exec(context.Background(), `
			INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, currency,
			                            "startedAt", "renewalDate", "autoRenew", status,
			                            "createdAt", "updatedAt")
			VALUES ($1, $2, $3, 'MONTHLY', 59000, 'VND', '2025-01-01', '2026-01-01', true, 'ACTIVE', NOW(), NOW())`,
			d.id, env.user, d.name); err != nil {
			t.Fatalf("seed duplicate %s: %v", d.id, err)
		}
	}

	// And one subscription the MACHINE has been charging for months with nothing
	// logged by hand, which is the QUIET_AUTO_RENEW rule — the only finding whose
	// detail carries a COUNT ("N lần" / "N times"), i.e. the plural pair.
	if _, err := env.pool.Exec(context.Background(), `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, currency,
		                            "startedAt", "renewalDate", "autoRenew", status,
		                            "createdAt", "updatedAt")
		VALUES ('quiet_i18n', $1, 'Apple One', 'MONTHLY', 59000, 'VND',
		        NOW() - INTERVAL '400 days', NOW() + INTERVAL '20 days', true, 'ACTIVE', NOW(), NOW())`,
		env.user); err != nil {
		t.Fatalf("seed quiet subscription: %v", err)
	}
	for i, paidAt := range []string{"2026-01-05", "2026-02-05", "2026-03-05"} {
		if _, err := env.pool.Exec(context.Background(), `
			INSERT INTO "SubscriptionPayment" (id, "subscriptionId", amount, "paidAt", note, "createdAt")
			VALUES ($1, 'quiet_i18n', 59000, $2::timestamp, 'Auto-renew', NOW())`,
			fmt.Sprintf("quiet_i18n_p%d", i), paidAt); err != nil {
			t.Fatalf("seed quiet payment: %v", err)
		}
	}

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
				// machine-readable code (`error`, a finding's `kind`/`severity`/
				// `reason`) or the resource the endpoint returned (a name, an id, a
				// timestamp) — none of which is translated, and all of which is
				// legitimately identical in two responses.
				switch {
				case prefix == "message":
					out[prefix] = val
				case strings.HasPrefix(prefix, "fieldErrors."):
					out[prefix] = val
				case prefix == "note":
					out[prefix] = val
				case strings.HasSuffix(prefix, ".title"), strings.HasSuffix(prefix, ".detail"):
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
		{"subscription validation", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodPost, "/api/v1/subscriptions?lang="+lang, "",
				`{"name":"","billingCycle":"NOPE","price":-1,"startedAt":"","status":"NOPE"}`)
		}},
		{"subscription custom cycle", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodPost, "/api/v1/subscriptions?lang="+lang, "",
				`{"name":"Netflix","billingCycle":"CUSTOM","price":1000,"startedAt":"2026-01-15"}`)
		}},
		{"subscription not found", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodGet, "/api/v1/subscriptions/nope?lang="+lang, "", "")
		}},
		{"subscription status filter", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodGet, "/api/v1/subscriptions?status=NOPE&lang="+lang, "", "")
		}},
		{"subscription renew refusal", func(lang string) *httptest.ResponseRecorder {
			// A LIFETIME row cannot be renewed; the sentence names the reason.
			created := env.do(t, http.MethodPost, "/api/v1/subscriptions?lang=vi", "",
				`{"name":"Vĩnh viễn","billingCycle":"LIFETIME","price":1990000,"startedAt":"2026-01-15"}`)
			var body struct {
				Subscription struct {
					ID string `json:"id"`
				} `json:"subscription"`
			}
			if err := json.Unmarshal(created.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode lifetime create: %v", err)
			}
			return env.do(t, http.MethodPost, "/api/v1/subscriptions/"+body.Subscription.ID+"/renew?lang="+lang, "", "")
		}},
		{"payment validation", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodPost, "/api/v1/subscriptions/"+subID+"/payments?lang="+lang, "",
				`{"amount":-1,"paidAt":"15/01/2026"}`)
		}},
		{"wishlist validation", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodPost, "/api/v1/wishlist?lang="+lang, "",
				`{"name":"","initialPrice":-1,"currentPrice":-1,"buyUrl":"x","imageUrl":"x",`+
					`"reminderIntervalDays":4000,"priority":"NOPE","status":"NOPE"}`)
		}},
		{"wishlist unknown category", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodPost, "/api/v1/wishlist?lang="+lang, "",
				`{"name":"Tai nghe","category":"NOT_A_CATEGORY"}`)
		}},
		{"wishlist not found", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodGet, "/api/v1/wishlist/nope?lang="+lang, "", "")
		}},
		{"wishlist status filter", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodGet, "/api/v1/wishlist?status=NOPE&lang="+lang, "", "")
		}},
		{"wishlist price log validation", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodPost, "/api/v1/wishlist/"+itemID+"/prices?lang="+lang, "",
				`{"price":-1,"note":"`+strings.Repeat("a", 501)+`"}`)
		}},
		// All three finding kinds are seeded above, so this one probe compares the
		// audit's `note`, all three `title`s and all three `detail`s — including the
		// QUIET_AUTO_RENEW detail, whose sentence carries a count and is therefore a
		// singular/plural pair.
		{"audit findings", func(lang string) *httptest.ResponseRecorder {
			return env.do(t, http.MethodGet, "/api/v1/subscriptions/audit?lang="+lang, "", "")
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
					if _, known := allowedIdenticalSubsTranslations[path]; known {
						continue
					}
					t.Errorf("%s is identical in both languages (%q) — most likely the key is not in the catalog, so English got the Vietnamese fallback", path, v)
				}
			}
		})
	}
}

// allowedIdenticalSubsTranslations lists the JSON paths whose two renderings are
// legitimately the same string.
//
// It is EMPTY, and that is a claim rather than a placeholder: every string this
// slice puts in front of a user has a distinct English rendering, including the
// generic `message` headline (ErrValidationHeadline keys it for the converted
// validators) and the audit `note`. An entry here means "this string is
// deliberately the same in both languages"; the mechanism exists so that adding
// one is a reviewable decision rather than a blanket exception.
var allowedIdenticalSubsTranslations = map[string]struct{}{}
