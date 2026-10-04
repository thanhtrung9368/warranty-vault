// Package services holds pure business logic, mirrored from
// website/src/lib/services/.
package services

import (
	"errors"
	"net/http"
)

// FieldErrors maps form field names to a list of user-facing error messages.
// Mirrors the shape Zod's `flatten().fieldErrors` produces in TS.
//
// A converted code path renders each message with `i18n.Text(ctx, <the
// Vietnamese literal>)` at the point where the literal is written, so the value
// here is already in the request's language. An unconverted one stores the
// Vietnamese literal, which is exactly what it did before i18n existed. That is
// the whole reason the values are finished strings rather than catalog keys: the
// key IS the Vietnamese source text (internal/i18n/catalog.go), so both shapes
// are the same bytes until a translation is added.
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
//
// MessageKey is set to the same literal as Message, which is always valid —
// the catalog is keyed on the Vietnamese source text — and is what lets the
// envelope writer render the headline in the request's language even though the
// error is built deep in a service with no request in scope
// (handlers.writeDevicesErr). An entry Phase 1 has not reached yet falls back to
// the Vietnamese string, i.e. to exactly what an unconverted caller sends today.
func ErrLimit(message string) *Error {
	return &Error{Code: "LIMIT_REACHED", Message: message, MessageKey: message}
}

// ErrValidation builds a VALIDATION error with a generic message and the
// per-field map.
//
// Message is deliberately NOT keyed HERE, and that is a scope decision rather
// than an oversight. `Dữ liệu không hợp lệ` is shared by every validator in this
// package, including the ones whose domains are not converted yet (wishlist,
// subscriptions, backup, shares, actions). Setting MessageKey in this constructor
// would flip the envelope `message` of all of them to English for a request that
// asks for English while their fieldErrors stay Vietnamese — the half-translated
// envelope docs/I18N_PLAN.md §2.4 is written to avoid.
//
// A CONVERTED validator therefore opts in explicitly, with
// ErrValidationHeadline, so its headline and its fieldErrors move together:
//
//	func ValidateThing(ctx context.Context, in *Thing) error {
//		fieldErrors := FieldErrors{"name": {i18n.Text(ctx, "Tên thiết bị bắt buộc")}}
//		return ErrValidationHeadline(fieldErrors)
//	}
//
// The devices and warranties validators do exactly that; handlers/auth.go reaches
// the same result by supplying its own translated headline through badInput.
// Leaving MessageKey empty is the pre-i18n behaviour, so an unconverted caller is
// byte-identical to what it was before this package knew about languages.
func ErrValidation(fieldErrors FieldErrors) *Error {
	return &Error{
		Code:        "VALIDATION",
		Message:     "Dữ liệu không hợp lệ",
		FieldErrors: fieldErrors,
	}
}

// ErrValidationHeadline is ErrValidation for a validator that has translated its
// fieldErrors and wants the envelope headline to follow the same language.
//
// The headline stays the GENERIC sentence rather than a field's message: this
// failure can report several fields at once ("Tên thiết bị bắt buộc" AND "Giá mua
// không hợp lệ"), so naming one of them would be a lie about the others. A failure
// that is genuinely about a single field uses ErrValidationKeyed instead.
func ErrValidationHeadline(fieldErrors FieldErrors) *Error {
	e := ErrValidation(fieldErrors)
	e.MessageKey = "Dữ liệu không hợp lệ"
	return e
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

// ErrBadInputKeyed is ErrValidationKeyed for a failure whose wire CODE is
// `bad_input` rather than `validation` — a distinction this package has always
// made and which clients bind to.
//
// It exists because dropping it is a silent contract change: the subscriptions
// service used to build these errors through a local `errBadInput` helper with
// `Code: "BAD_INPUT"`, so `POST /api/v1/subscriptions` with a Custom cycle and no
// interval has always answered `{"error":"bad_input",…}` — which is what
// openapi.yaml documents for the body-level failures on that path. Converting the
// helper to ErrValidationKeyed would have kept the status (both are 400) and the
// translation while quietly renaming the code to `validation`, and nothing in the
// suite would have caught it.
//
// The same MessageKey rule applies as above: an unknown key degrades to the
// Vietnamese source text, so this is safe for a domain a wave has not reached.
func ErrBadInputKeyed(messageKey string, fieldErrors FieldErrors) *Error {
	return &Error{
		Code:        "BAD_INPUT",
		Message:     messageKey,
		MessageKey:  messageKey,
		FieldErrors: fieldErrors,
	}
}

// ErrCategoryInvalid mirrors the TS "Loại thiết bị không hợp lệ" message, with an
// empty field error for the caller to fill in.
//
// It is split that way because this is the one converted error whose fieldError
// is a full sentence rather than a fragment: the call site
// (assertCategoryExists, which has a ctx) renders the `category` entry with
// `i18n.Text(ctx, ErrCategoryInvalidMessage)`, while the constructor — reachable
// with no request in scope — keys only the headline and leaves the map to the
// caller. Leaving the Vietnamese literal in the map here would ship a
// half-translated envelope: `message` in English, `fieldErrors.category` in
// Vietnamese, which is exactly the shape the devices i18n test scans for.
const ErrCategoryInvalidMessage = "Loại thiết bị không hợp lệ"

func ErrCategoryInvalid() *Error {
	return &Error{
		Code:        "CATEGORY_INVALID",
		Message:     ErrCategoryInvalidMessage,
		MessageKey:  ErrCategoryInvalidMessage,
		FieldErrors: FieldErrors{"category": {ErrCategoryInvalidMessage}},
	}
}
