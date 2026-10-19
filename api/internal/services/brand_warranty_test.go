package services

import (
	"encoding/json"
	"testing"
	"time"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// Brand warranty lookup + mismatch flag (gap #11, migration 0023).
//
// These are DB-free tests for the two halves of the feature:
//
//  1. the five input fields' validation rules (including the rule that a status
//     alone is valid — NOT_REGISTERED has no dates);
//  2. the mismatch arithmetic in BOTH directions, the whole-unit-only rule, and
//     the precedence when a start and an end mismatch coexist.
//
// The real-Postgres round trip (create/read/backup/import, "computed not stored")
// lives in brand_warranty_db_test.go.

func deviceWithBrand(purchase string, brandStart, brandEnd *string) store.Device {
	d := store.Device{
		ID:            "dev_brand",
		Name:          "Máy",
		Category:      "PHONE",
		PurchaseDate:  wire.Date(mustDate(purchase)),
		PurchasePrice: 1,
	}
	if brandStart != nil {
		d.BrandWarrantyStart = wire.Date(mustDate(*brandStart))
	}
	if brandEnd != nil {
		d.BrandWarrantyEnd = wire.Date(mustDate(*brandEnd))
	}
	return d
}

func mustDate(value string) time.Time {
	d, err := time.Parse("2006-01-02", value)
	if err != nil {
		panic(err)
	}
	return d.UTC()
}

func wholeUnitWarranty(end string) store.Warranty {
	return store.Warranty{
		ID:        "war_whole",
		DeviceId:  "dev_brand",
		Type:      "STANDARD",
		StartDate: wire.Date(mustDate("2025-01-01")),
		EndDate:   wire.Date(mustDate(end)),
		Months:    12,
	}
}

func componentWarranty(end string) store.Warranty {
	component := "Động cơ"
	return store.Warranty{
		ID:        "war_component",
		DeviceId:  "dev_brand",
		Type:      "STANDARD",
		Component: &component,
		StartDate: wire.Date(mustDate("2025-01-01")),
		EndDate:   wire.Date(mustDate(end)),
		Months:    120,
	}
}

// ─── validation ─────────────────────────────────────────────────────────────

func TestValidateDeviceInputBrandWarrantyRules(t *testing.T) {
	cases := []struct {
		name      string
		mutate    func(*DeviceInput)
		wantField string // "" = the request must be accepted
	}{
		{
			name:   "absent group is valid (pre-0023 device)",
			mutate: func(*DeviceInput) {},
		},
		{
			name: "status alone is valid",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
			},
		},
		{
			name: "NOT_REGISTERED alone is valid and has no dates",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusNotRegistered)
			},
		},
		{
			name: "start without status",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStart = strPtr("2025-01-10")
			},
			wantField: "brandWarrantyStatus",
		},
		{
			name: "end without status",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyEnd = strPtr("2026-01-10")
			},
			wantField: "brandWarrantyStatus",
		},
		{
			name: "checkedAt without status",
			mutate: func(in *DeviceInput) {
				in.BrandCheckedAt = strPtr("2025-01-10T09:00:00Z")
			},
			wantField: "brandWarrantyStatus",
		},
		{
			name: "lookup URL without status",
			mutate: func(in *DeviceInput) {
				in.BrandLookupUrl = strPtr("https://checkcoverage.apple.com/")
			},
			wantField: "brandWarrantyStatus",
		},
		{
			name: "status is not one of the five codes",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr("active")
			},
			wantField: "brandWarrantyStatus",
		},
		{
			name: "end before start",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandWarrantyStart = strPtr("2025-03-01")
				in.BrandWarrantyEnd = strPtr("2025-02-28")
			},
			wantField: "brandWarrantyEnd",
		},
		{
			name: "equal start and end is valid",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandWarrantyStart = strPtr("2025-03-01")
				in.BrandWarrantyEnd = strPtr("2025-03-01")
			},
		},
		{
			name: "start is not a date",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandWarrantyStart = strPtr("01/03/2025")
			},
			wantField: "brandWarrantyStart",
		},
		{
			name: "end is not a date",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandWarrantyEnd = strPtr("not-a-date")
			},
			wantField: "brandWarrantyEnd",
		},
		{
			name: "checkedAt is not a date",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandCheckedAt = strPtr("yesterday")
			},
			wantField: "brandCheckedAt",
		},
		{
			name: "relative URL",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandLookupUrl = strPtr("/warranty")
			},
			wantField: "brandLookupUrl",
		},
		{
			name: "ftp URL",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandLookupUrl = strPtr("ftp://example.com/warranty")
			},
			wantField: "brandLookupUrl",
		},
		{
			name: "javascript URL",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandLookupUrl = strPtr("javascript:alert(1)")
			},
			wantField: "brandLookupUrl",
		},
		{
			name: "http URL with no host",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandLookupUrl = strPtr("https://")
			},
			wantField: "brandLookupUrl",
		},
		{
			name: "URL with whitespace",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandLookupUrl = strPtr("https://example.com/a b")
			},
			wantField: "brandLookupUrl",
		},
		{
			name: "absolute http URL is valid",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
				in.BrandLookupUrl = strPtr("http://example.com/warranty?imei=1")
			},
		},
		{
			name: "absolute https URL is valid",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusUnknown)
				in.BrandLookupUrl = strPtr("https://www.samsung.com/vn/support/warrantycheck/")
			},
		},
		{
			name: "the full group is valid",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr(BrandWarrantyStatusPreActivated)
				in.BrandWarrantyStart = strPtr("2025-01-10")
				in.BrandWarrantyEnd = strPtr("2026-01-10")
				in.BrandCheckedAt = strPtr("2025-06-01T08:30:00Z")
				in.BrandLookupUrl = strPtr("https://checkcoverage.apple.com/")
			},
		},
		{
			name: "empty strings are treated as absent",
			mutate: func(in *DeviceInput) {
				in.BrandWarrantyStatus = strPtr("")
				in.BrandWarrantyStart = strPtr("")
				in.BrandWarrantyEnd = strPtr("")
				in.BrandCheckedAt = strPtr("")
				in.BrandLookupUrl = strPtr("")
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := validDeviceInput()
			tc.mutate(&in)
			err := ValidateDeviceInput(viCtx(), &in)
			if tc.wantField == "" {
				if err != nil {
					t.Fatalf("ValidateDeviceInput() = %v, want nil", err)
				}
				return
			}
			svc, ok := As(err)
			if !ok {
				t.Fatalf("ValidateDeviceInput() = %v, want a *services.Error with fieldErrors.%s", err, tc.wantField)
			}
			if svc.Code != "VALIDATION" {
				t.Errorf("code = %q, want VALIDATION", svc.Code)
			}
			if len(svc.FieldErrors[tc.wantField]) == 0 {
				t.Errorf("fieldErrors = %v, want a message under %q", svc.FieldErrors, tc.wantField)
			}
		})
	}
}

// TestBrandWarrantyValidationIsTranslated pins both languages on the two rules
// whose wording is new copy rather than a reused date message. The catalog test
// proves every key has an English column; this proves the call site actually
// renders it.
func TestBrandWarrantyValidationIsTranslated(t *testing.T) {
	en := validDeviceInput()
	en.BrandWarrantyStart = strPtr("2025-01-10")
	err := ValidateDeviceInput(enCtx(), &en)
	svc, ok := As(err)
	if !ok {
		t.Fatalf("want validation error, got %v", err)
	}
	if got := svc.FieldErrors["brandWarrantyStatus"]; len(got) == 0 ||
		got[0] != "Brand warranty status is required when a date or lookup URL is recorded" {
		t.Errorf("en brandWarrantyStatus = %v", got)
	}

	badURL := validDeviceInput()
	badURL.BrandWarrantyStatus = strPtr(BrandWarrantyStatusActive)
	badURL.BrandLookupUrl = strPtr("not a url")
	err = ValidateDeviceInput(enCtx(), &badURL)
	svc, ok = As(err)
	if !ok {
		t.Fatalf("want validation error, got %v", err)
	}
	if got := svc.FieldErrors["brandLookupUrl"]; len(got) == 0 ||
		got[0] != "Brand warranty lookup URL must be an absolute http/https URL" {
		t.Errorf("en brandLookupUrl = %v", got)
	}
}

// ─── mismatch arithmetic ────────────────────────────────────────────────────

func TestWarrantyMismatchStartDirections(t *testing.T) {
	cases := []struct {
		name     string
		purchase string
		start    string
		wantKind string
		wantDays int
	}{
		{
			name:     "brand starts before the invoice",
			purchase: "2025-06-01",
			start:    "2025-03-01",
			wantKind: WarrantyMismatchStartsBefore,
			wantDays: 92,
		},
		{
			name:     "brand starts after the invoice",
			purchase: "2025-06-01",
			start:    "2025-09-01",
			wantKind: WarrantyMismatchStartsAfter,
			wantDays: 92,
		},
		{
			name:     "same day is not a mismatch",
			purchase: "2025-06-01",
			start:    "2025-06-01",
			wantKind: "",
		},
		{
			name:     "date-only comparison ignores the time of day",
			purchase: "2025-06-01",
			start:    "2025-05-31",
			wantKind: WarrantyMismatchStartsBefore,
			wantDays: 1,
		},
		{
			name:     "leap day is counted",
			purchase: "2024-02-28",
			start:    "2024-03-01",
			wantKind: WarrantyMismatchStartsAfter,
			wantDays: 2,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := deviceWithBrand(tc.purchase, strPtr(tc.start), nil)
			got := warrantyMismatchFor(d, nil)
			if tc.wantKind == "" {
				if got != nil {
					t.Fatalf("mismatch = %+v, want nil", got)
				}
				return
			}
			if got == nil {
				t.Fatalf("mismatch = nil, want kind %s", tc.wantKind)
			}
			if got.Kind != tc.wantKind || got.Days != tc.wantDays {
				t.Errorf("mismatch = %+v, want kind %s / %d days", got, tc.wantKind, tc.wantDays)
			}
			if got.BrandDate != tc.start {
				t.Errorf("brandDate = %q, want %q", got.BrandDate, tc.start)
			}
			if got.PurchaseDate != tc.purchase {
				t.Errorf("purchaseDate = %q, want %q", got.PurchaseDate, tc.purchase)
			}
		})
	}
}

func TestWarrantyMismatchEndDirections(t *testing.T) {
	cases := []struct {
		name     string
		brandEnd string
		appEnd   string
		wantKind string
		wantDays int
	}{
		{
			name:     "brand ends before the app thinks",
			brandEnd: "2025-12-01",
			appEnd:   "2026-06-01",
			wantKind: WarrantyMismatchEndedEarlier,
			wantDays: 182,
		},
		{
			name:     "brand ends after the app thinks",
			brandEnd: "2027-01-01",
			appEnd:   "2026-06-01",
			wantKind: WarrantyMismatchEndedLater,
			wantDays: 214,
		},
		{
			name:     "same end date is not a mismatch",
			brandEnd: "2026-06-01",
			appEnd:   "2026-06-01",
			wantKind: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			d := deviceWithBrand("2025-06-01", nil, strPtr(tc.brandEnd))
			got := warrantyMismatchFor(d, []store.Warranty{wholeUnitWarranty(tc.appEnd)})
			if tc.wantKind == "" {
				if got != nil {
					t.Fatalf("mismatch = %+v, want nil", got)
				}
				return
			}
			if got == nil {
				t.Fatalf("mismatch = nil, want kind %s", tc.wantKind)
			}
			if got.Kind != tc.wantKind || got.Days != tc.wantDays {
				t.Errorf("mismatch = %+v, want kind %s / %d days", got, tc.wantKind, tc.wantDays)
			}
			// The contract's second field is named purchaseDate even for an end
			// comparison; for ENDED_* it carries the app's effective end.
			if got.PurchaseDate != tc.appEnd {
				t.Errorf("purchaseDate = %q, want the app's effective end %q", got.PurchaseDate, tc.appEnd)
			}
		})
	}
}

// TestWarrantyMismatchNoWholeUnitWarranty is the "nothing to compare" case the
// contract calls out: a component clock (a 10-year motor warranty) must not be
// presented as the whole device's expiry.
func TestWarrantyMismatchNoWholeUnitWarranty(t *testing.T) {
	d := deviceWithBrand("2025-06-01", strPtr("2025-06-01"), strPtr("2025-12-01"))
	if got := warrantyMismatchFor(d, []store.Warranty{componentWarranty("2035-01-01")}); got != nil {
		t.Fatalf("mismatch = %+v, want nil: only a component warranty exists, so there is no whole-unit end to compare", got)
	}

	// With a whole-unit row present, the component clock is still ignored: the
	// comparison target is the whole-unit end, not the later component end.
	rows := []store.Warranty{
		wholeUnitWarranty("2026-01-01"),
		componentWarranty("2035-01-01"),
	}
	got := warrantyMismatchFor(d, rows)
	if got == nil || got.Kind != WarrantyMismatchEndedEarlier {
		t.Fatalf("mismatch = %+v, want ENDED_EARLIER against the whole-unit row", got)
	}
	if got.PurchaseDate != "2026-01-01" {
		t.Errorf("purchaseDate = %q, want 2026-01-01 (the whole-unit end, not the component end)", got.PurchaseDate)
	}
	if got.Days != 31 {
		t.Errorf("days = %d, want 31", got.Days)
	}
}

// TestWarrantyMismatchPrecedence pins the one ordering decision: the END
// comparisons outrank the START comparisons, and an earlier-than-expected end
// outranks a later-than-expected one. See warrantyMismatchPrecedence.
func TestWarrantyMismatchPrecedence(t *testing.T) {
	// Both a start-before and an end-earlier mismatch: ENDED_EARLIER wins.
	d := deviceWithBrand("2025-06-01", strPtr("2025-03-01"), strPtr("2025-12-01"))
	got := warrantyMismatchFor(d, []store.Warranty{wholeUnitWarranty("2026-06-01")})
	if got == nil || got.Kind != WarrantyMismatchEndedEarlier {
		t.Fatalf("mismatch = %+v, want ENDED_EARLIER to outrank STARTS_BEFORE", got)
	}

	// Both a start-before and an end-later mismatch: ENDED_LATER still wins.
	d = deviceWithBrand("2025-06-01", strPtr("2025-03-01"), strPtr("2027-01-01"))
	got = warrantyMismatchFor(d, []store.Warranty{wholeUnitWarranty("2026-06-01")})
	if got == nil || got.Kind != WarrantyMismatchEndedLater {
		t.Fatalf("mismatch = %+v, want ENDED_LATER to outrank STARTS_BEFORE", got)
	}

	// No end comparison available: the start mismatch is surfaced instead.
	d = deviceWithBrand("2025-06-01", strPtr("2025-03-01"), strPtr("2027-01-01"))
	got = warrantyMismatchFor(d, nil)
	if got == nil || got.Kind != WarrantyMismatchStartsBefore {
		t.Fatalf("mismatch = %+v, want STARTS_BEFORE when there is no whole-unit end", got)
	}
}

func TestWarrantyMismatchNothingToCompare(t *testing.T) {
	// No brand fields at all: every pre-0023 device, and the proof that the
	// computed field does not invent a mismatch from the invoice date alone.
	d := deviceWithBrand("2025-06-01", nil, nil)
	if got := warrantyMismatchFor(d, []store.Warranty{wholeUnitWarranty("2026-06-01")}); got != nil {
		t.Fatalf("mismatch = %+v, want nil", got)
	}

	// A status alone (NOT_REGISTERED) is a complete answer with no dates.
	d.BrandWarrantyStatus = strPtr(BrandWarrantyStatusNotRegistered)
	if got := warrantyMismatchFor(d, []store.Warranty{wholeUnitWarranty("2026-06-01")}); got != nil {
		t.Fatalf("mismatch = %+v, want nil for a status without dates", got)
	}

	// A brand end with no whole-unit warranty row and no whole-unit component
	// has nothing to compare.
	d = deviceWithBrand("2025-06-01", nil, strPtr("2025-12-01"))
	if got := warrantyMismatchFor(d, nil); got != nil {
		t.Fatalf("mismatch = %+v, want nil when the device has no warranty rows", got)
	}
}

func TestBrandWarrantyMismatchJSONShape(t *testing.T) {
	raw, err := json.Marshal(BrandWarrantyMismatch{
		Kind:         WarrantyMismatchEndedEarlier,
		Days:         12,
		BrandDate:    "2025-12-01",
		PurchaseDate: "2025-12-13",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	want := []string{"kind", "days", "brandDate", "purchaseDate"}
	if len(got) != len(want) {
		t.Fatalf("mismatch JSON has %d keys, want %d: %s", len(got), len(want), raw)
	}
	for _, key := range want {
		if _, ok := got[key]; !ok {
			t.Errorf("mismatch JSON is missing %q: %s", key, raw)
		}
	}
	if string(got["kind"]) != `"ENDED_EARLIER"` {
		t.Errorf("kind = %s", got["kind"])
	}
	if string(got["days"]) != `12` {
		t.Errorf("days = %s", got["days"])
	}
}

// TestBackupBrandWarrantyValidation proves the backup importer enforces the same
// rules as the live write path, and that the pre-0023 payload shape (none of the
// five keys) is still valid. This is DB-free: the helper is the rule, the DB test
// covers the round trip.
func TestBackupBrandWarrantyValidation(t *testing.T) {
	cases := []struct {
		name    string
		device  BackupDevice
		wantErr bool
	}{
		{
			name:   "old payload: no brand keys",
			device: BackupDevice{Name: "Máy"},
		},
		{
			name: "status alone",
			device: BackupDevice{
				Name:                "Máy",
				BrandWarrantyStatus: strPtr(BrandWarrantyStatusNotRegistered),
			},
		},
		{
			name: "full group",
			device: BackupDevice{
				Name:                "Máy",
				BrandWarrantyStatus: strPtr(BrandWarrantyStatusActive),
				BrandWarrantyStart:  strPtr("2025-03-01"),
				BrandWarrantyEnd:    strPtr("2026-03-01"),
				BrandCheckedAt:      strPtr("2025-06-01T08:00:00Z"),
				BrandLookupUrl:      strPtr("https://checkcoverage.apple.com/"),
			},
		},
		{
			name: "date without status",
			device: BackupDevice{
				Name:               "Máy",
				BrandWarrantyStart: strPtr("2025-03-01"),
			},
			wantErr: true,
		},
		{
			name: "invalid status",
			device: BackupDevice{
				Name:                "Máy",
				BrandWarrantyStatus: strPtr("active"),
			},
			wantErr: true,
		},
		{
			name: "end before start",
			device: BackupDevice{
				Name:                "Máy",
				BrandWarrantyStatus: strPtr(BrandWarrantyStatusActive),
				BrandWarrantyStart:  strPtr("2025-03-01"),
				BrandWarrantyEnd:    strPtr("2025-02-01"),
			},
			wantErr: true,
		},
		{
			name: "relative lookup URL",
			device: BackupDevice{
				Name:                "Máy",
				BrandWarrantyStatus: strPtr(BrandWarrantyStatusActive),
				BrandLookupUrl:      strPtr("/warranty"),
			},
			wantErr: true,
		},
		{
			name: "bad date",
			device: BackupDevice{
				Name:                "Máy",
				BrandWarrantyStatus: strPtr(BrandWarrantyStatusActive),
				BrandWarrantyEnd:    strPtr("not-a-date"),
			},
			wantErr: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			values, err := backupBrandWarranty(viCtx(), tc.device)
			if tc.wantErr {
				svc, ok := As(err)
				if !ok || svc.Code != "VALIDATION" {
					t.Fatalf("backupBrandWarranty() = %v, want a VALIDATION error", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("backupBrandWarranty() = %v, want nil", err)
			}
			if values.Status == nil && tc.device.BrandWarrantyStatus != nil {
				t.Errorf("status was lost: %+v", values)
			}
		})
	}
}
