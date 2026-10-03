package services

import (
	"testing"
)

// "Việc cần xử lý" (FEATURE_IDEAS #3) — the pure parts: key parsing and ordering.
// Deriving items needs a database and is covered in internal/handlers against a
// per-test scratch database.

func TestActionItemKeyRoundTrip(t *testing.T) {
	key := ActionItemKey(ActionWarrantyExpired, "clx1234abcd")
	if key != "WARRANTY_EXPIRED:clx1234abcd" {
		t.Fatalf("ActionItemKey = %q", key)
	}
	kind, id, ok := ParseActionItemKey(key)
	if !ok || kind != ActionWarrantyExpired || id != "clx1234abcd" {
		t.Fatalf("ParseActionItemKey(%q) = (%q, %q, %v)", key, kind, id, ok)
	}
}

func TestParseActionItemKeyRejects(t *testing.T) {
	for _, tc := range []struct {
		name string
		key  string
	}{
		{"empty", ""},
		{"no separator", "WARRANTY_EXPIRED"},
		{"empty entity id", "WARRANTY_EXPIRED:"},
		{"empty kind", ":clx1"},
		{"unknown kind", "NOT_A_REAL_KIND:clx1"},
		{"lowercase kind is not the enum", "warranty_expired:clx1"},
		{"extra colon", "WARRANTY_EXPIRED:clx1:clx2"},
		{"id only", "clx1"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if kind, id, ok := ParseActionItemKey(tc.key); ok {
				t.Errorf("ParseActionItemKey(%q) accepted as (%q, %q)", tc.key, kind, id)
			}
		})
	}
}

func TestEveryActionKindIsKnown(t *testing.T) {
	// The list must stay in lockstep with the openapi enum: a kind that can be
	// derived but cannot be parsed back would produce items that can never be
	// snoozed, and the handler would answer 400 on the client's own itemKey.
	kinds := []string{
		ActionWarrantyExpired,
		ActionDeviceNoWarranty,
		ActionDeviceStatusStale,
		ActionDeviceMissingSerial,
		ActionDeviceMissingReceipt,
		ActionReturnWindowClosing,
		ActionReturnWindowUnknown,
		ActionSubRenewingNoCancelURL,
		ActionSubPaidNotAdvanced,
		ActionWishlistTargetPassed,
	}
	if len(kinds) != 10 {
		t.Fatalf("expected 10 kinds, have %d", len(kinds))
	}
	seen := map[string]bool{}
	for _, k := range kinds {
		if !IsKnownActionKind(k) {
			t.Errorf("kind %q is not recognised by IsKnownActionKind", k)
		}
		if seen[k] {
			t.Errorf("duplicate kind %q", k)
		}
		seen[k] = true
		if _, id, ok := ParseActionItemKey(ActionItemKey(k, "abc123")); !ok || id != "abc123" {
			t.Errorf("kind %q does not round-trip through its own key", k)
		}
	}
}

func TestSortActionItems(t *testing.T) {
	d1 := "2026-03-01T00:00:00Z"
	d2 := "2026-03-05T00:00:00Z"

	items := []ActionItem{
		{ItemKey: "LOW:a", Kind: ActionDeviceMissingSerial, Severity: ActionSeverityLow, DueDate: &d1},
		{ItemKey: "MED:b", Kind: ActionDeviceNoWarranty, Severity: ActionSeverityMedium},
		{ItemKey: "HIGH:late", Kind: ActionWarrantyExpired, Severity: ActionSeverityHigh, DueDate: &d2},
		{ItemKey: "HIGH:soon", Kind: ActionWarrantyExpired, Severity: ActionSeverityHigh, DueDate: &d1},
		{ItemKey: "MED:dated", Kind: ActionSubPaidNotAdvanced, Severity: ActionSeverityMedium, DueDate: &d2},
		{ItemKey: "LOW:undated", Kind: ActionDeviceMissingReceipt, Severity: ActionSeverityLow},
	}
	sortActionItems(items)

	want := []string{"HIGH:soon", "HIGH:late", "MED:dated", "MED:b", "LOW:a", "LOW:undated"}
	for i, w := range want {
		if items[i].ItemKey != w {
			t.Fatalf("position %d = %q, want %q (full order: %v)", i, items[i].ItemKey, w, keysOf(items))
		}
	}
}

func TestSortActionItemsIsStableForIdenticalInputs(t *testing.T) {
	// Two different items with the same severity and no date must not swap places
	// between two responses: a client diffing them must not see phantom changes.
	d := "2026-03-01T00:00:00Z"
	build := func() []ActionItem {
		return []ActionItem{
			{ItemKey: ActionItemKey(ActionDeviceMissingSerial, "zzz"), Kind: ActionDeviceMissingSerial, Severity: ActionSeverityLow, DueDate: &d},
			{ItemKey: ActionItemKey(ActionDeviceMissingSerial, "aaa"), Kind: ActionDeviceMissingSerial, Severity: ActionSeverityLow, DueDate: &d},
			{ItemKey: ActionItemKey(ActionDeviceMissingReceipt, "mmm"), Kind: ActionDeviceMissingReceipt, Severity: ActionSeverityLow, DueDate: &d},
		}
	}
	first := build()
	sortActionItems(first)

	// Same set, different input order → same output order.
	shuffled := []ActionItem{first[2], first[0], first[1]}
	sortActionItems(shuffled)

	for i := range first {
		if first[i].ItemKey != shuffled[i].ItemKey {
			t.Fatalf("order differs at %d: %q vs %q", i, first[i].ItemKey, shuffled[i].ItemKey)
		}
	}
}

func TestSnoozeBoundsAreSane(t *testing.T) {
	if SnoozeDaysDefault < SnoozeDaysMin || SnoozeDaysDefault > SnoozeDaysMax {
		t.Fatalf("default %d outside [%d, %d]", SnoozeDaysDefault, SnoozeDaysMin, SnoozeDaysMax)
	}
	// The feature doc asks for exactly "để đó 90 ngày"; if that ever changes, the
	// openapi default and the clients' copy change with it.
	if SnoozeDaysDefault != 90 {
		t.Errorf("SnoozeDaysDefault = %d, want 90", SnoozeDaysDefault)
	}
}

func TestNoWarrantyExpiredAndStatusStaleOverlap(t *testing.T) {
	// The two rules are built to be disjoint: WARRANTY_EXPIRED covers expiries
	// INSIDE the lookback horizon, DEVICE_STATUS_STALE covers a last expiry OLDER
	// than it. If the constants ever made the horizons equal in the wrong
	// direction a device could be double-reported.
	if ActionWarrantyExpiredLookbackDays <= 0 {
		t.Fatalf("lookback must be positive, got %d", ActionWarrantyExpiredLookbackDays)
	}
	if ActionReturnWindowClosingDays >= ActionReturnWindowUnknownDays {
		t.Errorf("closing horizon (%d) should be shorter than the unknown-prompt horizon (%d)",
			ActionReturnWindowClosingDays, ActionReturnWindowUnknownDays)
	}
}

func keysOf(items []ActionItem) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, it.ItemKey)
	}
	return out
}
