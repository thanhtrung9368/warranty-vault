package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// FEATURE_IDEAS #15 — danh bạ bảo hành: "giờ tôi mang máy đi đâu".
//
// The point of these tests is the HONESTY of the answer, not its size: what the
// app knows (a brand's own locator URL, seeded by migration 0012), what the user
// recorded (Warranty.address / .phone, with phoneSource), and what the app does
// NOT know (null + Input echoed back) must stay three distinguishable things.

const dirTestUser = "zz_test_dir_user"
const dirOtherUser = "zz_test_dir_other"

func setupDirectoryTest(t *testing.T) (*pgxpool.Pool, *http.ServeMux, string) {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	insertUser(t, pool, dirTestUser, "dir@example.invalid", hash)
	insertUser(t, pool, dirOtherUser, "dir-other@example.invalid", hash)
	deleteUsers(t, pool, dirTestUser, dirOtherUser)

	issued, err := auth.IssueToken(ctx, pool, dirTestUser, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	// The catalog cache is process-wide with a 60s TTL. Every scratch database is
	// seeded by the same migrations, so this is belt-and-braces — but a stale entry
	// from another test must never decide what this test sees.
	services.InvalidateCatalogCache()
	mux := http.NewServeMux()
	RegisterDirectory(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	RegisterCatalog(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	return pool, mux, issued.AccessToken
}

// seedDeviceWithWarranty inserts one device plus one warranty package.
func seedDeviceWithWarranty(t *testing.T, pool *pgxpool.Pool, userID, deviceID, name, brand string, w warrantySeed) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, brand, "purchaseDate", "purchasePrice", status, "updatedAt")
		 VALUES ($1, $2, $3, 'PHONE', $4, '2025-03-01', 20000000, 'ACTIVE', NOW())`,
		deviceID, userID, name, nullable(brand)); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Warranty" (id, "deviceId", type, provider, "startDate", "endDate", months, cost, address, phone, "updatedAt")
		 VALUES ($1, $2, 'STANDARD', $3, '2025-03-01', '2027-03-01', 24, 1500000, $4, $5, NOW())`,
		deviceID+"_w", deviceID, nullable(w.provider), nullable(w.address), nullable(w.phone)); err != nil {
		t.Fatalf("insert warranty: %v", err)
	}
}

type warrantySeed struct{ provider, address, phone string }

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// getDirectory fetches the directory bundle for one device.
//
// PINNED to Vietnamese: the disclaimer and the not-found headline now travel
// through the catalog, and the assertion-heavy tests below read the VIETNAMESE
// source sentence (`services.DirectoryDisclaimer`). Pinning the language here
// keeps those assertions independent of the machine's default locale — the rule
// docs/I18N_PLAN.md §4.3 lays down. Both languages are asserted deliberately in
// directory_i18n_test.go.
func getDirectory(t *testing.T, mux *http.ServeMux, token, deviceID string) (*httptest.ResponseRecorder, services.ServiceDirectory) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/devices/"+deviceID+"/service-directory?lang=vi", nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	var body struct {
		Directory services.ServiceDirectory `json:"directory"`
	}
	if rr.Code == http.StatusOK {
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode directory %q: %v", rr.Body.String(), err)
		}
	}
	return rr, body.Directory
}

func TestDirectorySurfacesWhatTheAppKnowsAndWhatTheUserRecorded(t *testing.T) {
	pool, mux, token := setupDirectoryTest(t)
	seedDeviceWithWarranty(t, pool, dirTestUser, "dir_dev_1", "Samsung Galaxy S24",
		"Điện thoại Samsung", warrantySeed{
			provider: "Trung tâm bảo hành Samsung",
			address:  "186 Nguyễn Thị Minh Khai, Q.1",
			phone:    "028 3822 1234",
		})

	rr, dir := getDirectory(t, mux, token, "dir_dev_1")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
	}

	// 1. The brand's OWN locator URL, copied from migration 0008 into 0012.
	if dir.Brand == nil {
		t.Fatalf("brand did not resolve for %q", "Điện thoại Samsung")
	}
	if dir.Brand.BrandID != "samsung" || dir.Brand.Name != "Samsung" {
		t.Errorf("brand = %+v, want Samsung", dir.Brand)
	}
	if dir.Brand.ServiceLocatorURL == nil || *dir.Brand.ServiceLocatorURL != "https://www.samsung.com/vn/support/service-center/" {
		t.Errorf("serviceLocatorUrl = %v", dir.Brand.ServiceLocatorURL)
	}
	if dir.BrandInput == nil || *dir.BrandInput != "Điện thoại Samsung" {
		t.Errorf("brandInput = %v, want the user's own text", dir.BrandInput)
	}

	// 2. The user's own recorded centre, with an explicit source.
	if len(dir.Centres) != 1 {
		t.Fatalf("centres = %d, want 1", len(dir.Centres))
	}
	c := dir.Centres[0]
	if c.Provider == nil || c.Provider.ID != "samsung-service" {
		t.Errorf("provider = %+v, want the samsung-service catalog row", c.Provider)
	}
	if c.PhoneSource != "user" || c.Phone == nil || *c.Phone != "028 3822 1234" {
		t.Errorf("phone = %v (source %q), want the user's number marked as theirs", c.Phone, c.PhoneSource)
	}
	if c.Address == nil || *c.Address != "186 Nguyễn Thị Minh Khai, Q.1" {
		t.Errorf("address = %v, want the user's address", c.Address)
	}
	if !c.IsActive {
		t.Error("a package ending in 2027 must be active")
	}

	// 3. The app never claims to have a hotline of its own: the seeded provider row
	//    has phone/address NULL, and the response says so rather than inventing one.
	if c.Provider.Phone != nil || c.Provider.Address != nil {
		t.Errorf("catalog provider phone/address = %v/%v, want NULL (migration 0008)",
			c.Provider.Phone, c.Provider.Address)
	}
	if dir.Disclaimer == "" || dir.Disclaimer != services.DirectoryDisclaimer {
		t.Errorf("disclaimer = %q, want the constant", dir.Disclaimer)
	}
}

func TestDirectoryAdmitsWhatItDoesNotKnow(t *testing.T) {
	pool, mux, token := setupDirectoryTest(t)
	// A brand that is not in the directory at all, and a provider typed by hand.
	seedDeviceWithWarranty(t, pool, dirTestUser, "dir_dev_unknown", "Máy lạ",
		"Hãng Không Có Trong Danh Bạ", warrantySeed{provider: "Thợ quen ở nhà"})

	rr, dir := getDirectory(t, mux, token, "dir_dev_unknown")
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
	}
	if dir.Brand != nil {
		t.Fatalf("brand = %+v, want null for a brand the app has no row for", dir.Brand)
	}
	if dir.BrandInput == nil || *dir.BrandInput != "Hãng Không Có Trong Danh Bạ" {
		t.Errorf("brandInput = %v — the user's text must still be echoed", dir.BrandInput)
	}
	if len(dir.Centres) != 1 || dir.Centres[0].Provider != nil {
		t.Fatalf("centres = %+v, want one centre with provider null", dir.Centres)
	}
	if dir.Centres[0].ProviderInput == nil || *dir.Centres[0].ProviderInput != "Thợ quen ở nhà" {
		t.Errorf("providerInput = %v, want the user's own text", dir.Centres[0].ProviderInput)
	}
	if dir.Centres[0].PhoneSource != "none" || dir.Centres[0].Phone != nil {
		t.Errorf("phoneSource = %q, phone = %v; want none/null", dir.Centres[0].PhoneSource, dir.Centres[0].Phone)
	}
}

func TestDirectoryIsOwnerScopedAndAuthGated(t *testing.T) {
	pool, mux, token := setupDirectoryTest(t)
	// A device belonging to SOMEBODY ELSE, with a brand that would resolve.
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "Device" (id, "userId", name, category, brand, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ('dir_dev_other', $1, 'Máy người khác', 'PHONE', 'Apple', '2025-03-01', 1, NOW())`,
		dirOtherUser); err != nil {
		t.Fatalf("insert other device: %v", err)
	}

	rr, _ := getDirectory(t, mux, token, "dir_dev_other")
	if rr.Code != http.StatusNotFound {
		t.Fatalf("foreign device = %d, want 404 (%s)", rr.Code, rr.Body.String())
	}

	rr, _ = getDirectory(t, mux, "", "dir_dev_other")
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("no bearer = %d, want 401", rr.Code)
	}
}

func TestCatalogCarriesTheBrandDirectory(t *testing.T) {
	_, mux, token := setupDirectoryTest(t)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/catalog", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("catalog = %d (%s)", rr.Code, rr.Body.String())
	}
	var cat struct {
		BrandServiceInfo []services.BrandServiceInfoOption `json:"brandServiceInfo"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &cat); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	if len(cat.BrandServiceInfo) != 16 {
		t.Fatalf("brandServiceInfo = %d rows, want the 16 seeded by migration 0012", len(cat.BrandServiceInfo))
	}
	for _, row := range cat.BrandServiceInfo {
		if row.BrandID == "" {
			t.Error("a directory row has no brandId")
		}
		if row.ServiceLocatorURL == nil && row.SupportURL == nil {
			t.Errorf("directory row %q has neither URL — it would answer nothing", row.BrandID)
		}
	}
	// Every brandId must exist in the brands array, or a client cannot render it.
	var full struct {
		Brands           []services.BrandOption `json:"brands"`
		BrandServiceInfo []struct {
			BrandID string `json:"brandId"`
		} `json:"brandServiceInfo"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &full); err != nil {
		t.Fatalf("decode catalog (2): %v", err)
	}
	known := map[string]bool{}
	for _, b := range full.Brands {
		known[b.ID] = true
	}
	for _, row := range full.BrandServiceInfo {
		if !known[row.BrandID] {
			t.Errorf("directory row %q points at a brand that is not in the catalog", row.BrandID)
		}
	}
}
