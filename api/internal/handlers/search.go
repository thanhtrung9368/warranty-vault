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

// RegisterSearch wires GET /api/v1/search — the cross-entity search added for
// roadmap #7. Devices keep their own `GET /api/v1/devices?q=` filter unchanged;
// this endpoint answers "where does this text appear at all?" in one round trip.
//
// i18n (docs/I18N_PLAN.md §3, Phase 1) covers the `limit` refusal below and the
// "quá dài" sentence `services.Search` produces. The search RESULTS are the user's
// own rows, so nothing in them is copy; the only other user-facing text this
// endpoint could ever carry is an error.
func RegisterSearch(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/search", requireUser(http.HandlerFunc(searchHandler(deps))))
}

func searchHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// i18n.Attach at the top of the handler: the tests build their own mux with
		// no middleware chain, so `?lang=` has to be resolved here for either
		// language to be reachable (i18n.Attach's doc comment).
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)

		// A blank q is not an error — it returns empty groups (see services.Search).
		query := r.URL.Query().Get("q")

		limit := services.DefaultSearchLimit
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > services.MaxSearchLimit {
				// `fieldErrors`, not just `message`, and translated AT THE CALL SITE:
				// the map holds finished strings, so a key left here would never be
				// rendered (docs/I18N_PLAN.md §3.1).
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
					i18n.Text(ctx, "Tham số limit không hợp lệ"),
					map[string][]string{
						"limit": {i18n.T(ctx, "Phải là số nguyên từ 1 tới %d", services.MaxSearchLimit)},
					})
				return
			}
			limit = n
		}

		res, err := services.Search(ctx, deps.DB, us.UserID, query, limit)
		if err != nil {
			writeServiceError(w, ctx, err, "search")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, res)
	}
}
