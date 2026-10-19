package services

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// AI claim assessment (gap #7, POST /api/v1/ai/assess-claim).
//
// The endpoint answers three questions a user standing at a service counter
// cannot answer from the app: "is this probably covered?", "what will they ask
// me?", and "what do I say?". It is ADVICE, not a decision: this file reads the
// claim, the device and the device's warranty rows, asks the model, applies a
// deterministic honesty guard, and returns the result. It writes no row, changes
// no status and caches nothing — the same "draft only" shape as receipt OCR, but
// with no attachment text to persist either.
//
// # What the model is given
//
// The ACTUAL contract terms from the user's Warranty rows (component, scope,
// cap, deductible, exclusions, region, transferable, claimsAllowed, claimsUsed,
// type, provider, start/end dates, months) plus the claim's issue/diagnosis/
// cost/ticket and the device identity. No term is summarised and no term is
// omitted: a nil becomes the explicit "unknown" the model is told to ask about
// (ai.ClaimAssessmentInput documents the rendering). That is the difference
// between "the app reasoned about your contract" and "the app guessed".
//
// # The honesty guard
//
// The prompt requires UNCLEAR when a decisive term is missing, but a prompt is a
// request to a model, not a guarantee. downgradeUnsupportedCoverage is the
// deterministic half: if the model asserts LIKELY_COVERED while the contract's
// scope or exclusions is null, the service downgrades the verdict to UNCLEAR and
// adds a question asking for the missing term (in the request's language).
// `component` and `claimsAllowed` are deliberately not members of that set:
// migration 0017 defines a null component as "the whole unit", and the warranty
// validator treats a null claimsAllowed as "no ceiling recorded" — neither is an
// unknown that blocks a verdict. Clients therefore never receive an overclaim
// that the server could see was unsupported.
//
// # No writes
//
// There is deliberately no UPDATE, INSERT or cache in this path. Test
// TestAssessClaimWritesNothing pins that against a real Postgres.

// ClaimAssessor is the AI boundary this service depends on. *ai.Client satisfies
// it; tests inject a fake. Kept in the services package (like ReceiptExtractor)
// so the service has no HTTP concerns.
type ClaimAssessor interface {
	Enabled() bool
	Model() string
	AssessClaim(ctx context.Context, in ai.ClaimAssessmentInput) (ai.ClaimAssessment, error)
}

// ClaimAssessmentResult is the wire shape of POST /api/v1/ai/assess-claim. The
// field names are frozen in openapi.yaml (ClaimAssessment); the handler writes
// this struct directly, with no envelope, because the contract specifies the
// top-level object.
type ClaimAssessmentResult struct {
	ClaimID     string    `json:"claimId"`
	Coverage    string    `json:"coverage"`
	Confidence  string    `json:"confidence"`
	Reasoning   string    `json:"reasoning"`
	Questions   []string  `json:"questions"`
	DraftLetter string    `json:"draftLetter"`
	GeneratedAt time.Time `json:"generatedAt"`
	Model       string    `json:"model"`
}

// decisiveTerms are the contract fields that decide whether a fault is covered
// at all. Four deliberate exclusions:
//
//   - cap / deductible change what the user pays, not whether the claim is
//     accepted, so a missing cap is not a reason to withhold LIKELY_COVERED.
//   - component is NOT a "missing" term when null. Migration 0017 defines a null
//     component as "the whole unit"; treating it as unknown would make almost
//     every legacy plan unanswerable and would contradict the stored meaning.
//     A non-null component is known data ("this plan covers the battery"), which
//     the model uses to reason about whether the fault is in scope.
//   - claimsAllowed is NOT a "missing" term when null either: the warranty
//     validator treats nil as "no ceiling recorded", not "no claims left". A
//     known counter that has reached a known allowance is data the model can
//     reason about (and the prompt tells it to), but the null state is permissive.
//
// scope and exclusions stay: without them the app cannot tell the user what the
// plan does and does not cover, which is exactly the question the endpoint exists
// to answer.
var decisiveTerms = []string{"scope", "exclusions"}

// missingDecisiveTermQuestion maps each decisive term to the question the user
// should ask when it is unknown. The map is only ever read through the ordered
// decisiveTerms slice, so the output order is deterministic.
//
// The sentences are also catalog keys (internal/i18n/catalog.go), rendered with
// i18n.Text at the call site. They follow the request language, like the model's
// own questions, because they sit in the same UI list.
var missingDecisiveTermQuestion = map[string]string{
	"scope":      "Phạm vi bảo hành (scope) trong hợp đồng ghi những gì? Hãy mang hợp đồng để đối chiếu.",
	"exclusions": "Hợp đồng có nêu trường hợp loại trừ nào áp dụng cho lỗi này không?",
	"warranty":   "Bạn còn hợp đồng hoặc phiếu bảo hành nào cho thiết bị này chưa nhập vào ứng dụng không? Hãy mang theo.",
}

// AssessClaim loads the authenticated user's claim + device + warranties, asks
// the model for advice, applies the honesty guard and returns the result. It
// never writes. A claim owned by another user is a 404, never a 403 (the same
// ownership rule as every other claim read).
func AssessClaim(ctx context.Context, db *pgxpool.Pool, client ClaimAssessor, userID, claimID string) (ClaimAssessmentResult, error) {
	// Shared AI gate (ai_gate.go): server key first, then per-user opt-in. The
	// codes and statuses are the receipt endpoint's, on purpose.
	gate, gerr := checkAIGate(ctx, db, client != nil && client.Enabled(), userID)
	if gerr != nil {
		return ClaimAssessmentResult{}, gerr
	}
	switch gate {
	case aiGateFeatureDisabled:
		return ClaimAssessmentResult{}, &AttachmentError{
			Code:    "feature_disabled",
			Message: i18n.Text(ctx, "Tính năng đánh giá yêu cầu bảo hành bằng AI chưa được bật"),
		}
	case aiGateOptInRequired:
		return ClaimAssessmentResult{}, &AttachmentError{
			Code:    "ai_optin_required",
			Message: i18n.Text(ctx, "Cần bật tính năng AI trong Cài đặt trước khi dùng"),
		}
	}

	q := store.New(db)
	claim, err := q.GetClaimByID(ctx, store.GetClaimByIDParams{ID: claimID, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ClaimAssessmentResult{}, &AttachmentError{
				Code:    "not_found",
				Message: i18n.Text(ctx, "Không tìm thấy yêu cầu bảo hành"),
			}
		}
		return ClaimAssessmentResult{}, internalErr(i18n.Text(ctx, "Lỗi tải yêu cầu bảo hành"))
	}
	device, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: claim.DeviceId, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ClaimAssessmentResult{}, &AttachmentError{
				Code:    "not_found",
				Message: i18n.Text(ctx, "Không tìm thấy thiết bị"),
			}
		}
		return ClaimAssessmentResult{}, internalErr(i18n.Text(ctx, "Lỗi tải thiết bị"))
	}
	warranties, err := q.ListWarrantiesByDevice(ctx, store.ListWarrantiesByDeviceParams{
		DeviceId: claim.DeviceId,
		UserId:   userID,
	})
	if err != nil {
		return ClaimAssessmentResult{}, internalErr(i18n.Text(ctx, "Lỗi tải gói bảo hành"))
	}

	assessment, aiErr := client.AssessClaim(ctx, buildClaimAssessmentInput(ctx, claim, device, warranties))
	if aiErr != nil {
		if ae, ok := ai.AsError(aiErr); ok {
			return ClaimAssessmentResult{}, mapAIError(ctx, ae)
		}
		return ClaimAssessmentResult{}, internalErr(i18n.Text(ctx, "Lỗi đánh giá yêu cầu bảo hành"))
	}

	result := ClaimAssessmentResult{
		ClaimID:     claim.ID,
		Coverage:    assessment.Coverage,
		Confidence:  assessment.Confidence,
		Reasoning:   assessment.Reasoning,
		Questions:   assessment.Questions,
		DraftLetter: assessment.DraftLetter,
		GeneratedAt: time.Now().UTC().Truncate(time.Second),
		Model:       client.Model(),
	}
	// Defense in depth: the prompt already forbids this overclaim, and the
	// server refuses to pass it through if the model did it anyway.
	downgradeUnsupportedCoverage(ctx, &result, claim, warranties)
	if result.Questions == nil {
		result.Questions = []string{}
	}
	return result, nil
}

// buildClaimAssessmentInput converts the stored rows into the bounded model
// input. Every nullable contract term is passed as nil, never filled with a
// default: the ai layer renders each null according to its defined meaning
// (component = whole unit, claimsAllowed = no recorded ceiling) or as "KHÔNG RÕ"
// when the term is genuinely unknown, and the honesty rule is evaluated against
// exactly that.
func buildClaimAssessmentInput(ctx context.Context, claim store.Claim, device store.Device, warranties []store.Warranty) ai.ClaimAssessmentInput {
	in := ai.ClaimAssessmentInput{
		Language: string(i18n.From(ctx)),
		Claim: ai.ClaimFacts{
			Issue:         claim.Issue,
			Diagnosis:     claim.Diagnosis,
			Cost:          claim.Cost,
			TicketNumber:  claim.TicketNumber,
			ServiceCenter: claim.ServiceCenter,
			Status:        claim.Status,
			OpenedAt:      formatAssessDate(claim.OpenedAt),
			WarrantyID:    claim.WarrantyId,
		},
		Device: ai.DeviceFacts{
			Name:         device.Name,
			Category:     device.Category,
			Brand:        device.Brand,
			Model:        device.Model,
			SerialNumber: device.SerialNumber,
			PurchaseDate: formatAssessDate(device.PurchaseDate),
			Status:       device.Status,
		},
		Warranties: make([]ai.WarrantyFacts, 0, len(warranties)),
	}
	for _, w := range warranties {
		in.Warranties = append(in.Warranties, ai.WarrantyFacts{
			ID:            w.ID,
			Type:          w.Type,
			Provider:      w.Provider,
			StartDate:     formatAssessDate(w.StartDate),
			EndDate:       formatAssessDate(w.EndDate),
			Months:        w.Months,
			Component:     w.Component,
			Scope:         w.Scope,
			Cap:           w.Cap,
			Deductible:    w.Deductible,
			Exclusions:    w.Exclusions,
			Region:        w.Region,
			Transferable:  w.Transferable,
			ClaimsAllowed: w.ClaimsAllowed,
			ClaimsUsed:    w.ClaimsUsed,
		})
	}
	return in
}

func formatAssessDate(ts pgtype.Timestamp) string {
	if !ts.Valid {
		return ""
	}
	return ts.Time.UTC().Format("2006-01-02")
}

// downgradeUnsupportedCoverage enforces the prompt's honesty rule in Go. It is a
// no-op unless the model asserted LIKELY_COVERED; then, for the warranty under
// claim (or any of the device's warranties when the claim names none), it checks
// the decisive terms. If none of the relevant warranties has all of them, the
// verdict becomes UNCLEAR and the missing-term questions are merged in.
//
// "None of the relevant warranties is complete" rather than "the first one is
// incomplete" is deliberate: a device can carry a STANDARD and a THIRD_PARTY
// plan, and one complete contract is enough to support a covered answer. When
// the claim names a specific warranty, only that contract can support it.
func downgradeUnsupportedCoverage(ctx context.Context, out *ClaimAssessmentResult, claim store.Claim, warranties []store.Warranty) {
	if out.Coverage != ai.CoverageLikelyCovered {
		return
	}
	missing := missingDecisiveTerms(claim, warranties)
	if len(missing) == 0 {
		return
	}
	out.Coverage = ai.CoverageUnclear
	required := make([]string, 0, len(missing))
	for _, term := range missing {
		key, ok := missingDecisiveTermQuestion[term]
		if !ok {
			continue
		}
		required = append(required, i18n.Text(ctx, key))
	}
	out.Questions = mergeAssessQuestions(out.Questions, required)
}

// missingDecisiveTerms returns the ordered list of decisive terms that are
// unknown. An empty result means "at least one relevant contract has every
// decisive term", i.e. the model's LIKELY_COVERED is supportable.
func missingDecisiveTerms(claim store.Claim, warranties []store.Warranty) []string {
	if len(warranties) == 0 {
		return []string{"warranty"}
	}
	relevant := warranties
	if claim.WarrantyId != nil {
		relevant = nil
		for _, w := range warranties {
			if w.ID == *claim.WarrantyId {
				relevant = []store.Warranty{w}
				break
			}
		}
		if len(relevant) == 0 {
			// The claim points at a warranty that is no longer in the device's
			// list. Treat the contract as unknown rather than silently falling
			// back to a different plan.
			return []string{"warranty"}
		}
	}
	for _, w := range relevant {
		if len(missingTermsOf(w)) == 0 {
			return nil
		}
	}
	var missing []string
	for _, term := range decisiveTerms {
		for _, w := range relevant {
			if isTermMissing(w, term) {
				missing = append(missing, term)
				break
			}
		}
	}
	return missing
}

func missingTermsOf(w store.Warranty) []string {
	var missing []string
	for _, term := range decisiveTerms {
		if isTermMissing(w, term) {
			missing = append(missing, term)
		}
	}
	return missing
}

func isTermMissing(w store.Warranty, term string) bool {
	switch term {
	case "scope":
		return blankPtr(w.Scope)
	case "exclusions":
		return blankPtr(w.Exclusions)
	default:
		return true
	}
}

func blankPtr(p *string) bool {
	return p == nil || strings.TrimSpace(*p) == ""
}

// mergeAssessQuestions keeps the required (server-generated) questions and caps
// the combined list at ai.MaxAssessQuestions. Model questions are kept first, but
// truncated if the required ones need room: a question about the exact term that
// blocked the verdict is the one the user must not lose.
func mergeAssessQuestions(existing, required []string) []string {
	if len(required) >= ai.MaxAssessQuestions {
		return append([]string{}, required[:ai.MaxAssessQuestions]...)
	}
	keep := ai.MaxAssessQuestions - len(required)
	out := make([]string, 0, ai.MaxAssessQuestions)
	if len(existing) > keep {
		out = append(out, existing[:keep]...)
	} else {
		out = append(out, existing...)
	}
	out = append(out, required...)
	return out
}
