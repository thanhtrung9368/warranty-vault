package handlers

import (
	"net/http"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
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
		ctx := r.Context()
		us, ok := auth.UserFromContext(r.Context())
		if !ok {
			unauthorized(w, ctx)
			return
		}
		months, err := services.ParseForecastMonths(r.URL.Query().Get("months"))
		if err != nil {
			writeServiceError(w, ctx, err, "parse forecast months")
			return
		}
		forecast, err := services.GetForecast(r.Context(), deps.DB, us.UserID, months, time.Now())
		if err != nil {
			writeServiceError(w, ctx, err, "forecast")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, forecast)
	}
}
