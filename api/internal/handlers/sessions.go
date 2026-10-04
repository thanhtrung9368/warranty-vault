package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
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

// sessionNotFoundMessage is used for BOTH "no such id" and "id belongs to another
// user" — the 404-not-403 convention already used by the file-download and
// attachment handlers. One message, one status: a foreign session id cannot be
// distinguished from a made-up one.
const sessionNotFoundMessage = "Không tìm thấy phiên đăng nhập"

func listSessionsHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, ok := auth.UserFromContext(r.Context())
		if !ok {
			unauthorized(w, ctx)
			return
		}
		sessions, err := auth.ListSessions(r.Context(), deps.DB, us.UserID, us.SessionID, time.Now())
		if err != nil {
			slog.Error("list sessions failed", "err", err, "userId", us.UserID)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
			return
		}
		if sessions == nil {
			sessions = []auth.SessionSummary{}
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
	}
}

func revokeSessionHandler(deps Deps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		us, ok := auth.UserFromContext(r.Context())
		if !ok {
			unauthorized(w, ctx)
			return
		}
		if !ensureUserWriteRate(w, r, deps, us.UserID) {
			return
		}

		sessionID := strings.TrimSpace(r.PathValue("id"))
		if sessionID == "" {
			badInput(w, ctx, map[string][]string{"id": {"Thiếu id phiên đăng nhập"}})
			return
		}

		alreadyRevoked, err := auth.RevokeSessionForUser(r.Context(), deps.DB, us.UserID, sessionID)
		if err != nil {
			if errors.Is(err, auth.ErrSessionNotFound) {
				httpx.WriteErrorC(w, ctx, http.StatusNotFound, "not_found", sessionNotFoundMessage, nil)
				return
			}
			slog.Error("revoke session failed", "err", err, "userId", us.UserID)
			httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
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
		current := sessionID == us.SessionID
		message := "Đã thu hồi phiên đăng nhập."
		if alreadyRevoked {
			message = "Phiên đăng nhập này đã được thu hồi trước đó."
		}
		if current {
			message += " Đây là phiên bạn đang dùng — hãy đăng nhập lại."
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":             true,
			"current":        current,
			"alreadyRevoked": alreadyRevoked,
			"message":        message,
		})
	}
}
