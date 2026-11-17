package handlers

import (
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterStaples wires the essentials/restock surface. Like the Wishlist, it
// is auth-gated and every mutation is per-user rate-limited. The table is kept
// separate from WishlistItem so buying toothpaste cannot create a Device.
func RegisterStaples(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /api/v1/staples", requireUser(http.HandlerFunc(listStaplesHandler(deps))))
	mux.Handle("POST /api/v1/staples", requireUser(http.HandlerFunc(createStapleHandler(deps))))
	mux.Handle("PATCH /api/v1/staples/{id}", requireUser(http.HandlerFunc(updateStapleHandler(deps))))
	mux.Handle("DELETE /api/v1/staples/{id}", requireUser(http.HandlerFunc(deleteStapleHandler(deps))))
	// Restock receipts (migration 0034). No DELETE: a receipt is history, and
	// deleting the staple cascades it away. Recording one also sets the staple's
	// state/lastBoughtAt in the same transaction (services.CreateStaplePurchase).
	mux.Handle("GET /api/v1/staples/{id}/purchases", requireUser(http.HandlerFunc(listStaplePurchasesHandler(deps))))
	mux.Handle("POST /api/v1/staples/{id}/purchases", requireUser(http.HandlerFunc(createStaplePurchaseHandler(deps))))
}

func listStaplesHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		var stateFilter *string
		if v := r.URL.Query().Get("state"); v != "" {
			stateFilter = &v
		}
		items, err := services.ListStaples(ctx, deps.DB, us.UserID, stateFilter)
		if err != nil {
			writeServiceError(w, ctx, err, "list staples")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"items": items})
	}
}

func createStapleHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		var input services.StapleInput
		if err := decodeJSONLoose(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		row, err := services.CreateStaple(ctx, deps.DB, us.UserID, input)
		if err != nil {
			writeServiceError(w, ctx, err, "create staple")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusCreated, map[string]any{"item": row})
	}
}

func updateStapleHandler(deps Deps) http.HandlerFunc {
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
		var input services.StapleInput
		if err := decodeJSONLoose(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		row, err := services.UpdateStaple(ctx, deps.DB, us.UserID, id, input)
		if err != nil {
			writeServiceError(w, ctx, err, "update staple")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"item": row})
	}
}

func deleteStapleHandler(deps Deps) http.HandlerFunc {
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
		if err := services.DeleteStaple(ctx, deps.DB, us.UserID, id); err != nil {
			writeServiceError(w, ctx, err, "delete staple")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]bool{"ok": true})
	}
}

func listStaplePurchasesHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id món"), nil)
			return
		}
		items, err := services.ListStaplePurchases(ctx, deps.DB, us.UserID, id)
		if err != nil {
			writeServiceError(w, ctx, err, "list staple purchases")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"items": items})
	}
}

func createStaplePurchaseHandler(deps Deps) http.HandlerFunc {
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
		var input services.StaplePurchaseInput
		if err := decodeJSONLoose(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		result, err := services.CreateStaplePurchase(ctx, deps.DB, us.UserID, id, input)
		if err != nil {
			writeServiceError(w, ctx, err, "create staple purchase")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusCreated, result)
	}
}
