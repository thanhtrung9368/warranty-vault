package handlers

import (
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterWishlist wires the /api/v1/wishlist/* surface onto the supplied mux.
// Auth wraps every route; per-user rate-limit wraps mutations.
func RegisterWishlist(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /api/v1/wishlist", requireUser(http.HandlerFunc(listWishlistHandler(deps))))
	mux.Handle("POST /api/v1/wishlist", requireUser(http.HandlerFunc(createWishlistHandler(deps))))
	mux.Handle("GET /api/v1/wishlist/{id}", requireUser(http.HandlerFunc(getWishlistHandler(deps))))
	mux.Handle("PATCH /api/v1/wishlist/{id}", requireUser(http.HandlerFunc(updateWishlistHandler(deps))))
	mux.Handle("DELETE /api/v1/wishlist/{id}", requireUser(http.HandlerFunc(deleteWishlistHandler(deps))))
	mux.Handle("POST /api/v1/wishlist/{id}/prices", requireUser(http.HandlerFunc(logWishlistPriceHandler(deps))))
}

func listWishlistHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Attach resolves `?lang=` / Accept-Language for THIS request. The real
		// server also runs i18n.Middleware, but the handler tests build their own
		// mux without it, and a test that cannot pin a language either depends on
		// the machine's locale or has to assert the default (docs/I18N_PLAN.md
		// §4.3). Calling it is harmless when the middleware already ran.
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		var statusFilter *string
		if v := r.URL.Query().Get("status"); v != "" {
			statusFilter = &v
		}
		items, err := services.ListWishlist(ctx, deps.DB, us.UserID, statusFilter)
		if err != nil {
			writeServiceError(w, ctx, err, "list wishlist")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"items": items})
	}
}

func createWishlistHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		var input services.WishlistInput
		if err := decodeJSONLoose(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		item, err := services.CreateWishlist(ctx, deps.DB, us.UserID, input)
		if err != nil {
			writeServiceError(w, ctx, err, "create wishlist")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusCreated, map[string]any{"item": item})
	}
}

func getWishlistHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id món"), nil)
			return
		}
		detail, err := services.GetWishlist(ctx, deps.DB, us.UserID, id)
		if err != nil {
			writeServiceError(w, ctx, err, "get wishlist")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{
			"item":   detail.Item,
			"prices": detail.Prices,
		})
	}
}

func updateWishlistHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id món"), nil)
			return
		}
		var input services.WishlistInput
		if err := decodeJSONLoose(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		item, err := services.UpdateWishlist(ctx, deps.DB, us.UserID, id, input)
		if err != nil {
			writeServiceError(w, ctx, err, "update wishlist")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"item": item})
	}
}

func deleteWishlistHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id món"), nil)
			return
		}
		if err := services.DeleteWishlist(ctx, deps.DB, us.UserID, id); err != nil {
			writeServiceError(w, ctx, err, "delete wishlist")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]bool{"ok": true})
	}
}

func logWishlistPriceHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id món"), nil)
			return
		}
		var input services.PriceLogInput
		if err := decodeJSONLoose(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		if err := services.LogWishlistPrice(ctx, deps.DB, us.UserID, id, input); err != nil {
			writeServiceError(w, ctx, err, "log wishlist price")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusCreated, map[string]bool{"ok": true})
	}
}
