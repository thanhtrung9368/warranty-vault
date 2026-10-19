package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
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
	// The literal segment is more specific than the {id} wildcard below, so Go's
	// ServeMux routes "bulk" here and never into getDeviceHandler's path. The
	// registration order is irrelevant, but keeping it next to the single create
	// makes the pair obvious.
	mux.Handle("POST /api/v1/devices/bulk", requireUser(http.HandlerFunc(bulkCreateDevicesHandler(deps))))
	mux.Handle("GET /api/v1/devices/{id}", requireUser(http.HandlerFunc(getDeviceHandler(deps))))
	mux.Handle("PATCH /api/v1/devices/{id}", requireUser(http.HandlerFunc(updateDeviceHandler(deps))))
	mux.Handle("DELETE /api/v1/devices/{id}", requireUser(http.HandlerFunc(deleteDeviceHandler(deps))))
}

func listDevicesHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Attach resolves `?lang=` / Accept-Language for THIS request. The real
		// server also runs i18n.Middleware, but the handler tests build their own
		// mux without it, and a test that cannot pin a language either depends on
		// the machine's locale or has to assert the default (docs/I18N_PLAN.md
		// §4.3). Calling it is harmless when the middleware already ran: the two
		// compute the same answer.
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		f := services.DeviceFilter{
			Q:        r.URL.Query().Get("q"),
			Category: r.URL.Query().Get("category"),
			Status:   r.URL.Query().Get("status"),
			Sort:     r.URL.Query().Get("sort"),
			Dir:      r.URL.Query().Get("dir"),
		}
		rows, err := services.ListDevices(ctx, deps.DB, us.UserID, f)
		if err != nil {
			writeDevicesErr(w, ctx, err, "list devices")
			return
		}
		if rows == nil {
			rows = []services.DeviceListItem{}
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"devices": rows})
	}
}

func createDeviceHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}

		// Decode into a flexible map first so we can pull `fromWishlistId`
		// without polluting the strict service input struct.
		var raw map[string]any
		if err := decodeJSON(r, &raw); err != nil {
			badJSONBody(w, ctx)
			return
		}
		var input services.DeviceInput
		if err := remarshal(raw, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}

		fromWishlistID := ""
		if v, ok := raw["fromWishlistId"].(string); ok {
			fromWishlistID = strings.TrimSpace(v)
		}

		device, err := services.CreateDevice(ctx, deps.DB, us.UserID, input, fromWishlistID)
		if err != nil {
			writeDevicesErr(w, ctx, err, "create device")
			return
		}
		// Serial/IMEI advisory post-check (FEATURE_IDEAS #6). It runs AFTER the
		// write and excludes the new row, so a device can never look like a
		// duplicate of itself and a rejected create costs no extra query. The
		// field is additive: the device WAS created, the status stays 201.
		warnings := services.DeviceSerialWarnings(ctx, deps.DB, us.UserID, device.SerialNumber, device.ID)
		httpx.WriteJSONC(w, ctx, http.StatusCreated, map[string]any{"device": device, "warnings": warnings})
	}
}

// bulkCreateDevicesHandler implements POST /api/v1/devices/bulk.
//
// The body is decoded LOOSELY, exactly like the single create (which decodes a
// map and then remarshals it): unknown top-level or per-row fields are ignored
// rather than rejecting the whole batch. The contract only names `devices`, and
// a client that adds a future field must not lose 49 good rows to a 400.
//
// Order of operations:
//  1. decode and enforce the 1..50 shape before anything else, so a 51-row body
//     is a 400 rather than consuming 51 write tokens;
//  2. charge the per-user write bucket once per ROW, not once per request — see
//     ratelimit.CheckUserWriteN and the contract's "a batch is one request but
//     50 writes";
//  3. hand the batch to the service, which validates each row independently and
//     writes the passing ones in one transaction.
func bulkCreateDevicesHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)

		var body struct {
			Devices []services.DeviceInput `json:"devices"`
		}
		if err := decodeJSONLoose(r, &body); err != nil {
			badJSONBody(w, ctx)
			return
		}
		if err := services.ValidateBulkBatchSize(ctx, len(body.Devices)); err != nil {
			writeDevicesErr(w, ctx, err, "bulk create devices")
			return
		}
		if !ensureUserWriteRateN(w, r, deps, us.UserID, len(body.Devices)) {
			return
		}

		result, err := services.BulkCreateDevices(ctx, deps.DB, us.UserID, body.Devices)
		if err != nil {
			writeDevicesErr(w, ctx, err, "bulk create devices")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, result)
	}
}

func getDeviceHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id thiết bị"), nil)
			return
		}
		device, err := services.GetDevice(ctx, deps.DB, us.UserID, id)
		if err != nil {
			writeDevicesErr(w, ctx, err, "get device")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"device": device})
	}
}

func updateDeviceHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id thiết bị"), nil)
			return
		}
		var input services.DeviceInput
		if err := decodeJSON(r, &input); err != nil {
			badJSONBody(w, ctx)
			return
		}
		device, err := services.UpdateDevice(ctx, deps.DB, us.UserID, id, input)
		if err != nil {
			writeDevicesErr(w, ctx, err, "update device")
			return
		}
		// Same advisory post-check as create, excluding the row just edited.
		warnings := services.DeviceSerialWarnings(ctx, deps.DB, us.UserID, device.SerialNumber, device.ID)
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"device": device, "warnings": warnings})
	}
}

func deleteDeviceHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := r.PathValue("id")
		if id == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id thiết bị"), nil)
			return
		}
		if err := services.DeleteDevice(ctx, deps.DB, us.UserID, id); err != nil {
			writeDevicesErr(w, ctx, err, "delete device")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]bool{"ok": true})
	}
}

// ensureUserWriteRate runs the per-user write limiter and writes a 429 when
// the bucket is empty. Returns false if the request was already terminated.
//
// It calls i18n.Attach itself rather than trusting r.Context(): the caller's
// handler has usually attached already, but Attach returns a NEW context instead
// of mutating the request, so `r.Context()` here would carry only the
// middleware's Accept-Language tag and the 429 would ignore `?lang=`.
func ensureUserWriteRate(w http.ResponseWriter, r *http.Request, deps Deps, userID string) bool {
	return ensureUserWriteRateN(w, r, deps, userID, 1)
}

// ensureUserWriteRateN is ensureUserWriteRate with an explicit cost. The bulk
// endpoint charges one token per device row (a 50-row batch costs 50 of the
// 60/minute budget), because treating it as a single write would multiply the
// effective write ceiling by the batch size. The reply and language handling are
// identical to the single-write helper.
func ensureUserWriteRateN(w http.ResponseWriter, r *http.Request, deps Deps, userID string, cost int) bool {
	ctx := i18n.Attach(r)
	rl, _ := ratelimit.CheckUserWriteN(ctx, deps.Limiter, userID, cost)
	if !rl.Ok {
		rateLimited(w, ctx, rl.RetryAfterSec)
		return false
	}
	return true
}

// writeDevicesErr translates a services.* error into the JSON envelope. Logs
// internal errors as 500 with the supplied operation tag. Shared by the
// devices/warranties/reminders handler trio in this package; named with a
// suffix to avoid colliding with helpers defined in other resource files
// (subscriptions, attachments, etc).
//
// A converted domain error carries its user-facing text twice: `MessageKey` names
// a catalog entry and `Message` is the Vietnamese source. Rendering the key is
// what lets an error built deep in services (with no request in scope) reach the
// client in the right language — and, because the catalog is keyed on the
// Vietnamese source text, an error with no key is written out verbatim, so the
// domains Phase 1 has not reached are byte-identical. Mirrors
// writeAuthServiceErr in auth.go; the 500 message stays a literal for the same
// reason it does there (see the note in writeServiceError).
func writeDevicesErr(w http.ResponseWriter, ctx context.Context, err error, op string) {
	var svc *services.Error
	if errors.As(err, &svc) {
		code := strings.ToLower(svc.Code)
		httpx.WriteErrorC(w, ctx, svc.HTTPStatus(), code, domainErrorMessage(ctx, svc), svc.FieldErrors)
		return
	}
	slog.Error(op+" failed", "err", err)
	httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
}
