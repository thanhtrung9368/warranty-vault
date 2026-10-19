package services

// The documented `PaymentInput.note.maxLength: 500` — enforced, and pinned here.
//
// Before this test the cap existed only in openapi.yaml: a 501-character note was
// accepted and stored, so a client that validated against the contract and one
// that trusted the server disagreed about the same request. The service now
// rejects it with the same `VALIDATION` error shape as the other payment checks
// (`amount`, `paidAt`).
//
// No database is involved: the length check runs before the ownership read, so a
// nil pool proves the refusal cannot depend on a row existing. That ordering is
// deliberate and matches LogWishlistPrice.

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

func TestLogPaymentRejectsNoteOverDocumentedMaxLength(t *testing.T) {
	ctx := i18n.WithTag(context.Background(), i18n.EN)
	note := strings.Repeat("a", MaxPaymentNoteRunes+1) // 501

	_, err := LogPayment(ctx, nil, "user", "subscription", 1000, time.Now(), &note)
	if err == nil {
		t.Fatalf("a %d-character note was accepted; openapi.yaml declares maxLength: %d", len(note), MaxPaymentNoteRunes)
	}

	svc, ok := As(err)
	if !ok {
		t.Fatalf("error = %T (%v), want *services.Error", err, err)
	}
	if svc.Code != "VALIDATION" {
		t.Errorf("code = %q, want VALIDATION (a too-long field is invalid data, not a limit)", svc.Code)
	}
	// The 409/400 distinction this repo cares about: LIMIT_REACHED is a conflict
	// with the resource's state (409); a field that is too long is VALIDATION and
	// must stay 400, exactly like the amount and paidAt failures above it.
	if got := svc.HTTPStatus(); got != http.StatusBadRequest {
		t.Errorf("HTTPStatus() = %d, want 400 (VALIDATION), not 409", got)
	}
	// Errors built deep in the service carry the Vietnamese SOURCE sentence in
	// Message and the catalog key in MessageKey; the handler renders the envelope
	// headline from the key at the HTTP edge. Both halves have to point at the same
	// sentence, or the envelope would say one thing and its field error another.
	if svc.MessageKey != paymentNoteTooLongMessage {
		t.Errorf("MessageKey = %q, want the note-cap catalog key", svc.MessageKey)
	}
	if svc.Message != paymentNoteTooLongMessage {
		t.Errorf("message = %q, want the Vietnamese source sentence %q", svc.Message, paymentNoteTooLongMessage)
	}
	translated := i18n.Text(ctx, svc.MessageKey)
	if translated == paymentNoteTooLongMessage {
		t.Errorf("the note-cap sentence is missing from the English catalog: %q", translated)
	}
	if len(svc.FieldErrors["note"]) != 1 {
		t.Fatalf("fieldErrors = %v, want exactly one note entry", svc.FieldErrors)
	}
	// Field errors are finished strings rendered here, with the request's context.
	if got := svc.FieldErrors["note"][0]; got != translated {
		t.Errorf("fieldErrors.note[0] = %q, want the translated note-cap sentence %q", got, translated)
	}
}
