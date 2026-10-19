package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
)

// POST /api/v1/ai/assess-claim over HTTP: the two shared AI gates, the body
// shape, the ownership 404, the rate limit, and the top-level response object.
//
// The success case points a real *ai.Client at an httptest.Server (no key, no
// Anthropic, no network): that is the only way to pin the handler's wire shape
// without weakening Deps. Everything that would call a model is either refused
// earlier by a gate/validation or answered by the local server.

type assessHTTPEnv struct {
	mux            *http.ServeMux
	pool           *pgxpool.Pool
	token          string
	userID         string
	claimID        string
	otherClaimID   string
	noOptInToken   string
	noOptInClaimID string
}

const (
	assessHTTPIssue = "Màn hình bị sọc xanh sau khi rơi"
	assessHTTPScope = "Lỗi phần cứng do nhà sản xuất"
)

func setupAssessHTTPEnv(t *testing.T, aiClient *ai.Client) *assessHTTPEnv {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect scratch: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userID       = "zz_assess_http_user"
		otherUserID  = "zz_assess_http_other"
		noOptInID    = "zz_assess_http_nooptin"
		deviceID     = "zz_assess_http_dev"
		otherDevice  = "zz_assess_http_other_dev"
		noOptInDev   = "zz_assess_http_nooptin_dev"
		warID        = "zz_assess_http_war"
		otherWar     = "zz_assess_http_other_war"
		noOptInWar   = "zz_assess_http_nooptin_war"
		claimID      = "zz_assess_http_claim"
		otherClaimID = "zz_assess_http_other_claim"
		noOptInClaim = "zz_assess_http_nooptin_claim"
	)
	insertUser(t, pool, userID, "assess-http@example.invalid", "x")
	insertUser(t, pool, otherUserID, "assess-http-other@example.invalid", "x")
	insertUser(t, pool, noOptInID, "assess-http-nooptin@example.invalid", "x")
	deleteUsers(t, pool, userID, otherUserID, noOptInID)
	if _, err := pool.Exec(ctx, `UPDATE "User" SET "aiOptIn" = true WHERE id = ANY($1)`,
		[]string{userID, otherUserID}); err != nil {
		t.Fatalf("opt in: %v", err)
	}

	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("exec %q: %v", q, err)
		}
	}
	for device, owner := range map[string]string{
		deviceID:    userID,
		otherDevice: otherUserID,
		noOptInDev:  noOptInID,
	} {
		exec(`INSERT INTO "Device" (id, "userId", name, category, brand, model, "serialNumber",
		                            "purchaseDate", "purchasePrice", status, "updatedAt")
		      VALUES ($1, $2, 'iPhone 15 Pro', 'PHONE', 'Apple', 'A3102', '356938035643809',
		              '2024-11-20', 28990000, 'ACTIVE', NOW())`, device, owner)
	}
	for war, device := range map[string]string{
		warID:      deviceID,
		otherWar:   otherDevice,
		noOptInWar: noOptInDev,
	} {
		exec(`INSERT INTO "Warranty" (id, "deviceId", type, provider, "startDate", "endDate", months,
		                              component, scope, cap, deductible, exclusions, region,
		                              transferable, "claimsAllowed", "claimsUsed", "updatedAt")
		      VALUES ($1, $2, 'EXTENDED', 'AppleCare+', '2024-11-20', '2026-11-20', 24,
		              'Pin và màn hình', $3, 5000000, 200000, 'Rơi vỡ, vào nước', 'Việt Nam',
		              true, 3, 1, NOW())`, war, device, assessHTTPScope)
	}
	exec(`INSERT INTO "Claim" (id, "deviceId", "warrantyId", status, "openedAt", "ticketNumber",
	                           "serviceCenter", issue, diagnosis, cost, "updatedAt")
	      VALUES ($1, $2, $3, 'OPEN', '2026-10-01', 'SC-123', 'TTBH Apple Q.1', $4,
	              'Màn hình hỏng, cần thay', 1500000, NOW())`,
		claimID, deviceID, warID, assessHTTPIssue)
	exec(`INSERT INTO "Claim" (id, "deviceId", "warrantyId", status, "openedAt", issue, "updatedAt")
	      VALUES ($1, $2, $3, 'OPEN', '2026-10-01', 'Của người khác', NOW())`,
		otherClaimID, otherDevice, otherWar)
	exec(`INSERT INTO "Claim" (id, "deviceId", "warrantyId", status, "openedAt", issue, "updatedAt")
	      VALUES ($1, $2, $3, 'OPEN', '2026-10-01', 'Pin tụt nhanh', NOW())`,
		noOptInClaim, noOptInDev, noOptInWar)

	issue := func(user string) string {
		t.Helper()
		tok, err := auth.IssueToken(ctx, pool, user, nil, nil)
		if err != nil {
			t.Fatalf("issue token for %s: %v", user, err)
		}
		return tok.AccessToken
	}

	mux := http.NewServeMux()
	RegisterAI(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}, AI: aiClient})
	return &assessHTTPEnv{
		mux:            mux,
		pool:           pool,
		token:          issue(userID),
		userID:         userID,
		claimID:        claimID,
		otherClaimID:   otherClaimID,
		noOptInToken:   issue(noOptInID),
		noOptInClaimID: noOptInClaim,
	}
}

func (e *assessHTTPEnv) do(t *testing.T, token, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req := httptest.NewRequest(http.MethodPost, path, reader)
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	rr := httptest.NewRecorder()
	e.mux.ServeHTTP(rr, req)
	return rr
}

func decodeAssessEnvelope(t *testing.T, rr *httptest.ResponseRecorder, wantStatus int) map[string]any {
	t.Helper()
	if rr.Code != wantStatus {
		t.Fatalf("status = %d, want %d (%s)", rr.Code, wantStatus, rr.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode %q: %v", rr.Body.String(), err)
	}
	return body
}

func TestAssessClaimHandler_FeatureGate(t *testing.T) {
	// No configured client: the handler refuses before reading the body or
	// touching the database beyond auth.
	env := setupAssessHTTPEnv(t, nil)

	for _, tc := range []struct {
		lang    string
		wantMsg string
	}{
		{"vi", "Tính năng đánh giá yêu cầu bảo hành bằng AI chưa được bật"},
		{"en", "AI claim assessment is not enabled"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			body := []byte(`{"claimId":"` + env.claimID + `"}`)
			rr := env.do(t, env.token, "/api/v1/ai/assess-claim?lang="+tc.lang, body)
			got := decodeAssessEnvelope(t, rr, http.StatusServiceUnavailable)
			if got["error"] != "feature_disabled" {
				t.Errorf("error = %v, want feature_disabled", got["error"])
			}
			if got["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", got["message"], tc.wantMsg)
			}
		})
	}
}

func TestAssessClaimHandler_OptInGate(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key-never-used")
	env := setupAssessHTTPEnv(t, ai.NewFromEnv())

	for _, tc := range []struct {
		lang    string
		wantMsg string
	}{
		{"vi", "Cần bật tính năng AI trong Cài đặt trước khi dùng"},
		{"en", "Turn on AI features in Settings before using this"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			body := []byte(`{"claimId":"` + env.noOptInClaimID + `"}`)
			rr := env.do(t, env.noOptInToken, "/api/v1/ai/assess-claim?lang="+tc.lang, body)
			got := decodeAssessEnvelope(t, rr, http.StatusForbidden)
			if got["error"] != "ai_optin_required" {
				t.Errorf("error = %v, want ai_optin_required", got["error"])
			}
			if got["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", got["message"], tc.wantMsg)
			}
		})
	}
}

func TestAssessClaimHandler_RequestBodyAndOwnership(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key-never-used")
	env := setupAssessHTTPEnv(t, ai.NewFromEnv())

	// Missing claimId: 400 before any service call (and therefore no model call).
	rr := env.do(t, env.token, "/api/v1/ai/assess-claim?lang=en", []byte(`{}`))
	got := decodeAssessEnvelope(t, rr, http.StatusBadRequest)
	if got["error"] != "bad_input" || got["message"] != "Missing claimId" {
		t.Errorf("missing claimId = %v", got)
	}

	// Malformed JSON: the shared bad_input envelope.
	rr = env.do(t, env.token, "/api/v1/ai/assess-claim", []byte(`not json`))
	decodeAssessEnvelope(t, rr, http.StatusBadRequest)

	// Another user's claim is a 404, not a 403, and never reaches the model.
	body := []byte(`{"claimId":"` + env.otherClaimID + `"}`)
	rr = env.do(t, env.token, "/api/v1/ai/assess-claim?lang=en", body)
	got = decodeAssessEnvelope(t, rr, http.StatusNotFound)
	if got["error"] != "not_found" {
		t.Errorf("foreign claim error = %v, want not_found", got["error"])
	}
	if got["message"] != "Claim not found" {
		t.Errorf("foreign claim message = %v", got["message"])
	}
}

// denyLimiter already exists in fx_test.go (shared by the 429 paths); reuse it
// rather than redeclaring an identical fake in this file.

func TestAssessClaimHandler_RateLimited(t *testing.T) {
	// The limiter is consulted before the feature gate, like the OCR endpoint.
	env := setupAssessHTTPEnv(t, nil)
	env.mux = http.NewServeMux()
	RegisterAI(env.mux, Deps{DB: env.pool, Limiter: denyLimiter{}, AI: nil})

	body := []byte(`{"claimId":"` + env.claimID + `"}`)
	rr := env.do(t, env.token, "/api/v1/ai/assess-claim", body)
	got := decodeAssessEnvelope(t, rr, http.StatusTooManyRequests)
	if got["error"] != "rate_limited" {
		t.Errorf("error = %v, want rate_limited", got["error"])
	}
	if retry := rr.Header().Get("Retry-After"); retry != "42" {
		t.Errorf("Retry-After = %q, want 42", retry)
	}
}

// End-to-end over the wire: a real *ai.Client pointed at a local fake Messages
// API. Proves the top-level response shape (no envelope), the echoed model, the
// generatedAt timestamp, and that the actual contract terms reached the prompt.
func TestAssessClaimHandler_SuccessShape(t *testing.T) {
	var captured map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(raw, &captured); err != nil {
			t.Errorf("decode upstream request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"tool_use","name":"emit_claim_assessment","input":{
			"coverage":"UNCLEAR",
			"confidence":"LOW",
			"reasoning":"Thiếu thông tin về tình trạng vật lý.",
			"questions":["Máy có bị rơi vỡ không?","Anh/chị có hoá đơn không?"],
			"draftLetter":"Kính gửi trung tâm bảo hành, tôi mang đến máy iPhone 15 Pro..."
		}}]}`))
	}))
	defer srv.Close()

	env := setupAssessHTTPEnv(t, ai.NewClientForEndpoint("test-key-never-used", "test-model", srv.URL))
	body := []byte(`{"claimId":"` + env.claimID + `"}`)
	rr := env.do(t, env.token, "/api/v1/ai/assess-claim?lang=vi", body)
	got := decodeAssessEnvelope(t, rr, http.StatusOK)

	if got["claimId"] != env.claimID {
		t.Errorf("claimId = %v, want %q", got["claimId"], env.claimID)
	}
	if got["coverage"] != "UNCLEAR" || got["confidence"] != "LOW" {
		t.Errorf("coverage/confidence = %v/%v", got["coverage"], got["confidence"])
	}
	if got["model"] != "test-model" {
		t.Errorf("model = %v, want test-model", got["model"])
	}
	if _, ok := got["generatedAt"].(string); !ok {
		t.Errorf("generatedAt = %v, want an RFC3339 string", got["generatedAt"])
	}
	questions, ok := got["questions"].([]any)
	if !ok || len(questions) != 2 {
		t.Errorf("questions = %v, want a 2-element array (never null)", got["questions"])
	}
	if letter, _ := got["draftLetter"].(string); !strings.Contains(letter, "Kính gửi trung tâm bảo hành") {
		t.Errorf("draftLetter = %v", got["draftLetter"])
	}

	// The prompt actually sent upstream carries the real claim/contract data.
	msgs, _ := captured["messages"].([]any)
	if len(msgs) != 1 {
		t.Fatalf("upstream messages = %v", captured["messages"])
	}
	msg, _ := msgs[0].(map[string]any)
	content, _ := msg["content"].([]any)
	if len(content) != 1 {
		t.Fatalf("upstream content = %v", msg["content"])
	}
	block, _ := content[0].(map[string]any)
	prompt, _ := block["text"].(string)
	for _, want := range []string{assessHTTPIssue, assessHTTPScope, "iPhone 15 Pro", "SC-123"} {
		if !strings.Contains(prompt, want) {
			t.Errorf("upstream prompt is missing %q", want)
		}
	}
	if captured["model"] != "test-model" {
		t.Errorf("upstream model = %v", captured["model"])
	}
}
