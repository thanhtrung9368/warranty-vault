package handlers

import (
	"net/http"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterReturnWindows wires GET /api/v1/return-windows.
//
// A separate endpoint rather than a group inside GET /api/v1/reminders, for two
// reasons:
//
//  1. The two lists answer different questions. The reminders feed is a LOOKAHEAD
//     window over `Warranty.endDate` ("cái gì sắp hết"); an exchange window is
//     "cái gì còn đang mở", which is a right-closed interval starting in the past
//     for devices bought weeks ago. Expressing it through `withinDays` would make
//     one parameter mean two different things.
//  2. The reminders response shape is frozen for three clients. This endpoint adds
//     a surface instead of changing one, so `GET /api/v1/reminders` stays
//     byte-identical — the same reasoning that produced `/api/v1/forecast` instead
//     of extra fields on `/api/v1/stats`.
//
// FEATURE_IDEAS #1 asks for the exchange window to be a group visually SEPARATE
// from "Sắp hết bảo hành"; a separate resource is the API-level version of that.
func RegisterReturnWindows(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/return-windows",
		requireUser(http.HandlerFunc(listReturnWindowsHandler(deps))))
}

func listReturnWindowsHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, ok := auth.UserFromContext(r.Context())
		if !ok {
			unauthorized(w)
			return
		}
		rows, err := services.ListReturnWindows(r.Context(), deps.DB, us.UserID, time.Now())
		if err != nil {
			writeServiceError(w, err, "list return windows")
			return
		}
		if rows == nil {
			rows = []services.ReturnWindowRow{}
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"returnWindows": rows})
	}
}
