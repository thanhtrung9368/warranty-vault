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
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// The manual write path must carry the same serial/IMEI advisories as the OCR
// draft (FEATURE_IDEAS #6) — and must still CREATE the device. A warning that
// turns into a 400 would be worse than the typo it prevents: a serial number is
// not always an IMEI.

type deviceWarningsBody struct {
	Device struct {
		ID           string  `json:"id"`
		SerialNumber *string `json:"serialNumber"`
	} `json:"device"`
	Warnings []services.Warning `json:"warnings"`
}

func setupDeviceWarningsTest(t *testing.T) (*pgxpool.Pool, *http.ServeMux, string) {
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
	const userID = "zz_test_devwarn_user"
	insertUser(t, pool, userID, "devwarn@example.invalid", hash)
	deleteUsers(t, pool, userID)

	issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}
	mux := http.NewServeMux()
	RegisterDevices(mux, Deps{DB: pool, Limiter: &permissiveLimiter{}})
	return pool, mux, issued.AccessToken
}

func postDevice(t *testing.T, mux *http.ServeMux, token, serial string) (*httptest.ResponseRecorder, deviceWarningsBody) {
	t.Helper()
	payload := map[string]any{
		"name":          "Điện thoại test",
		"category":      "PHONE",
		"purchaseDate":  "2026-01-15",
		"purchasePrice": 12000000,
		"serialNumber":  serial,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/devices", bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	var body deviceWarningsBody
	if rr.Code == http.StatusCreated {
		if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
			t.Fatalf("decode create response %q: %v", rr.Body.String(), err)
		}
	}
	return rr, body
}

func warningCodeSet(ws []services.Warning) map[string]bool {
	set := map[string]bool{}
	for _, w := range ws {
		set[w.Code] = true
		if w.Field != services.SerialField {
			// Asserted here as well so a new warning cannot silently point at the
			// wrong input field.
			set["__wrong_field__"] = true
		}
	}
	return set
}

func TestCreateDeviceSerialWarningsAreAdvisoryNotBlocking(t *testing.T) {
	pool, mux, token := setupDeviceWarningsTest(t)

	// 1. A Luhn-failing 15-digit IMEI is stored anyway, with a warning.
	rr, body := postDevice(t, mux, token, "356938035643808")
	if rr.Code != http.StatusCreated {
		t.Fatalf("create with a suspicious IMEI = %d, want 201 (a warning must not block): %s", rr.Code, rr.Body.String())
	}
	if body.Device.SerialNumber == nil || *body.Device.SerialNumber != "356938035643808" {
		t.Errorf("stored serial = %v, want the value the user typed", body.Device.SerialNumber)
	}
	if codes := warningCodeSet(body.Warnings); !codes[services.WarningIMEIChecksum] || codes["__wrong_field__"] {
		t.Errorf("warnings = %+v, want IMEI_CHECKSUM on %s", body.Warnings, services.SerialField)
	}

	// 2. The same serial on a second device → both advisories.
	rr2, body2 := postDevice(t, mux, token, "356938035643808")
	if rr2.Code != http.StatusCreated {
		t.Fatalf("second create = %d, want 201: %s", rr2.Code, rr2.Body.String())
	}
	codes := warningCodeSet(body2.Warnings)
	if !codes[services.WarningIMEIChecksum] || !codes[services.WarningSerialDuplicate] {
		t.Errorf("second create warnings = %+v, want IMEI_CHECKSUM + SERIAL_DUPLICATE", body2.Warnings)
	}

	// 3. Case-insensitive duplicate: the uppercase form of the same sticker.
	rr3, body3 := postDevice(t, mux, token, "ABC123XYZ")
	if rr3.Code != http.StatusCreated {
		t.Fatalf("alphanumeric create = %d, want 201: %s", rr3.Code, rr3.Body.String())
	}
	if len(body3.Warnings) != 0 {
		t.Errorf("alphanumeric serial warnings = %+v, want none (it is not an IMEI)", body3.Warnings)
	}
	_, body4 := postDevice(t, mux, token, "abc123xyz")
	if codes := warningCodeSet(body4.Warnings); !codes[services.WarningSerialDuplicate] || codes[services.WarningIMEIChecksum] {
		t.Errorf("lower-case duplicate warnings = %+v, want only SERIAL_DUPLICATE", body4.Warnings)
	}

	// 4. A valid IMEI on a new device → no advisories at all.
	_, body5 := postDevice(t, mux, token, "490154203237518")
	if len(body5.Warnings) != 0 {
		t.Errorf("valid IMEI warnings = %+v, want none", body5.Warnings)
	}

	// 5. Nothing was rejected: every device above exists.
	var count int
	if err := pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM "Device" WHERE "userId" = 'zz_test_devwarn_user'`).Scan(&count); err != nil {
		t.Fatalf("count devices: %v", err)
	}
	if count != 5 {
		t.Errorf("devices stored = %d, want 5 (advisories never block a save)", count)
	}
}

func TestUpdateDeviceSerialWarningExcludesItself(t *testing.T) {
	_, mux, token := setupDeviceWarningsTest(t)

	_, created := postDevice(t, mux, token, "356938035643809")
	deviceID := created.Device.ID
	if deviceID == "" {
		t.Fatal("create returned no device id")
	}

	patch := func(serial string) (*httptest.ResponseRecorder, deviceWarningsBody) {
		t.Helper()
		raw, _ := json.Marshal(map[string]any{
			"name":          "Điện thoại test",
			"category":      "PHONE",
			"purchaseDate":  "2026-01-15",
			"purchasePrice": 12000000,
			"serialNumber":  serial,
		})
		req := httptest.NewRequest(http.MethodPatch, "/api/v1/devices/"+deviceID, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		var body deviceWarningsBody
		if rr.Code == http.StatusOK {
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode patch response %q: %v", rr.Body.String(), err)
			}
		}
		return rr, body
	}

	// Re-saving the same serial must not report the device as its own duplicate.
	rr, body := patch("356938035643809")
	if rr.Code != http.StatusOK {
		t.Fatalf("patch = %d, want 200: %s", rr.Code, rr.Body.String())
	}
	if len(body.Warnings) != 0 {
		t.Errorf("warnings on a no-op update = %+v, want none (self-exclusion)", body.Warnings)
	}

	// Editing the serial to a suspicious one still warns.
	rr2, body2 := patch("356938035643808")
	if rr2.Code != http.StatusOK {
		t.Fatalf("patch (bad checksum) = %d, want 200: %s", rr2.Code, rr2.Body.String())
	}
	if codes := warningCodeSet(body2.Warnings); !codes[services.WarningIMEIChecksum] {
		t.Errorf("patch warnings = %+v, want IMEI_CHECKSUM", body2.Warnings)
	}
}
