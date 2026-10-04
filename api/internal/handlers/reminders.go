package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
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
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)

		withinDays := defaultRemindersWithinDays
		if raw := r.URL.Query().Get("withinDays"); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > maxRemindersWithinDays {
				// The field error used to be assembled by CONCATENATION
				// ("Phải là số nguyên từ 1 tới " + strconv.Itoa(max)), which can
				// never be a catalog key: no literal at any call site equals the
				// result, so `i18n.Text` would always miss and the sentence stayed
				// Vietnamese under ?lang=en. It is now the printf-shaped key
				// wave 4 added for /search's `limit` — same sentence, same bound,
				// different parameter name.
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
					i18n.Text(ctx, "Tham số withinDays không hợp lệ"),
					map[string][]string{
						"withinDays": {i18n.T(ctx, "Phải là số nguyên từ 1 tới %d", maxRemindersWithinDays)},
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
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Tham số includeDismissed không hợp lệ"),
				map[string][]string{
					"includeDismissed": {i18n.Text(ctx, "Phải là true hoặc false")},
				})
			return
		}

		rows, err := services.ListUpcomingReminders(ctx, deps.DB, us.UserID, withinDays, includeDismissed)
		if err != nil {
			writeDevicesErr(w, ctx, err, "list reminders")
			return
		}
		if rows == nil {
			rows = []services.ReminderRow{}
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"reminders": rows})
	}
}
