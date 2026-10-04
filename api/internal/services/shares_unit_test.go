package services

import (
	"context"
	"testing"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// Pure tests for the share-link certificate (FEATURE_IDEAS #2). The security
// assertions that need a database (foreign / expired / revoked token all fail; the
// projection is limited) live in internal/handlers/shares_test.go.
//
// Language: `shareTTL` renders its refusal through the catalog, so every call
// below passes a context rather than a bare value. The assertions are about the
// BOUNDS, not about the sentence, so they pin nothing — the sentence itself is
// covered in both languages by handlers/shares_i18n_test.go, where it reaches the
// wire.

func TestMaskSerialNeverRevealsTheWholeValue(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"356938035643809", "3569*******3809"},
		{"ABC123", "A****3"},
		{"12", "**"},
		{"9", "*"},
		{"", ""},
		{"  356938035643809  ", "3569*******3809"},
	}
	for _, tc := range cases {
		if got := MaskSerial(tc.in); got != tc.want {
			t.Errorf("MaskSerial(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}

	// The property that matters, checked across every length: at least one
	// character is always hidden and the length is preserved, so no input can
	// round-trip through the masked field.
	for n := 1; n <= 64; n++ {
		in := ""
		for i := 0; i < n; i++ {
			in += "7"
		}
		got := MaskSerial(in)
		if len([]rune(got)) != n {
			t.Fatalf("MaskSerial(%d chars) changed the length: %q", n, got)
		}
		hidden := 0
		for _, r := range got {
			if r == '*' {
				hidden++
			}
		}
		if hidden == 0 {
			t.Fatalf("MaskSerial(%d chars) hid nothing: %q", n, got)
		}
	}
}

func TestShareTTLBounds(t *testing.T) {
	// There is no "never expires" link: the column is NOT NULL and every value is
	// bounded to [1, 90] days. A nil means the 30-day default.
	//
	// Pinned to Vietnamese: the refusals below are asserted for their CODE path,
	// but `shareTTL` now renders its fieldErrors through the catalog, and pinning
	// the language keeps this test independent of the machine's locale — the rule
	// docs/I18N_PLAN.md §4.3 lays down for every converted string.
	ctx := i18n.WithTag(context.Background(), i18n.VI)
	if d, err := shareTTL(ctx, nil); err != nil || d != ShareTTLDefault {
		t.Fatalf("shareTTL(nil) = %v, %v; want %v, nil", d, err, ShareTTLDefault)
	}
	if ShareTTLDefault != 30*24*3600*1000*1000*1000 {
		t.Fatalf("default TTL = %v, want 30 days", ShareTTLDefault)
	}
	one := int32(1)
	if d, err := shareTTL(ctx, &one); err != nil || d.Hours() != 24 {
		t.Fatalf("shareTTL(1) = %v, %v", d, err)
	}
	for _, bad := range []int32{0, -5, 91, 9999} {
		v := bad
		if _, err := shareTTL(ctx, &v); err == nil {
			t.Errorf("shareTTL(%d) must be rejected", bad)
		}
	}
	max := int32(90)
	if _, err := shareTTL(ctx, &max); err != nil {
		t.Errorf("shareTTL(90) must be allowed, got %v", err)
	}
}

func TestSharePathIsRelativeAndCarriesTheToken(t *testing.T) {
	// Clients append this to their own base URL. The server deliberately does not
	// build an absolute URL: it does not know which host the caller reached it on,
	// and a wrong host in a forwarded link is worse than no link.
	if got := SharePath("abc123"); got != "/api/v1/public/shares/abc123" {
		t.Fatalf("SharePath = %q", got)
	}
}

func TestShareNotFoundErrorIsOneMessage(t *testing.T) {
	// Handlers render this single error for unknown, expired AND revoked tokens.
	// If these ever diverge, the endpoint becomes an enumeration oracle.
	svc, ok := As(ErrShareNotFound())
	if !ok || svc.Code != "NOT_FOUND" {
		t.Fatalf("ErrShareNotFound = %#v", ErrShareNotFound())
	}
	if svc.HTTPStatus() != 404 {
		t.Fatalf("ErrShareNotFound status = %d, want 404", svc.HTTPStatus())
	}
	if svc.Message == "" {
		t.Fatal("ErrShareNotFound must carry a Vietnamese message")
	}
	// i18n: the error stays context-free (see its doc comment — the four failure
	// cases must share ONE construction), and the handler renders it with the
	// language chosen at the request edge. What this test pins is that both
	// languages the handler can ask for are actually in the catalog, so a
	// `?lang=en` recipient cannot get an untranslated 404 while every other
	// converted endpoint answers in English.
	if got := i18n.Translate(i18n.VI, svc.Message, nil...); got != svc.Message {
		t.Errorf("Vietnamese rendering = %q, want the source sentence %q", got, svc.Message)
	}
	if got := i18n.Translate(i18n.EN, svc.Message, nil...); got == svc.Message {
		t.Errorf("English rendering fell back to Vietnamese (%q) — the key is not in the catalog", got)
	}
}
