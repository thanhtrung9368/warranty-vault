package handlers

import (
	"net/http"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterForecast wires GET /api/v1/forecast.
//
// A separate endpoint rather than an extra field on GET /api/v1/stats: /stats is
// a single round trip three clients already depend on, and this read needs three
// more queries plus a per-charge walk over the user's subscriptions. Keeping it
// separate means a dashboard that never opens the forecast pays nothing for it,
// and the /stats response shape stays byte-identical (its money fields are
// untouched).
func RegisterForecast(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/forecast", requireUser(http.HandlerFunc(forecastHandler(deps))))
}

func forecastHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// The forecast's `note` — and the refusal below — are server-generated
		// copy, so the request's language has to be attached before either is
		// produced. `?lang=` is read here, exactly as the other converted
		// handlers do it.
		ctx := i18n.Attach(r)
		us, ok := auth.UserFromContext(ctx)
		if !ok {
			unauthorized(w, ctx)
			return
		}
		months, err := services.ParseForecastMonths(ctx, r.URL.Query().Get("months"))
		if err != nil {
			writeServiceError(w, ctx, err, "parse forecast months")
			return
		}
		forecast, err := services.GetForecast(ctx, deps.DB, us.UserID, months, time.Now())
		if err != nil {
			writeServiceError(w, ctx, err, "forecast")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, forecast)
	}
}
