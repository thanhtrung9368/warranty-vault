package handlers

import (
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// RegisterPush wires the /v1/push/* surface. Auth + per-user write rate
// limit are enforced inline. Mirrors website/src/app/api/v1/push/* + the
// push server actions.
func RegisterPush(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("GET /v1/push", requireUser(http.HandlerFunc(listPushHandler(deps))))
	mux.Handle("POST /v1/push/register", requireUser(http.HandlerFunc(registerPushHandler(deps))))
	mux.Handle("DELETE /v1/push/{id}", requireUser(http.HandlerFunc(deletePushHandler(deps))))
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
