package handlers

import (
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterWarranties wires the warranty + reminder dismiss/restore routes.
//
// Routes:
//
//	GET    /api/v1/devices/{id}/warranties     - list (verifies device ownership)
//	POST   /api/v1/devices/{id}/warranties     - create (write rate limit, count<5)
//	PATCH  /api/v1/warranties/{id}             - update
//	DELETE /api/v1/warranties/{id}             - delete
//	POST   /api/v1/warranties/{id}/reminder    - dismiss
//	DELETE /api/v1/warranties/{id}/reminder    - restore (i.e. un-dismiss)
func RegisterWarranties(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /api/v1/devices/{id}/warranties", requireUser(http.HandlerFunc(listWarrantiesHandler(deps))))
	mux.Handle("POST /api/v1/devices/{id}/warranties", requireUser(http.HandlerFunc(createWarrantyHandler(deps))))
	mux.Handle("PATCH /api/v1/warranties/{id}", requireUser(http.HandlerFunc(updateWarrantyHandler(deps))))
	mux.Handle("DELETE /api/v1/warranties/{id}", requireUser(http.HandlerFunc(deleteWarrantyHandler(deps))))
	mux.Handle("POST /api/v1/warranties/{id}/reminder", requireUser(http.HandlerFunc(dismissReminderHandler(deps))))
	mux.Handle("DELETE /api/v1/warranties/{id}/reminder", requireUser(http.HandlerFunc(restoreReminderHandler(deps))))
}

func listWarrantiesHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		deviceID := r.PathValue("id")
		if deviceID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu id thiết bị", nil)
			return
		}
		rows, err := services.ListWarrantiesByDevice(r.Context(), deps.DB, us.UserID, deviceID)
		if err != nil {
			writeDevicesErr(w, ctx, err, "list warranties")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"warranties": rows})
	}
}

func createWarrantyHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		deviceID := r.PathValue("id")
		if deviceID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu id thiết bị", nil)
			return
		}
		var input services.WarrantyInput
		if err := decodeJSON(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		row, err := services.CreateWarranty(r.Context(), deps.DB, us.UserID, deviceID, input)
		if err != nil {
			writeDevicesErr(w, ctx, err, "create warranty")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"warranty": row})
	}
}

func updateWarrantyHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu id gói bảo hành", nil)
			return
		}
		var input services.WarrantyInput
		if err := decodeJSON(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		row, err := services.UpdateWarranty(r.Context(), deps.DB, us.UserID, id, input)
		if err != nil {
			writeDevicesErr(w, ctx, err, "update warranty")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"warranty": row})
	}
}

func deleteWarrantyHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu id gói bảo hành", nil)
			return
		}
		if err := services.DeleteWarranty(r.Context(), deps.DB, us.UserID, id); err != nil {
			writeDevicesErr(w, ctx, err, "delete warranty")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func dismissReminderHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu id gói bảo hành", nil)
			return
		}
		if err := services.DismissReminder(r.Context(), deps.DB, us.UserID, id); err != nil {
			writeDevicesErr(w, ctx, err, "dismiss reminder")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

func restoreReminderHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", "Thiếu id gói bảo hành", nil)
			return
		}
		if err := services.RestoreReminder(r.Context(), deps.DB, us.UserID, id); err != nil {
			writeDevicesErr(w, ctx, err, "restore reminder")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}
