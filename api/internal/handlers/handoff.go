package handlers

import (
	"errors"
	"io"
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Resale handoff (Warrly 2.0) — three owner routes, one public preview, one claim.
//
// Path shape (frozen merge contract):
//
//	POST   /api/v1/devices/{id}/handoff   create, returns the code ONCE
//	GET    /api/v1/devices/{id}/handoff   latest status + cooldown hint
//	DELETE /api/v1/devices/{id}/handoff   cancel the open handoff
//	GET    /api/v1/public/handoff/{code}  public preview, NO bearer token
//	POST   /api/v1/handoff/{code}/claim   transfer into the caller's account
//
// The public preview is the service's second unauthenticated read (the first is
// the share certificate). It reuses the SAME defensive header set and the SAME
// language precedence chain as that route (handlers.setShareHeaders /
// publicShareContext): no-store/noindex/no-referrer because a 6-character code is
// sitting in the path, and the recipient's own Accept-Language decides the copy —
// falling back to Vietnamese, the language the artifact has always been written
// in, not the product's English default.
//
// The preview is rate-limited per IP BEFORE the database is touched, because a
// 6-character code is only ~30 bits: the bucket is what makes it unguessable in
// practice (see ratelimit.CheckHandoffPreview).
func RegisterHandoff(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)

	mux.Handle("POST /api/v1/devices/{id}/handoff", requireUser(http.HandlerFunc(createHandoffHandler(deps))))
	mux.Handle("GET /api/v1/devices/{id}/handoff", requireUser(http.HandlerFunc(getHandoffHandler(deps))))
	mux.Handle("DELETE /api/v1/devices/{id}/handoff", requireUser(http.HandlerFunc(cancelHandoffHandler(deps))))

	// Unauthenticated by design: the code IS the credential. See the comment above.
	mux.HandleFunc("GET /api/v1/public/handoff/{code}", publicHandoffPreviewHandler(deps))

	mux.Handle("POST /api/v1/handoff/{code}/claim", requireUser(http.HandlerFunc(claimHandoffHandler(deps))))
}

// handoffCreateRequest is the POST /api/v1/devices/{id}/handoff body.
//
// One optional field. `attachmentIds` is the seller's EXPLICIT receipt selection:
// omitted and `[]` both mean "no documents travel" — the server never decides for
// the seller which receipts leave their account.
//
// The body is decoded STRICTLY (`decodeJSON`, DisallowUnknownFields): a typo like
// `attachmentIDS` must be a 400, not a handoff that silently ships no documents.
// An empty body is accepted (the decoder's io.EOF is handled below) so a client
// that wants the minimal handoff can POST nothing at all.
// scripts/check_request_field_drift.py pins this struct to the HandoffCreateInput
// schema in openapi.yaml.
type handoffCreateRequest struct {
	AttachmentIDs []string `json:"attachmentIds"`
}

func createHandoffHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		rl, _ := ratelimit.CheckHandoffCreate(ctx, deps.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}
		deviceID := r.PathValue("id")
		if deviceID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id thiết bị"), nil)
			return
		}

		var body handoffCreateRequest
		if err := decodeJSON(r, &body); err != nil && !errors.Is(err, io.EOF) {
			badJSONBody(w, ctx)
			return
		}

		created, err := services.CreateDeviceHandoff(ctx, deps.DB, us.UserID, deviceID,
			ratelimit.GetClientIP(r), services.CreateHandoffInput{AttachmentIDs: body.AttachmentIDs})
		if err != nil {
			writeDevicesErr(w, ctx, err, "create handoff")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusCreated, map[string]any{"handoff": created})
	}
}

func getHandoffHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		deviceID := r.PathValue("id")
		if deviceID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id thiết bị"), nil)
			return
		}
		status, err := services.GetDeviceHandoff(ctx, deps.DB, us.UserID, deviceID)
		if err != nil {
			writeDevicesErr(w, ctx, err, "get handoff")
			return
		}
		// Top-level shape: {"handoff": <Handoff|null>, "nextAllowedAt": <instant>?}.
		// The wrapper is written here rather than inside the service so the JSON
		// keys the contract froze are visible at the HTTP edge.
		httpx.WriteJSONC(w, ctx, http.StatusOK, status)
	}
}

func cancelHandoffHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		deviceID := r.PathValue("id")
		if deviceID == "" {
			httpx.WriteErrorC(w, ctx, http.StatusBadRequest, "bad_input", i18n.Text(ctx, "Thiếu id thiết bị"), nil)
			return
		}
		if err := services.CancelDeviceHandoff(ctx, deps.DB, us.UserID, deviceID); err != nil {
			writeDevicesErr(w, ctx, err, "cancel handoff")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]bool{"ok": true})
	}
}

func publicHandoffPreviewHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Same cache/robots/referrer/CSP policy as the public share certificate:
		// the credential is in the path, so it must not be cached, indexed, or
		// leaked in a Referer when the reader clicks a link on the page.
		setShareHeaders(w)
		ctx := publicShareContext(r)
		lang, _ := i18n.FromContext(ctx)
		w.Header().Set("Content-Language", string(lang))

		// Rate limit BEFORE the lookup: an enumeration attempt must not reach the
		// database at all.
		rl, _ := ratelimit.CheckHandoffPreview(ctx, deps.Limiter, ratelimit.GetClientIP(r))
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}

		preview, err := services.PreviewHandoff(ctx, deps.DB, r.PathValue("code"))
		if err != nil {
			// Every dead state (unknown / expired / cancelled / claimed / deleted
			// device) produces the SAME 404 body here — services.ErrHandoffCodeNotFound.
			// The language is the recipient's, applied once at this edge.
			writeDevicesErr(w, ctx, err, "handoff preview")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"handoff": preview})
	}
}

func claimHandoffHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, _ := auth.UserFromContext(ctx)
		rl, _ := ratelimit.CheckHandoffClaim(ctx, deps.Limiter, us.UserID)
		if !rl.Ok {
			rateLimited(w, ctx, rl.RetryAfterSec)
			return
		}
		// Empty body by contract: `markSold`-style options do not exist — the
		// seller's row becomes SOLD as part of the transfer, and there is no price
		// or payment concept anywhere in this feature.
		result, err := services.ClaimHandoff(ctx, deps.DB, us.UserID, r.PathValue("code"))
		if err != nil {
			writeDevicesErr(w, ctx, err, "claim handoff")
			return
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, result)
	}
}
