package handlers

import (
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterClaims wires the warranty-claim routes (migration 0021).
//
// Routes:
//
//	GET    /api/v1/claims          - the caller's claims, newest openedAt first
//	POST   /api/v1/claims          - create (write rate limit, one open claim/device)
//	GET    /api/v1/claims/{id}     - read
//	PATCH  /api/v1/claims/{id}     - full replacement (server-managed closedAt)
//	DELETE /api/v1/claims/{id}     - delete
//
// Auth + rate limiting are wrapped at registration; per-row ownership lives in
// the service layer, so a claim owned by another user is a 404, never a 403.
func RegisterClaims(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /api/v1/claims", requireUser(http.HandlerFunc(listClaimsHandler(deps))))
	mux.Handle("POST /api/v1/claims", requireUser(http.HandlerFunc(createClaimHandler(deps))))
	mux.Handle("GET /api/v1/claims/{id}", requireUser(http.HandlerFunc(getClaimHandler(deps))))
	mux.Handle("PATCH /api/v1/claims/{id}", requireUser(http.HandlerFunc(updateClaimHandler(deps))))
	mux.Handle("DELETE /api/v1/claims/{id}", requireUser(http.HandlerFunc(deleteClaimHandler(deps))))
}

func listClaimsHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Attach makes `?lang=` work even when this handler is reached without
		// i18n.Middleware (the handler tests build their own mux). See the note
		// in devices.go::listDevicesHandler.
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		rows, err := services.ListClaims(ctx, deps.DB, us.UserID, services.ClaimFilter{
			DeviceID: r.URL.Query().Get("deviceId"),
			Status:   r.URL.Query().Get("status"),
		})
		if err != nil {
			writeDevicesErr(w, ctx, err, "list claims")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"claims": rows})
	}
}

func createClaimHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		var input services.ClaimInput
		if err := decodeJSON(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		row, err := services.CreateClaim(ctx, deps.DB, us.UserID, input)
		if err != nil {
			writeDevicesErr(w, ctx, err, "create claim")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusCreated, map[string]any{"claim": row})
	}
}

func getClaimHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Thiếu id yêu cầu bảo hành"), nil)
			return
		}
		row, err := services.GetClaim(ctx, deps.DB, us.UserID, id)
		if err != nil {
			writeDevicesErr(w, ctx, err, "get claim")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"claim": row})
	}
}

func updateClaimHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Thiếu id yêu cầu bảo hành"), nil)
			return
		}
		var input services.ClaimInput
		if err := decodeJSON(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		row, err := services.UpdateClaim(ctx, deps.DB, us.UserID, id, input)
		if err != nil {
			writeDevicesErr(w, ctx, err, "update claim")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"claim": row})
	}
}

func deleteClaimHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Thiếu id yêu cầu bảo hành"), nil)
			return
		}
		if err := services.DeleteClaim(ctx, deps.DB, us.UserID, id); err != nil {
			writeDevicesErr(w, ctx, err, "delete claim")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]bool{"ok": true})
	}
}
