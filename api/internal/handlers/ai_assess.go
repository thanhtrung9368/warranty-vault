package handlers

import (
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// POST /api/v1/ai/assess-claim — AI claim assessment + Vietnamese letter draft.
//
// The handler is deliberately thin, matching extractReceiptHandler: rate limit,
// feature gate, body shape, service call, shared error writer. The ownership
// check, the contract terms and the honesty guard all live in
// services/ai_assess.go. Nothing here (and nothing there) writes a row.
func assessClaimHandler(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)

		// Same tighter bucket as receipt OCR, but a separate key: a user
		// alternating "scan the receipt" and "assess the claim" at the counter
		// should not have one action starve the other.
		rl, _ := ratelimit.CheckAIAssess(ctx, d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		// The same gate as receipt OCR (services/ai_gate.go), same 503/code. The
		// sentence names this feature so a user does not go looking for a
		// receipt-scanning switch they never opened.
		if d.AI == nil || !d.AI.Enabled() {
			httpx.WriteErrorC(w, ctx, http.StatusServiceUnavailable, "feature_disabled",
				i18n.Text(ctx, "Tính năng đánh giá yêu cầu bảo hành bằng AI chưa được bật"), nil)
			return
		}

		var body struct {
			ClaimID string `json:"claimId"`
		}
		if err := decodeJSONLoose(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}
		claimID := strings.TrimSpace(body.ClaimID)
		if claimID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Thiếu claimId"), nil)
			return
		}

		result, err := services.AssessClaim(ctx, d.DB, d.AI, us.UserID, claimID)
		if err != nil {
			// The service already resolved every sentence to the request's
			// language; writeAIError maps the frozen code to the status.
			writeAIError(w, ctx, err)
			return
		}
		// No envelope: the frozen contract is the top-level ClaimAssessment
		// object, and the three clients decode it as such.
		httpx.WriteJSONC(w, ctx, http.StatusOK, result)
	}
}
