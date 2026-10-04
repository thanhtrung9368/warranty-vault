package handlers

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterSearch wires GET /api/v1/search — the cross-entity search added for
// roadmap #7. Devices keep their own `GET /api/v1/devices?q=` filter unchanged;
// this endpoint answers "where does this text appear at all?" in one round trip.
func RegisterSearch(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/search", requireUser(http.HandlerFunc(searchHandler(deps))))
}

func searchHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, _ := auth.UserFromContext(r.Context())

		// A blank q is not an error — it returns empty groups (see services.Search).
		query := r.URL.Query().Get("q")

		limit := services.DefaultSearchLimit
		if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
			n, err := strconv.Atoi(raw)
			if err != nil || n < 1 || n > services.MaxSearchLimit {
				httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input",
					"Tham số limit không hợp lệ",
					map[string][]string{
						"limit": {"Phải là số nguyên từ 1 tới " + strconv.Itoa(services.MaxSearchLimit)},
					})
				return
			}
			limit = n
		}

		res, err := services.Search(r.Context(), deps.DB, us.UserID, query, limit)
		if err != nil {
			writeServiceError(w, ctx, err, "search")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, res)
	}
}
