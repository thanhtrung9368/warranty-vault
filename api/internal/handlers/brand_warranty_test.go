package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// HTTP-level proof for brand warranty lookup (gap #11, migration 0023).
//
// The service tests prove the arithmetic and the storage rules; this file proves
// the wire contract the three clients bind to:
//
//   - the five fields are accepted on POST/PATCH and returned on every read;
//   - warrantyMismatch is a computed object on the device payload, not a column;
//   - each validation rule surfaces as 400 + fieldErrors.<field>;
//   - a request that never mentions the feature gets the pre-0023 device;
//   - GET /api/v1/brands/{brandId}/service-info answers for a known brand, null
//     for a known brand with no directory row, and 404 for an unknown brand;
//   - the catalog and the device service-directory carry warrantyLookupUrl.
//
// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres; every test
// gets its own database via testDatabaseURL.

type brandWarrantyEnv struct {
	mux   *http.ServeMux
	token string
}

func setupBrandWarrantyEnv(t *testing.T) *brandWarrantyEnv {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect scratch: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	const userID = "zz_test_brand_http_user"
	insertUser(t, pool, userID, "brand-http@example.invalid", hash)
	deleteUsers(t, pool, userID)

	issued, err := auth.IssueToken(context.Background(), pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	mux := http.NewServeMux()
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	RegisterDevices(mux, deps)
	RegisterBrands(mux, deps)
	RegisterCatalog(mux, deps)
	RegisterDirectory(mux, deps)
	RegisterSearch(mux, deps)
	return &brandWarrantyEnv{mux: mux, token: issued.AccessToken}
}

func (e *brandWarrantyEnv) do(t *testing.T, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, reader)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+e.token)
	rr := httptest.NewRecorder()
	i18n.Middleware(e.mux).ServeHTTP(rr, req)
	return rr
}

// brandDeviceDTO is the subset of the device payload this feature adds. The
// helpers above intentionally decode only what the test asserts, so a future
// additive field cannot break these tests for the wrong reason.
type brandDeviceDTO struct {
	ID                  string  `json:"id"`
	Name                string  `json:"name"`
	BrandWarrantyStatus *string `json:"brandWarrantyStatus"`
	BrandWarrantyStart  *string `json:"brandWarrantyStart"`
	BrandWarrantyEnd    *string `json:"brandWarrantyEnd"`
	BrandCheckedAt      *string `json:"brandCheckedAt"`
	BrandLookupUrl      *string `json:"brandLookupUrl"`
	WarrantyMismatch    *struct {
		Kind         string `json:"kind"`
		Days         int    `json:"days"`
		BrandDate    string `json:"brandDate"`
		PurchaseDate string `json:"purchaseDate"`
	} `json:"warrantyMismatch"`
}

type brandDeviceEnvelope struct {
	Device brandDeviceDTO `json:"device"`
}

func decodeBrandDevice(t *testing.T, rr *httptest.ResponseRecorder) brandDeviceDTO {
	t.Helper()
	var out brandDeviceEnvelope
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode device envelope %q: %v", rr.Body.String(), err)
	}
	return out.Device
}

type brandServiceInfoDTO struct {
	BrandID           string  `json:"brandId"`
	Name              string  `json:"name"`
	ServiceLocatorURL *string `json:"serviceLocatorUrl"`
	SupportURL        *string `json:"supportUrl"`
	WarrantyLookupURL *string `json:"warrantyLookupUrl"`
	Notes             *string `json:"notes"`
}

// ─── the brand service-info endpoint ───────────────────────────────────────

func TestBrandServiceInfoEndpoint(t *testing.T) {
	env := setupBrandWarrantyEnv(t)

	t.Run("verified brand returns the lookup URL", func(t *testing.T) {
		rr := env.do(t, http.MethodGet, "/api/v1/brands/apple/service-info", "")
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
		}
		var out struct {
			ServiceInfo *brandServiceInfoDTO `json:"serviceInfo"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if out.ServiceInfo == nil {
			t.Fatal("serviceInfo = null, want Apple's directory row")
		}
		si := out.ServiceInfo
		if si.BrandID != "apple" || si.Name != "Apple" {
			t.Errorf("serviceInfo = %+v, want brandId apple / name Apple", si)
		}
		if si.WarrantyLookupURL == nil || *si.WarrantyLookupURL != "https://checkcoverage.apple.com/" {
			t.Errorf("warrantyLookupUrl = %v, want Apple's coverage checker", si.WarrantyLookupURL)
		}
		if si.ServiceLocatorURL == nil {
			t.Error("serviceLocatorUrl = null; the existing field must keep working")
		}
	})

	t.Run("known brand without a directory row answers null, not 404", func(t *testing.T) {
		rr := env.do(t, http.MethodGet, "/api/v1/brands/honor/service-info", "")
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d (%s), want 200 with serviceInfo:null", rr.Code, rr.Body.String())
		}
		var out struct {
			ServiceInfo json.RawMessage `json:"serviceInfo"`
		}
		if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if string(out.ServiceInfo) != "null" {
			t.Errorf("serviceInfo = %s, want null for a brand with no directory row", out.ServiceInfo)
		}
	})

	t.Run("unknown brand is 404", func(t *testing.T) {
		rr := env.do(t, http.MethodGet, "/api/v1/brands/not-a-brand/service-info", "")
		if rr.Code != http.StatusNotFound {
			t.Fatalf("status = %d (%s), want 404", rr.Code, rr.Body.String())
		}
	})

	t.Run("unauthenticated is 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/brands/apple/service-info", nil)
		rr := httptest.NewRecorder()
		i18n.Middleware(env.mux).ServeHTTP(rr, req)
		if rr.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d, want 401", rr.Code)
		}
	})
}

func TestCatalogCarriesWarrantyLookupURL(t *testing.T) {
	env := setupBrandWarrantyEnv(t)
	rr := env.do(t, http.MethodGet, "/api/v1/catalog", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("catalog = %d (%s)", rr.Code, rr.Body.String())
	}
	var cat struct {
		BrandServiceInfo []brandServiceInfoDTO `json:"brandServiceInfo"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &cat); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	byID := map[string]brandServiceInfoDTO{}
	for _, row := range cat.BrandServiceInfo {
		byID[row.BrandID] = row
	}
	for _, want := range []string{"apple", "samsung", "asus", "lenovo"} {
		row, ok := byID[want]
		if !ok {
			t.Fatalf("catalog is missing the %s directory row", want)
		}
		if row.WarrantyLookupURL == nil || *row.WarrantyLookupURL == "" {
			t.Errorf("%s warrantyLookupUrl = null, want a verified URL", want)
		}
		if row.Name == "" {
			t.Errorf("%s has no name; the single-brand endpoint's schema requires it", want)
		}
	}
	// A brand that could not be verified must stay NULL: the repo's rule is that
	// a guessed URL is worse than no URL.
	if row, ok := byID["xiaomi"]; !ok {
		t.Fatal("catalog is missing the xiaomi directory row")
	} else if row.WarrantyLookupURL != nil {
		t.Errorf("xiaomi warrantyLookupUrl = %q, want null (no verifiable official lookup page)", *row.WarrantyLookupURL)
	}
}

func TestServiceDirectoryCarriesWarrantyLookupURL(t *testing.T) {
	env := setupBrandWarrantyEnv(t)

	create := env.do(t, http.MethodPost, "/api/v1/devices", `{
		"name":"iPhone của tôi","category":"PHONE","brand":"Apple",
		"purchaseDate":"2025-06-01","purchasePrice":20000000
	}`)
	if create.Code != http.StatusCreated {
		t.Fatalf("create = %d (%s)", create.Code, create.Body.String())
	}
	device := decodeBrandDevice(t, create)

	rr := env.do(t, http.MethodGet, "/api/v1/devices/"+device.ID+"/service-directory", "")
	if rr.Code != http.StatusOK {
		t.Fatalf("directory = %d (%s)", rr.Code, rr.Body.String())
	}
	var out struct {
		Directory struct {
			Brand *struct {
				BrandID           string  `json:"brandId"`
				WarrantyLookupURL *string `json:"warrantyLookupUrl"`
			} `json:"brand"`
		} `json:"directory"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode directory: %v", err)
	}
	if out.Directory.Brand == nil || out.Directory.Brand.BrandID != "apple" {
		t.Fatalf("directory.brand = %+v, want Apple", out.Directory.Brand)
	}
	if out.Directory.Brand.WarrantyLookupURL == nil ||
		*out.Directory.Brand.WarrantyLookupURL != "https://checkcoverage.apple.com/" {
		t.Errorf("directory.brand.warrantyLookupUrl = %v", out.Directory.Brand.WarrantyLookupURL)
	}
}

// ─── device create / read / update over HTTP ───────────────────────────────

func TestBrandWarrantyDeviceOverHTTP(t *testing.T) {
	env := setupBrandWarrantyEnv(t)

	t.Run("a pre-0023 create is unchanged", func(t *testing.T) {
		rr := env.do(t, http.MethodPost, "/api/v1/devices", `{
			"name":"Máy cũ","category":"PHONE",
			"purchaseDate":"2025-06-01","purchasePrice":1000
		}`)
		if rr.Code != http.StatusCreated {
			t.Fatalf("create = %d (%s)", rr.Code, rr.Body.String())
		}
		d := decodeBrandDevice(t, rr)
		if d.BrandWarrantyStatus != nil || d.BrandWarrantyStart != nil || d.BrandWarrantyEnd != nil ||
			d.BrandCheckedAt != nil || d.BrandLookupUrl != nil {
			t.Errorf("pre-0023 create returned brand data: %+v", d)
		}
		if d.WarrantyMismatch != nil {
			t.Errorf("pre-0023 create returned a mismatch: %+v", d.WarrantyMismatch)
		}
	})

	t.Run("status without dates is accepted, with no mismatch", func(t *testing.T) {
		rr := env.do(t, http.MethodPost, "/api/v1/devices", `{
			"name":"Máy chưa đăng ký","category":"PHONE",
			"purchaseDate":"2025-06-01","purchasePrice":1000,
			"brandWarrantyStatus":"NOT_REGISTERED"
		}`)
		if rr.Code != http.StatusCreated {
			t.Fatalf("create = %d (%s)", rr.Code, rr.Body.String())
		}
		d := decodeBrandDevice(t, rr)
		if d.BrandWarrantyStatus == nil || *d.BrandWarrantyStatus != "NOT_REGISTERED" {
			t.Errorf("status = %v, want NOT_REGISTERED", d.BrandWarrantyStatus)
		}
		if d.WarrantyMismatch != nil {
			t.Errorf("mismatch = %+v, want nil for a status without dates", d.WarrantyMismatch)
		}
	})

	t.Run("the full group is accepted and the mismatch is computed on every read", func(t *testing.T) {
		rr := env.do(t, http.MethodPost, "/api/v1/devices", `{
			"name":"iPhone tra hãng","category":"PHONE","brand":"Apple",
			"purchaseDate":"2025-06-01","purchasePrice":20000000,
			"warrantyMonths":12,
			"brandWarrantyStatus":"PRE_ACTIVATED",
			"brandWarrantyStart":"2025-03-01",
			"brandWarrantyEnd":"2025-12-01",
			"brandCheckedAt":"2025-06-02T10:00:00Z",
			"brandLookupUrl":"https://checkcoverage.apple.com/"
		}`)
		if rr.Code != http.StatusCreated {
			t.Fatalf("create = %d (%s)", rr.Code, rr.Body.String())
		}
		created := decodeBrandDevice(t, rr)
		if created.BrandWarrantyStatus == nil || *created.BrandWarrantyStatus != "PRE_ACTIVATED" ||
			created.BrandWarrantyStart == nil || created.BrandWarrantyEnd == nil ||
			created.BrandCheckedAt == nil ||
			created.BrandLookupUrl == nil || *created.BrandLookupUrl != "https://checkcoverage.apple.com/" {
			t.Fatalf("created device lost brand fields: %+v", created)
		}
		if created.WarrantyMismatch == nil || created.WarrantyMismatch.Kind != "ENDED_EARLIER" {
			t.Fatalf("create mismatch = %+v, want ENDED_EARLIER", created.WarrantyMismatch)
		}
		if created.WarrantyMismatch.Days != 182 {
			t.Errorf("create mismatch days = %d, want 182", created.WarrantyMismatch.Days)
		}

		detail := env.do(t, http.MethodGet, "/api/v1/devices/"+created.ID, "")
		if detail.Code != http.StatusOK {
			t.Fatalf("detail = %d (%s)", detail.Code, detail.Body.String())
		}
		d := decodeBrandDevice(t, detail)
		if d.WarrantyMismatch == nil || d.WarrantyMismatch.Kind != "ENDED_EARLIER" {
			t.Errorf("detail mismatch = %+v, want ENDED_EARLIER", d.WarrantyMismatch)
		}

		list := env.do(t, http.MethodGet, "/api/v1/devices", "")
		if list.Code != http.StatusOK {
			t.Fatalf("list = %d (%s)", list.Code, list.Body.String())
		}
		var listOut struct {
			Devices []brandDeviceDTO `json:"devices"`
		}
		if err := json.Unmarshal(list.Body.Bytes(), &listOut); err != nil {
			t.Fatalf("decode list: %v", err)
		}
		found := false
		for _, row := range listOut.Devices {
			if row.ID == created.ID {
				found = true
				if row.WarrantyMismatch == nil || row.WarrantyMismatch.Kind != "ENDED_EARLIER" {
					t.Errorf("list mismatch = %+v, want ENDED_EARLIER", row.WarrantyMismatch)
				}
			}
		}
		if !found {
			t.Fatal("created device is missing from the list")
		}

		search := env.do(t, http.MethodGet, "/api/v1/search?q=iPhone+tra", "")
		if search.Code != http.StatusOK {
			t.Fatalf("search = %d (%s)", search.Code, search.Body.String())
		}
		var searchOut struct {
			Devices []brandDeviceDTO `json:"devices"`
		}
		if err := json.Unmarshal(search.Body.Bytes(), &searchOut); err != nil {
			t.Fatalf("decode search: %v", err)
		}
		if len(searchOut.Devices) != 1 {
			t.Fatalf("search returned %d devices, want 1", len(searchOut.Devices))
		}
		if searchOut.Devices[0].WarrantyMismatch == nil ||
			searchOut.Devices[0].WarrantyMismatch.Kind != "ENDED_EARLIER" {
			t.Errorf("search mismatch = %+v, want ENDED_EARLIER", searchOut.Devices[0].WarrantyMismatch)
		}

		// PATCH with status only is the full-replacement clear path.
		patch := env.do(t, http.MethodPatch, "/api/v1/devices/"+created.ID, `{
			"name":"iPhone tra hãng","category":"PHONE","brand":"Apple",
			"purchaseDate":"2025-06-01","purchasePrice":20000000,
			"warrantyMonths":12,
			"brandWarrantyStatus":"NOT_REGISTERED"
		}`)
		if patch.Code != http.StatusOK {
			t.Fatalf("patch = %d (%s)", patch.Code, patch.Body.String())
		}
		patched := decodeBrandDevice(t, patch)
		if patched.BrandWarrantyStatus == nil || *patched.BrandWarrantyStatus != "NOT_REGISTERED" {
			t.Errorf("patched status = %v", patched.BrandWarrantyStatus)
		}
		if patched.BrandWarrantyStart != nil || patched.BrandWarrantyEnd != nil ||
			patched.BrandCheckedAt != nil || patched.BrandLookupUrl != nil {
			t.Errorf("patch did not clear the dates/url: %+v", patched)
		}
		if patched.WarrantyMismatch != nil {
			t.Errorf("patched mismatch = %+v, want nil", patched.WarrantyMismatch)
		}
	})
}

func TestBrandWarrantyValidationOverHTTP(t *testing.T) {
	env := setupBrandWarrantyEnv(t)
	base := `"name":"Máy","category":"PHONE","purchaseDate":"2025-06-01","purchasePrice":1000`

	cases := []struct {
		name  string
		field string
		body  string
	}{
		{
			name:  "date without status",
			field: "brandWarrantyStatus",
			body:  `{` + base + `,"brandWarrantyStart":"2025-01-01"}`,
		},
		{
			name:  "invalid status",
			field: "brandWarrantyStatus",
			body:  `{` + base + `,"brandWarrantyStatus":"active"}`,
		},
		{
			name:  "invalid start date",
			field: "brandWarrantyStart",
			body:  `{` + base + `,"brandWarrantyStatus":"ACTIVE","brandWarrantyStart":"01/01/2025"}`,
		},
		{
			name:  "end before start",
			field: "brandWarrantyEnd",
			body:  `{` + base + `,"brandWarrantyStatus":"ACTIVE","brandWarrantyStart":"2025-03-01","brandWarrantyEnd":"2025-02-01"}`,
		},
		{
			name:  "relative lookup URL",
			field: "brandLookupUrl",
			body:  `{` + base + `,"brandWarrantyStatus":"ACTIVE","brandLookupUrl":"/warranty"}`,
		},
		{
			name:  "ftp lookup URL",
			field: "brandLookupUrl",
			body:  `{` + base + `,"brandWarrantyStatus":"ACTIVE","brandLookupUrl":"ftp://example.com/warranty"}`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rr := env.do(t, http.MethodPost, "/api/v1/devices", tc.body)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d (%s), want 400", rr.Code, rr.Body.String())
			}
			body := decodeResponse(t, rr)
			if code, _ := body["error"].(string); code != "validation" {
				t.Errorf("error = %q, want validation", code)
			}
			if msg := firstFieldError(t, body, tc.field); msg == "" {
				t.Errorf("fieldErrors.%s is empty: %s", tc.field, rr.Body.String())
			}
		})
	}
}
