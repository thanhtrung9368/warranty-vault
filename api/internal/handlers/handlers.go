// Package handlers hosts HTTP handlers for the /api/v1/* REST surface.
package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/thanhtrung9368/warranty-vault/api/internal/httpx"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// domainErrorMessage renders the headline of a services.* domain error in the
// language resolved for ctx.
//
// A converted error carries its user-facing text twice: `MessageKey` names a
// catalog entry, `Message` is the Vietnamese source that every unconverted
// service still sets. Rendering the key, when there is one, is what lets an error
// constructed deep in a call stack with no request in scope reach the client in
// the right language (see the MessageKey doc comment in services/errors.go).
//
// An error with NO key is written out verbatim — `Message` is already the text to
// send. That is the pre-i18n behaviour, and it is what keeps the domains Phase 1
// has not reached byte-for-byte identical while a shared writer like this one is
// used by both.
//
// The key travels as DATA (a struct field), never as a literal at this call site,
// so this goes through `i18n.Text` rather than the printf-shaped `i18n.T`: the
// latter is classified as a printf wrapper by `go vet`, which `go test` runs, and
// rejects a non-constant key.
func domainErrorMessage(ctx context.Context, svc *services.Error) string {
	if svc.MessageKey != "" {
		return translateKey(ctx, svc.MessageKey)
	}
	return svc.Message
}

// writeServiceError translates a services.* error into the JSON envelope.
// Logs internal errors as 500 with the supplied operation tag.
//
// Converted in Phase 1 as part of the devices/warranties slice, which is what put
// `domainErrorMessage` here: the two callers that are in scope in this wave
// (return-window and catalogue reads) now render their translated headlines,
// while every out-of-scope caller keeps its Vietnamese text because its errors
// carry no MessageKey.
//
// The 500 message stays a Vietnamese literal on purpose. This writer is shared by
// every domain — subscriptions, wishlist, backup, attachments, AI, shares,
// search, actions — and `Lỗi hệ thống` reaches the user through all of them. It is
// added to the catalog when the last of those is converted, so that no endpoint
// answers `?lang=en` with an English envelope around a Vietnamese headline.
// The same applies to the 500 in writeDevicesErr and in the other per-domain
// writers; those are marked for the wave that converts them.
func writeServiceError(w http.ResponseWriter, ctx context.Context, err error, op string) {
	var svc *services.Error
	if errors.As(err, &svc) {
		code := strings.ToLower(svc.Code)
		httpx.WriteErrorC(w, ctx, svc.HTTPStatus(), code, domainErrorMessage(ctx, svc), svc.FieldErrors)
		return
	}
	slog.Error(op+" failed", "err", err)
	httpx.WriteErrorC(w, ctx, http.StatusInternalServerError, "internal_error", "Lỗi hệ thống", nil)
}
