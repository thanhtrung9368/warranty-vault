package i18n

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ── Precedence ───────────────────────────────────────────────────────────────
//
// The four levels, all four exercised in one table so a future reordering cannot
// pass by accident. The doc comment in i18n.go is the spec; this is the pin.
//
// Every case names its expectation explicitly. None of them reads the machine's
// locale: the whole point of `?lang=` and of passing an explicit header is that a
// test can pin the language it is asserting (docs/I18N_PLAN.md §4.3 — 118 test
// files in this repo assert Vietnamese strings and the ones that keep asserting
// them must say so).

func TestPrecedenceChain(t *testing.T) {
	for _, tc := range []struct {
		name       string
		langQuery  string
		header     string
		storedUser *string
		want       Tag
	}{
		{
			name: "1 — ?lang beats everything",
			// Deliberately disagrees with both other levels: were the order
			// wrong, this case fails, which is the only reason to include it.
			langQuery: "vi", header: "en-US,en;q=0.9", storedUser: strp("en"), want: VI,
		},
		{
			name:   "2 — Accept-Language beats the stored preference",
			header: "vi", storedUser: strp("en"), want: VI,
		},
		{
			name:       "3 — stored preference wins when the request says nothing",
			storedUser: strp("vi"), want: VI,
		},
		{
			name:       "4 — nothing said anywhere falls back to the default",
			storedUser: nil, want: EN,
		},
		{
			name: "NULL stored preference is the same as absent",
			// Every row that exists before migration 0014 has locale = NULL.
			storedUser: nil, header: "", want: EN,
		},
		{
			name:      "?lang=en overrides a Vietnamese stored preference",
			langQuery: "en", storedUser: strp("vi"), want: EN,
		},
		{
			name:      "?lang=EN is accepted case-insensitively",
			langQuery: "EN", header: "vi", want: EN,
		},
		{
			name:   "a regional header tag resolves to its base language",
			header: "vi-VN,vi;q=0.9", want: VI,
		},
		{
			name:   "a q-weighted list picks the highest-preference supported tag",
			header: "fr-FR,vi;q=0.9,en;q=0.3", want: VI,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
			if tc.langQuery != "" {
				q := r.URL.Query()
				q.Set("lang", tc.langQuery)
				r.URL.RawQuery = q.Encode()
			}
			if tc.header != "" {
				r.Header.Set("Accept-Language", tc.header)
			}

			// Mirror the production wiring: Middleware seeds the request-derived
			// level, the auth middleware would then add the stored one.
			var ctx context.Context
			h := Middleware(http.HandlerFunc(func(_ http.ResponseWriter, inner *http.Request) {
				ctx = inner.Context()
			}))
			h.ServeHTTP(httptest.NewRecorder(), r)

			ctx = WithUserLocale(ctx, tc.storedUser)
			if got := From(ctx); got != tc.want {
				t.Errorf("From(ctx) = %q, want %q", got, tc.want)
			}
			// TagFor is the whole-request view and must agree.
			if got := TagFor(r.WithContext(ctx)); got != tc.want {
				t.Errorf("TagFor(r) = %q, want %q", got, tc.want)
			}
		})
	}
}

// An unsupported language falls back. It is NOT a 400 and NOT an error: a client
// sending `Accept-Language: fr` gets English and a 200 (docs/I18N_PLAN.md §2.2).
func TestUnsupportedLanguageFallsBackToDefault(t *testing.T) {
	for _, tc := range []struct {
		name      string
		langQuery string
		header    string
		want      Tag
		// wantContentLanguage is the Content-Language header the response must
		// carry. "" means NO header: a request that sent no language signal at
		// all gets none, because the body of an unconverted endpoint is still a
		// Vietnamese literal and claiming English for it would be a lie. A
		// request that DID send something — even something we cannot honour —
		// gets the language it will actually be served in.
		wantContentLanguage string
	}{
		{name: "unsupported header", header: "fr", want: EN, wantContentLanguage: "en"},
		{name: "unsupported header with a region", header: "fr-CA,fr;q=0.9", want: EN, wantContentLanguage: "en"},
		{name: "unsupported script language", header: "zh-Hans-CN", want: EN, wantContentLanguage: "en"},
		{name: "malformed header", header: "!!!not-a-language!!!", want: EN, wantContentLanguage: "en"},
		{name: "wildcard header", header: "*", want: EN, wantContentLanguage: "en"},
		// q=0 means "not acceptable" — treating it as a match would pin English
		// and make the stored preference unreachable.
		{name: "explicitly rejected language", header: "en;q=0", want: EN, wantContentLanguage: "en"},
		{name: "unsupported ?lang falls through to the next level", langQuery: "fr", header: "vi", want: VI, wantContentLanguage: "vi"},
		{
			name: "unsupported ?lang with nothing else falls to the default",
			// The client asked (`?lang=de`), so it is told what it got: English.
			// Only a request that asks NOTHING gets no Content-Language header.
			langQuery: "de", want: EN, wantContentLanguage: "en",
		},
		// A permissive parser would map "vi-VN" onto VI here; the OpenAPI contract
		// for ?lang= says the exact literals only.
		{name: "?lang=vi-VN is not one of the two documented literals", langQuery: "vi-VN", want: EN, wantContentLanguage: "en"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
			if tc.langQuery != "" {
				q := r.URL.Query()
				q.Set("lang", tc.langQuery)
				r.URL.RawQuery = q.Encode()
			}
			if tc.header != "" {
				r.Header.Set("Accept-Language", tc.header)
			}

			var ctx context.Context
			h := Middleware(http.HandlerFunc(func(_ http.ResponseWriter, inner *http.Request) {
				ctx = inner.Context()
			}))
			// No stored preference: the fallback must come from the resolver, not
			// from a level-3 rescue.
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, r)
			ctx = WithUserLocale(ctx, nil)

			if got := From(ctx); got != tc.want {
				t.Errorf("From(ctx) = %q, want %q", got, tc.want)
			}
			if rec.Code == http.StatusBadRequest {
				t.Errorf("response was 400 — an unsupported language must never be a validation error")
			}
			if got := rec.Header().Get("Content-Language"); got != tc.wantContentLanguage {
				t.Errorf("Content-Language = %q, want %q", got, tc.wantContentLanguage)
			}
		})
	}
}

// An unsupported STORED value (a hand-edited row, or a language that was removed)
// must not leak through either.
func TestUnsupportedStoredLocaleIsIgnored(t *testing.T) {
	ctx := WithUserLocale(context.Background(), strp("klingon"))
	if got := From(ctx); got != EN {
		t.Errorf("From(ctx) = %q, want the default %q", got, EN)
	}
}

// Attach must not clobber a tag that is already resolved.
//
// The ordering that makes this load-bearing: auth.RequireUser runs BEFORE the
// handler and attaches the stored preference (level 3); the handler then calls
// Attach to pick up `?lang=`/Accept-Language when it was invoked outside the
// middleware chain. If Attach overwrote an existing tag, level 3 would be lost on
// exactly the endpoints that use it.
func TestAttachPreservesAnAlreadyResolvedTag(t *testing.T) {
	// Simulate what the auth middleware did: level 3 only, no request signal.
	r := httptest.NewRequest(http.MethodPatch, "/api/v1/auth/me", nil)
	r = r.WithContext(WithUserLocale(r.Context(), strp("vi")))
	if got := From(Attach(r)); got != VI {
		t.Errorf("Attach dropped the stored preference: got %q, want %q", got, VI)
	}

	// A request signal still wins.
	r2 := httptest.NewRequest(http.MethodPatch, "/api/v1/auth/me?lang=en", nil)
	r2 = r2.WithContext(WithUserLocale(r2.Context(), strp("vi")))
	if got := From(Attach(r2)); got != EN {
		t.Errorf("Attach ignored ?lang=en over the stored preference: got %q, want %q", got, EN)
	}
}

// A request-derived language beats the stored preference because Middleware
// already recorded a decision — WithUserLocale must not overwrite it.
func TestWithUserLocaleDoesNotOverrideARequestSignal(t *testing.T) {
	ctx := WithTag(context.Background(), VI)
	ctx = WithUserLocale(ctx, strp("en"))
	if got := From(ctx); got != VI {
		t.Errorf("WithUserLocale overrode the request signal: got %q, want %q", got, VI)
	}
}

// ── Translation + fallback ───────────────────────────────────────────────────

// A key that is in the catalog in only ONE language must render that language
// rather than an empty string or the key. This is the contract that lets Phase 1
// land in parallel across agents without a broken window.
//
// The entry is injected rather than found, so the test is deterministic and does
// not depend on some real string being untranslated — the moment Phase 1 finishes
// the job, a real gap would close and the test would stop testing anything.
func TestMissingTranslationFallsBackToTheOtherLanguage(t *testing.T) {
	const viOnly = "zz test — chỉ có tiếng Việt"
	const enOnly = "zz test — English only"

	messages[viOnly] = message{vi: "Xin chào", en: ""}
	messages[enOnly] = message{vi: "", en: "Hello"}
	t.Cleanup(func() {
		delete(messages, viOnly)
		delete(messages, enOnly)
	})

	if got := Translate(EN, viOnly); got != "Xin chào" {
		t.Errorf("English lookup of a Vietnamese-only entry = %q, want the Vietnamese text", got)
	}
	if got := Translate(VI, viOnly); got != "Xin chào" {
		t.Errorf("Vietnamese lookup = %q, want %q", got, "Xin chào")
	}
	if got := Translate(VI, enOnly); got != "Hello" {
		t.Errorf("Vietnamese lookup of an English-only entry = %q, want the English text", got)
	}
	if got := Translate(EN, enOnly); got != "Hello" {
		t.Errorf("English lookup = %q, want %q", got, "Hello")
	}

	// Never empty, in either direction.
	for _, tag := range []Tag{VI, EN} {
		if got := Translate(tag, viOnly); got == "" {
			t.Errorf("Translate(%q, vietnamese-only) returned an empty string", tag)
		}
		if got := Translate(tag, enOnly); got == "" {
			t.Errorf("Translate(%q, english-only) returned an empty string", tag)
		}
	}
}

// A key that is in NO language returns the key — which is the Vietnamese source
// text, i.e. exactly what the endpoint served before this change. It never
// returns an identifier or an empty string.
func TestUnknownKeyReturnsTheVietnameseSourceText(t *testing.T) {
	const unknown = "Một câu chưa có trong catalog"
	for _, tag := range []Tag{VI, EN, Tag("fr")} {
		if got := Translate(tag, unknown); got != unknown {
			t.Errorf("Translate(%q, unknown key) = %q, want the key itself", tag, got)
		}
	}
}

// Interpolation uses Sprintf verbs, and the args go in only when there are args —
// so a message that happens to contain a literal `%` survives intact.
//
// The messages are built through nonConstant() on purpose: `go vet` treats
// Translate/Interpolate as printf wrappers (correctly — that is their contract),
// and a literal format string containing a bare `%` is a vet error. The runtime
// case being tested is precisely the one vet cannot see, because in production the
// format string always comes out of the catalog map rather than from a literal at
// the call site.
func TestInterpolate(t *testing.T) {
	withVerb := nonConstant("Còn %d ngày")
	if got := Interpolate(withVerb, 3); got != "Còn 3 ngày" {
		t.Errorf("Interpolate = %q, want %q", got, "Còn 3 ngày")
	}
	// The no-argument path must not run Sprintf at all, or a message containing a
	// bare `%` would be mangled — the one hazard of using Sprintf verbs as the
	// interpolation syntax. Asserted through Translate, which is the shape every
	// static call site uses.
	literalPercent := nonConstant("100% chính hãng")
	messages[literalPercent] = message{vi: literalPercent, en: "100% genuine"}
	t.Cleanup(func() { delete(messages, literalPercent) })
	// Text, not Translate: the no-argument path is a different function exactly so
	// that a key which is not a literal at the call site never reaches Sprintf.
	if got := Text(WithTag(context.Background(), EN), literalPercent); got != "100% genuine" {
		t.Errorf("a literal %% was mangled: %q", got)
	}
	if got := Text(ctxVIStub(), literalPercent); got != "100% chính hãng" {
		t.Errorf("a literal %% was mangled in the source language: %q", got)
	}
	if got := Translate(EN, nonConstant("Còn %d ngày"), 3); got != "Còn 3 ngày" {
		t.Errorf("Translate with an unknown key must still interpolate: %q", got)
	}
}

// ── Resulting HTTP behaviour ─────────────────────────────────────────────────

// The resolver must leave status codes alone entirely: the only observable HTTP
// effect of an unsupported language is the Content-Language header.
func TestMiddlewareNeverChangesTheStatus(t *testing.T) {
	for _, header := range []string{"", "fr", "vi", "!!junk!!", "*"} {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
		if header != "" {
			r.Header.Set("Accept-Language", header)
		}
		rec := httptest.NewRecorder()
		Middleware(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusTeapot)
			_, _ = w.Write([]byte("body"))
		})).ServeHTTP(rec, r)
		if rec.Code != http.StatusTeapot {
			t.Errorf("Accept-Language %q changed the status to %d", header, rec.Code)
		}
		if rec.Body.String() != "body" {
			t.Errorf("Accept-Language %q changed the body to %q", header, rec.Body.String())
		}
	}
}

func TestMiddlewareSetsContentLanguageForEveryRequest(t *testing.T) {
	for _, tc := range []struct {
		query  string
		header string
		want   string
	}{
		{query: "vi", want: "vi"},
		{query: "vi", header: "en", want: "vi"}, // query wins
		{header: "vi-VN", want: "vi"},
		{header: "fr", want: "en"}, // sent a signal, so it gets told what it got
		{header: "", want: ""},     // sent nothing, so it is told nothing
		{query: "fr", want: "en"},  // asked for something we do not ship → told what it got
	} {
		r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
		if tc.query != "" {
			q := r.URL.Query()
			q.Set("lang", tc.query)
			r.URL.RawQuery = q.Encode()
		}
		if tc.header != "" {
			r.Header.Set("Accept-Language", tc.header)
		}
		rec := httptest.NewRecorder()
		Middleware(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(rec, r)
		if got := rec.Header().Get("Content-Language"); got != tc.want {
			t.Errorf("query=%q header=%q → Content-Language %q, want %q", tc.query, tc.header, got, tc.want)
		}
	}
}

// ── Value formatting ─────────────────────────────────────────────────────────

func TestFormatDateFollowsTheLanguage(t *testing.T) {
	d := time.Date(2026, time.July, 5, 12, 0, 0, 0, time.UTC)
	// The same instant, two readings — which is exactly why the date follows the
	// language and not the server.
	if got := FormatDate(VI, d); got != "05/07/2026" {
		t.Errorf("FormatDate(vi) = %q, want 05/07/2026 (dd/mm/yyyy)", got)
	}
	if got := FormatDate(EN, d); got != "07/05/2026" {
		t.Errorf("FormatDate(en) = %q, want 07/05/2026 (mm/dd/yyyy)", got)
	}
}

func TestFormatMoney(t *testing.T) {
	for _, tc := range []struct {
		amount int32
		vi, en string
	}{
		{0, "0 ₫", "₫0"},
		{1200000, "1.200.000 ₫", "₫1,200,000"},
		{12345, "12.345 ₫", "₫12,345"},
		{-1500, "-1.500 ₫", "-₫1,500"},
	} {
		if got := FormatMoney(VI, tc.amount); got != tc.vi {
			t.Errorf("FormatMoney(vi, %d) = %q, want %q", tc.amount, got, tc.vi)
		}
		if got := FormatMoney(EN, tc.amount); got != tc.en {
			t.Errorf("FormatMoney(en, %d) = %q, want %q", tc.amount, got, tc.en)
		}
	}
}

// ── Normalize ────────────────────────────────────────────────────────────────

func TestNormalize(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want Tag
		ok   bool
	}{
		{"vi", VI, true},
		{"VI", VI, true},
		{" vi ", VI, true},
		{"vi-VN", VI, true},
		{"vi-VN-u-nu-latn", VI, true},
		{"en", EN, true},
		{"en-US", EN, true},
		{"", "", false},
		{"   ", "", false},
		{"fr", "", false},
		{"de-DE", "", false},
		{"!!junk!!", "", false},
	} {
		got, ok := Normalize(tc.in)
		if ok != tc.ok || got != tc.want {
			t.Errorf("Normalize(%q) = (%q, %v), want (%q, %v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}

func TestIsSupported(t *testing.T) {
	for _, tag := range []Tag{VI, EN} {
		if !IsSupported(tag) {
			t.Errorf("IsSupported(%q) = false", tag)
		}
	}
	for _, tag := range []Tag{"fr", "", "vi-VN"} {
		if IsSupported(tag) {
			t.Errorf("IsSupported(%q) = true", tag)
		}
	}
	if !IsSupported(Default) {
		t.Errorf("the default language %q is not in the supported set", Default)
	}
}

// The documented languages are exactly the two the catalog has columns for; a
// third one added to `Supported` without a column would be a silent hole.
func TestSupportedMatchesTheCatalogColumns(t *testing.T) {
	for _, tag := range Supported {
		switch tag {
		case VI, EN:
		default:
			t.Errorf("Supported contains %q, which has no column in `message`", tag)
		}
	}
	if len(Supported) != 2 {
		t.Errorf("len(Supported) = %d, want 2 (vi, en)", len(Supported))
	}
}

func strp(s string) *string { return &s }

// nonConstant returns s in a way the compiler cannot fold back to a constant, so
// the `printf` analyzer does not read the message as a malformed format string at
// the call site. In production the format string always comes out of the catalog
// map; this reproduces that runtime position.
func nonConstant(s string) string {
	return strings.Join([]string{s}, "")
}

// Guards against the query-param reader accepting anything a proxy might append.
func TestQueryTagIgnoresExtraParameters(t *testing.T) {
	r := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me?withinDays=7&lang=vi&limit=20", nil)
	if got, ok := QueryTag(r); !ok || got != VI {
		t.Errorf("QueryTag = (%q, %v), want (vi, true)", got, ok)
	}
	r = httptest.NewRequest(http.MethodGet, "/api/v1/auth/me?language=vi", nil)
	if got, ok := QueryTag(r); ok {
		t.Errorf("QueryTag read a different parameter name: (%q, %v)", got, ok)
	}
	if !strings.Contains(r.URL.RawQuery, "language=vi") {
		t.Fatal("fixture is wrong")
	}
}
