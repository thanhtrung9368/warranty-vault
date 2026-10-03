package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterDevices wires the /api/v1/devices/* surface onto the supplied mux.
// Auth + rate limit are wrapped at registration; per-row ownership lives
// inside the service layer.
func RegisterDevices(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /api/v1/devices", requireUser(http.HandlerFunc(listDevicesHandler(deps))))
	mux.Handle("POST /api/v1/devices", requireUser(http.HandlerFunc(createDeviceHandler(deps))))
	mux.Handle("GET /api/v1/devices/{id}", requireUser(http.HandlerFunc(getDeviceHandler(deps))))
	mux.Handle("PATCH /api/v1/devices/{id}", requireUser(http.HandlerFunc(updateDeviceHandler(deps))))
	mux.Handle("DELETE /api/v1/devices/{id}", requireUser(http.HandlerFunc(deleteDeviceHandler(deps))))
}

func listDevicesHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		f := services.DeviceFilter{
			Q:        r.URL.Query().Get("q"),
			Category: r.URL.Query().Get("category"),
			Status:   r.URL.Query().Get("status"),
			Sort:     r.URL.Query().Get("sort"),
			Dir:      r.URL.Query().Get("dir"),
		}
		rows, err := services.ListDevices(r.Context(), deps.DB, us.UserID, f)
		if err != nil {
			writeDevicesErr(w, err, "list devices")
			return
		}
		if rows == nil {
			rows = []services.DeviceListItem{}
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"devices": rows})
	}
}

func createDeviceHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}

		// Decode into a flexible map first so we can pull `fromWishlistId`
		// without polluting the strict service input struct.
		var raw map[string]any
		if err := decodeJSON(r, &raw); err != nil {
			badJSONBody(w)
			return
		}
		var input services.DeviceInput
		if err := remarshal(raw, &input); err != nil {
			badJSONBody(w)
			return
		}

		fromWishlistID := ""
		if v, ok := raw["fromWishlistId"].(string); ok {
			fromWishlistID = strings.TrimSpace(v)
		}

		device, err := services.CreateDevice(r.Context(), deps.DB, us.UserID, input, fromWishlistID)
		if err != nil {
			writeDevicesErr(w, err, "create device")
			return
		}
		// Serial/IMEI advisory post-check (FEATURE_IDEAS #6). It runs AFTER the
		// write and excludes the new row, so a device can never look like a
		// duplicate of itself and a rejected create costs no extra query. The
		// field is additive: the device WAS created, the status stays 201.
		warnings := services.DeviceSerialWarnings(r.Context(), deps.DB, us.UserID, device.SerialNumber, device.ID)
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"device": device, "warnings": warnings})
	}
}

func getDeviceHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id thiết bị", nil)
			return
		}
		device, err := services.GetDevice(r.Context(), deps.DB, us.UserID, id)
		if err != nil {
			writeDevicesErr(w, err, "get device")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"device": device})
	}
}

func updateDeviceHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id thiết bị", nil)
			return
		}
		var input services.DeviceInput
		if err := decodeJSON(r, &input); err != nil {
			badJSONBody(w)
			return
		}
		device, err := services.UpdateDevice(r.Context(), deps.DB, us.UserID, id, input)
		if err != nil {
			writeDevicesErr(w, err, "update device")
			return
		}
		// Same advisory post-check as create, excluding the row just edited.
		warnings := services.DeviceSerialWarnings(r.Context(), deps.DB, us.UserID, device.SerialNumber, device.ID)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"device": device, "warnings": warnings})
	}
}

func deleteDeviceHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id thiết bị", nil)
			return
		}
		if err := services.DeleteDevice(r.Context(), deps.DB, us.UserID, id); err != nil {
			writeDevicesErr(w, err, "delete device")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ensureUserWriteRate runs the per-user write limiter and writes a 429 when
// the bucket is empty. Returns false if the request was already terminated.
func ensureUserWriteRate(w http.ResponseWriter, r *http.Request, deps Deps, userID string) bool {
	rl, _ := ratelimit.CheckUserWrite(r.Context(), deps.Limiter, userID)
	if !rl.Ok {
		rateLimited(w, rl.RetryAfterSec)
		return false
	}
	return true
}

// writeDevicesErr translates a services.* error into the JSON envelope. Logs
// internal errors as 500 with the supplied operation tag. Shared by the
// devices/warranties/reminders handler trio in this package; named with a
// suffix to avoid colliding with helpers defined in other resource files
// (subscriptions, attachments, etc).
func writeDevicesErr(w http.ResponseWriter, err error, op string) {
	var svc *services.Error
	if errors.As(err, &svc) {
		code := strings.ToLower(svc.Code)
		httpx.WriteError(w, svc.HTTPStatus(), code, svc.Message, svc.FieldErrors)
		return
	}
	slog.Error(op+" failed", "err", err)
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
}
