package handlers

import (
	"log/slog"
	"net/http"
	"strings"
	"sync"

	"golang.org/x/sync/errgroup"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/push"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// RegisterPush wires the /api/v1/push/* surface. Auth + per-user write rate
// limit are enforced inline. Mirrors website/src/app/api/v1/push/* + the
// push server actions.
func RegisterPush(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /api/v1/push", requireUser(http.HandlerFunc(listPushHandler(deps))))
	mux.Handle("POST /api/v1/push/register", requireUser(http.HandlerFunc(registerPushHandler(deps))))
	mux.Handle("DELETE /api/v1/push/{id}", requireUser(http.HandlerFunc(deletePushHandler(deps))))
}

// pushRegisterRequest mirrors the Zod union accepted by the TS register route.
// Either web (endpoint+p256dh+auth) OR native (platform=apns|fcm + token).
type pushRegisterRequest struct {
	Platform  string  `json:"platform"`
	Endpoint  string  `json:"endpoint"`
	Token     string  `json:"token"`
	P256dh    *string `json:"p256dh"`
	Auth      *string `json:"auth"`
	UserAgent *string `json:"userAgent"`
}

func listPushHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		subs, err := services.ListPushSubscriptions(r.Context(), deps.DB, us.UserID)
		if err != nil {
			writeServiceError(w, err, "list push subscriptions")
			return
		}
		if subs == nil {
			subs = []services.PushSubscriptionDTO{}
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"subscriptions": subs})
	}
}

func registerPushHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}

		var body pushRegisterRequest
		if err := decodeJSONLoose(r, &body); err != nil {
			badJSONBody(w)
			return
		}

		input := services.PushInput{
			Platform:  strings.TrimSpace(body.Platform),
			Endpoint:  strings.TrimSpace(body.Endpoint),
			P256dh:    body.P256dh,
			Auth:      body.Auth,
			UserAgent: body.UserAgent,
		}
		if input.Platform == "" {
			input.Platform = services.PushPlatformWeb
		}

		// Native shape: client posts `{platform, token}` instead of an endpoint.
		// Synthesize the endpoint to match the TS `endpointFor()` convention so
		// the upsert key (endpoint) stays stable across clients.
		if input.Platform == services.PushPlatformAPNs || input.Platform == services.PushPlatformFCM {
			tok := strings.TrimSpace(body.Token)
			if tok != "" && input.Endpoint == "" {
				input.Endpoint = input.Platform + "://" + tok
			}
		}

		if _, err := services.SubscribePush(r.Context(), deps.DB, us.UserID, input); err != nil {
			writeServiceError(w, err, "subscribe push")
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]bool{"ok": true})
	}
}

func deletePushHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		id := strings.TrimSpace(r.PathValue("id"))
		if id == "" {
			httpx.WriteError(w, http.StatusBadRequest, "bad_input", "Thiếu id đăng ký", nil)
			return
		}
		if err := services.DeletePushSubscriptionByID(r.Context(), deps.DB, us.UserID, id); err != nil {
			writeServiceError(w, err, "delete push subscription")
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// TestPush sends a sample notification to every PushSubscription belonging to
// the authenticated user. Used by the web settings page's "Send test" button.
// Auth is enforced via auth.RequireUser so this handler can be registered
// directly on the mux from main.go.
//
// Returns `{ sent, failed }`. Subscriptions reported `gone` by the dispatcher
// are deleted (matches the cron's gone-detection behavior).
func TestPush(deps Deps) http.HandlerFunc {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		us, _ := auth.UserFromContext(r.Context())
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}
		if deps.Dispatcher == nil {
			httpx.WriteError(w, http.StatusInternalServerError,
				"push_not_configured", "Push dispatcher chưa khởi tạo", nil)
			return
		}

		q := store.New(deps.DB)
		rows, err := q.ListPushSubscriptionsByUser(r.Context(), us.UserID)
		if err != nil {
			slog.Error("test push: list subs failed", "user", us.UserID, "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}

		payload := push.Payload{
			Title: "WarrantyVault",
			Body:  "Đây là thông báo thử nghiệm",
			URL:   "/settings",
			Tag:   "wv-test-push",
		}

		// Fan out the test deliveries concurrently (bounded), since each
		// Send() is a blocking network call. `sent`/`failed` are guarded by a
		// mutex because they are written from multiple goroutines.
		var (
			sent, failed int
			countMu      sync.Mutex
		)
		g, gctx := errgroup.WithContext(r.Context())
		g.SetLimit(8)
		for _, row := range rows {
			row := row
			g.Go(func() error {
				sub := push.Subscription{
					ID:       row.ID,
					Platform: row.Platform,
					Endpoint: row.Endpoint,
					P256dh:   row.P256dh,
					Auth:     row.Auth,
				}
				res := deps.Dispatcher.Send(sub, payload)
				if res.Ok {
					countMu.Lock()
					sent++
					countMu.Unlock()
					return nil
				}
				if res.Gone {
					countMu.Lock()
					failed++
					countMu.Unlock()
					if _, derr := q.DeletePushSubscriptionByIDInternal(gctx, row.ID); derr != nil {
						slog.Error("test push: delete gone sub failed", "sub", row.ID, "err", derr)
					}
					slog.Info("test push", "user", us.UserID, "sub", row.ID, "platform", row.Platform, "gone", true, "err", res.Error)
					return nil
				}
				countMu.Lock()
				failed++
				countMu.Unlock()
				slog.Warn("test push", "user", us.UserID, "sub", row.ID, "platform", row.Platform, "err", res.Error)
				return nil
			})
		}
		_ = g.Wait()

		httpx.WriteJSON(w, http.StatusOK, map[string]int{
			"sent":   sent,
			"failed": failed,
		})
	})
	return auth.RequireUser(deps.DB)(inner).ServeHTTP
}
