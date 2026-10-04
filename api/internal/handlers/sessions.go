package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// RegisterSessions wires the per-session management surface:
//
//	GET    /api/v1/auth/sessions        — list my active sessions
//	DELETE /api/v1/auth/sessions/{id}   — revoke one of them
//
// These are the two missing halves of the revocation story: before them the only
// ways to revoke were "the exact token being presented" (POST /auth/logout) and
// "everything at once" (the password-reset / email-change paths call
// RevokeAllSessionsForUser). Handing your phone to someone therefore had no
// observable, one-device undo.
//
// Both routes sit under /auth and use the shared requireUser middleware, like
// PATCH /auth/me — the session id in the path is data, not a credential, and
// ownership is checked in SQL (`AND "userId" = $2`).
func RegisterSessions(mux *http.ServeMux, deps Deps) {
	requireUser := auth.RequireUser(deps.DB)
	mux.Handle("GET /api/v1/auth/sessions", requireUser(http.HandlerFunc(listSessionsHandler(deps))))
	mux.Handle("DELETE /api/v1/auth/sessions/{id}", requireUser(http.HandlerFunc(revokeSessionHandler(deps))))
}

// sessionNotFoundMessageKey is used for BOTH "no such id" and "id belongs to another
// user" — the 404-not-403 convention already used by the file-download and
// attachment handlers. One message, one status: a foreign session id cannot be
// distinguished from a made-up one.
//
// It is the Vietnamese source text and doubles as the catalog key, kept as a
// named constant because the same sentence is the answer to two different
// questions (no such id / someone else's id) and must stay one string.
const sessionNotFoundMessageKey = "Không tìm thấy phiên đăng nhập"

func listSessionsHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := i18n.Attach(r)
		us, ok := auth.UserFromContext(ctx)
		if !ok {
			unauthorized(w, ctx)
			return
		}
		sessions, err := auth.ListSessions(ctx, deps.DB, us.UserID, us.SessionID, time.Now())
		if err != nil {
			slog.Error("list sessions failed", "err", err, "userId", us.UserID)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}
		if sessions == nil {
			sessions = []auth.SessionSummary{}
		}
		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{"sessions": sessions})
	}
}

func revokeSessionHandler(deps Deps) http.HandlerFunc {
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

		sessionID := strings.TrimSpace(r.PathValue("id"))
		if sessionID == "" {
			badInput(w, ctx, map[string][]string{"id": {i18n.Text(ctx, "Thiếu id phiên đăng nhập")}})
			return
		}

		alreadyRevoked, err := auth.RevokeSessionForUser(ctx, deps.DB, us.UserID, sessionID)
		if err != nil {
			if errors.Is(err, auth.ErrSessionNotFound) {
				httpx.WriteErrorC(w, ctx, http.StatusNotFound, "not_found",
					i18n.Text(ctx, sessionNotFoundMessageKey), nil)
				return
			}
			slog.Error("revoke session failed", "err", err, "userId", us.UserID)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", i18n.Text(ctx, "Lỗi hệ thống"), nil)
			return
		}

		// Revoking the CURRENT session is allowed and is deliberately not a
		// special case: it is exactly what POST /auth/logout does, and it is the
		// honest answer for "đăng xuất khỏi thiết bị này" when the device in
		// question is the one in your hand. The response says so, because the
		// client must drop its local token — the next request will 401.
		//
		// (current + alreadyRevoked is unreachable in practice: RequireUser would
		// have rejected a revoked bearer before reaching this handler.)
		// Each sentence is its own catalog key; they are joined here with a space,
		// which is byte-identical to the concatenation this replaces in Vietnamese
		// while keeping every fragment translatable on its own.
		current := sessionID == us.SessionID
		message := i18n.Text(ctx, "Đã thu hồi phiên đăng nhập.")
		if alreadyRevoked {
			message = i18n.Text(ctx, "Phiên đăng nhập này đã được thu hồi trước đó.")
		}
		if current {
			message += " " + i18n.Text(ctx, "Đây là phiên bạn đang dùng — hãy đăng nhập lại.")
		}

		httpx.WriteJSONC(w, ctx, http.StatusOK, map[string]any{
			"ok":             true,
			"current":        current,
			"alreadyRevoked": alreadyRevoked,
			"message":        message,
		})
	}
}
