package handlers

import (
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterCatalog wires GET /api/v1/catalog. Read-only, auth-gated, in-process
// TTL-cached at the service layer.
func RegisterCatalog(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/catalog", requireUser(http.HandlerFunc(catalogHandler(deps))))
}

func catalogHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cat, err := services.ListCatalog(r.Context(), deps.DB)
		if err != nil {
			writeServiceError(w, err, "list catalog")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, cat)
	}
}
