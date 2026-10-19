package handlers

// `PaymentInput.note.maxLength: 500` over HTTP, end to end.
//
// The contract declared the cap and nothing enforced it, so POST
// /api/v1/subscriptions/{id}/payments stored any length. The service now rejects a
// longer note; this asserts the WIRE shape of that rejection, because the contract
// says nothing about a 500 — it says a client's request is invalid:
//
//	400 {"error":"validation","message":…,"fieldErrors":{"note":[…]}}
//
// and explicitly not 409. LIMIT_REACHED is the 409 in this API (a per-user cap
// already reached); a field that is too long is VALIDATION and must stay 400, the
// same distinction the quota tests pin for devices.
//
// The accept cases matter as much as the reject: exactly 500 characters is
// allowed, and the count is in RUNES (JSON Schema `maxLength`), so 500 Vietnamese
// characters — 1500 bytes — must not be rejected by a byte-length check.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// paymentNoteErrorDTO decodes the envelope a failed payment write produces.
type paymentNoteErrorDTO struct {
	Error       string              `json:"error"`
	Message     string              `json:"message"`
	FieldErrors map[string][]string `json:"fieldErrors"`
}

func createSubscriptionForPaymentNoteTest(t *testing.T, env *subsI18nEnv) string {
	t.Helper()
	rr := env.do(t, http.MethodPost, "/api/v1/subscriptions?lang=en", "en",
		`{"name":"Note cap","billingCycle":"MONTHLY","price":100000,"startedAt":"2026-01-15"}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create subscription = %d (%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Subscription struct {
			ID string `json:"id"`
		} `json:"subscription"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || body.Subscription.ID == "" {
		t.Fatalf("decode created subscription: %v (%s)", err, rr.Body.String())
	}
	return body.Subscription.ID
}

func postPaymentNote(t *testing.T, env *subsI18nEnv, subID, note string) *httptest.ResponseRecorder {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"amount": 100000, "note": note})
	if err != nil {
		t.Fatalf("marshal payment body: %v", err)
	}
	return env.do(t, http.MethodPost, "/api/v1/subscriptions/"+subID+"/payments?lang=en", "en", string(payload))
}

func TestPaymentNoteOver500CharactersIsAValidationError(t *testing.T) {
	env := setupSubsI18nEnv(t)
	subID := createSubscriptionForPaymentNoteTest(t, env)

	rr := postPaymentNote(t, env, subID, strings.Repeat("a", 501))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("501-character note = %d (%s), want 400 VALIDATION (409 would mean LIMIT_REACHED)",
			rr.Code, rr.Body.String())
	}

	var body paymentNoteErrorDTO
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error envelope: %v (%s)", err, rr.Body.String())
	}
	if body.Error != "validation" {
		t.Errorf("error = %q, want %q — the same code the amount/paidAt checks produce", body.Error, "validation")
	}
	if len(body.FieldErrors["note"]) == 0 {
		t.Errorf("fieldErrors = %v, want a note entry", body.FieldErrors)
	}
	// English was requested, and this message has a catalog entry: an untranslated
	// headline would mean the note cap was the one payment error that never got
	// keyed.
	if !strings.Contains(strings.ToLower(body.Message), "500") {
		t.Errorf("message = %q, want it to name the 500-character cap", body.Message)
	}

	// The rejection must not have written a payment row.
	rrDetail := env.do(t, http.MethodGet, "/api/v1/subscriptions/"+subID+"?lang=en", "en", "")
	if rrDetail.Code != http.StatusOK {
		t.Fatalf("get subscription = %d (%s)", rrDetail.Code, rrDetail.Body.String())
	}
	var detail struct {
		Subscription struct {
			Payments []any `json:"payments"`
		} `json:"subscription"`
	}
	if err := json.Unmarshal(rrDetail.Body.Bytes(), &detail); err != nil {
		t.Fatalf("decode detail: %v (%s)", err, rrDetail.Body.String())
	}
	if len(detail.Subscription.Payments) != 0 {
		t.Errorf("a rejected note still stored %d payment(s)", len(detail.Subscription.Payments))
	}
}

func TestPaymentNoteAt500CharactersIsAccepted(t *testing.T) {
	env := setupSubsI18nEnv(t)
	subID := createSubscriptionForPaymentNoteTest(t, env)

	for _, tc := range []struct {
		name string
		note string
	}{
		{"ascii", strings.Repeat("a", 500)},
		// 500 characters, 1500 bytes: JSON Schema's maxLength counts characters, so
		// this must be accepted. A byte-based check would reject it.
		{"vietnamese", strings.Repeat("ặ", 500)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if rr := postPaymentNote(t, env, subID, tc.note); rr.Code != http.StatusCreated {
				t.Fatalf("%d-character note = %d (%s), want 201", len([]rune(tc.note)), rr.Code, rr.Body.String())
			}
		})
	}
}
