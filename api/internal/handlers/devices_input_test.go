package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

// The device write contract over the real wire.
//
// POST /api/v1/devices and PATCH /api/v1/devices/{id} do not accept the same
// field set, and before this file the difference was invisible to the server:
// one `DeviceInput` schema was used for both, while the handler decoded POST
// through a loose map and PATCH through the strict one. `fromWishlistId` is the
// field that exposed it — the docs offered it on PATCH, the strict decoder
// rejected it, and POST additionally accepted any other undocumented key
// without complaint.
//
// The fix is a real split:
//
//   - POST  -> DeviceCreateInput  -> deviceCreateRequest (DeviceInput + fromWishlistId)
//   - PATCH -> DeviceUpdateInput  -> services.DeviceInput (no fromWishlistId)
//
// Both decoders remain strict. These tests pin the consequence: the documented
// field set works on each endpoint, the create-only field is honoured on POST
// (including the cross-link it writes), the same field is a 400 on PATCH, and a
// read-only response field is a 400 on POST instead of being silently ignored.
//
// They are DB-backed like the rest of the handler suite (they skip when
// WV_TEST_DATABASE_URL is unset): the interesting half of `fromWishlistId` is
// the wishlist row it marks in the same transaction.

// setupDeviceInputEnv is the devices env plus the wishlist routes, so a test
// can create a real wishlist item over HTTP and observe the cross-link.
func setupDeviceInputEnv(t *testing.T) *devicesI18nEnv {
	t.Helper()
	env := setupDevicesI18nEnv(t)
	RegisterWishlist(env.mux, Deps{DB: env.pool, Limiter: &permissiveLimiter{}})
	return env
}

func mustCreateWishlistItem(t *testing.T, env *devicesI18nEnv, name string) string {
	t.Helper()
	rr := env.do(t, http.MethodPost, "/api/v1/wishlist?lang=vi", "vi",
		fmt.Sprintf(`{"name":%q,"priority":"WANT"}`, name))
	if rr.Code != http.StatusCreated {
		t.Fatalf("create wishlist item = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Item struct {
			ID string `json:"id"`
		} `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil || body.Item.ID == "" {
		t.Fatalf("decode wishlist item: %v (%s)", err, rr.Body.String())
	}
	return body.Item.ID
}

func mustCreateDeviceInput(t *testing.T, env *devicesI18nEnv, name string) string {
	t.Helper()
	rr := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "vi",
		fmt.Sprintf(`{"name":%q,"category":"PHONE","purchaseDate":"2026-01-15"}`, name))
	if rr.Code != http.StatusCreated {
		t.Fatalf("create device = %d, want 201 (%s)", rr.Code, rr.Body.String())
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

// deviceCreateFullFieldSet is every property openapi.yaml documents for
// DeviceCreateInput, with values chosen to satisfy the cross-field rules:
// currency USD requires fxRate, the sold pair is sent together, and the brand
// warranty group has a status plus internally consistent dates.
func deviceCreateFullFieldSet(fromWishlistID string) string {
	return fmt.Sprintf(`{
		"name": "iPhone 17 Pro",
		"category": "PHONE",
		"brand": "Apple",
		"model": "A3101",
		"serialNumber": "SN-INPUT-TEST",
		"purchaseDate": "2026-01-15",
		"purchasePrice": 999,
		"currency": "USD",
		"fxRate": 26000,
		"purchasePlace": "Apple Store",
		"status": "ACTIVE",
		"notes": "Ghi chú thiết bị",
		"soldAt": "2026-06-01",
		"soldPrice": 500,
		"returnWindowDays": 30,
		"receivedAt": "2026-01-20",
		"leadDays": [30, 7],
		"activationRequired": true,
		"activatedAt": "2026-01-10",
		"extendedCoverBuyBy": "2026-02-01",
		"brandWarrantyStatus": "ACTIVE",
		"brandWarrantyStart": "2026-01-01",
		"brandWarrantyEnd": "2027-01-01",
		"brandCheckedAt": "2026-01-21",
		"brandLookupUrl": "https://example.com/warranty-check",
		"warrantyMonths": 12,
		"warrantyProvider": "Apple",
		"warrantyAddress": "12 Nguyen Hue",
		"warrantyPhone": "0900000000",
		"warrantyNotes": "Gói bảo hành mở rộng",
		"fromWishlistId": %q
	}`, fromWishlistID)
}

// deviceUpdateFullFieldSet is the same set minus the create-only field.
func deviceUpdateFullFieldSet() string {
	return `{
		"name": "iPhone 17 Pro Max",
		"category": "PHONE",
		"brand": "Apple",
		"model": "A3101",
		"serialNumber": "SN-INPUT-TEST",
		"purchaseDate": "2026-01-15",
		"purchasePrice": 1099,
		"currency": "USD",
		"fxRate": 26000,
		"purchasePlace": "Apple Store",
		"status": "ACTIVE",
		"notes": "Ghi chú đã sửa",
		"soldAt": "2026-06-01",
		"soldPrice": 600,
		"returnWindowDays": 14,
		"receivedAt": "2026-01-20",
		"leadDays": [14, 3],
		"activationRequired": false,
		"activatedAt": null,
		"extendedCoverBuyBy": "2026-03-01",
		"brandWarrantyStatus": "EXPIRED",
		"brandWarrantyStart": "2026-01-01",
		"brandWarrantyEnd": "2026-12-31",
		"brandCheckedAt": "2026-12-31",
		"brandLookupUrl": "https://example.com/warranty-check",
		"warrantyMonths": 12,
		"warrantyProvider": "Apple",
		"warrantyAddress": "12 Nguyen Hue",
		"warrantyPhone": "0900000000",
		"warrantyNotes": "Gói bảo hành mở rộng"
	}`
}

// TestDeviceCreateAcceptsEveryDocumentedFieldAndLinksWishlist walks the full
// DeviceCreateInput shape and then proves the create-only field did its job.
func TestDeviceCreateAcceptsEveryDocumentedFieldAndLinksWishlist(t *testing.T) {
	env := setupDeviceInputEnv(t)
	wishlistID := mustCreateWishlistItem(t, env, "Muốn mua iPhone")

	rr := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "vi",
		deviceCreateFullFieldSet(wishlistID))
	if rr.Code != http.StatusCreated {
		t.Fatalf("create with the full documented DeviceCreateInput = %d, want 201 (%s)",
			rr.Code, rr.Body.String())
	}

	var created struct {
		Device struct {
			ID                  string  `json:"id"`
			Name                string  `json:"name"`
			Currency            string  `json:"currency"`
			FxRate              *int32  `json:"fxRate"`
			ReturnWindowDays    *int32  `json:"returnWindowDays"`
			ReceivedAt          *string `json:"receivedAt"`
			LeadDays            []int32 `json:"leadDays"`
			BrandWarrantyStatus *string `json:"brandWarrantyStatus"`
		} `json:"device"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &created); err != nil || created.Device.ID == "" {
		t.Fatalf("decode created device: %v (%s)", err, rr.Body.String())
	}
	d := created.Device
	if d.Name != "iPhone 17 Pro" || d.Currency != "USD" ||
		d.FxRate == nil || *d.FxRate != 26000 ||
		d.ReturnWindowDays == nil || *d.ReturnWindowDays != 30 ||
		d.ReceivedAt == nil || *d.ReceivedAt != "2026-01-20" ||
		len(d.LeadDays) != 2 || d.LeadDays[0] != 30 || d.LeadDays[1] != 7 ||
		d.BrandWarrantyStatus == nil || *d.BrandWarrantyStatus != "ACTIVE" {
		t.Fatalf("created device does not round-trip the documented fields: %+v", d)
	}

	// The wishlist item is the other half of the POST contract: one transaction,
	// so the device and the PURCHASED status cannot disagree.
	rr = env.do(t, http.MethodGet, "/api/v1/wishlist/"+wishlistID+"?lang=vi", "vi", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("get wishlist item = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	var linked struct {
		Item struct {
			Status            string  `json:"status"`
			PurchasedDeviceID *string `json:"purchasedDeviceId"`
		} `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &linked); err != nil {
		t.Fatalf("decode wishlist item: %v (%s)", err, rr.Body.String())
	}
	if linked.Item.Status != "PURCHASED" {
		t.Errorf("wishlist status = %q, want PURCHASED", linked.Item.Status)
	}
	if linked.Item.PurchasedDeviceID == nil || *linked.Item.PurchasedDeviceID != d.ID {
		t.Errorf("wishlist purchasedDeviceId = %v, want the created device %s",
			linked.Item.PurchasedDeviceID, d.ID)
	}
}

// TestDeviceCreateAcceptsNullFromWishlistID pins the exact payload the website
// sends on every create: the key is present, with JSON null.
func TestDeviceCreateAcceptsNullFromWishlistID(t *testing.T) {
	env := setupDeviceInputEnv(t)
	rr := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "vi",
		`{"name":"Null Wishlist Device","category":"PHONE","purchaseDate":"2026-01-15","fromWishlistId":null}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("create with fromWishlistId:null = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
}

// TestDeviceCreateRejectsNonStringFromWishlistID pins the type of the one
// create-only field. The old loose-map decode silently ignored a non-string
// value: the device was created and the wishlist item was quietly not marked,
// which looked like success. The schema says string|null, so anything else is a
// 400 like every other malformed field.
func TestDeviceCreateRejectsNonStringFromWishlistID(t *testing.T) {
	env := setupDeviceInputEnv(t)
	rr := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "vi",
		`{"name":"Bad Wishlist Type Device","category":"PHONE","purchaseDate":"2026-01-15","fromWishlistId":123}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("create with numeric fromWishlistId = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if got := decodeResponse(t, rr)["error"]; got != "bad_input" {
		t.Errorf("create with numeric fromWishlistId: error = %v, want bad_input", got)
	}
}

// TestDeviceCreateRejectsUndocumentedField is the behaviour change that makes
// POST honest: it used to decode a loose map and silently drop anything the
// schema did not name. Read-only response fields must be a 400 now.
func TestDeviceCreateRejectsUndocumentedField(t *testing.T) {
	env := setupDeviceInputEnv(t)
	for _, extra := range []string{
		`"warrantyMismatch": null`,
		`"purchasePriceVnd": 123`,
		`"effectiveWarrantyEnd": null`,
	} {
		body := `{"name":"Undocumented Field Device","category":"PHONE","purchaseDate":"2026-01-15",` + extra + `}`
		rr := env.do(t, http.MethodPost, "/api/v1/devices?lang=vi", "vi", body)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("POST with undocumented %s = %d, want 400 (%s)", extra, rr.Code, rr.Body.String())
			continue
		}
		if got := decodeResponse(t, rr)["error"]; got != "bad_input" {
			t.Errorf("POST with undocumented %s: error = %v, want bad_input", extra, got)
		}
	}
}

// TestDevicePatchRejectsFromWishlistID pins the other half of the split: the
// field the docs used to advertise on PATCH is now explicitly not part of the
// update schema, and the strict decoder says so. A PATCH that omits it still
// works — that is the body every existing client sends.
func TestDevicePatchRejectsFromWishlistID(t *testing.T) {
	env := setupDeviceInputEnv(t)
	deviceID := mustCreateDeviceInput(t, env, "Patch Wishlist Field Device")
	wishlistID := mustCreateWishlistItem(t, env, "Không được đánh dấu từ PATCH")

	rr := env.do(t, http.MethodPatch, "/api/v1/devices/"+deviceID+"?lang=vi", "vi",
		fmt.Sprintf(`{"name":"Renamed","category":"PHONE","purchaseDate":"2026-01-15","fromWishlistId":%q}`, wishlistID))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("PATCH with fromWishlistId = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if got := decodeResponse(t, rr)["error"]; got != "bad_input" {
		t.Errorf("PATCH with fromWishlistId: error = %v, want bad_input", got)
	}

	// The documented update body (no fromWishlistId) is accepted.
	rr = env.do(t, http.MethodPatch, "/api/v1/devices/"+deviceID+"?lang=vi", "vi",
		`{"name":"Renamed","category":"PHONE","purchaseDate":"2026-01-15"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH without fromWishlistId = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}

	// And the rejected PATCH above really did nothing: the wishlist item is
	// still WATCHING, because there was no device creation to link it to.
	rr = env.do(t, http.MethodGet, "/api/v1/wishlist/"+wishlistID+"?lang=vi", "vi", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("get wishlist item = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	var item struct {
		Item struct {
			Status string `json:"status"`
		} `json:"item"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &item); err != nil {
		t.Fatalf("decode wishlist item: %v (%s)", err, rr.Body.String())
	}
	if item.Item.Status != "WATCHING" {
		t.Errorf("wishlist status after rejected PATCH = %q, want WATCHING", item.Item.Status)
	}
}

// TestDevicePatchAcceptsEveryDocumentedField walks the full DeviceUpdateInput
// shape. A field the schema lists but the struct lacks is a 400 here — the
// class of bug this file exists for.
func TestDevicePatchAcceptsEveryDocumentedField(t *testing.T) {
	env := setupDeviceInputEnv(t)
	deviceID := mustCreateDeviceInput(t, env, "Patch Full Field Set Device")

	rr := env.do(t, http.MethodPatch, "/api/v1/devices/"+deviceID+"?lang=vi", "vi",
		deviceUpdateFullFieldSet())
	if rr.Code != http.StatusOK {
		t.Fatalf("PATCH with the full documented DeviceUpdateInput = %d, want 200 (%s)",
			rr.Code, rr.Body.String())
	}

	var updated struct {
		Device struct {
			ID                  string  `json:"id"`
			Name                string  `json:"name"`
			Currency            string  `json:"currency"`
			FxRate              *int32  `json:"fxRate"`
			ReturnWindowDays    *int32  `json:"returnWindowDays"`
			ReceivedAt          *string `json:"receivedAt"`
			LeadDays            []int32 `json:"leadDays"`
			BrandWarrantyStatus *string `json:"brandWarrantyStatus"`
			SoldAt              *string `json:"soldAt"`
			SoldPrice           *int32  `json:"soldPrice"`
		} `json:"device"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode updated device: %v (%s)", err, rr.Body.String())
	}
	d := updated.Device
	if d.ID != deviceID || d.Name != "iPhone 17 Pro Max" || d.Currency != "USD" ||
		d.FxRate == nil || *d.FxRate != 26000 ||
		d.ReturnWindowDays == nil || *d.ReturnWindowDays != 14 ||
		d.ReceivedAt == nil || *d.ReceivedAt != "2026-01-20" ||
		len(d.LeadDays) != 2 || d.LeadDays[0] != 14 || d.LeadDays[1] != 3 ||
		d.BrandWarrantyStatus == nil || *d.BrandWarrantyStatus != "EXPIRED" ||
		d.SoldAt == nil || *d.SoldAt != "2026-06-01" ||
		d.SoldPrice == nil || *d.SoldPrice != 600 {
		t.Fatalf("updated device does not round-trip the documented fields: %+v", d)
	}
}
