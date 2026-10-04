// Package services holds pure business logic, mirrored from
// website/src/lib/services/.
package services

import (
	"errors"
	"net/http"
)

// FieldErrors maps form field names to a list of Vietnamese error messages.
// Mirrors the shape Zod's `flatten().fieldErrors` produces in TS.
type FieldErrors map[string][]string

// Error is a typed business-logic error that handlers translate into the
// JSON envelope. Mirrors website/src/lib/services/errors.ts::DomainError.
type Error struct {
	Code        string      // machine-readable; matches TS DomainError.code
	Message     string      // user-facing; Vietnamese unless MessageKey is set
	FieldErrors FieldErrors // optional per-field messages
	// MessageKey is the i18n catalog key for Message, when the code path that
	// built this error has been converted. Empty — the default, and what every
	// Err* constructor below produces — means "Message is already the text to
	// send", i.e. exactly the pre-i18n behaviour.
	//
	// The indirection exists because Message is a plain string on a struct built
	// by ~50 call sites across this package, while the language is only known at
	// the HTTP edge (internal/i18n resolves it from the request). A handler
	// renders a keyed message with i18n.T(ctx, svc.MessageKey) when it writes the
	// envelope and falls back to svc.Message otherwise, so an error constructed
	// deep in a service with no context in scope still reaches the client in the
	// right language.
	//
	// Because the catalog is keyed on the Vietnamese source text
	// (internal/i18n/catalog.go), setting MessageKey to the same literal as
	// Message is always valid and can never render worse than Message would have:
	// an entry Phase 1 has not reached falls back to the Vietnamese string.
	MessageKey string
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

// HTTPStatus maps a domain error code to an HTTP status. Mirrors
// website/src/lib/services/errors.ts::statusForCode.
func (e *Error) HTTPStatus() int {
	switch e.Code {
	case "NOT_FOUND":
		return http.StatusNotFound
	case "FORBIDDEN":
		return http.StatusForbidden
	// LIMIT_REACHED is a conflict with the resource's current state (you already
	// hold the maximum), not a malformed request, so it is 409 — which is what
	// openapi.yaml documented all along and what the web client keys off to stop
	// a bulk import instead of firing the rest of a doomed batch. It used to be
	// 400 here, so the documented contract and the real server disagreed.
	case "LIMIT_REACHED":
		return http.StatusConflict
	case "VALIDATION", "CATEGORY_INVALID":
		return http.StatusBadRequest
	case "CONFLICT":
		return http.StatusConflict
	default:
		return http.StatusBadRequest
	}
}

// As is a convenience helper for callers that want to check `errors.As(err, &svcErr)`.
func As(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}

// ErrNotFound builds a NOT_FOUND domain error with a Vietnamese message.
func ErrNotFound(message string) *Error {
	return &Error{Code: "NOT_FOUND", Message: message}
}

// ErrForbidden builds a FORBIDDEN domain error.
func ErrForbidden(message string) *Error {
	return &Error{Code: "FORBIDDEN", Message: message}
}

// ErrLimit builds a LIMIT_REACHED domain error matching the TS pattern of
// `Đã đạt giới hạn ${max} ${name}. ...` style messages.
func ErrLimit(message string) *Error {
	return &Error{Code: "LIMIT_REACHED", Message: message}
}

// ErrValidation builds a VALIDATION error with a generic message and the
// per-field map.
//
// The envelope `Message` is intentionally a fixed Vietnamese string: it is the
// generic "invalid input" headline that is identical for every validator in this
// package. A converted handler that wants it rendered in the request's language
// sets MessageKey afterwards, or supplies its own headline — see
// handlers/auth.go::badInput, which does the latter.
func ErrValidation(fieldErrors FieldErrors) *Error {
	return &Error{
		Code: "VALIDATION",
		// Vietnamese source text, and the i18n catalog key for it: a converted
		// handler renders MessageKey, an unconverted one sends Message, and both
		// spell the same sentence (internal/i18n/catalog.go).
		Message:     "Dữ liệu không hợp lệ",
		MessageKey:  "Dữ liệu không hợp lệ",
		FieldErrors: fieldErrors,
	}
}

// ErrValidationKeyed is ErrValidation for a failure that IS the whole story — a
// single bad field, where the envelope headline should say what went wrong rather
// than the generic "Dữ liệu không hợp lệ". `messageKey` is both the Vietnamese
// source text and the catalog key for it, so a converted handler renders it in the
// request's language and an unconverted one sends the Vietnamese verbatim.
func ErrValidationKeyed(messageKey string, fieldErrors FieldErrors) *Error {
	return &Error{
		Code:        "VALIDATION",
		Message:     messageKey,
		MessageKey:  messageKey,
		FieldErrors: fieldErrors,
	}
}

// ErrCategoryInvalid mirrors the TS "Loại thiết bị không hợp lệ" message.
func ErrCategoryInvalid() *Error {
	return &Error{
		Code:        "CATEGORY_INVALID",
		Message:     "Loại thiết bị không hợp lệ",
		FieldErrors: FieldErrors{"category": {"Loại thiết bị không hợp lệ"}},
	}
}
