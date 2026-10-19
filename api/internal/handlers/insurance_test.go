package handlers

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/pdfpack/pdftext"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
)

// HTTP contract for GET /api/v1/insurance-pack:
//   - 200 + application/pdf + Content-Disposition + Content-Language: vi
//   - the document stays Vietnamese even when ?lang=en is sent
//   - 401 without a bearer
//   - 400 for a malformed includeSold
//   - 429 on the dedicated per-user bucket
//
// The content rules (sold filter, ownership, image budget) are pinned in
// internal/services/insurance_pack_test.go; this file pins the wire shape.

func setupInsuranceHTTP(t *testing.T) (*http.ServeMux, string, string, string) {
	t.Helper()
	return setupInsuranceHTTPWithLimiter(t, &permissiveLimiter{})
}

func setupInsuranceHTTPWithLimiter(t *testing.T, limiter ratelimit.Limiter) (*http.ServeMux, string, string, string) {
	t.Helper()
	pool := createScratchDatabase(t, testDatabaseURL(t))
	ctx := context.Background()

	userID := "zz_insurance_http_user"
	otherID := "zz_insurance_http_other"
	deviceID := "zz_insurance_http_device"
	otherDeviceID := "zz_insurance_http_other_device"

	insertUser(t, pool, userID, "insurance-http@example.invalid", "x")
	insertUser(t, pool, otherID, "insurance-http-other@example.invalid", "x")
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		 VALUES ($1, $2, 'Tủ lạnh Samsung của tôi', 'FRIDGE', '2025-01-01', 15000000, 'ACTIVE', NOW())`,
		deviceID, userID); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		 VALUES ($1, $2, 'Máy của người khác', 'PHONE', '2025-01-01', 1000000, 'ACTIVE', NOW())`,
		otherDeviceID, otherID); err != nil {
		t.Fatalf("insert other device: %v", err)
	}
	token, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	mux := http.NewServeMux()
	RegisterInsurance(mux, Deps{DB: pool, Limiter: limiter})
	return mux, token.AccessToken, deviceID, otherDeviceID
}

func getInsurance(t *testing.T, mux *http.ServeMux, bearer, url string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, url, nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	return rr
}

func TestInsurancePackHTTPReturnsVietnamesePDF(t *testing.T) {
	mux, token, deviceID, _ := setupInsuranceHTTP(t)

	rr := getInsurance(t, mux, token, "/api/v1/insurance-pack")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/pdf" {
		t.Errorf("Content-Type = %q, want application/pdf", ct)
	}
	if cd := rr.Header().Get("Content-Disposition"); !strings.Contains(cd, "attachment;") || !strings.HasSuffix(cd, `.pdf"`) {
		t.Errorf("Content-Disposition = %q", cd)
	}
	if cl := rr.Header().Get("Content-Language"); cl != "vi" {
		t.Errorf("Content-Language = %q, want vi", cl)
	}
	if cc := rr.Header().Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Errorf("Cache-Control = %q", cc)
	}
	body := rr.Body.Bytes()
	if !bytes.HasPrefix(body, []byte("%PDF-")) {
		t.Fatalf("body is not a PDF: %q", body[:minHandlerInt(len(body), 16)])
	}
	text, err := pdftext.Extract(body)
	if err != nil {
		t.Fatalf("extract text: %v", err)
	}
	for _, want := range []string{"Bảng kê tài sản được bảo vệ", "Tủ lạnh Samsung của tôi", "insurance-http@example.invalid", "được bảo vệ"} {
		if !strings.Contains(text, want) {
			t.Errorf("PDF text missing %q\n--- text ---\n%s", want, text)
		}
	}

	// language is accepted but the artifact is always Vietnamese.
	rr = getInsurance(t, mux, token, "/api/v1/insurance-pack?lang=en&deviceIds="+deviceID)
	if rr.Code != http.StatusOK {
		t.Fatalf("lang=en status = %d (%s)", rr.Code, rr.Body.String())
	}
	text, err = pdftext.Extract(rr.Body.Bytes())
	if err != nil {
		t.Fatalf("extract lang=en text: %v", err)
	}
	if !strings.Contains(text, "Bảng kê tài sản được bảo vệ") || !strings.Contains(text, "Tổng cộng") {
		t.Errorf("?lang=en changed the document language:\n%s", text)
	}
	if strings.Contains(text, "Insurance") || strings.Contains(text, "Protected property") {
		t.Errorf("?lang=en leaked English into the document:\n%s", text)
	}
}

func TestInsurancePackHTTPAuthAndBadInput(t *testing.T) {
	mux, token, _, otherDeviceID := setupInsuranceHTTP(t)

	rr := getInsurance(t, mux, "", "/api/v1/insurance-pack")
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("unauthenticated status = %d, want 401", rr.Code)
	}

	rr = getInsurance(t, mux, token, "/api/v1/insurance-pack?includeSold=maybe")
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid includeSold status = %d (%s)", rr.Code, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("400 Content-Type = %q, want JSON", ct)
	}

	// Another user's device id is ignored, not confirmed and not included.
	rr = getInsurance(t, mux, token, "/api/v1/insurance-pack?deviceIds="+otherDeviceID)
	if rr.Code != http.StatusOK {
		t.Fatalf("foreign deviceIds status = %d (%s)", rr.Code, rr.Body.String())
	}
	text, err := pdftext.Extract(rr.Body.Bytes())
	if err != nil {
		t.Fatalf("extract text: %v", err)
	}
	if strings.Contains(text, "Máy của người khác") {
		t.Error("another user's device appeared in the PDF")
	}
	if !strings.Contains(text, "Không có thiết bị nào để kê khai") {
		t.Errorf("foreign-only filter should yield the empty notice:\n%s", text)
	}
}

func TestInsurancePackHTTPRateLimit(t *testing.T) {
	mux, token, _, _ := setupInsuranceHTTPWithLimiter(t, ratelimit.NewMemoryLimiter())
	for i := 0; i < 5; i++ {
		rr := getInsurance(t, mux, token, "/api/v1/insurance-pack")
		if rr.Code != http.StatusOK {
			t.Fatalf("request %d status = %d (%s)", i+1, rr.Code, rr.Body.String())
		}
	}
	rr := getInsurance(t, mux, token, "/api/v1/insurance-pack")
	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("6th request status = %d, want 429", rr.Code)
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("429 response has no Retry-After header")
	}
	if ct := rr.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Errorf("429 Content-Type = %q, want JSON", ct)
	}
}

func minHandlerInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
