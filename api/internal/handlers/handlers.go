// Package handlers hosts HTTP handlers for the /api/v1/* REST surface.
package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// writeServiceError translates a services.* error into the JSON envelope.
// Logs internal errors as 500 with the supplied operation tag.
func writeServiceError(w http.ResponseWriter, err error, op string) {
	var svc *services.Error
	if errors.As(err, &svc) {
		code := strings.ToLower(svc.Code)
		httpx.WriteError(w, svc.HTTPStatus(), code, svc.Message, svc.FieldErrors)
		return
	}
	slog.Error(op+" failed", "err", err)
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
}
