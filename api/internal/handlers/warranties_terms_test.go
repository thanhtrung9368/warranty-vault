package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// Contract terms over the actual JSON wire (migration 0017).
//
// The service tests prove the rules and the DB round trip; this test proves the
// HANDLER accepts the nine fields (decodeJSON uses DisallowUnknownFields, so a
// missing struct field would be a 400), returns them, and maps the claims pair to
// fieldErrors on PATCH as well as POST. It is DB-gated like the rest of the
// handler suite.
func TestWarrantyContractTermsOverTheWire(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	created := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "vi",
		`{"name":"Xe máy","category":"PHONE","purchaseDate":"2026-01-15","purchasePrice":30000000}`)
	if created.Code != http.StatusCreated {
		t.Fatalf("create device = %d (%s)", created.Code, created.Body.String())
	}
	var deviceBody struct {
		Device struct {
			ID string `json:"id"`
		} `json:"device"`
	}
	if err := json.Unmarshal(created.Body.Bytes(), &deviceBody); err != nil || deviceBody.Device.ID == "" {
		t.Fatalf("decode create device: %v (%s)", err, created.Body.String())
	}
	deviceID := deviceBody.Device.ID

	// A THIRD_PARTY plan WITH a cap and exclusions: the frozen contract says no
	// validation may tie terms to type, so this combination must be accepted.
	const terms = `"component":"Động cơ","scope":"Động cơ và hộp số",` +
		`"cap":50000000,"deductible":1000000,"exclusions":"Hao mòn tự nhiên",` +
		`"region":"Việt Nam","transferable":true,"claimsAllowed":3,"claimsUsed":2`
	createBody := `{"type":"THIRD_PARTY","startDate":"2026-01-15","months":24,` + terms + `}`

	rr := env.do(t, http.MethodPost, "/api/v1/devices/"+deviceID+"/warranties?lang=vi", "vi", createBody)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create warranty = %d (%s)", rr.Code, rr.Body.String())
	}
	var warrantyBody struct {
		Warranty struct {
			ID            string  `json:"id"`
			Component     *string `json:"component"`
			Scope         *string `json:"scope"`
			Cap           *int32  `json:"cap"`
			Deductible    *int32  `json:"deductible"`
			Exclusions    *string `json:"exclusions"`
			Region        *string `json:"region"`
			Transferable  *bool   `json:"transferable"`
			ClaimsAllowed *int32  `json:"claimsAllowed"`
			ClaimsUsed    int32   `json:"claimsUsed"`
		} `json:"warranty"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &warrantyBody); err != nil {
		t.Fatalf("decode warranty: %v (%s)", err, rr.Body.String())
	}
	w := warrantyBody.Warranty
	if w.ID == "" {
		t.Fatalf("create warranty returned no id: %s", rr.Body.String())
	}
	if w.Component == nil || *w.Component != "Động cơ" ||
		w.Scope == nil || *w.Scope != "Động cơ và hộp số" ||
		w.Cap == nil || *w.Cap != 50_000_000 ||
		w.Deductible == nil || *w.Deductible != 1_000_000 ||
		w.Exclusions == nil || *w.Exclusions != "Hao mòn tự nhiên" ||
		w.Region == nil || *w.Region != "Việt Nam" ||
		w.Transferable == nil || !*w.Transferable ||
		w.ClaimsAllowed == nil || *w.ClaimsAllowed != 3 ||
		w.ClaimsUsed != 2 {
		t.Fatalf("created warranty does not carry the terms: %+v", w)
	}

	// PATCH without claimsUsed must KEEP 2, so asking for an allowance of 1 is the
	// "contract cannot be over-used" 400 — on the update path, not just create.
	patchBody := `{"type":"THIRD_PARTY","startDate":"2026-01-15","months":24,` +
		`"component":"Động cơ","scope":"Động cơ và hộp số","cap":50000000,` +
		`"deductible":1000000,"exclusions":"Hao mòn tự nhiên","region":"Việt Nam",` +
		`"transferable":true,"claimsAllowed":1}`
	rr = env.do(t, http.MethodPatch, "/api/v1/warranties/"+w.ID+"?lang=vi", "vi", patchBody)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("over-used PATCH = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if got := firstFieldError(t, decodeResponse(t, rr), "claimsUsed"); got != "Số lần đã dùng không được vượt quá số lần được phép" {
		t.Errorf("PATCH fieldErrors.claimsUsed = %q", got)
	}

	// Raising the allowance to 2 makes the same body valid, and the counter is
	// still the stored 2 (omitted claimsUsed never resets it).
	patchBody = `{"type":"THIRD_PARTY","startDate":"2026-01-15","months":24,` +
		`"component":"Động cơ","scope":"Động cơ và hộp số","cap":50000000,` +
		`"deductible":1000000,"exclusions":"Hao mòn tự nhiên","region":"Việt Nam",` +
		`"transferable":true,"claimsAllowed":2}`
	rr = env.do(t, http.MethodPatch, "/api/v1/warranties/"+w.ID+"?lang=vi", "vi", patchBody)
	if rr.Code != http.StatusOK {
		t.Fatalf("valid PATCH = %d (%s)", rr.Code, rr.Body.String())
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &warrantyBody); err != nil {
		t.Fatalf("decode updated warranty: %v", err)
	}
	if warrantyBody.Warranty.ClaimsUsed != 2 {
		t.Errorf("claimsUsed after omitted-field PATCH = %d, want the stored 2",
			warrantyBody.Warranty.ClaimsUsed)
	}
	if warrantyBody.Warranty.ClaimsAllowed == nil || *warrantyBody.Warranty.ClaimsAllowed != 2 {
		t.Errorf("claimsAllowed after PATCH = %v, want 2", warrantyBody.Warranty.ClaimsAllowed)
	}

	// Every read returns the fields. The list endpoint is the one a client's edit
	// form is populated from, so a missing key there would silently blank the form.
	rr = env.do(t, http.MethodGet, "/api/v1/devices/"+deviceID+"/warranties?lang=vi", "vi", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list warranties = %d (%s)", rr.Code, rr.Body.String())
	}
	raw := rr.Body.String()
	for _, key := range []string{
		`"component":"Động cơ"`, `"cap":50000000`, `"deductible":1000000`,
		`"exclusions":"Hao mòn tự nhiên"`, `"region":"Việt Nam"`,
		`"transferable":true`, `"claimsAllowed":2`, `"claimsUsed":2`,
	} {
		if !strings.Contains(raw, key) {
			t.Errorf("list response is missing %s: %s", key, raw)
		}
	}
}
