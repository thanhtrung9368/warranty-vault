package handlers

import (
	"context"
	"crypto/subtle"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/cron"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
)

// RegisterCron wires POST /api/v1/cron/warranty-check.
//
// Auth: shared secret in CRON_SECRET env. Mirrors the TS route — accepts
// either `Authorization: Bearer <secret>` (Vercel Cron's format) or
// `?secret=<secret>` (handy for `curl` smoke tests). Without CRON_SECRET set,
// the endpoint hard-fails with 500 to avoid running unauthenticated in prod.
func RegisterCron(mux *http.ServeMux, deps Deps) {
	mux.HandleFunc("POST /api/v1/cron/warranty-check", warrantyCheckHandler(deps))
}

func warrantyCheckHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		secret := strings.TrimSpace(os.Getenv("CRON_SECRET"))
		if secret == "" {
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError,
				"cron_not_configured", "CRON_SECRET chưa set", nil)
			return
		}
		if !cronAuthorized(r, secret) {
			httpx.WriteErrorC(w, ctx, http.StatusUnauthorized,
				"unauthorized", "Unauthorized", nil)
			return
		}

		if deps.Dispatcher == nil {
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError,
				"cron_misconfigured", "Push dispatcher chưa khởi tạo", nil)
			return
		}

		// Cron passes can run long; allow up to 5 minutes per call.
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		defer cancel()

		started := time.Now()
		stats, err := cron.Run(ctx, deps.DB, deps.Dispatcher)
		if err != nil {
			slog.Error("cron run failed", "err", err)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError,
				"cron_failed", err.Error(), nil)
			return
		}
		slog.Info("cron run complete",
			"duration_ms", time.Since(started).Milliseconds(),
			"warranty_notices", stats.WarrantyNotices,
			"return_window_notices", stats.ReturnWindowNotices,
			"wishlist_target", stats.WishlistTargetHits,
			"wishlist_checkin", stats.WishlistCheckins,
			"sub_renewals", stats.SubscriptionRenewals,
			"sub_expired", stats.SubscriptionExpired,
			"sessions_pruned", stats.SessionsPruned,
			"pushes_sent", stats.PushesSent,
			"pushes_failed", stats.PushesFailed,
			"pushes_gone", stats.PushesGone,
		)

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"checkedAt": started.UTC().Format(time.RFC3339),
			"stats":     stats,
		})
	}
}

// cronAuthorized accepts either `Authorization: Bearer <secret>` (Vercel Cron)
// or `?secret=<secret>` (curl). Constant-time compare on both paths to keep
// the timing side-channel closed.
func cronAuthorized(r *http.Request, secret string) bool {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		token := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		if subtle.ConstantTimeCompare([]byte(token), []byte(secret)) == 1 {
			return true
		}
	}
	if q := r.URL.Query().Get("secret"); q != "" {
		if subtle.ConstantTimeCompare([]byte(q), []byte(secret)) == 1 {
			return true
		}
	}
	return false
}
