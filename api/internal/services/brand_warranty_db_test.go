package services

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Real-Postgres proof for brand warranty lookup (gap #11, migration 0023).
//
// The three promises this file exists to defend:
//
//  1. A user who never records a brand lookup sees NO behavioural change. A
//     device created with the pre-0023 request shape stores five NULLs, reads
//     them back as null, and its backup payload contains none of the new keys
//     (the `omitempty` rule that also keeps VND-only payloads byte-identical).
//  2. The five fields travel through export/import, while warrantyMismatch does
//     NOT: it is computed on read and has no column, no payload key.
//  3. An older payload with none of the five keys imports unchanged as NULL.
//
// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres; the target
// for the import half is a brand-new database created by the test.

func brandWarrantyUser(t *testing.T, pool *pgxpool.Pool, id string) string {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, id, id+"@example.invalid"); err != nil {
		t.Fatalf("insert test user %s: %v", id, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, id)
	})
	return id
}

func readBrandWarrantyColumns(t *testing.T, pool *pgxpool.Pool, id string) (
	status *string, start, end, checked pgtype.Timestamp, lookupURL *string,
) {
	t.Helper()
	err := pool.QueryRow(context.Background(),
		`SELECT "brandWarrantyStatus", "brandWarrantyStart", "brandWarrantyEnd",
		        "brandCheckedAt", "brandLookupUrl"
		 FROM "Device" WHERE id = $1`, id).
		Scan(&status, &start, &end, &checked, &lookupURL)
	if err != nil {
		t.Fatalf("read brand columns for %s: %v", id, err)
	}
	return status, start, end, checked, lookupURL
}

func brandPayloadDevice(t *testing.T, payload *BackupExport, id string) *BackupDevice {
	t.Helper()
	for i := range payload.Devices {
		if payload.Devices[i].ID == id {
			return &payload.Devices[i]
		}
	}
	t.Fatalf("backup payload has no device %s", id)
	return nil
}

func brandPayloadJSONDevice(t *testing.T, raw []byte, id string) map[string]json.RawMessage {
	t.Helper()
	var generic struct {
		Devices []map[string]json.RawMessage `json:"devices"`
	}
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatalf("decode payload generically: %v", err)
	}
	for _, d := range generic.Devices {
		var gotID string
		if err := json.Unmarshal(d["id"], &gotID); err != nil {
			continue
		}
		if gotID == id {
			return d
		}
	}
	t.Fatalf("generic payload has no device %s", id)
	return nil
}

func TestBrandWarrantyAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	source, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(source.Close)

	const (
		userA = "zz_test_brand_warranty_a"
		userB = "zz_test_brand_warranty_b"
	)
	brandWarrantyUser(t, source, userA)

	// ── 0. The schema exists, and warrantyMismatch is NOT a column ─────────
	for _, col := range []string{
		"brandWarrantyStatus", "brandWarrantyStart", "brandWarrantyEnd",
		"brandCheckedAt", "brandLookupUrl",
	} {
		var n int
		if err := source.QueryRow(ctx,
			`SELECT count(*) FROM information_schema.columns
			 WHERE table_schema = 'public' AND table_name = 'Device' AND column_name = $1`,
			col).Scan(&n); err != nil {
			t.Fatalf("information_schema(%s): %v", col, err)
		}
		if n != 1 {
			t.Errorf("Device.%s column count = %d, want 1", col, n)
		}
	}
	var mismatchColumns int
	if err := source.QueryRow(ctx,
		`SELECT count(*) FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = 'Device' AND column_name = 'warrantyMismatch'`).
		Scan(&mismatchColumns); err != nil {
		t.Fatalf("information_schema(warrantyMismatch): %v", err)
	}
	if mismatchColumns != 0 {
		t.Errorf("Device has a warrantyMismatch column; it is DERIVED and must never be stored")
	}
	var serviceInfoColumn int
	if err := source.QueryRow(ctx,
		`SELECT count(*) FROM information_schema.columns
		 WHERE table_schema = 'public' AND table_name = 'BrandServiceInfo' AND column_name = 'warrantyLookupUrl'`).
		Scan(&serviceInfoColumn); err != nil {
		t.Fatalf("information_schema(BrandServiceInfo.warrantyLookupUrl): %v", err)
	}
	if serviceInfoColumn != 1 {
		t.Errorf("BrandServiceInfo.warrantyLookupUrl column count = %d, want 1", serviceInfoColumn)
	}

	// ── 1. A pre-0023 request shape is untouched ───────────────────────────
	plain, err := CreateDevice(ctx, source, userA, DeviceInput{
		Name:          "Máy chưa tra hãng",
		Category:      "PHONE",
		PurchaseDate:  "2025-06-01",
		PurchasePrice: 1000,
	}, "")
	if err != nil {
		t.Fatalf("create plain device: %v", err)
	}
	if plain.WarrantyMismatch != nil {
		t.Errorf("plain create mismatch = %+v, want nil", plain.WarrantyMismatch)
	}
	status, start, end, checked, lookupURL := readBrandWarrantyColumns(t, source, plain.ID)
	if status != nil || start.Valid || end.Valid || checked.Valid || lookupURL != nil {
		t.Errorf("plain row stored brand data: status=%v start=%v end=%v checked=%v url=%v",
			status, start, end, checked, lookupURL)
	}

	// The JSON read has all six keys (five + the computed mismatch) and every
	// one is null. Their PRESENCE is the contract; their null value is the
	// "never checked" answer. Nothing else on the device moved.
	plainRaw, err := json.Marshal(plain)
	if err != nil {
		t.Fatalf("marshal plain device: %v", err)
	}
	var plainMap map[string]json.RawMessage
	if err := json.Unmarshal(plainRaw, &plainMap); err != nil {
		t.Fatalf("decode plain device: %v", err)
	}
	for _, key := range []string{
		"brandWarrantyStatus", "brandWarrantyStart", "brandWarrantyEnd",
		"brandCheckedAt", "brandLookupUrl", "warrantyMismatch",
	} {
		got, ok := plainMap[key]
		if !ok {
			t.Errorf("plain device JSON is missing %q: %s", key, plainRaw)
			continue
		}
		if string(got) != "null" {
			t.Errorf("plain device %s = %s, want null", key, got)
		}
	}
	if string(plainMap["purchasePrice"]) != `1000` {
		t.Errorf("plain device purchasePrice = %s, want 1000 (existing fields unchanged)", plainMap["purchasePrice"])
	}
	// No pre-existing key disappeared or was renamed. This is the other half of
	// "no behavioural change": the response gained six additive keys, and nothing
	// else about it moved. soldPriceVnd is omitted for an unsold device by
	// design, so it is not in this list.
	for _, key := range []string{
		"id", "userId", "name", "category", "brand", "model", "serialNumber",
		"purchaseDate", "purchasePrice", "purchasePlace", "status", "notes",
		"createdAt", "updatedAt", "soldAt", "soldPrice", "returnWindowDays",
		"receivedAt", "returnWindowNotifiedAt", "leadDays", "activationRequired",
		"activatedAt", "extendedCoverBuyBy", "activationNotifiedAt",
		"extendedCoverNotifiedAt", "extendedCoverNotifiedLeadDay", "currency",
		"fxRate", "purchasePriceVnd",
	} {
		if _, ok := plainMap[key]; !ok {
			t.Errorf("plain device JSON lost the pre-existing key %q: %s", key, plainRaw)
		}
	}

	// A backup payload written by that user contains NONE of the five keys and
	// no mismatch: the old format, byte-for-byte.
	payload, err := ExportBackup(ctx, source, userA)
	if err != nil {
		t.Fatalf("export after plain create: %v", err)
	}
	plainBackup := brandPayloadDevice(t, payload, plain.ID)
	if plainBackup.BrandWarrantyStatus != nil || plainBackup.BrandWarrantyStart != nil ||
		plainBackup.BrandWarrantyEnd != nil || plainBackup.BrandCheckedAt != nil ||
		plainBackup.BrandLookupUrl != nil {
		t.Errorf("plain backup carried brand fields: %+v", plainBackup)
	}
	payloadRaw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	plainJSON := brandPayloadJSONDevice(t, payloadRaw, plain.ID)
	for _, key := range []string{
		"brandWarrantyStatus", "brandWarrantyStart", "brandWarrantyEnd",
		"brandCheckedAt", "brandLookupUrl", "warrantyMismatch",
	} {
		if _, ok := plainJSON[key]; ok {
			t.Errorf("backup JSON for a never-checked device contains %q — the pre-0023 payload shape must not change", key)
		}
	}

	// ── 2. A device with brand data stores it, and computes the mismatch ───
	brandDev, err := CreateDevice(ctx, source, userA, DeviceInput{
		Name:                "iPhone tra hãng",
		Category:            "PHONE",
		Brand:               strPtr("Apple"),
		PurchaseDate:        "2025-06-01",
		PurchasePrice:       20_000_000,
		WarrantyMonths:      12,
		BrandWarrantyStatus: strPtr(BrandWarrantyStatusPreActivated),
		BrandWarrantyStart:  strPtr("2025-03-01"),
		BrandWarrantyEnd:    strPtr("2025-12-01"),
		BrandCheckedAt:      strPtr("2025-06-02T10:00:00Z"),
		BrandLookupUrl:      strPtr("https://checkcoverage.apple.com/"),
	}, "")
	if err != nil {
		t.Fatalf("create brand device: %v", err)
	}
	if brandDev.WarrantyMismatch == nil || brandDev.WarrantyMismatch.Kind != WarrantyMismatchEndedEarlier {
		t.Fatalf("create mismatch = %+v, want ENDED_EARLIER", brandDev.WarrantyMismatch)
	}
	// The inline warranty ends 2026-06-01; the brand says 2025-12-01.
	if brandDev.WarrantyMismatch.Days != 182 || brandDev.WarrantyMismatch.PurchaseDate != "2026-06-01" {
		t.Errorf("create mismatch = %+v, want 182 days against 2026-06-01", brandDev.WarrantyMismatch)
	}

	status, start, end, checked, lookupURL = readBrandWarrantyColumns(t, source, brandDev.ID)
	if status == nil || *status != BrandWarrantyStatusPreActivated {
		t.Errorf("stored status = %v, want PRE_ACTIVATED", status)
	}
	if !start.Valid || start.Time.Format("2006-01-02") != "2025-03-01" ||
		!end.Valid || end.Time.Format("2006-01-02") != "2025-12-01" {
		t.Errorf("stored dates = %v / %v", start, end)
	}
	if !checked.Valid || checked.Time.Format(time.RFC3339) != "2025-06-02T10:00:00Z" {
		t.Errorf("stored checkedAt = %v", checked)
	}
	if lookupURL == nil || *lookupURL != "https://checkcoverage.apple.com/" {
		t.Errorf("stored lookup URL = %v", lookupURL)
	}

	// Every device read computes it: detail, list, search.
	detail, err := GetDevice(ctx, source, userA, brandDev.ID)
	if err != nil {
		t.Fatalf("get brand device: %v", err)
	}
	if detail.WarrantyMismatch == nil || detail.WarrantyMismatch.Kind != WarrantyMismatchEndedEarlier {
		t.Errorf("detail mismatch = %+v, want ENDED_EARLIER", detail.WarrantyMismatch)
	}
	if detail.BrandWarrantyStatus == nil || *detail.BrandWarrantyStatus != BrandWarrantyStatusPreActivated {
		t.Errorf("detail brand status = %v", detail.BrandWarrantyStatus)
	}

	list, err := ListDevices(ctx, source, userA, DeviceFilter{})
	if err != nil {
		t.Fatalf("list devices: %v", err)
	}
	for _, row := range list {
		if row.ID != brandDev.ID {
			continue
		}
		if row.WarrantyMismatch == nil || row.WarrantyMismatch.Kind != WarrantyMismatchEndedEarlier {
			t.Errorf("list mismatch = %+v, want ENDED_EARLIER", row.WarrantyMismatch)
		}
	}

	search, err := Search(ctx, source, userA, "iPhone tra", 20)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(search.Devices) != 1 {
		t.Fatalf("search returned %d devices, want 1: %+v", len(search.Devices), search.Devices)
	}
	if search.Devices[0].WarrantyMismatch == nil ||
		search.Devices[0].WarrantyMismatch.Kind != WarrantyMismatchEndedEarlier {
		t.Errorf("search mismatch = %+v, want ENDED_EARLIER", search.Devices[0].WarrantyMismatch)
	}

	// ── 3. Update is a full replacement, and validation still refuses ───────
	// A status alone clears the dates (NOT_REGISTERED has none) and the computed
	// mismatch disappears. This is the documented PATCH semantics, not a bug.
	updated, err := UpdateDevice(ctx, source, userA, brandDev.ID, DeviceInput{
		Name:                "iPhone tra hãng",
		Category:            "PHONE",
		Brand:               strPtr("Apple"),
		PurchaseDate:        "2025-06-01",
		PurchasePrice:       20_000_000,
		WarrantyMonths:      12,
		BrandWarrantyStatus: strPtr(BrandWarrantyStatusNotRegistered),
	})
	if err != nil {
		t.Fatalf("update to status-only: %v", err)
	}
	if updated.WarrantyMismatch != nil {
		t.Errorf("status-only update mismatch = %+v, want nil", updated.WarrantyMismatch)
	}
	status, start, end, checked, lookupURL = readBrandWarrantyColumns(t, source, brandDev.ID)
	if status == nil || *status != BrandWarrantyStatusNotRegistered {
		t.Errorf("stored status after update = %v, want NOT_REGISTERED", status)
	}
	if start.Valid || end.Valid || checked.Valid || lookupURL != nil {
		t.Errorf("status-only update left dates/url behind: %v %v %v %v", start, end, checked, lookupURL)
	}

	// An invalid group is refused before the transaction, and the stored row is
	// untouched.
	_, err = UpdateDevice(ctx, source, userA, brandDev.ID, DeviceInput{
		Name:               "iPhone tra hãng",
		Category:           "PHONE",
		PurchaseDate:       "2025-06-01",
		PurchasePrice:      20_000_000,
		WarrantyMonths:     12,
		BrandWarrantyStart: strPtr("2025-03-01"), // no status
	})
	if svc, ok := As(err); !ok || len(svc.FieldErrors["brandWarrantyStatus"]) == 0 {
		t.Fatalf("update with a date and no status = %v, want fieldErrors.brandWarrantyStatus", err)
	}
	status, _, _, _, _ = readBrandWarrantyColumns(t, source, brandDev.ID)
	if status == nil || *status != BrandWarrantyStatusNotRegistered {
		t.Errorf("a rejected update changed the stored status to %v", status)
	}

	// Put the full group back (with a later brand end) for the backup round trip.
	if _, err := UpdateDevice(ctx, source, userA, brandDev.ID, DeviceInput{
		Name:                "iPhone tra hãng",
		Category:            "PHONE",
		Brand:               strPtr("Apple"),
		PurchaseDate:        "2025-06-01",
		PurchasePrice:       20_000_000,
		WarrantyMonths:      12,
		BrandWarrantyStatus: strPtr(BrandWarrantyStatusActive),
		BrandWarrantyStart:  strPtr("2025-03-01"),
		BrandWarrantyEnd:    strPtr("2027-01-01"),
		BrandCheckedAt:      strPtr("2025-06-03T09:00:00Z"),
		BrandLookupUrl:      strPtr("https://checkcoverage.apple.com/?locale=vi_VN"),
	}); err != nil {
		t.Fatalf("restore full brand group: %v", err)
	}

	// ── 4. Backup export carries the five fields, never the mismatch ────────
	payload, err = ExportBackup(ctx, source, userA)
	if err != nil {
		t.Fatalf("export brand device: %v", err)
	}
	brandBackup := brandPayloadDevice(t, payload, brandDev.ID)
	if brandBackup.BrandWarrantyStatus == nil || *brandBackup.BrandWarrantyStatus != BrandWarrantyStatusActive ||
		brandBackup.BrandWarrantyStart == nil || *brandBackup.BrandWarrantyStart != "2025-03-01T00:00:00Z" ||
		brandBackup.BrandWarrantyEnd == nil || *brandBackup.BrandWarrantyEnd != "2027-01-01T00:00:00Z" ||
		brandBackup.BrandCheckedAt == nil || *brandBackup.BrandCheckedAt != "2025-06-03T09:00:00Z" ||
		brandBackup.BrandLookupUrl == nil || *brandBackup.BrandLookupUrl != "https://checkcoverage.apple.com/?locale=vi_VN" {
		t.Errorf("exported brand fields = %+v", brandBackup)
	}
	payloadRaw, err = json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal brand payload: %v", err)
	}
	if strings.Contains(string(payloadRaw), "warrantyMismatch") {
		t.Error("backup JSON contains warrantyMismatch — it is DERIVED and must not travel")
	}
	brandJSON := brandPayloadJSONDevice(t, payloadRaw, brandDev.ID)
	for _, key := range []string{
		"brandWarrantyStatus", "brandWarrantyStart", "brandWarrantyEnd",
		"brandCheckedAt", "brandLookupUrl",
	} {
		if _, ok := brandJSON[key]; !ok {
			t.Errorf("backup JSON for a checked device is missing %q", key)
		}
	}

	// ── 5. Restore into a brand-new database ────────────────────────────────
	targetDSN := createScratchDatabase(t, dsn)
	gooseUp(t, targetDSN)
	target, err := pgxpool.New(ctx, targetDSN)
	if err != nil {
		t.Fatalf("connect target: %v", err)
	}
	t.Cleanup(target.Close)
	brandWarrantyUser(t, target, userB)

	var onDisk BackupExport
	if err := json.Unmarshal(payloadRaw, &onDisk); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if _, err := ImportBackup(ctx, target, userB, &onDisk, ImportReplace); err != nil {
		t.Fatalf("import: %v", err)
	}

	restored, err := GetDevice(ctx, target, userB, brandDev.ID)
	if err != nil {
		t.Fatalf("get restored device: %v", err)
	}
	if restored.BrandWarrantyStatus == nil || *restored.BrandWarrantyStatus != BrandWarrantyStatusActive {
		t.Errorf("restored status = %v", restored.BrandWarrantyStatus)
	}
	if restored.BrandWarrantyStart.Valid == false ||
		restored.BrandWarrantyStart.Time.Format("2006-01-02") != "2025-03-01" {
		t.Errorf("restored start = %v", restored.BrandWarrantyStart)
	}
	if restored.BrandWarrantyEnd.Valid == false ||
		restored.BrandWarrantyEnd.Time.Format("2006-01-02") != "2027-01-01" {
		t.Errorf("restored end = %v", restored.BrandWarrantyEnd)
	}
	if restored.BrandCheckedAt.Valid == false {
		t.Error("restored checkedAt is NULL")
	}
	if restored.BrandLookupUrl == nil || *restored.BrandLookupUrl != "https://checkcoverage.apple.com/?locale=vi_VN" {
		t.Errorf("restored lookup URL = %v", restored.BrandLookupUrl)
	}
	// The mismatch is still COMPUTED after the restore, not restored.
	if restored.WarrantyMismatch == nil || restored.WarrantyMismatch.Kind != WarrantyMismatchEndedLater {
		t.Errorf("restored mismatch = %+v, want ENDED_LATER", restored.WarrantyMismatch)
	}

	// ── 6. An OLD payload (no brand keys) imports unchanged as NULL ─────────
	// Strip the five keys from the brand device, exactly as a pre-0023 file
	// would look. Import in replace mode: the same ids are reused, and the wipe
	// runs first.
	var generic map[string]any
	if err := json.Unmarshal(payloadRaw, &generic); err != nil {
		t.Fatalf("decode generic payload: %v", err)
	}
	devices, ok := generic["devices"].([]any)
	if !ok {
		t.Fatal("payload has no devices array")
	}
	stripped := 0
	for _, entry := range devices {
		d, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		for _, key := range []string{
			"brandWarrantyStatus", "brandWarrantyStart", "brandWarrantyEnd",
			"brandCheckedAt", "brandLookupUrl", "warrantyMismatch",
		} {
			if _, ok := d[key]; ok {
				delete(d, key)
				stripped++
			}
		}
	}
	if stripped == 0 {
		t.Fatal("failed to strip the post-0023 keys; the compatibility check would prove nothing")
	}
	oldRaw, err := json.Marshal(generic)
	if err != nil {
		t.Fatalf("marshal old payload: %v", err)
	}
	if strings.Contains(string(oldRaw), "brandWarranty") || strings.Contains(string(oldRaw), "brandLookupUrl") {
		t.Fatal("failed to strip the post-0023 keys; the compatibility check would prove nothing")
	}
	var oldPayload BackupExport
	if err := json.Unmarshal(oldRaw, &oldPayload); err != nil {
		t.Fatalf("decode old payload: %v", err)
	}
	if _, err := ImportBackup(ctx, target, userB, &oldPayload, ImportReplace); err != nil {
		t.Fatalf("import a pre-0023 payload: %v", err)
	}
	oldRestored, err := GetDevice(ctx, target, userB, brandDev.ID)
	if err != nil {
		t.Fatalf("get device restored from the old payload: %v", err)
	}
	if oldRestored.BrandWarrantyStatus != nil ||
		oldRestored.BrandWarrantyStart.Valid ||
		oldRestored.BrandWarrantyEnd.Valid ||
		oldRestored.BrandCheckedAt.Valid ||
		oldRestored.BrandLookupUrl != nil {
		t.Errorf("old payload restored brand data: %+v", oldRestored.Device)
	}
	if oldRestored.WarrantyMismatch != nil {
		t.Errorf("old payload restored a mismatch: %+v", oldRestored.WarrantyMismatch)
	}
}
