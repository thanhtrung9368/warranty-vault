package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

// The warranty write contract over the real wire.
//
// The regression this pins: `POST /api/v1/devices/{id}/warranties` rejected
//
//	{"type":"STANDARD","startDate":"2025-11-20","endDate":"2026-11-20","months":12}
//
// with `bad_input`. The body is valid JSON and `endDate` is a field every
// Warranty response carries, but the request struct did not have it and
// decodeJSON uses DisallowUnknownFields — so the strict decoder turned a valid
// read-modify-write payload into a 400. The fix accepts the field (honouring it
// when sent) instead of widening the decoder: unknown fields stay a 400, which
// is what catches client typos.
//
// A client that sends exactly the documented `WarrantyInput` field set — the
// nine basic fields plus the nine migration-0017 terms — must get a 201.

// warrantyWireDTO is the response shape this test asserts. Pointers keep a
// missing key distinguishable from an explicit null.
type warrantyWireDTO struct {
	ID            string  `json:"id"`
	DeviceID      string  `json:"deviceId"`
	Type          string  `json:"type"`
	Provider      *string `json:"provider"`
	StartDate     string  `json:"startDate"`
	EndDate       string  `json:"endDate"`
	Months        int32   `json:"months"`
	Cost          *int32  `json:"cost"`
	Address       *string `json:"address"`
	Phone         *string `json:"phone"`
	Notes         *string `json:"notes"`
	Component     *string `json:"component"`
	Scope         *string `json:"scope"`
	Cap           *int32  `json:"cap"`
	Deductible    *int32  `json:"deductible"`
	Exclusions    *string `json:"exclusions"`
	Region        *string `json:"region"`
	Transferable  *bool   `json:"transferable"`
	ClaimsAllowed *int32  `json:"claimsAllowed"`
	ClaimsUsed    int32   `json:"claimsUsed"`
}

func decodeWarrantyWire(t *testing.T, bodyBytes []byte) warrantyWireDTO {
	t.Helper()
	var body struct {
		Warranty warrantyWireDTO `json:"warranty"`
	}
	if err := json.Unmarshal(bodyBytes, &body); err != nil {
		t.Fatalf("decode warranty: %v (%s)", err, bodyBytes)
	}
	if body.Warranty.ID == "" {
		t.Fatalf("response carries no warranty id: %s", bodyBytes)
	}
	return body.Warranty
}

func mustCreateDeviceForWarrantyInputTest(t *testing.T, env *devicesI18nEnv, name string) string {
	t.Helper()
	rr := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "vi",
		fmt.Sprintf(`{"name":%q,"category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":30000000}`, name))
	if rr.Code != http.StatusCreated {
		t.Fatalf("create device = %d (%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Device struct {
			ID string `json:"id"`
		} `json:"device"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || body.Device.ID == "" {
		t.Fatalf("decode created device: %v (%s)", err, rr.Body.String())
	}
	return body.Device.ID
}

// TestWarrantyCreateAcceptsTheExactReportedBody is the verbatim reproduction:
// without endDate in the struct this is a 400 from DisallowUnknownFields.
func TestWarrantyCreateAcceptsTheExactReportedBody(t *testing.T) {
	env := setupDevicesI18nEnv(t)
	deviceID := mustCreateDeviceForWarrantyInputTest(t, env, "Reported Body Device")

	rr := env.do(t, http.MethodPost, "/api/v1/devices/"+deviceID+"/warranties?lang=vi", "vi",
		`{"type":"STANDARD","startDate":"2025-11-20","endDate":"2026-11-20","months":12}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create warranty with endDate = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Warranty struct {
			EndDate string `json:"endDate"`
		} `json:"warranty"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode warranty: %v (%s)", err, rr.Body.String())
	}
	if body.Warranty.EndDate != "2026-11-20T00:00:00" {
		t.Errorf("endDate = %q, want the explicit 2026-11-20", body.Warranty.EndDate)
	}
}

// TestWarrantyCreateAcceptsFullDocumentedFieldSet walks every field
// openapi.yaml documents for `WarrantyInput`, endDate included. A field the
// contract lists but the struct lacks is a 400 here — the class of bug this
// file exists for.
func TestWarrantyCreateAcceptsFullDocumentedFieldSet(t *testing.T) {
	env := setupDevicesI18nEnv(t)
	deviceID := mustCreateDeviceForWarrantyInputTest(t, env, "Full Field Set Device")

	const request = `{
		"type": "THIRD_PARTY",
		"provider": "Samsung",
		"startDate": "2025-11-20",
		"endDate": "2026-11-20",
		"months": 12,
		"cost": 100000,
		"address": "12 Nguyen Hue",
		"phone": "0900000000",
		"notes": "Ghi chú hợp đồng",
		"component": null,
		"scope": "Toàn máy",
		"cap": 50000000,
		"deductible": 1000000,
		"exclusions": "Hao mòn tự nhiên",
		"region": "Việt Nam",
		"transferable": true,
		"claimsAllowed": 3,
		"claimsUsed": 1
	}`
	rr := env.do(t, http.MethodPost, "/api/v1/devices/"+deviceID+"/warranties?lang=vi", "vi", request)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create with the full documented field set = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	w := decodeWarrantyWire(t, rr.Body.Bytes())

	if w.Type != "THIRD_PARTY" ||
		w.Provider == nil || *w.Provider != "Samsung" ||
		w.StartDate != "2025-11-20T00:00:00" ||
		w.EndDate != "2026-11-20T00:00:00" ||
		w.Months != 12 ||
		w.Cost == nil || *w.Cost != 100000 ||
		w.Address == nil || *w.Address != "12 Nguyen Hue" ||
		w.Phone == nil || *w.Phone != "0900000000" ||
		w.Notes == nil || *w.Notes != "Ghi chú hợp đồng" ||
		w.Component != nil ||
		w.Scope == nil || *w.Scope != "Toàn máy" ||
		w.Cap == nil || *w.Cap != 50_000_000 ||
		w.Deductible == nil || *w.Deductible != 1_000_000 ||
		w.Exclusions == nil || *w.Exclusions != "Hao mòn tự nhiên" ||
		w.Region == nil || *w.Region != "Việt Nam" ||
		w.Transferable == nil || !*w.Transferable ||
		w.ClaimsAllowed == nil || *w.ClaimsAllowed != 3 ||
		w.ClaimsUsed != 1 {
		t.Fatalf("created warranty does not round-trip the documented fields: %+v", w)
	}
}

// An explicit endDate is authoritative, not decoration: the contract offers it
// as an input, so a date that differs from startDate + months must be the date
// stored. An omitted endDate keeps the old derivation (the next test).
func TestWarrantyEndDateIsHonouredWhenItDiffersFromTheDerivedDate(t *testing.T) {
	env := setupDevicesI18nEnv(t)
	deviceID := mustCreateDeviceForWarrantyInputTest(t, env, "Explicit End Date Device")

	rr := env.do(t, http.MethodPost, "/api/v1/devices/"+deviceID+"/warranties?lang=vi", "vi",
		`{"type":"STANDARD","startDate":"2025-11-20","endDate":"2026-11-30","months":12}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create explicit endDate = %d (%s)", rr.Code, rr.Body.String())
	}
	w := decodeWarrantyWire(t, rr.Body.Bytes())
	if w.EndDate != "2026-11-30T00:00:00" {
		t.Errorf("endDate = %q, want the explicit 2026-11-30, not startDate + months", w.EndDate)
	}

	// PATCH is the same contract: explicit wins...
	rr = env.do(t, http.MethodPatch, "/api/v1/warranties/"+w.ID+"?lang=vi", "vi",
		`{"type":"STANDARD","startDate":"2025-11-20","endDate":"2027-01-15","months":12}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("patch explicit endDate = %d (%s)", rr.Code, rr.Body.String())
	}
	patched := decodeWarrantyWire(t, rr.Body.Bytes())
	if patched.EndDate != "2027-01-15T00:00:00" {
		t.Errorf("patched endDate = %q, want 2027-01-15", patched.EndDate)
	}

	// ...and an omitted endDate recomputes exactly as it always did.
	rr = env.do(t, http.MethodPatch, "/api/v1/warranties/"+w.ID+"?lang=vi", "vi",
		`{"type":"STANDARD","startDate":"2025-11-20","months":12}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("patch without endDate = %d (%s)", rr.Code, rr.Body.String())
	}
	derived := decodeWarrantyWire(t, rr.Body.Bytes())
	if derived.EndDate != "2026-11-20T00:00:00" {
		t.Errorf("endDate after omitted-field PATCH = %q, want startDate + months", derived.EndDate)
	}
}

// Omitting endDate is still the historical behaviour, byte for byte: this is the
// body every existing client sends.
func TestWarrantyEndDateIsDerivedWhenOmitted(t *testing.T) {
	env := setupDevicesI18nEnv(t)
	deviceID := mustCreateDeviceForWarrantyInputTest(t, env, "Derived End Date Device")

	rr := env.do(t, http.MethodPost, "/api/v1/devices/"+deviceID+"/warranties?lang=vi", "vi",
		`{"type":"STANDARD","startDate":"2025-11-20","months":12}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create without endDate = %d (%s)", rr.Code, rr.Body.String())
	}
	if w := decodeWarrantyWire(t, rr.Body.Bytes()); w.EndDate != "2026-11-20T00:00:00" {
		t.Errorf("derived endDate = %q, want 2026-11-20", w.EndDate)
	}
}

// The explicit date is still validated. A warranty that ends before it starts is
// a field error, not a row the clients have to defend against.
func TestWarrantyEndDateBeforeStartDateIsAFieldError(t *testing.T) {
	env := setupDevicesI18nEnv(t)
	deviceID := mustCreateDeviceForWarrantyInputTest(t, env, "Bad End Date Device")

	rr := env.do(t, http.MethodPost, "/api/v1/devices/"+deviceID+"/warranties?lang=vi", "vi",
		`{"type":"STANDARD","startDate":"2025-11-20","endDate":"2025-01-01","months":12}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("endDate before startDate = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	body := decodeResponse(t, rr)
	if got := firstFieldError(t, body, "endDate"); !strings.Contains(got, "trước ngày bắt đầu") {
		t.Errorf("fieldErrors.endDate = %q, want the ordering message", got)
	}

	// An unparseable explicit date is the same field, a different sentence.
	rr = env.do(t, http.MethodPost, "/api/v1/devices/"+deviceID+"/warranties?lang=vi", "vi",
		`{"type":"STANDARD","startDate":"2025-11-20","endDate":"31/12/2026","months":12}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("unparseable endDate = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if got := firstFieldError(t, decodeResponse(t, rr), "endDate"); !strings.Contains(got, "không hợp lệ") {
		t.Errorf("fieldErrors.endDate = %q, want the format message", got)
	}
}
