package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

const (
	defaultRemindersWithinDays = 30
	maxRemindersWithinDays     = 365
)

// RegisterReminders wires GET /api/v1/reminders.
func RegisterReminders(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/reminders", requireUser(http.HandlerFunc(listRemindersHandler(deps))))
}

// parseBoolQuery parses a strict boolean query parameter.
//
// Returns (value, true) when raw is a recognised boolean, (false, true) when the
// parameter is absent (the caller keeps its default), and (false, false) when the
// caller sent something unparseable (the caller answers 400). Deliberately
// strict: silently reading "yes" / "maybe" as false would discard the user's
// intent on a flag that changes which reminders they can see.
func parseBoolQuery(raw string) (value bool, ok bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "":
		return false, true
	case "true", "1":
		return true, true
	case "false", "0":
		return false, true
	default:
		return false, false
	}
}

func listRemindersHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())

		withinDays := defaultRemindersWithinDays
		if raw := r.URL.Query().Get("withinDays"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > maxRemindersWithinDays {
				httpx.WriteError(w, http.StatusBadRequest, "bad_input",
					"Tham số withinDays không hợp lệ",
					map[string][]string{
						"withinDays": {"Phải là số nguyên từ 1 tới " + strconv.Itoa(maxRemindersWithinDays)},
					})
				return
			}
			withinDays = n
		}

		// Opt-in (default false): also return the user's dismissed reminders so a
		// UI can offer an "Đã ẩn" section. Absent/false keeps the pre-flag
		// behaviour AND response shape exactly.
		includeDismissed, ok := parseBoolQuery(r.URL.Query().Get("includeDismissed"))
		if !ok {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input",
				"Tham số includeDismissed không hợp lệ",
				map[string][]string{
					"includeDismissed": {"Phải là true hoặc false"},
				})
			return
		}

		rows, err := services.ListUpcomingReminders(r.Context(), deps.DB, us.UserID, withinDays, includeDismissed)
		if err != nil {
			writeDevicesErr(w, err, "list reminders")
			return
		}
		if rows == nil {
			rows = []services.ReminderRow{}
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"reminders": rows})
	}
}
