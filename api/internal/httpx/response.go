package httpx

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

type ErrorEnvelope struct {
	Error       string              `json:"error"`
	Message     string              `json:"message,omitempty"`
	FieldErrors map[string][]string `json:"fieldErrors,omitempty"`
}

func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write json failed", "err", err)
	}
}

func WriteError(w http.ResponseWriter, status int, code, message string, fieldErrors map[string][]string) {
	WriteJSON(w, status, ErrorEnvelope{
		Error:       code,
		Message:     message,
		FieldErrors: fieldErrors,
	})
}

// ── locale-aware variants ────────────────────────────────────────────────────
//
// The two functions above stay exactly as they are for every call site that has
// not been converted to i18n — Phase 1's job. A blanket rewrite in Phase 0 would
// translate strings that are explicitly out of scope.
//
// The context-taking pair below adds the one piece of i18n that belongs to the
// response layer: the `Content-Language` header, so a client can see which
// language it actually got — including when its own `Accept-Language` asked for
// something we do not ship.
//
// The `message` is taken as a FINISHED string, never as a catalog key.
// Translation happens in internal/handlers, where the Vietnamese literal and the
// `i18n.T(...)` call sit next to each other and a reviewer can see the scope of
// the conversion. That keeps the shared helpers (badInput, unauthorized,
// rateLimited, badJSONBody) convertible without converting every file that calls
// them: an out-of-scope caller keeps passing Vietnamese literals, which are
// written out verbatim.

// ContentLanguage stamps Content-Language from the request context. A context
// with no language signal at all sets nothing, so an unconverted endpoint's
// response is byte-identical to what it was before i18n existed.
func ContentLanguage(w http.ResponseWriter, ctx context.Context) {
	if tag, ok := i18n.FromContext(ctx); ok {
		w.Header().Set("Content-Language", string(tag))
	}
}

// WriteJSONC writes a JSON body and stamps Content-Language.
func WriteJSONC(w http.ResponseWriter, ctx context.Context, status int, v any) {
	ContentLanguage(w, ctx)
	WriteJSON(w, status, v)
}

// WriteErrorC writes an error envelope and stamps Content-Language.
func WriteErrorC(w http.ResponseWriter, ctx context.Context, status int, code, message string, fieldErrors map[string][]string) {
	ContentLanguage(w, ctx)
	WriteError(w, status, code, message, fieldErrors)
}
