package handlers

import (
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
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
		us, _ := auth.UserFromContext(r.Context())
		var statusFilter *string
		if v := r.URL.Query().Get("status"); v != "" {
			statusFilter = &v
		}
		items, err := services.ListWishlist(r.Context(), deps.DB, us.UserID, statusFilter)
		if err != nil {
			writeServiceError(w, err, "list wishlist")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func createWishlistHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		var input services.WishlistInput
		if err := decodeJSONLoose(r, &input); err != nil {
			badJSONBody(w)
			return
		}
		item, err := services.CreateWishlist(r.Context(), deps.DB, us.UserID, input)
		if err != nil {
			writeServiceError(w, err, "create wishlist")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"item": item})
	}
}

func getWishlistHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id món", nil)
			return
		}
		detail, err := services.GetWishlist(r.Context(), deps.DB, us.UserID, id)
		if err != nil {
			writeServiceError(w, err, "get wishlist")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"item":   detail.Item,
			"prices": detail.Prices,
		})
	}
}

func updateWishlistHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id món", nil)
			return
		}
		var input services.WishlistInput
		if err := decodeJSONLoose(r, &input); err != nil {
			badJSONBody(w)
			return
		}
		item, err := services.UpdateWishlist(r.Context(), deps.DB, us.UserID, id, input)
		if err != nil {
			writeServiceError(w, err, "update wishlist")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"item": item})
	}
}

func deleteWishlistHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id món", nil)
			return
		}
		if err := services.DeleteWishlist(r.Context(), deps.DB, us.UserID, id); err != nil {
			writeServiceError(w, err, "delete wishlist")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func logWishlistPriceHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id món", nil)
			return
		}
		var input services.PriceLogInput
		if err := decodeJSONLoose(r, &input); err != nil {
			badJSONBody(w)
			return
		}
		if err := services.LogWishlistPrice(r.Context(), deps.DB, us.UserID, id, input); err != nil {
			writeServiceError(w, err, "log wishlist price")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]bool{"ok": true})
	}
}
