package handlers

import (
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterStats wires GET /api/v1/stats. Auth-gated; the service fans out
// independent queries with errgroup.
func RegisterStats(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/stats", requireUser(http.HandlerFunc(statsHandler(deps))))
}

func statsHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		stats, err := services.Snapshot(r.Context(), deps.DB, us.UserID)
		if err != nil {
			writeServiceError(w, err, "stats snapshot")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, stats)
	}
}
