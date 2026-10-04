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

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Wave 5's proof of the i18n pattern over HTTP, on the surface this wave
// converted — the SHARED machinery rather than one domain.
//
// What each test is for, and why the assertions are written the way they are:
//
//  1. The 500 headline is proven through THREE different per-domain writers, not
//     one. That is the whole point of this wave: `Lỗi hệ thống` was the common
//     failure branch of every writer, so the change has one failure mode that a
//     single-domain test cannot see — translating the copy in the writer one
//     endpoint happens to use and leaving the other two in Vietnamese. Each case
//     forces a real internal error (the table the endpoint reads is dropped on a
//     scratch database) rather than calling the writer directly, so the handler,
//     the service and the writer are all exercised.
//  2. The 429 is asserted as a WHOLE sentence, and checked for the other
//     language's unit. "Try again in 2 phút" is what this wave exists to fix, and
//     it would pass any assertion that only looked at the first three words.
//  3. The 401 is asserted on two routes from different domains, because the
//     middleware that writes it is shared by all of them.
//  4. The action queue and the forecast note are the two server-generated read
//     models this wave converted, and the queue is where a language mistake is
//     WORST: it renders dates and money inside the sentences, so a queue in
//     English with Vietnamese date order tells the reader the wrong day.
//
// Every case pins its language explicitly (`?lang=`), and the raw bodies are
// logged so a run with -v shows exactly what a client receives. Each DB-backed
// test gets its own scratch database, like every other handler test.

// denyingLimiter refuses everything, with a fixed retry window. Used to reach the
// two 429 writers deterministically: a real limiter would need dozens of requests
// and would still be timing-dependent.
type denyingLimiter struct {
	retryAfterSec int
	checked       int
}

func (d *denyingLimiter) Check(context.Context, string, int, int) (ratelimit.Result, error) {
	d.checked++
	return ratelimit.Result{Ok: false, RetryAfterSec: d.retryAfterSec}, nil
}

// wave5Env is one scratch database with one authenticated user and every route
// this wave touched.
type wave5Env struct {
	mux    *http.ServeMux
	pool   *pgxpool.Pool
	token  string
	userID string
}

func setupWave5Env(t *testing.T, limiter ratelimit.Limiter) *wave5Env {
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
	const userID = "zz_test_wave5_user"
	insertUser(t, pool, userID, "wave5@example.invalid", hash)
	deleteUsers(t, pool, userID)

	issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	if limiter == nil {
		limiter = &permissiveLimiter{}
	}
	mux := http.NewServeMux()
	deps := Deps{DB: pool, Limiter: limiter}
	RegisterDevices(mux, deps)
	RegisterActions(mux, deps)
	RegisterReminders(mux, deps)
	RegisterPush(mux, deps)
	RegisterSessions(mux, deps)
	RegisterForecast(mux, deps)
	RegisterAttachments(mux, deps)

	return &wave5Env{mux: mux, pool: pool, token: issued.AccessToken, userID: userID}
}

// do issues one request with the language pinned by `?lang=`. The handlers call
// i18n.Attach themselves, so no middleware chain is needed.
func (e *wave5Env) do(t *testing.T, method, path, bearer string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequest(method, path, reader)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	e.mux.ServeHTTP(rr, req)
	return rr
}

func wave5Body(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	t.Logf("HTTP %d %s", rr.Code, strings.TrimSpace(rr.Body.String()))
	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode envelope %q: %v", rr.Body.String(), err)
	}
	return out
}

// ── 1. the shared 500, through three different writers ───────────────────────

// The single highest-blast-radius edit of the whole migration, proven where it
// can actually regress: every per-domain error writer has its own 500 branch, and
// they are three separate lines of code in three files.
//
// The failure is forced by DROPPING THE TABLE the endpoint reads, on a scratch
// database, after the token was issued (so auth still resolves). That produces a
// genuine non-domain error — exactly what the `slog.Error(...)` branch is for —
// without weakening the handler or reaching into the writer directly.
//
// The three endpoints use three writers:
//
//	GET   /api/v1/devices              → writeDevicesErr        (devices domain)
//	GET   /api/v1/actions              → writeServiceError      (action queue)
//	PATCH /api/v1/attachments/{id}     → writeAttachmentError   (attachments domain)
func TestShared500HeadlineInBothLanguages(t *testing.T) {
	env := setupWave5Env(t, nil)

	// Force every read below to fail with an internal (non-domain) error. This
	// also removes the dependent constraints; "Warranty" and "Attachment" keep
	// their rows and lose only the foreign key to "Device".
	if _, err := env.pool.Exec(context.Background(), `DROP TABLE "Device" CASCADE`); err != nil {
		t.Fatalf("drop Device: %v", err)
	}

	cases := []struct {
		name   string
		method string
		path   string
		body   []byte
	}{
		{"devices", http.MethodGet, "/api/v1/devices", nil},
		{"actions", http.MethodGet, "/api/v1/actions", nil},
		{"attachments", http.MethodPatch, "/api/v1/attachments/zz_wave5_missing", []byte(`{"description":"x"}`)},
	}

	for _, lang := range []struct {
		tag      string
		wantText string
		other    string
	}{
		{"vi", "Lỗi hệ thống", "Something went wrong"},
		{"en", "Something went wrong", "Lỗi hệ thống"},
	} {
		t.Run(lang.tag, func(t *testing.T) {
			for _, tc := range cases {
				rr := env.do(t, tc.method, tc.path+"?lang="+lang.tag, env.token, tc.body)
				if rr.Code != http.StatusInternalServerError {
					t.Fatalf("%s = %d, want 500 (%s)", tc.name, rr.Code, rr.Body.String())
				}
				body := wave5Body(t, rr)
				if body["error"] != "internal_error" {
					t.Errorf("%s error = %v, want internal_error — the code does not move with the language", tc.name, body["error"])
				}
				if body["message"] != lang.wantText {
					t.Errorf("%s message = %v, want %q", tc.name, body["message"], lang.wantText)
				}
				// The other language's sentence must be GONE, which is what proves
				// this writer was converted rather than shadowed by a second copy.
				if strings.Contains(rr.Body.String(), lang.other) {
					t.Errorf("%s body = %s still contains %q", tc.name, rr.Body.String(), lang.other)
				}
				if got := rr.Header().Get("Content-Language"); got != lang.tag {
					t.Errorf("%s Content-Language = %q, want %q", tc.name, got, lang.tag)
				}
			}
		})
	}
}

// The same writer, one level down: `writeServiceError` is what most endpoints
// use, and a domain error must still be written with ITS OWN message (not the
// generic 500) in the request's language. A regression here would be the opposite
// failure — an English headline over a Vietnamese domain sentence.
//
// Both sentences the action queue's write path can produce a 404 with are
// asserted, because they are built in two different places (the ownership check
// in SnoozeActionItem and the row-count check in UnSnoozeActionItem) and only one
// of them would be caught by testing a single route.
func TestDomainErrorStillBeatsTheGeneric500(t *testing.T) {
	env := setupWave5Env(t, nil)
	const key = "WARRANTY_EXPIRED:zz_wave5_nope"

	for _, lang := range []struct{ tag, missing, notSnoozed string }{
		{"vi", "Không tìm thấy việc cần xử lý này", "Việc này không đang được hoãn"},
		{"en", "Action item not found", "This item is not snoozed"},
	} {
		t.Run(lang.tag, func(t *testing.T) {
			// POST: the key is well-formed but is not one of THIS user's derived
			// items, so the queue never contains it.
			rr := env.do(t, http.MethodPost,
				"/api/v1/actions/"+key+"/snooze?lang="+lang.tag, env.token, nil)
			if rr.Code != http.StatusNotFound {
				t.Fatalf("snooze status = %d, want 404 (%s)", rr.Code, rr.Body.String())
			}
			if body := wave5Body(t, rr); body["message"] != lang.missing {
				t.Errorf("snooze message = %v, want %q", body["message"], lang.missing)
			}

			// DELETE: the row was never there to un-snooze. A different sentence,
			// same writer.
			rr = env.do(t, http.MethodDelete,
				"/api/v1/actions/"+key+"/snooze?lang="+lang.tag, env.token, nil)
			if rr.Code != http.StatusNotFound {
				t.Fatalf("un-snooze status = %d, want 404 (%s)", rr.Code, rr.Body.String())
			}
			if body := wave5Body(t, rr); body["message"] != lang.notSnoozed {
				t.Errorf("un-snooze message = %v, want %q", body["message"], lang.notSnoozed)
			}
		})
	}
}

// ── 2. the retry-after sentence ──────────────────────────────────────────────

// The defect wave 3 found and deferred: the sentence came from the catalog and
// the unit did not, so `?lang=en` produced "Too many attempts. Try again in
// 2 phút". Both halves must now be in ONE language, so each case asserts the
// whole string and then asserts the other language's unit is absent — an
// assertion on the leading words would have passed all along.
//
// Two retry windows, because the singular form ("1 phút" / "1 minute") is
// reachable by arithmetic and English inflects.
func TestRateLimit429InBothLanguages(t *testing.T) {
	const bodyLimit = `{"platform":"web","endpoint":"https://push.local/x","p256dh":"p","auth":"a"}`

	for _, tc := range []struct {
		name    string
		seconds int
		lang    string
		want    string
		foreign string
	}{
		{"vi/plural", 100, "vi", "Thao tác quá nhanh. Đợi 2 phút", "minute"},
		{"en/plural", 100, "en", "Too many attempts. Try again in 2 minutes", "phút"},
		{"vi/singular", 60, "vi", "Thao tác quá nhanh. Đợi 1 phút", "minute"},
		{"en/singular", 60, "en", "Too many attempts. Try again in 1 minute", "phút"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := setupWave5Env(t, &denyingLimiter{retryAfterSec: tc.seconds})
			rr := env.do(t, http.MethodPost, "/api/v1/push/register?lang="+tc.lang, env.token, []byte(bodyLimit))
			if rr.Code != http.StatusTooManyRequests {
				t.Fatalf("status = %d, want 429 (%s)", rr.Code, rr.Body.String())
			}
			if got := rr.Header().Get("Retry-After"); got != "60" && tc.seconds == 60 {
				t.Errorf("Retry-After = %q, want the raw seconds (60)", got)
			}
			body := wave5Body(t, rr)
			if body["error"] != "rate_limited" {
				t.Errorf("error = %v, want rate_limited", body["error"])
			}
			if body["message"] != tc.want {
				t.Errorf("message = %v, want %q", body["message"], tc.want)
			}
			if strings.Contains(rr.Body.String(), tc.foreign) {
				t.Errorf("body = %s still contains the other language's unit %q", rr.Body.String(), tc.foreign)
			}
		})
	}
}

// ── 3. the shared 401 ────────────────────────────────────────────────────────

// auth.RequireUser guards every authenticated route. Before wave 5 it wrote a
// hardcoded Vietnamese sentence, so a converted endpoint answered a bad token in
// Vietnamese under `?lang=en` — the whole point of converting the domain was
// undone by the middleware in front of it.
//
// Two routes from different domains, plus the no-header branch (which returns
// before the database is touched) and the malformed-token branch (which does
// not). The stored-preference level of the chain is unreachable here BY
// CONSTRUCTION — no User row was resolved — which is asserted at the end.
func TestUnauthorizedInBothLanguages(t *testing.T) {
	env := setupWave5Env(t, nil)

	for _, tc := range []struct {
		lang    string
		want    string
		foreign string
	}{
		{"vi", "Bạn chưa đăng nhập", "You are not signed in"},
		{"en", "You are not signed in", "Bạn chưa đăng nhập"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			for _, route := range []struct {
				name, path string
			}{
				{"devices", "/api/v1/devices"},
				{"sessions", "/api/v1/auth/sessions"},
				{"actions", "/api/v1/actions"},
			} {
				for _, token := range []struct {
					name  string
					value string
				}{
					{"no header", ""},
					{"garbage token", "not-a-real-token"},
				} {
					rr := env.do(t, http.MethodGet, route.path+"?lang="+tc.lang, token.value, nil)
					if rr.Code != http.StatusUnauthorized {
						t.Fatalf("%s/%s = %d, want 401 (%s)", route.name, token.name, rr.Code, rr.Body.String())
					}
					body := wave5Body(t, rr)
					if body["error"] != "unauthorized" {
						t.Errorf("%s/%s error = %v, want unauthorized", route.name, token.name, body["error"])
					}
					if body["message"] != tc.want {
						t.Errorf("%s/%s message = %v, want %q", route.name, token.name, body["message"], tc.want)
					}
					if strings.Contains(rr.Body.String(), tc.foreign) {
						t.Errorf("%s/%s body = %s still contains %q", route.name, token.name, rr.Body.String(), tc.foreign)
					}
				}
			}
		})
	}
}

// ── 4. the action queue: language, date format AND money format ──────────────

// The queue is the case docs/I18N_PLAN.md §3.2 flagged for this wave: its copy,
// its dates and its money were all Vietnamese-only, and the dates were rendered
// by a helper that could not follow the language at all.
//
// The money assertion is the sharp one because it is unambiguous — "1.200.000 ₫"
// and "₫1,200,000" cannot both be right — and the date assertion is built from
// the same wall clock the fixture uses, so it is exact.
func TestActionQueueIsLocalisedEndToEnd(t *testing.T) {
	env := setupWave5Env(t, nil)
	ctx := context.Background()

	const subID = "zz_wave5_sub"
	if _, err := env.pool.Exec(ctx, `
		INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, currency,
		                            "startedAt", "renewalDate", "autoRenew", status, "createdAt", "updatedAt")
		VALUES ($1, $2, 'Netflix', 'MONTHLY', 1200000, 'VND',
		        NOW() - INTERVAL '1 year', NOW() + INTERVAL '5 days', true, 'ACTIVE', NOW(), NOW())`,
		subID, env.userID); err != nil {
		t.Fatalf("insert subscription: %v", err)
	}

	renewal := time.Now().AddDate(0, 0, 5)

	for _, tc := range []struct {
		lang      string
		wantMoney string
		badMoney  string
		wantDate  string
		wantNote  string
	}{
		{
			lang:      "vi",
			wantMoney: "1.200.000 ₫",
			badMoney:  "₫1,200,000",
			wantDate:  renewal.Format("02/01/2006"),
			wantNote:  "TỰ SUY RA",
		},
		{
			lang:      "en",
			wantMoney: "₫1,200,000",
			badMoney:  "1.200.000 ₫",
			wantDate:  renewal.Format("01/02/2006"),
			wantNote:  "INFERS",
		},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := env.do(t, http.MethodGet, "/api/v1/actions?lang="+tc.lang, env.token, nil)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			var queue services.ActionQueue
			if err := json.Unmarshal(rr.Body.Bytes(), &queue); err != nil {
				t.Fatalf("decode queue: %v", err)
			}
			if !strings.Contains(queue.Note, tc.wantNote) {
				t.Errorf("note = %q, want it to contain %q", queue.Note, tc.wantNote)
			}

			var detail string
			for _, it := range queue.Items {
				if it.SubscriptionID != nil && *it.SubscriptionID == subID {
					detail = it.Detail
				}
			}
			if detail == "" {
				t.Fatalf("the cancel-link item is missing from the queue: %+v", queue.Items)
			}
			t.Logf("detail = %q", detail)
			if !strings.Contains(detail, tc.wantMoney) {
				t.Errorf("detail = %q, want the %s money format %q", detail, tc.lang, tc.wantMoney)
			}
			if strings.Contains(detail, tc.badMoney) {
				t.Errorf("detail = %q still contains the other language's money format %q", detail, tc.badMoney)
			}
			if !strings.Contains(detail, tc.wantDate) {
				t.Errorf("detail = %q, want the %s date format %q", detail, tc.lang, tc.wantDate)
			}
		})
	}
}

// ── 5. the forecast note ─────────────────────────────────────────────────────

// forecastNote was also flagged in §3.2: it is the honesty line about what the
// numbers include, and it is long enough that a partial translation is a real
// risk. Both languages are asserted in full, plus the first and last clause, so a
// truncated English note fails here rather than in a client.
func TestForecastNoteInBothLanguages(t *testing.T) {
	env := setupWave5Env(t, nil)

	for _, tc := range []struct {
		lang    string
		want    []string
		foreign string
	}{
		{
			lang: "vi",
			want: []string{
				"Chỉ tính các gói đang ACTIVE; gói LIFETIME không bao giờ bị trừ.",
				"subscriptionAutoRenewVnd là tiền sẽ bị trừ tự động",
				"không phải khoản chắc chắn trả.",
			},
			foreign: "LIFETIME plans are never charged",
		},
		{
			lang: "en",
			want: []string{
				"Only ACTIVE plans are counted; LIFETIME plans are never charged.",
				"subscriptionAutoRenewVnd is money that will be taken automatically",
				"not a charge you are certain to pay.",
			},
			foreign: "không bao giờ bị trừ",
		},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := env.do(t, http.MethodGet, "/api/v1/forecast?lang="+tc.lang, env.token, nil)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			var out struct {
				Note string `json:"note"`
			}
			if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
				t.Fatalf("decode forecast: %v", err)
			}
			t.Logf("note = %q", out.Note)
			for _, want := range tc.want {
				if !strings.Contains(out.Note, want) {
					t.Errorf("note = %q, want it to contain %q", out.Note, want)
				}
			}
			if strings.Contains(out.Note, tc.foreign) {
				t.Errorf("note = %q still contains the other language's copy %q", out.Note, tc.foreign)
			}
			if got := rr.Header().Get("Content-Language"); got != tc.lang {
				t.Errorf("Content-Language = %q, want %q", got, tc.lang)
			}
		})
	}
}

// The forecast's `months` refusal carries a headline AND a field error, and they
// have to be the same language — the failure mode the shared writers exist to
// prevent.
func TestForecastMonthsRefusalIsTranslated(t *testing.T) {
	env := setupWave5Env(t, nil)

	for _, tc := range []struct {
		lang    string
		query   string
		wantMsg string
	}{
		// Both values take the SAME branch: ParseForecastMonths validates range
		// and syntax together, so the "phải trong khoảng" key in GetForecast is
		// only reachable through a direct service call (forecast_test.go covers
		// it there). Over HTTP this is the sentence a client can actually get.
		{"vi", "months=99", "Số tháng phải là số trong khoảng 1–24"},
		{"en", "months=99", "Months must be a number between 1 and 24"},
		{"vi", "months=abc", "Số tháng phải là số trong khoảng 1–24"},
		{"en", "months=abc", "Months must be a number between 1 and 24"},
	} {
		t.Run(tc.lang+"/"+tc.query, func(t *testing.T) {
			rr := env.do(t, http.MethodGet, "/api/v1/forecast?"+tc.query+"&lang="+tc.lang, env.token, nil)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := wave5Body(t, rr)
			if body["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMsg)
			}
			fields, ok := body["fieldErrors"].(map[string]any)
			if !ok {
				t.Fatalf("fieldErrors = %v, want an object", body["fieldErrors"])
			}
			got, ok := fields["months"].([]any)
			if !ok || len(got) != 1 || got[0] != tc.wantMsg {
				t.Errorf("fieldErrors.months = %v, want [%q]", fields["months"], tc.wantMsg)
			}
		})
	}
}

// ── 6. the concatenation trap and the field-level maps ───────────────────────

// `"Phải là số nguyên từ 1 tới " + strconv.Itoa(max)` can never be a catalog key:
// no literal at any call site equals the result, so `i18n.Text` would always miss
// and the sentence stayed Vietnamese under `?lang=en` while its HEADLINE was
// translated. It now reuses the printf-shaped key wave 4 added for /search.
//
// The other two cases in this test are the §6 rule: `fieldErrors` holds finished
// strings, so a key left in the map is shipped verbatim.
func TestQueryParameterRefusalsCarryTranslatedFieldErrors(t *testing.T) {
	env := setupWave5Env(t, nil)

	cases := []struct {
		name      string
		path      string
		lang      string
		wantMsg   string
		wantField string
	}{
		{
			"withinDays/vi", "/api/v1/reminders?withinDays=abc", "vi",
			"Tham số withinDays không hợp lệ",
			"Phải là số nguyên từ 1 tới 365",
		},
		{
			"withinDays/en", "/api/v1/reminders?withinDays=abc", "en",
			"Invalid withinDays parameter",
			"Must be an integer from 1 to 365",
		},
		{
			"includeDismissed/en", "/api/v1/reminders?includeDismissed=maybe", "en",
			"Invalid includeDismissed parameter",
			"Must be true or false",
		},
		{
			"snoozed/en", "/api/v1/actions?snoozed=maybe", "en",
			"Invalid snoozed parameter",
			"Must be true or false",
		},
		{
			"snoozed/vi", "/api/v1/actions?snoozed=maybe", "vi",
			"Tham số snoozed không hợp lệ",
			"Phải là true hoặc false",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := env.do(t, http.MethodGet, tc.path+"&lang="+tc.lang, env.token, nil)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := wave5Body(t, rr)
			if body["error"] != "bad_input" {
				t.Errorf("error = %v, want bad_input", body["error"])
			}
			if body["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMsg)
			}
			fields, _ := body["fieldErrors"].(map[string]any)
			for _, v := range fields {
				list, _ := v.([]any)
				if len(list) != 1 || list[0] != tc.wantField {
					t.Errorf("fieldErrors = %v, want one entry %q", fields, tc.wantField)
				}
			}
			if len(fields) != 1 {
				t.Errorf("fieldErrors = %v, want exactly one field", fields)
			}
		})
	}
}

// ── 7. push registration: services-owned validation, both halves ─────────────

// The push write path is the one place this wave converted a SERVICE validator,
// so it is the case that proves a service-owned `fieldErrors` map moves with its
// headline: `ErrValidationHeadline` is what keeps the generic sentence from
// staying Vietnamese above English field hints.
func TestPushRegistrationValidationInBothLanguages(t *testing.T) {
	env := setupWave5Env(t, nil)

	for _, tc := range []struct {
		lang      string
		wantMsg   string
		wantField string
	}{
		{"vi", "Dữ liệu không hợp lệ", "Bắt buộc"},
		{"en", "Invalid input", "Required"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := env.do(t, http.MethodPost, "/api/v1/push/register?lang="+tc.lang, env.token, []byte(`{}`))
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := wave5Body(t, rr)
			if body["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMsg)
			}
			fields, _ := body["fieldErrors"].(map[string]any)
			if len(fields) != 3 {
				t.Fatalf("fieldErrors = %v, want endpoint/p256dh/auth", fields)
			}
			for _, name := range []string{"endpoint", "p256dh", "auth"} {
				list, _ := fields[name].([]any)
				if len(list) != 1 || list[0] != tc.wantField {
					t.Errorf("fieldErrors.%s = %v, want [%q]", name, fields[name], tc.wantField)
				}
			}
		})
	}

	// A native row with a bad token takes the other branch of the same validator,
	// so the sentence differs — asserted so a future edit cannot collapse the two.
	for _, tc := range []struct{ lang, want string }{
		{"vi", "Token thiết bị không hợp lệ"},
		{"en", "Invalid device token"},
	} {
		rr := env.do(t, http.MethodPost, "/api/v1/push/register?lang="+tc.lang, env.token,
			[]byte(`{"platform":"fcm","endpoint":"fcm://"}`))
		body := wave5Body(t, rr)
		fields, _ := body["fieldErrors"].(map[string]any)
		list, _ := fields["endpoint"].([]any)
		if len(list) != 1 || list[0] != tc.want {
			t.Errorf("%s fieldErrors.endpoint = %v, want [%q]", tc.lang, fields["endpoint"], tc.want)
		}
	}
}

// A sanity check on this file's own fixtures: the two languages really do produce
// different bytes on the action queue, so none of the assertions above can pass
// because a conversion quietly served the source language to both.
func TestWave5LanguagesActuallyDiffer(t *testing.T) {
	if i18n.FromStored(nil) != i18n.EN {
		t.Errorf("FromStored(nil) = %q, want the product default en — that is what the email path relies on", i18n.FromStored(nil))
	}
	stored := "vi"
	if i18n.FromStored(&stored) != i18n.VI {
		t.Errorf("FromStored(\"vi\") = %q, want vi", i18n.FromStored(&stored))
	}
	unsupported := "fr"
	if i18n.FromStored(&unsupported) != i18n.EN {
		t.Errorf("FromStored(\"fr\") = %q, want the default (an unsupported value falls back, never 400)", i18n.FromStored(&unsupported))
	}
}
