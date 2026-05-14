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
	Message     string      // Vietnamese, user-facing
	FieldErrors FieldErrors // optional per-field messages
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
	case "LIMIT_REACHED", "VALIDATION", "CATEGORY_INVALID":
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
func ErrValidation(fieldErrors FieldErrors) *Error {
	return &Error{Code: "VALIDATION", Message: "Dữ liệu không hợp lệ", FieldErrors: fieldErrors}
}

// ErrCategoryInvalid mirrors the TS "Loại thiết bị không hợp lệ" message.
func ErrCategoryInvalid() *Error {
	return &Error{
		Code:        "CATEGORY_INVALID",
		Message:     "Loại thiết bị không hợp lệ",
		FieldErrors: FieldErrors{"category": {"Loại thiết bị không hợp lệ"}},
	}
}

