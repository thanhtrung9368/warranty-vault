package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterActions wires the "Việc cần xử lý" surface (FEATURE_IDEAS #3):
//
//	GET    /api/v1/actions
//	POST   /api/v1/actions/{itemKey}/snooze
//	DELETE /api/v1/actions/{itemKey}/snooze
//
// The snooze lives server-side and is keyed by (userId, itemKey), which is what
// makes it survive across devices — a client-local flag would not, and reusing
// "Reminder" would silence real warranty push (see migration 0011 and
// docs/SPEC-MAINTENANCE-SCHEDULES.md §2.3).
//
// `{itemKey}` is `<KIND>:<entityId>`. Go's ServeMux matches a single path segment
// for `{itemKey}`, and ':' is legal unencoded inside a segment (RFC 3986), so no
// escaping is needed. The literal `/api/v1/actions/snooze` is not a route here,
// so there is no ambiguity with the wildcard.
func RegisterActions(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /api/v1/actions",
		requireUser(http.HandlerFunc(listActionsHandler(deps))))
	mux.Handle("POST /api/v1/actions/{itemKey}/snooze",
		requireUser(http.HandlerFunc(snoozeActionHandler(deps))))
	mux.Handle("DELETE /api/v1/actions/{itemKey}/snooze",
		requireUser(http.HandlerFunc(unsnoozeActionHandler(deps))))
}

func listActionsHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, ok := auth.UserFromContext(ctx)
		if !ok {
			unauthorized(w, ctx)
			return
		}
		// Opt-in, default false: the default response is the actionable queue only.
		// `true` ADDS the snoozed rows (each carrying `snoozedUntil`) so a client can
		// render a "Đang hoãn" section and offer to un-snooze — the same contract the
		// reminders feed uses for `includeDismissed`. `counts` never changes meaning:
		// it always counts the actionable subset.
		includeSnoozed, valid := parseBoolQuery(r.URL.Query().Get("snoozed"))
		if !valid {
			// The headline AND the field error are translated at the call site:
			// `fieldErrors` holds finished strings, so a key left in the map
			// would be shipped verbatim.
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Tham số snoozed không hợp lệ"),
				map[string][]string{"snoozed": {i18n.Text(ctx, "Phải là true hoặc false")}})
			return
		}

		queue, err := services.ListActionItems(ctx, deps.DB, us.UserID, time.Now(), includeSnoozed)
		if err != nil {
			writeServiceError(w, ctx, err, "list action items")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, queue)
	}
}

// snoozeRequest is the optional body of POST /actions/{itemKey}/snooze. Both
// fields are optional: no body at all means "hoãn 90 ngày" (SnoozeDaysDefault),
// which is the one-click case the feature is built around.
type snoozeRequest struct {
	Days int `json:"days"`
}

func snoozeActionHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, ok := auth.UserFromContext(ctx)
		if !ok {
			unauthorized(w, ctx)
			return
		}
		// Snoozing is a write, so it goes through the same per-user write limiter as
		// every other mutation.
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}

		itemKey := strings.TrimSpace(r.PathValue("itemKey"))
		if _, _, valid := services.ParseActionItemKey(itemKey); !valid {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Mã việc cần xử lý không hợp lệ"),
				map[string][]string{"itemKey": {i18n.Text(ctx, "Phải có dạng <LOẠI_VIỆC>:<id>")}})
			return
		}

		// A missing body is legal (use the default); a malformed one is not, because
		// silently defaulting would hide a client bug.
		req := snoozeRequest{Days: services.SnoozeDaysDefault}
		if r.Body != nil && r.ContentLength != 0 {
			if err := decodeJSON(r, &req); err != nil {
				badJSONBody(w, ctx)
				return
			}
			if req.Days == 0 {
				req.Days = services.SnoozeDaysDefault
			}
		}

		res, err := services.SnoozeActionItem(ctx, deps.DB, us.UserID, itemKey, req.Days, time.Now())
		if err != nil {
			writeServiceError(w, ctx, err, "snooze action item")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, res)
	}
}

func unsnoozeActionHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, ok := auth.UserFromContext(ctx)
		if !ok {
			unauthorized(w, ctx)
			return
		}
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}

		itemKey := strings.TrimSpace(r.PathValue("itemKey"))
		if _, _, valid := services.ParseActionItemKey(itemKey); !valid {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
				i18n.Text(ctx, "Mã việc cần xử lý không hợp lệ"),
				map[string][]string{"itemKey": {i18n.Text(ctx, "Phải có dạng <LOẠI_VIỆC>:<id>")}})
			return
		}
		if err := services.UnSnoozeActionItem(ctx, deps.DB, us.UserID, itemKey); err != nil {
			writeServiceError(w, ctx, err, "un-snooze action item")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"ok": true, "itemKey": itemKey})
	}
}
