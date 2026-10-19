package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

// The invariant that was missing: the same device must report the same
// `effectiveWarrantyEnd` from the list, the detail and search. Before this test
// the list computed max(endDate) over EVERY warranty row (a component clock
// could inflate it) while the detail serializer dropped the field entirely and
// search did not compute it at all. Each endpoint looked "fine" in isolation;
// only reading the same device three ways exposes the disagreement.
//
// The rule pinned here is the certificate's: max(endDate) over WHOLE-UNIT rows
// only (component NULL/blank). A device with a whole-unit plan ending
// 2026-11-20 and a 10-year motor row must answer 2026-11-20 everywhere, and a
// device with only component rows must answer null everywhere.

// effectiveEndDeviceDTO decodes only the fields this test asserts, so an
// additive device field cannot fail the test for the wrong reason.
type effectiveEndDeviceDTO struct {
	ID                   string  `json:"id"`
	EffectiveWarrantyEnd *string `json:"effectiveWarrantyEnd"`
}

func (e *devicesI18nEnv) effectiveEndFromList(t *testing.T, deviceID string) effectiveEndDeviceDTO {
	t.Helper()
	rr := e.do(t, http.MethodGet, "/api/v1/devices?status=ALL&lang=vi", "vi", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("list devices = %d (%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Devices []effectiveEndDeviceDTO `json:"devices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode list: %v (%s)", err, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"effectiveWarrantyEnd"`) {
		t.Fatalf("list response omits effectiveWarrantyEnd: %s", rr.Body.String())
	}
	for _, d := range body.Devices {
		if d.ID == deviceID {
			return d
		}
	}
	t.Fatalf("list response has no device %q: %s", deviceID, rr.Body.String())
	return effectiveEndDeviceDTO{}
}

func (e *devicesI18nEnv) effectiveEndFromDetail(t *testing.T, deviceID string) effectiveEndDeviceDTO {
	t.Helper()
	rr := e.do(t, http.MethodGet, "/api/v1/devices/"+deviceID+"?lang=vi", "vi", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("get device = %d (%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Device effectiveEndDeviceDTO `json:"device"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode detail: %v (%s)", err, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"effectiveWarrantyEnd"`) {
		t.Fatalf("detail response omits effectiveWarrantyEnd: %s", rr.Body.String())
	}
	return body.Device
}

func (e *devicesI18nEnv) effectiveEndFromSearch(t *testing.T, deviceID, name string) effectiveEndDeviceDTO {
	t.Helper()
	rr := e.do(t, http.MethodGet, "/api/v1/search?q="+url.QueryEscape(name)+"&lang=vi", "vi", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("search = %d (%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Devices []effectiveEndDeviceDTO `json:"devices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode search: %v (%s)", err, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"effectiveWarrantyEnd"`) {
		t.Fatalf("search response omits effectiveWarrantyEnd: %s", rr.Body.String())
	}
	for _, d := range body.Devices {
		if d.ID == deviceID {
			return d
		}
	}
	t.Fatalf("search response has no device %q: %s", deviceID, rr.Body.String())
	return effectiveEndDeviceDTO{}
}

func mustCreateDeviceForWarrantyEndTest(t *testing.T, env *devicesI18nEnv, name string) string {
	t.Helper()
	rr := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "vi",
		fmt.Sprintf(`{"name":%q,"category":"PHONE","purchaseDate":"2024-01-15","purchasePrice":10000000}`, name))
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

func mustCreateWarrantyForWarrantyEndTest(t *testing.T, env *devicesI18nEnv, deviceID, body string) {
	t.Helper()
	rr := env.do(t, http.MethodPost, "/api/v1/devices/"+deviceID+"/warranties?lang=vi", "vi", body)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create warranty on %s = %d (%s)", deviceID, rr.Code, rr.Body.String())
	}
}

func TestEffectiveWarrantyEndAgreesAcrossListDetailAndSearch(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	// One whole-unit plan (2024-11-20 + 24 months = 2026-11-20) and one
	// component row that ends much later (2025-01-01 + 120 months = 2035-01-01).
	// The component row must NOT win the headline: that is the certificate rule.
	const name = "Invariant Warranty End Device"
	deviceID := mustCreateDeviceForWarrantyEndTest(t, env, name)
	mustCreateWarrantyForWarrantyEndTest(t, env, deviceID,
		`{"type":"STANDARD","provider":"Apple","startDate":"2024-11-20","months":24}`)
	mustCreateWarrantyForWarrantyEndTest(t, env, deviceID,
		`{"type":"THIRD_PARTY","startDate":"2025-01-01","months":120,"component":"Động cơ"}`)

	const want = "2026-11-20T00:00:00Z"
	list := env.effectiveEndFromList(t, deviceID)
	detail := env.effectiveEndFromDetail(t, deviceID)
	search := env.effectiveEndFromSearch(t, deviceID, name)

	for source, got := range map[string]*string{
		"list":   list.EffectiveWarrantyEnd,
		"detail": detail.EffectiveWarrantyEnd,
		"search": search.EffectiveWarrantyEnd,
	} {
		if got == nil || *got != want {
			t.Errorf("%s effectiveWarrantyEnd = %v, want %s", source, got, want)
		}
	}

	// The invariant itself, stated explicitly so a future refactor cannot make
	// the three values merely "each plausible" and still pass.
	if list.EffectiveWarrantyEnd == nil || detail.EffectiveWarrantyEnd == nil || search.EffectiveWarrantyEnd == nil {
		t.Fatalf("a nil effectiveWarrantyEnd breaks the equality invariant: list=%v detail=%v search=%v",
			list.EffectiveWarrantyEnd, detail.EffectiveWarrantyEnd, search.EffectiveWarrantyEnd)
	}
	if *list.EffectiveWarrantyEnd != *detail.EffectiveWarrantyEnd ||
		*list.EffectiveWarrantyEnd != *search.EffectiveWarrantyEnd {
		t.Errorf("effectiveWarrantyEnd disagrees: list=%q detail=%q search=%q",
			*list.EffectiveWarrantyEnd, *detail.EffectiveWarrantyEnd, *search.EffectiveWarrantyEnd)
	}
}

// A device whose every warranty row is component-scoped has no whole-unit end
// date. All three reads must say null — not the component clock's 2035 date.
func TestEffectiveWarrantyEndNullWhenEveryRowIsComponentScoped(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	const name = "Component Only Warranty End Device"
	deviceID := mustCreateDeviceForWarrantyEndTest(t, env, name)
	mustCreateWarrantyForWarrantyEndTest(t, env, deviceID,
		`{"type":"THIRD_PARTY","startDate":"2025-01-01","months":120,"component":"Động cơ"}`)

	for source, got := range map[string]*string{
		"list":   env.effectiveEndFromList(t, deviceID).EffectiveWarrantyEnd,
		"detail": env.effectiveEndFromDetail(t, deviceID).EffectiveWarrantyEnd,
		"search": env.effectiveEndFromSearch(t, deviceID, name).EffectiveWarrantyEnd,
	} {
		if got != nil {
			t.Errorf("%s effectiveWarrantyEnd = %q, want null (every row is component-scoped)", source, *got)
		}
	}
}

// No warranty at all is the other null case; it must be null in all three reads
// rather than an omitted key only one endpoint happens to serialise.
func TestEffectiveWarrantyEndNullWithoutWarranties(t *testing.T) {
	env := setupDevicesI18nEnv(t)

	const name = "No Warranty End Device"
	deviceID := mustCreateDeviceForWarrantyEndTest(t, env, name)

	for source, got := range map[string]*string{
		"list":   env.effectiveEndFromList(t, deviceID).EffectiveWarrantyEnd,
		"detail": env.effectiveEndFromDetail(t, deviceID).EffectiveWarrantyEnd,
		"search": env.effectiveEndFromSearch(t, deviceID, name).EffectiveWarrantyEnd,
	} {
		if got != nil {
			t.Errorf("%s effectiveWarrantyEnd = %q, want null (device has no warranties)", source, *got)
		}
	}
}
