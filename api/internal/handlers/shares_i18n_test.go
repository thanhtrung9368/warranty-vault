package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Wave 4's proof for the PUBLIC share certificate — the one document in this
// service with no authenticated user behind it (docs/I18N_PLAN.md §3).
//
// The product decision under test: a recipient is a third party holding a
// forwarded link, they never chose a language in this app, and there is no
// `User.locale` to fall back on (that column belongs to the OWNER). So the page
// follows what the RECIPIENT's own client sends — `?lang=`, then Accept-Language —
// and falls back to VIETNAMESE, not to the product default English, because this is
// a durable artifact: links minted before this wave and non-browser fetchers carry
// no Accept-Language, and a certificate that flips language under someone who
// already printed it is not recoverable. See handlers.publicShareLanguage.
//
// Two properties are asserted here that nothing else covers:
//
//  1. The four failure cases (expired / revoked / never minted / whitespace token)
//     render BYTE-IDENTICAL bodies *within* each language, while the two languages
//     differ from each other. That combination is the security contract: the
//     language is client-supplied and says nothing about the token, and the reason
//     for the failure must not be inferable in either language.
//  2. The page's own labels and its date FORMAT follow the language. The two
//     formats are genuinely ambiguous against each other ("05/07/2026" is 5 July in
//     one and 7 May in the other), which is why the format cannot stay fixed while
//     the words move.

// publicShareGet fetches the certificate in a named language. It deliberately does
// NOT reuse shares_test.go::getPublic, which pins `?lang=vi` for the security
// suite: this helper's whole purpose is to vary the language, and one of its cases
// sends no signal at all.
func publicShareGet(t *testing.T, env shareTestEnv, token, accept, lang string) *httptest.ResponseRecorder {
	t.Helper()
	path := "/api/v1/public/shares/" + token
	if lang != "" {
		path += "?lang=" + lang
	}
	return publicShareRaw(env, path, accept, "")
}

// publicShareRaw is the no-defaults form: the caller controls the URL (including
// whether `?lang=` is present at all) and any Accept-Language.
func publicShareRaw(env shareTestEnv, path, accept, acceptLanguage string) *httptest.ResponseRecorder {
	if accept == "" {
		accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
	}
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Accept", accept)
	if acceptLanguage != "" {
		req.Header.Set("Accept-Language", acceptLanguage)
	}
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	return rr
}

// ── 1. the certificate page itself, both languages ──────────────────────────

func TestPublicCertificatePageRendersInBothLanguages(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	token, _ := createShare(t, env, "share_dev", `{"includeSerial":true}`)
	if token == "" {
		t.Fatal("could not mint a share")
	}

	for _, tc := range []struct {
		lang string
		// want lists strings the page MUST contain; absent lists strings that belong
		// to the other language and must therefore be gone.
		want   []string
		absent []string
	}{
		{
			lang: "vi",
			want: []string{
				`<html lang="vi">`,
				"Phiếu bàn giao bảo hành",
				"Bảo hành còn lại tới",
				"Số máy (IMEI/serial)",
				"Ngày mua",
				"Trạng thái",
				"Gói bảo hành",
				"ĐT: 028 3822 9999",
				"Tiêu chuẩn",
				"Đã bán",
				// dd/mm/yyyy: the fixture soldAt is 2026-05-02 and the warranty ends
				// 2026-11-20. The two languages put the same instants on the page in a
				// different order, which is the point of asserting both.
				"02/05/2026",
				"20/11/2026",
				// What the document says it is NOT: its disclaimer, and the link's own
				// lifetime.
				"Phiếu này do chủ máy tạo từ ứng dụng Warranty Vault",
				"Link này hết hiệu lực sau ngày",
				"24 tháng",
			},
			absent: []string{"Warranty handover certificate", "Phone: 028", "24 months"},
		},
		{
			lang: "en",
			want: []string{
				`<html lang="en">`,
				"Warranty handover certificate",
				"Warranty covered until",
				"Serial number (IMEI/serial)",
				"Purchase date",
				"Status",
				"Warranty plan",
				"Phone: 028 3822 9999",
				"Standard",
				"Sold",
				// mm/dd/yyyy for the same two instants.
				"05/02/2026",
				"11/20/2026",
				"This certificate was created by the device owner",
				"This link stops working after",
				"24 months",
			},
			absent: []string{"Phiếu bàn giao bảo hành", "ĐT: 028", "24 tháng", "Ngày mua"},
		},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := publicShareGet(t, env, token, "", tc.lang)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			html := rr.Body.String()
			if cl := rr.Header().Get("Content-Language"); cl != tc.lang {
				t.Errorf("Content-Language = %q, want %q — the header must name the language the body was rendered in", cl, tc.lang)
			}
			for _, want := range tc.want {
				if !strings.Contains(html, want) {
					t.Errorf("html (%s) is missing %q", tc.lang, want)
				}
			}
			for _, absent := range tc.absent {
				if strings.Contains(html, absent) {
					t.Errorf("html (%s) still contains the other language's %q", tc.lang, absent)
				}
			}
			// The security properties of the page do not move with the language.
			for _, forbidden := range []string{"<script", "http://", "https://", "<link", "<iframe"} {
				if strings.Contains(html, forbidden) {
					t.Errorf("html (%s) is not self-contained: contains %q", tc.lang, forbidden)
				}
			}
			if strings.Contains(html, token) {
				t.Errorf("html (%s) echoes the raw token", tc.lang)
			}
		})
	}
}

// The "no date at all" case: a device with no warranty rows reaches the same
// slot as a package without an end date, because `effectiveWarrantyEnd` is nil in
// both. The sentence that fills it is page copy like any other.
//
// `Warranty.endDate` is NOT NULL in the schema (migration 0001), so the reachable
// state is "no package", which is what this test builds — clearing the column is
// not something a client can do.
func TestPublicCertificateWithoutAPackageSaysSoInBothLanguages(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	if _, err := env.pool.Exec(t.Context(),
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ('share_dev_no_war', $1, 'Máy chưa có phiếu', 'PHONE', '2025-01-01', 1000, NOW())`,
		shareOwner); err != nil {
		t.Fatalf("insert device without a warranty: %v", err)
	}
	token, rr := createShare(t, env, "share_dev_no_war", "")
	if token == "" {
		t.Fatalf("create share failed: %d (%s)", rr.Code, rr.Body.String())
	}

	for _, tc := range []struct {
		lang      string
		want      string
		otherLang string
	}{
		{"vi", "Không có ngày hết hạn", "No expiry date"},
		{"en", "No expiry date", "Không có ngày hết hạn"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := publicShareGet(t, env, token, "", tc.lang)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), tc.want) {
				t.Errorf("html (%s) is missing %q", tc.lang, tc.want)
			}
			if strings.Contains(rr.Body.String(), tc.otherLang) {
				t.Errorf("html (%s) contains the other language's %q", tc.lang, tc.otherLang)
			}
		})
	}
}

// The recipient's own browser is the level that needs no cooperation from the
// owner: a Vietnamese phone sends `Accept-Language: vi` and gets Vietnamese, an
// English one gets English. `?lang=` only has to WIN over it.
func TestPublicCertificateFollowsTheRecipientsAcceptLanguage(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	token, _ := createShare(t, env, "share_dev", "")
	if token == "" {
		t.Fatal("could not mint a share")
	}
	const path = "/api/v1/public/shares/"

	for _, tc := range []struct {
		name   string
		accept string
		want   string // Content-Language
		probe  string // a string only that language's page contains
	}{
		{"browser in Vietnamese", "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7", "vi", "Phiếu bàn giao bảo hành"},
		{"browser in English", "en-GB,en;q=0.9", "en", "Warranty handover certificate"},
		// An unsupported language is a FALLBACK, never an error, and the fallback here
		// is the source language of the document (see publicShareLanguage).
		{"browser in French", "fr-FR,fr;q=0.9", "vi", "Phiếu bàn giao bảo hành"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := publicShareRaw(env, path+token, "text/html", tc.accept)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			if cl := rr.Header().Get("Content-Language"); cl != tc.want {
				t.Errorf("Content-Language = %q, want %q", cl, tc.want)
			}
			if !strings.Contains(rr.Body.String(), tc.probe) {
				t.Errorf("page does not contain %q", tc.probe)
			}
		})
	}

	// `?lang=` is level 1: it beats the header in BOTH directions, which is what
	// makes it usable for a recipient whose browser sends nothing useful.
	for _, tc := range []struct{ lang, accept, probe string }{
		{"en", "vi-VN,vi;q=0.9", "Warranty handover certificate"},
		{"vi", "en-GB,en;q=0.9", "Phiếu bàn giao bảo hành"},
	} {
		rr := publicShareRaw(env, path+token+"?lang="+tc.lang, "text/html", tc.accept)
		if !strings.Contains(rr.Body.String(), tc.probe) {
			t.Errorf("?lang=%s did not beat Accept-Language %q", tc.lang, tc.accept)
		}
	}

	// A request with NO language signal at all — a link re-fetched after printing, a
	// curl, an old fetcher — gets the Vietnamese fallback, never a blank page and
	// never the product default. This is the durability decision, stated as a test.
	rr := publicShareRaw(env, path+token, "text/html", "")
	if cl := rr.Header().Get("Content-Language"); cl != "vi" {
		t.Errorf("no-signal Content-Language = %q, want vi (the certificate's own fallback)", cl)
	}
	if !strings.Contains(rr.Body.String(), "Phiếu bàn giao bảo hành") {
		t.Error("a request with no language signal did not render the Vietnamese certificate")
	}
}

// The JSON projection carries the same disclaimer in the same language, so a client
// that opts into JSON is not handed a different answer than the page.
func TestPublicCertificateJSONDisclaimerIsTranslated(t *testing.T) {
	env := setupShareTest(t)
	seedShareFixture(t, env.pool)
	token, _ := createShare(t, env, "share_dev", "")
	if token == "" {
		t.Fatal("could not mint a share")
	}

	for _, tc := range []struct {
		lang         string
		wantContains string
	}{
		{"vi", "Phiếu này do chủ máy tạo từ ứng dụng Warranty Vault"},
		{"en", "This certificate was created by the device owner"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := publicShareGet(t, env, token, "application/json", tc.lang)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			var body struct {
				Certificate services.SharedCertificate `json:"certificate"`
			}
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode certificate: %v", err)
			}
			if !strings.Contains(body.Certificate.Disclaimer, tc.wantContains) {
				t.Errorf("disclaimer = %q, want it to contain %q", body.Certificate.Disclaimer, tc.wantContains)
			}
		})
	}
}

// ── 2. the four failure cases, byte-identical within each language ───────────

// The route must not be an oracle. Four ways for a token to be dead have to produce
// ONE answer, and that has to hold in BOTH languages — the language is
// client-supplied, so it can never be the thing that leaks which case happened.
//
// Both projections are covered: a browser (the actual recipient) gets HTML, so a
// JSON-only assertion would miss the surface the contract exists for.
func TestPublicShareFailureCasesStayIdenticalInBothLanguages(t *testing.T) {
	for _, contentType := range []string{"", "application/json"} {
		name := "html"
		if contentType != "" {
			name = "json"
		}
		t.Run(name, func(t *testing.T) {
			env := setupShareTest(t)
			seedShareFixture(t, env.pool)

			// Each dead link is created, its OWN id and token are read out of its own
			// create response, and only then is it killed. No row is ever identified by
			// an ORDER BY on a millisecond timestamp — the flakiness shares_test.go
			// documents — and the token cannot be re-read later by design, so the
			// (id, token) pair has to travel together.
			expiredToken, expiredRR := createShare(t, env, "share_dev", "")
			if expiredToken == "" {
				t.Fatalf("create expired-candidate failed: %d (%s)", expiredRR.Code, expiredRR.Body.String())
			}
			expiredID := shareIDFrom(t, expiredRR)
			tag, err := env.pool.Exec(t.Context(),
				`UPDATE "DeviceShare" SET "expiresAt" = NOW() - INTERVAL '1 day' WHERE id = $1`, expiredID)
			if err != nil {
				t.Fatalf("expire share: %v", err)
			}
			if tag.RowsAffected() != 1 {
				t.Fatalf("expiring the named share touched %d rows, want 1", tag.RowsAffected())
			}

			revokedToken, revokedRR := createShare(t, env, "share_dev", "")
			if revokedToken == "" {
				t.Fatalf("create revoke-candidate failed: %d (%s)", revokedRR.Code, revokedRR.Body.String())
			}
			revokedID := shareIDFrom(t, revokedRR)
			req := httptest.NewRequest(http.MethodDelete, "/api/v1/shares/"+revokedID, nil)
			req.Header.Set("Authorization", "Bearer "+env.token)
			rec := httptest.NewRecorder()
			env.mux.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("revoke = %d (%s)", rec.Code, rec.Body.String())
			}

			dead := map[string]string{
				"expired":      expiredToken,
				"revoked":      revokedToken,
				"never minted": "not-a-real-token-at-all",
				"whitespace":   "%20",
			}

			bodies := map[string]string{}
			for _, lang := range []string{"vi", "en"} {
				for name, tok := range dead {
					rr := publicShareGet(t, env, tok, contentType, lang)
					if rr.Code != http.StatusNotFound {
						t.Fatalf("%s (%s) = %d, want 404 (%s)", name, lang, rr.Code, rr.Body.String())
					}
					bodies[name+" "+lang] = rr.Body.String()
				}

				for _, name := range []string{"expired", "revoked"} {
					// The two named rows must ALSO match the two anonymous ones, and the
					// comparison below is what enforces it.
					if bodies[name+" "+lang] == "" {
						t.Fatalf("%s (%s) produced an empty body", name, lang)
					}
				}

				keys := make([]string, 0, 4)
				for name := range dead {
					keys = append(keys, name+" "+lang)
				}
				sort.Strings(keys)
				baseline := bodies[keys[0]]
				for _, k := range keys[1:] {
					if bodies[k] != baseline {
						t.Errorf("%s = %q,\nwant the identical body %q — the four dead-token cases must be indistinguishable in one language",
							k, bodies[k], baseline)
					}
				}
				t.Logf("%s 404 body: %s", lang, strings.TrimSpace(baseline))

				// And the language is the one that was asked for: the single sentence
				// still moves, which is what makes this a translation rather than a
				// decoration.
				wantFragment := "không tồn tại, đã hết hạn hoặc đã bị thu hồi"
				if lang == "en" {
					wantFragment = "does not exist, has expired, or has been revoked"
				}
				if !strings.Contains(baseline, wantFragment) {
					t.Errorf("404 body (%s) does not contain %q: %s", lang, wantFragment, baseline)
				}
			}

			// The two languages really are different renderings of one answer, so the
			// byte-identity asserted above is per language and not an accident of the
			// message never being translated at all.
			if bodies["expired vi"] == bodies["expired en"] {
				t.Error("the Vietnamese and English 404 bodies are identical — the sentence was not translated")
			}
		})
	}
}
