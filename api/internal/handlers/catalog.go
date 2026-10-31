package handlers

import (
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
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
		// Attach resolves `?lang=` / Accept-Language for THIS request. The real
		// server also runs i18n.Middleware, but the handler tests build their own
		// mux without it, and the category names in this payload depend on the
		// resolved tag. Calling it is harmless when the middleware already ran:
		// the two compute the same answer.
		ctx := i18n.Attach(r)
		// CatalogForRequest localizes a COPY of the cached catalog; the cache
		// itself stays canonical and language-free (see services/catalog.go).
		cat, err := services.CatalogForRequest(ctx, deps.DB)
		if err != nil {
			writeServiceError(w, ctx, err, "list catalog")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, cat)
	}
}
