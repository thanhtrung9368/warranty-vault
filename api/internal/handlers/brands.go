package handlers

import (
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Brand service-info endpoint (gap #11, migration 0023).
//
// This is the single-brand form of the directory data GET /api/v1/catalog
// already returns in `brandServiceInfo` (migration 0012), now carrying the
// brand's `warrantyLookupUrl`. It is auth-gated and read-only, like the catalog.
//
// Why a dedicated route when the catalog already carries the array: the device
// form has a brand id in hand and needs exactly one row, and the catalog payload
// is a full catalog (categories, brands, stores, providers, 16 directory rows,
// each an object). The endpoint reads through the same 60s in-process cache, so
// the two cannot disagree about a URL.
//
// The response is an envelope (`serviceInfo`) for consistency with the other
// single-resource endpoints (`device`, `directory`). Three outcomes:
//
//   - 200 with the row    — known brand with directory data;
//   - 200 with `null`     — known brand with no directory row (49 brands are
//     seeded, only 16 have one; that is a normal answer,
//     not a missing resource);
//   - 404                 — no such active brand.
//
// i18n: the only copy here is the missing-id refusal and the service's
// "Không tìm thấy hãng"; the rows themselves are vendor URLs and operator
// notes, which are not translated.
func RegisterBrands(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/brands/{brandId}/service-info",
		requireUser(http.HandlerFunc(brandServiceInfoHandler(deps))))
}

func brandServiceInfoHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Attach at the edge: handler tests build their own mux without the
		// middleware, and the service translates its 404 through this context.
		ctx := i18n.Attach(r)
		brandID := strings.TrimSpace(r.PathValue("brandId"))
		if brandID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Thiếu id hãng"), nil)
			return
		}
		info, err := services.GetBrandServiceInfo(ctx, deps.DB, brandID)
		if err != nil {
			writeDevicesErr(w, ctx, err, "brand service info")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"serviceInfo": info})
	}
}
