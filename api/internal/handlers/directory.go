package handlers

import (
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Warranty directory endpoint (FEATURE_IDEAS #15). Read-only and auth-gated —
// it is scoped to one device the caller owns, exactly like GET /api/v1/devices/{id}.
//
// This is an ADDITIONAL route rather than a field on the device read for one
// reason: resolving the directory needs the catalog (60s in-process cache) and
// the device + warranties, and bolting a catalog lookup onto every device read
// would make the hot path depend on a second table for a card most reads never
// show. The catalog itself also carries the raw `brandServiceInfo` array, so a
// client that already fetched GET /api/v1/catalog can render the same card
// client-side; this endpoint exists so the MATCHING rule (free text → brand /
// provider row, including the "ambiguous ⇒ no match" case) lives in one place
// instead of being re-implemented by three clients.
func RegisterDirectory(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/devices/{id}/service-directory",
		requireUser(http.HandlerFunc(serviceDirectoryHandler(deps))))
}

func serviceDirectoryHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu id thiết bị", nil)
			return
		}
		dir, err := services.BuildServiceDirectory(r.Context(), deps.DB, us.UserID, id)
		if err != nil {
			writeDevicesErr(w, ctx, err, "service directory")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"directory": dir})
	}
}
