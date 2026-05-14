package handlers

import (
	"net/http"
	"strconv"

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

		rows, err := services.ListUpcomingReminders(r.Context(), deps.DB, us.UserID, withinDays)
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
