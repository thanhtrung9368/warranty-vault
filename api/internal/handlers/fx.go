package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/fx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
)

// RegisterFX wires GET /api/v1/fx/rates — the rate PREFILL helper for devices
// recorded in a foreign currency (migration 0022, gap #16).
//
// Authenticated on purpose: it is a convenience for a logged-in user filling in
// the device form, not a public exchange-rate API. Each user gets their own
// bucket (ratelimit.CheckFXRate) so a client stuck in a retry loop cannot turn
// this service into a proxy for the upstream.
//
// The endpoint NEVER supplies a device's stored rate. Device.fxRate is locked at
// entry; this only shows today's number so the user can confirm it. When the
// upstream is unreachable the endpoint says so (503) instead of guessing,
// because a guessed rate silently corrupts every total the feature exists to
// fix.
func RegisterFX(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/fx/rates", requireUser(http.HandlerFunc(fxRatesHandler(deps))))
}

func fxRatesHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// i18n.Attach resolves `?lang=` / Accept-Language for this request; the
		// handler tests build their own mux with no middleware, and the 400/503
		// sentences below must still follow the request's language.
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)

		rl, _ := ratelimit.CheckFXRate(ctx, deps.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		// `?base=` defaults to USD, the upstream's own natural base and the
		// currency most foreign purchases are priced in. The code is normalised
		// before validation so `?base=usd` works; an unsupported code is a 400,
		// not an upstream call.
		base := strings.TrimSpace(r.URL.Query().Get("base"))
		if base == "" {
			base = "USD"
		}

		if deps.FX == nil {
			// The service was not wired (possible only in a hand-built Deps). Be
			// honest and let the client fall back to manual entry.
			writeFXUnavailable(w, ctx, "fx service not configured")
			return
		}

		snap, err := deps.FX.Rates(ctx, base)
		if err != nil {
			if errors.Is(err, fx.ErrUnsupportedBase) {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
					i18n.Text(ctx, "Loại tiền không hỗ trợ"),
					map[string][]string{"base": {i18n.Text(ctx, "Loại tiền không hỗ trợ")}})
				return
			}
			// Detail goes to the log only: the client must not see an upstream URL
			// or a transport error, and it must not turn a failure into a number.
			writeFXUnavailable(w, ctx, err.Error())
			return
		}

		httpx.WriteJSONC(w, ctx, http.StatusOK, snap)
	}
}

// writeFXUnavailable is the single 503 path: the client cannot prefill the rate
// and must ask the user to enter it by hand. The message says exactly that
// rather than "internal error", because the action is different.
func writeFXUnavailable(w http.ResponseWriter, ctx context.Context, detail string) {
	slog.Warn("fx rates unavailable", "err", detail)
	httpx.WriteErrorC(w, ctx, http.StatusServiceUnavailable, "fx_unavailable",
		i18n.Text(ctx, "Không lấy được tỷ giá. Hãy tự nhập tỷ giá."), nil)
}
