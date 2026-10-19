package services

import (
	"context"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// AI claim assessment (gap #7). Pure prompt/schema/bounds assertions live in
// internal/ai/assess_test.go; this file covers the service contract end to end
// against a real Postgres: the shared gates, ownership, the actual contract terms
// reaching the model boundary, the honesty guard, the language split and the
// no-write guarantee. A fake ClaimAssessor stands in for the model — no network
// call is made in this file either.

var assessIDSeq atomic.Int64

func assessID(prefix string) string {
	return fmt.Sprintf("zz_assess_%s_%d", prefix, assessIDSeq.Add(1))
}

type fakeClaimAssessor struct {
	enabled bool
	model   string
	result  ai.ClaimAssessment
	err     error
	calls   int
	last    ai.ClaimAssessmentInput
}

func (f *fakeClaimAssessor) Enabled() bool { return f.enabled }
func (f *fakeClaimAssessor) Model() string { return f.model }
func (f *fakeClaimAssessor) AssessClaim(_ context.Context, in ai.ClaimAssessmentInput) (ai.ClaimAssessment, error) {
	f.calls++
	f.last = in
	if f.err != nil {
		return ai.ClaimAssessment{}, f.err
	}
	return f.result, nil
}

type assessEnv struct {
	pool     *pgxpool.Pool
	userID   string
	deviceID string
	warID    string
	claimID  string
}

const (
	assessIssue     = "Màn hình bị sọc xanh sau khi rơi"
	assessDiagnosis = "Màn hình hỏng, cần thay"
	assessScope     = "Lỗi phần cứng do nhà sản xuất"
	assessExclusion = "Rơi vỡ, vào nước"
)

func newAssessEnv(t *testing.T) *assessEnv {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	e := &assessEnv{
		pool:     pool,
		userID:   assessID("user"),
		deviceID: assessID("dev"),
		warID:    assessID("war"),
		claimID:  assessID("claim"),
	}
	insertAssessUser(t, pool, e.userID, true)
	insertAssessDevice(t, pool, e.deviceID, e.userID)
	insertAssessWarranty(t, pool, e.warID, e.deviceID, true)
	insertAssessClaim(t, pool, e.claimID, e.deviceID, &e.warID, assessIssue)
	return e
}

func insertAssessUser(t *testing.T, pool *pgxpool.Pool, id string, aiOptIn bool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt", "aiOptIn")
		 VALUES ($1, $2, 'x', NOW(), $3)
		 ON CONFLICT (id) DO UPDATE SET "aiOptIn" = EXCLUDED."aiOptIn"`,
		id, id+"@assess.invalid", aiOptIn); err != nil {
		t.Fatalf("insert user %s: %v", id, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, id)
	})
}

func insertAssessDevice(t *testing.T, pool *pgxpool.Pool, id, userID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "Device" (id, "userId", name, category, brand, model, "serialNumber",
		                       "purchaseDate", "purchasePrice", status, "updatedAt")
		 VALUES ($1, $2, 'iPhone 15 Pro', 'PHONE', 'Apple', 'A3102', '356938035643809',
		         '2024-11-20', 28990000, 'ACTIVE', NOW())`, id, userID); err != nil {
		t.Fatalf("insert device %s: %v", id, err)
	}
}

// insertAssessWarranty writes a fully-populated contract. complete=false leaves
// the contract-text terms (component/scope/exclusions/claimsAllowed) NULL so the
// honesty guard can be exercised without a second fixture.
func insertAssessWarranty(t *testing.T, pool *pgxpool.Pool, id, deviceID string, complete bool) {
	t.Helper()
	var component, scope, exclusions any = "Pin và màn hình", assessScope, assessExclusion
	var claimsAllowed any = int32(3)
	if !complete {
		component, scope, exclusions, claimsAllowed = nil, nil, nil, nil
	}
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "Warranty" (id, "deviceId", type, provider, "startDate", "endDate", months,
		                         cost, component, scope, cap, deductible, exclusions, region,
		                         transferable, "claimsAllowed", "claimsUsed", "updatedAt")
		 VALUES ($1, $2, 'EXTENDED', 'AppleCare+', '2024-11-20', '2026-11-20', 24,
		         2500000, $3, $4, 5000000, 200000, $5, 'Việt Nam', true, $6, 1, NOW())`,
		id, deviceID, component, scope, exclusions, claimsAllowed); err != nil {
		t.Fatalf("insert warranty %s: %v", id, err)
	}
}

func insertAssessClaim(t *testing.T, pool *pgxpool.Pool, id, deviceID string, warrantyID *string, issue string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "Claim" (id, "deviceId", "warrantyId", status, "openedAt", "ticketNumber",
		                      "serviceCenter", issue, diagnosis, cost, "updatedAt")
		 VALUES ($1, $2, $3, 'OPEN', '2026-10-01', 'SC-123', 'TTBH Apple Q.1', $4, $5, 1500000, NOW())`,
		id, deviceID, warrantyID, issue, assessDiagnosis); err != nil {
		t.Fatalf("insert claim %s: %v", id, err)
	}
}

func assessErrorCode(t *testing.T, err error) string {
	t.Helper()
	ae, ok := AsAttachmentError(err)
	if !ok {
		t.Fatalf("error = %v, want a services.AttachmentError", err)
	}
	return ae.Code
}

// ── gates ────────────────────────────────────────────────────────────────────

func TestAssessClaim_SharedGates(t *testing.T) {
	env := newAssessEnv(t)
	ctx := viCtx()

	// 1. No client at all (no ANTHROPIC_API_KEY on the server).
	_, err := AssessClaim(ctx, env.pool, nil, env.userID, env.claimID)
	if code := assessErrorCode(t, err); code != "feature_disabled" {
		t.Errorf("nil client code = %q, want feature_disabled", code)
	}

	// 2. A disabled client is the same refusal, and must not touch the model.
	disabled := &fakeClaimAssessor{enabled: false, model: "m"}
	_, err = AssessClaim(ctx, env.pool, disabled, env.userID, env.claimID)
	if code := assessErrorCode(t, err); code != "feature_disabled" {
		t.Errorf("disabled client code = %q, want feature_disabled", code)
	}
	if disabled.calls != 0 {
		t.Errorf("disabled client was called %d times, want 0", disabled.calls)
	}

	// 3. A configured server still refuses a user who has not opted in.
	noOptInUser := assessID("nooptin_user")
	noOptInDevice := assessID("nooptin_dev")
	noOptInWar := assessID("nooptin_war")
	noOptInClaim := assessID("nooptin_claim")
	insertAssessUser(t, env.pool, noOptInUser, false)
	insertAssessDevice(t, env.pool, noOptInDevice, noOptInUser)
	insertAssessWarranty(t, env.pool, noOptInWar, noOptInDevice, true)
	insertAssessClaim(t, env.pool, noOptInClaim, noOptInDevice, &noOptInWar, "Pin tụt nhanh")

	enabled := &fakeClaimAssessor{enabled: true, model: "m", result: ai.ClaimAssessment{
		Coverage: ai.CoverageUnclear, Confidence: ai.ConfidenceLow,
		Reasoning: "x", Questions: []string{}, DraftLetter: "y",
	}}
	_, err = AssessClaim(ctx, env.pool, enabled, noOptInUser, noOptInClaim)
	if code := assessErrorCode(t, err); code != "ai_optin_required" {
		t.Errorf("no-opt-in code = %q, want ai_optin_required", code)
	}
	if enabled.calls != 0 {
		t.Errorf("no-opt-in user reached the model %d times, want 0", enabled.calls)
	}
}

// The shared gate refactor must not change receipt OCR's frozen copy or codes.
// The wave-4 handler test pins the feature_disabled half over HTTP; this pins
// both refusals at the service boundary that now calls checkAIGate.
func TestExtractReceiptGateCopyUnchanged(t *testing.T) {
	env := newAssessEnv(t)

	// No client configured: the receipt feature's own sentence, not the
	// assessment one.
	_, err := ExtractReceipt(viCtx(), env.pool, nil, env.userID, ExtractInput{
		Body: []byte{0xFF, 0xD8, 0xFF, 0xE0}, MediaType: "image/jpeg",
	})
	ae, ok := AsAttachmentError(err)
	if !ok || ae.Code != "feature_disabled" {
		t.Fatalf("nil extractor error = %v, want feature_disabled", err)
	}
	if ae.Message != "Tính năng quét hoá đơn chưa được bật" {
		t.Errorf("feature_disabled message = %q, want the receipt copy", ae.Message)
	}

	// A configured server + a user who has not opted in still answers with the
	// receipt-specific opt-in sentence.
	noOptInUser := assessID("ocr_nooptin_user")
	insertAssessUser(t, env.pool, noOptInUser, false)
	extractor := &fakeExtractor{result: ai.ExtractedReceipt{}}
	_, err = ExtractReceipt(viCtx(), env.pool, extractor, noOptInUser, ExtractInput{
		Body: []byte{0xFF, 0xD8, 0xFF, 0xE0}, MediaType: "image/jpeg",
	})
	ae, ok = AsAttachmentError(err)
	if !ok || ae.Code != "ai_optin_required" {
		t.Fatalf("no-opt-in extractor error = %v, want ai_optin_required", err)
	}
	if ae.Message != "Cần bật tính năng quét hoá đơn (AI) trong Cài đặt trước khi dùng" {
		t.Errorf("ai_optin_required message = %q, want the receipt copy", ae.Message)
	}
	if extractor.calls != 0 {
		t.Errorf("extractor was called %d times before the gate, want 0", extractor.calls)
	}
}

func TestAssessClaim_OwnershipIs404AndNeverCallsModel(t *testing.T) {
	env := newAssessEnv(t)
	otherUser := assessID("other_user")
	otherDevice := assessID("other_dev")
	otherWar := assessID("other_war")
	otherClaim := assessID("other_claim")
	insertAssessUser(t, env.pool, otherUser, true)
	insertAssessDevice(t, env.pool, otherDevice, otherUser)
	insertAssessWarranty(t, env.pool, otherWar, otherDevice, true)
	insertAssessClaim(t, env.pool, otherClaim, otherDevice, &otherWar, "Của người khác")

	fake := &fakeClaimAssessor{enabled: true, model: "m"}
	_, err := AssessClaim(viCtx(), env.pool, fake, env.userID, otherClaim)
	if code := assessErrorCode(t, err); code != "not_found" {
		t.Fatalf("code = %q, want not_found (never 403 for another user's claim)", code)
	}
	if fake.calls != 0 {
		t.Errorf("model was called %d times for a foreign claim, want 0", fake.calls)
	}
}

// ── what the model is given ──────────────────────────────────────────────────

func TestAssessClaim_PassesActualContractTermsToModel(t *testing.T) {
	env := newAssessEnv(t)
	fake := &fakeClaimAssessor{
		enabled: true,
		model:   "test-model",
		result: ai.ClaimAssessment{
			Coverage:    ai.CoverageUnclear,
			Confidence:  ai.ConfidenceLow,
			Reasoning:   "Cần thêm thông tin.",
			Questions:   []string{"Anh/chị có hoá đơn không?"},
			DraftLetter: "Kính gửi trung tâm bảo hành, ...",
		},
	}
	out, err := AssessClaim(viCtx(), env.pool, fake, env.userID, env.claimID)
	if err != nil {
		t.Fatalf("AssessClaim: %v", err)
	}
	if fake.calls != 1 {
		t.Fatalf("model calls = %d, want 1", fake.calls)
	}

	in := fake.last
	if in.Language != "vi" {
		t.Errorf("model language = %q, want vi", in.Language)
	}
	if in.Claim.Issue != assessIssue || in.Claim.Diagnosis == nil || *in.Claim.Diagnosis != assessDiagnosis {
		t.Errorf("claim facts = %+v", in.Claim)
	}
	if in.Claim.Cost == nil || *in.Claim.Cost != 1500000 {
		t.Errorf("claim cost = %v", in.Claim.Cost)
	}
	if in.Claim.TicketNumber == nil || *in.Claim.TicketNumber != "SC-123" {
		t.Errorf("ticket = %v", in.Claim.TicketNumber)
	}
	if in.Claim.ServiceCenter == nil || *in.Claim.ServiceCenter != "TTBH Apple Q.1" {
		t.Errorf("serviceCenter = %v", in.Claim.ServiceCenter)
	}
	if in.Claim.Status != "OPEN" || in.Claim.OpenedAt != "2026-10-01" {
		t.Errorf("claim status/openedAt = %q/%q", in.Claim.Status, in.Claim.OpenedAt)
	}
	if in.Claim.WarrantyID == nil || *in.Claim.WarrantyID != env.warID {
		t.Errorf("warrantyId = %v, want %q", in.Claim.WarrantyID, env.warID)
	}
	if in.Device.Name != "iPhone 15 Pro" || in.Device.Category != "PHONE" ||
		in.Device.Brand == nil || *in.Device.Brand != "Apple" ||
		in.Device.Model == nil || *in.Device.Model != "A3102" ||
		in.Device.SerialNumber == nil || *in.Device.SerialNumber != "356938035643809" ||
		in.Device.PurchaseDate != "2024-11-20" || in.Device.Status != "ACTIVE" {
		t.Errorf("device facts = %+v", in.Device)
	}
	if len(in.Warranties) != 1 {
		t.Fatalf("warranties = %d, want 1", len(in.Warranties))
	}
	w := in.Warranties[0]
	if w.ID != env.warID || w.Type != "EXTENDED" || w.Provider == nil || *w.Provider != "AppleCare+" {
		t.Errorf("warranty identity = %+v", w)
	}
	if w.Component == nil || *w.Component != "Pin và màn hình" ||
		w.Scope == nil || *w.Scope != assessScope ||
		w.Exclusions == nil || *w.Exclusions != assessExclusion ||
		w.Region == nil || *w.Region != "Việt Nam" {
		t.Errorf("warranty text terms = %+v", w)
	}
	if w.Cap == nil || *w.Cap != 5000000 || w.Deductible == nil || *w.Deductible != 200000 {
		t.Errorf("cap/deductible = %v/%v", w.Cap, w.Deductible)
	}
	if w.Transferable == nil || !*w.Transferable {
		t.Errorf("transferable = %v, want true", w.Transferable)
	}
	if w.ClaimsAllowed == nil || *w.ClaimsAllowed != 3 || w.ClaimsUsed != 1 {
		t.Errorf("claims = %v/%d, want 3/1", w.ClaimsAllowed, w.ClaimsUsed)
	}
	if w.StartDate != "2024-11-20" || w.EndDate != "2026-11-20" || w.Months != 24 {
		t.Errorf("warranty dates = %q..%q (%d months)", w.StartDate, w.EndDate, w.Months)
	}

	if out.ClaimID != env.claimID || out.Model != "test-model" {
		t.Errorf("result identity = %q/%q", out.ClaimID, out.Model)
	}
	if out.Coverage != ai.CoverageUnclear || out.GeneratedAt.IsZero() {
		t.Errorf("result = %+v", out)
	}
	if out.DraftLetter != "Kính gửi trung tâm bảo hành, ..." {
		t.Errorf("draftLetter = %q, want the model's letter untouched", out.DraftLetter)
	}
}

// Language split: reasoning/questions follow the REQUEST, and the server's own
// missing-term question does too. draftLetter is not touched by the service.
func TestAssessClaim_LanguageSplit(t *testing.T) {
	env := newAssessEnv(t)
	// Make the contract incomplete so the guard adds a server-generated question.
	if _, err := env.pool.Exec(context.Background(),
		`UPDATE "Warranty" SET scope = NULL WHERE id = $1`, env.warID); err != nil {
		t.Fatalf("null the scope: %v", err)
	}

	fake := &fakeClaimAssessor{
		enabled: true,
		model:   "m",
		result: ai.ClaimAssessment{
			Coverage:    ai.CoverageLikelyCovered, // the guard must downgrade it
			Confidence:  ai.ConfidenceHigh,
			Reasoning:   "The contract looks supportive.",
			Questions:   []string{"Do you still have the receipt?"},
			DraftLetter: "Kính gửi trung tâm bảo hành, ...", // always Vietnamese
		},
	}
	ctx := i18n.WithTag(context.Background(), i18n.EN)
	out, err := AssessClaim(ctx, env.pool, fake, env.userID, env.claimID)
	if err != nil {
		t.Fatalf("AssessClaim: %v", err)
	}
	if fake.last.Language != "en" {
		t.Errorf("model language = %q, want en", fake.last.Language)
	}
	if out.Coverage != ai.CoverageUnclear {
		t.Fatalf("coverage = %q, want the guard to downgrade LIKELY_COVERED", out.Coverage)
	}
	if !containsAssess(out.Questions, "Do you still have the receipt?") {
		t.Errorf("questions lost the model's English question: %v", out.Questions)
	}
	if !containsAssess(out.Questions, "What does the warranty's scope actually say? Bring the contract so it can be checked.") {
		t.Errorf("server-generated question is not in the request language: %v", out.Questions)
	}
	if out.DraftLetter != "Kính gửi trung tâm bảo hành, ..." {
		t.Errorf("draftLetter was translated/rewritten: %q", out.DraftLetter)
	}
}

// ── the honesty guard ────────────────────────────────────────────────────────

// The requirement in one test: when the decisive scope is null, a model that says
// LIKELY_COVERED must not reach the client — the answer becomes UNCLEAR and the
// response asks for the missing term. The service also passes the null through
// to the model input rather than inventing a value.
func TestAssessClaim_MissingDecisiveTermDowngradesToUnclear(t *testing.T) {
	env := newAssessEnv(t)
	if _, err := env.pool.Exec(context.Background(),
		`UPDATE "Warranty" SET scope = NULL WHERE id = $1`, env.warID); err != nil {
		t.Fatalf("null the scope: %v", err)
	}

	fake := &fakeClaimAssessor{
		enabled: true,
		model:   "m",
		result: ai.ClaimAssessment{
			Coverage:    ai.CoverageLikelyCovered,
			Confidence:  ai.ConfidenceHigh,
			Reasoning:   "Có vẻ được bảo hành.",
			Questions:   []string{},
			DraftLetter: "Kính gửi trung tâm bảo hành, ...",
		},
	}
	out, err := AssessClaim(viCtx(), env.pool, fake, env.userID, env.claimID)
	if err != nil {
		t.Fatalf("AssessClaim: %v", err)
	}
	if fake.last.Warranties[0].Scope != nil {
		t.Errorf("model input scope = %v, want nil (the service must not invent a term)", fake.last.Warranties[0].Scope)
	}
	if out.Coverage != ai.CoverageUnclear {
		t.Errorf("coverage = %q, want UNCLEAR when the decisive scope is null", out.Coverage)
	}
	wantQuestion := missingDecisiveTermQuestion["scope"]
	if !containsAssess(out.Questions, wantQuestion) {
		t.Errorf("questions = %v, want a question asking for the missing scope", out.Questions)
	}
}

// A complete contract must NOT be downgraded, and the guard must leave the
// model's own questions in place.
func TestAssessClaim_CompleteContractKeepsLikelyCovered(t *testing.T) {
	env := newAssessEnv(t)
	fake := &fakeClaimAssessor{
		enabled: true,
		model:   "m",
		result: ai.ClaimAssessment{
			Coverage:    ai.CoverageLikelyCovered,
			Confidence:  ai.ConfidenceHigh,
			Reasoning:   "Đủ điều khoản.",
			Questions:   []string{"Anh/chị có hoá đơn không?"},
			DraftLetter: "Kính gửi trung tâm bảo hành, ...",
		},
	}
	out, err := AssessClaim(viCtx(), env.pool, fake, env.userID, env.claimID)
	if err != nil {
		t.Fatalf("AssessClaim: %v", err)
	}
	if out.Coverage != ai.CoverageLikelyCovered {
		t.Errorf("coverage = %q, want LIKELY_COVERED for a complete contract", out.Coverage)
	}
	if len(out.Questions) != 1 || out.Questions[0] != "Anh/chị có hoá đơn không?" {
		t.Errorf("questions = %v, want the model's single question untouched", out.Questions)
	}
}

// A null component means "the whole unit" (migration 0017), which is KNOWN
// information. It must not trigger the missing-term downgrade — almost every
// plan predating the contract-terms feature has a null component, and treating
// that as a gap would turn the endpoint into a permanent UNCLEAR.
func TestAssessClaim_NullComponentMeansWholeUnitNotUnknown(t *testing.T) {
	env := newAssessEnv(t)
	if _, err := env.pool.Exec(context.Background(),
		`UPDATE "Warranty" SET component = NULL WHERE id = $1`, env.warID); err != nil {
		t.Fatalf("null the component: %v", err)
	}
	fake := &fakeClaimAssessor{
		enabled: true, model: "m",
		result: ai.ClaimAssessment{
			Coverage: ai.CoverageLikelyCovered, Confidence: ai.ConfidenceHigh,
			Reasoning: "Gói áp dụng cho toàn bộ thiết bị.", Questions: []string{},
			DraftLetter: "Kính gửi trung tâm bảo hành, ...",
		},
	}
	out, err := AssessClaim(viCtx(), env.pool, fake, env.userID, env.claimID)
	if err != nil {
		t.Fatalf("AssessClaim: %v", err)
	}
	if fake.last.Warranties[0].Component != nil {
		t.Errorf("model input component = %v, want nil", fake.last.Warranties[0].Component)
	}
	if out.Coverage != ai.CoverageLikelyCovered {
		t.Errorf("coverage = %q, want LIKELY_COVERED: a null component is not a missing term", out.Coverage)
	}
}

// claimsAllowed null means "no ceiling recorded" (the warranty validator's
// rule), not "no claims left". The guard must not turn that into UNCLEAR; only a
// known counter that reached a known allowance is evidence against coverage.
func TestAssessClaim_NullClaimsAllowedIsPermissive(t *testing.T) {
	env := newAssessEnv(t)
	if _, err := env.pool.Exec(context.Background(),
		`UPDATE "Warranty" SET "claimsAllowed" = NULL WHERE id = $1`, env.warID); err != nil {
		t.Fatalf("null claimsAllowed: %v", err)
	}
	fake := &fakeClaimAssessor{
		enabled: true, model: "m",
		result: ai.ClaimAssessment{
			Coverage: ai.CoverageLikelyCovered, Confidence: ai.ConfidenceHigh,
			Reasoning: "Không có giới hạn được ghi nhận.", Questions: []string{},
			DraftLetter: "Kính gửi trung tâm bảo hành, ...",
		},
	}
	out, err := AssessClaim(viCtx(), env.pool, fake, env.userID, env.claimID)
	if err != nil {
		t.Fatalf("AssessClaim: %v", err)
	}
	if fake.last.Warranties[0].ClaimsAllowed != nil {
		t.Errorf("model input claimsAllowed = %v, want nil", fake.last.Warranties[0].ClaimsAllowed)
	}
	if out.Coverage != ai.CoverageLikelyCovered {
		t.Errorf("coverage = %q, want LIKELY_COVERED: null claimsAllowed is not a missing decisive term", out.Coverage)
	}
}

// The combined list stays at the schema's 8-question ceiling, and the required
// question survives even when the model filled all 8 slots itself.
func TestAssessClaim_GuardRespectsQuestionCeiling(t *testing.T) {
	env := newAssessEnv(t)
	if _, err := env.pool.Exec(context.Background(),
		`UPDATE "Warranty" SET scope = NULL WHERE id = $1`, env.warID); err != nil {
		t.Fatalf("null the scope: %v", err)
	}
	questions := make([]string, 0, ai.MaxAssessQuestions)
	for i := 0; i < ai.MaxAssessQuestions; i++ {
		questions = append(questions, fmt.Sprintf("Q%d", i))
	}
	fake := &fakeClaimAssessor{
		enabled: true, model: "m",
		result: ai.ClaimAssessment{
			Coverage: ai.CoverageLikelyCovered, Confidence: ai.ConfidenceHigh,
			Reasoning: "x", Questions: questions, DraftLetter: "y",
		},
	}
	out, err := AssessClaim(viCtx(), env.pool, fake, env.userID, env.claimID)
	if err != nil {
		t.Fatalf("AssessClaim: %v", err)
	}
	if len(out.Questions) != ai.MaxAssessQuestions {
		t.Fatalf("questions = %d, want %d", len(out.Questions), ai.MaxAssessQuestions)
	}
	if !containsAssess(out.Questions, missingDecisiveTermQuestion["scope"]) {
		t.Errorf("questions = %v, want the required scope question kept", out.Questions)
	}
}

// ── no writes ────────────────────────────────────────────────────────────────

func TestAssessClaim_WritesNothing(t *testing.T) {
	env := newAssessEnv(t)
	ctx := viCtx()

	type tupleVersion struct {
		claimXmin    string
		deviceXmin   string
		warrantyXmin string
		claimCount   int
		deviceCount  int
		warCount     int
	}
	snapshot := func() tupleVersion {
		t.Helper()
		var s tupleVersion
		if err := env.pool.QueryRow(ctx,
			`SELECT xmin::text FROM "Claim" WHERE id = $1`, env.claimID).Scan(&s.claimXmin); err != nil {
			t.Fatalf("claim xmin: %v", err)
		}
		if err := env.pool.QueryRow(ctx,
			`SELECT xmin::text FROM "Device" WHERE id = $1`, env.deviceID).Scan(&s.deviceXmin); err != nil {
			t.Fatalf("device xmin: %v", err)
		}
		if err := env.pool.QueryRow(ctx,
			`SELECT xmin::text FROM "Warranty" WHERE id = $1`, env.warID).Scan(&s.warrantyXmin); err != nil {
			t.Fatalf("warranty xmin: %v", err)
		}
		if err := env.pool.QueryRow(ctx,
			`SELECT (SELECT count(*) FROM "Claim"),
			        (SELECT count(*) FROM "Device"),
			        (SELECT count(*) FROM "Warranty")`).
			Scan(&s.claimCount, &s.deviceCount, &s.warCount); err != nil {
			t.Fatalf("counts: %v", err)
		}
		return s
	}

	before := snapshot()
	fake := &fakeClaimAssessor{
		enabled: true, model: "m",
		result: ai.ClaimAssessment{
			Coverage:    ai.CoverageUnclear,
			Confidence:  ai.ConfidenceLow,
			Reasoning:   "Cần thêm thông tin.",
			Questions:   []string{"Có hoá đơn không?"},
			DraftLetter: "Kính gửi trung tâm bảo hành, ...",
		},
	}
	if _, err := AssessClaim(ctx, env.pool, fake, env.userID, env.claimID); err != nil {
		t.Fatalf("AssessClaim: %v", err)
	}
	time.Sleep(10 * time.Millisecond) // let any stray async write land before the snapshot
	after := snapshot()

	if before != after {
		t.Errorf("assessment wrote to the database:\nbefore = %+v\nafter  = %+v", before, after)
	}
}

func TestAssessClaim_MapsAIErrors(t *testing.T) {
	env := newAssessEnv(t)
	fake := &fakeClaimAssessor{
		enabled: true, model: "m",
		err: &ai.Error{Code: "rate_limited", Message: "Dịch vụ AI đang quá tải, thử lại sau"},
	}
	_, err := AssessClaim(viCtx(), env.pool, fake, env.userID, env.claimID)
	if code := assessErrorCode(t, err); code != "ai_rate_limited" {
		t.Errorf("code = %q, want ai_rate_limited", code)
	}
}

func containsAssess(haystack []string, needle string) bool {
	for _, s := range haystack {
		if strings.TrimSpace(s) == needle {
			return true
		}
	}
	return false
}

// The assessment input carries both calendar-day columns and one instant
// (Claim.openedAt). They must not share a formatter: a zone conversion is right
// for the instant and wrong for a Day, whose stored wall clock already names the
// user's day. This is the regression pin for that separation.
func TestAssessDayColumnsAreNotShiftedByTheProcessZone(t *testing.T) {
	// 2026-10-20 as a Day: the wire value is UTC midnight and must render
	// exactly 2026-10-20 in every process zone.
	d := wire.Date(time.Date(2026, 10, 20, 0, 0, 0, 0, time.UTC))
	if got := formatAssessDay(d); got != "2026-10-20" {
		t.Errorf("formatAssessDay = %q, want 2026-10-20 (a Day must not move by a zone)", got)
	}
	// NULL is empty, not 0001-01-01.
	if got := formatAssessDay(wire.Day{}); got != "" {
		t.Errorf("formatAssessDay(invalid) = %q, want empty", got)
	}
	if got := formatAssessInstantDay(wire.Instant{}); got != "" {
		t.Errorf("formatAssessInstantDay(invalid) = %q, want empty", got)
	}
}
