package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// ---- POST /api/v1/billing/verify ------------------------------------------------

type premiumVerifyRequest struct {
	JWS string `json:"jws"`
}

// VerifyPremium accepts the StoreKit 2 signed transaction, verifies it, and
// stores the entitlement. The client may call it for every current transaction
// on restore/sync; the service is idempotent per transactionId.
//
// It deliberately answers 200 with premium:false for a valid-but-expired or
// revoked transaction: that is a normal state, not a client error, and the app
// needs the answer to turn the paywall back into "expired" instead of showing
// a mysterious failure.
func VerifyPremium(d Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, err := auth.VerifyBearer(r.Context(), d.DB, r.Header.Get("Authorization"))
		if err != nil {
			unauthorized(w, ctx)
			return
		}

		rl, _ := ratelimit.CheckUserWrite(r.Context(), d.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		var body premiumVerifyRequest
		if err := decodeJSON(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}
		jws := strings.TrimSpace(body.JWS)
		if jws == "" {
			badInput(w, ctx, map[string][]string{
				"jws": {i18n.Text(ctx, "Thiếu mã giao dịch App Store.")},
			})
			return
		}

		status, err := services.VerifyAndStorePremium(r.Context(), d.DB, us.UserID, jws)
		switch {
		case errors.Is(err, services.ErrPremiumOwned):
			httpx.WriteErrorC(w, ctx, http.StatusConflict, "receipt_owned",
				i18n.Text(ctx, "Giao dịch này đã thuộc về một tài khoản khác."), nil)
			return
		case errors.Is(err, services.ErrPremiumProduct):
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "product_not_allowed",
				i18n.Text(ctx, "Gói đăng ký này không được hỗ trợ."), nil)
			return
		case errors.Is(err, services.ErrPremiumInvalid):
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "invalid_receipt",
				i18n.Text(ctx, "Không xác minh được giao dịch App Store."), nil)
			return
		case err != nil:
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error",
				i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		resp := map[string]any{
			"premium":     status.Active,
			"environment": status.Environment,
		}
		if status.Active {
			resp["productId"] = status.ProductID
			resp["expiresAt"] = status.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z07:00")
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, resp)
	}
}
