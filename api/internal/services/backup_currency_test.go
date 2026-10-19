package services

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// The backup round trip for the multi-currency pair (migration 0022, gap #16).
//
// Three promises are proven here:
//  1. a foreign-currency device travels with its LOCKED rate and restores to the
//     same VND value — the restore must not turn USD 999 into VND 999;
//  2. a VND-only payload is byte-identical to the pre-0022 format (neither new
//     key appears), so existing exports and existing importers are unaffected;
//  3. a payload that predates the columns imports unchanged, as VND.
//
// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres; the target
// is a brand-new database created by the test, exactly like
// backup_blob_roundtrip_test.go.
func TestBackupCurrencyRoundTrip(t *testing.T) {
	sourceDSN := testDatabaseURL(t)
	gooseUp(t, sourceDSN)
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir())
	t.Setenv("FILE_MASTER_KEY", testMasterKeyB64)

	ctx := viCtx()
	source, err := pgxpool.New(ctx, sourceDSN)
	if err != nil {
		t.Fatalf("connect source: %v", err)
	}
	t.Cleanup(source.Close)

	const (
		userA = "zz_test_currency_backup_a"
		userB = "zz_test_currency_backup_b"
	)
	currencyUser(t, source, userA)

	vndDev, err := CreateDevice(ctx, source, userA, DeviceInput{
		Name: "Máy VND", Category: "PHONE", PurchaseDate: "2025-01-01", PurchasePrice: 25_000_000,
	}, "")
	if err != nil {
		t.Fatalf("create VND device: %v", err)
	}
	soldAt := "2025-06-01"
	soldPrice := int32(700)
	usdDev, err := CreateDevice(ctx, source, userA, DeviceInput{
		Name: "iPhone US", Category: "PHONE", PurchaseDate: "2025-02-01",
		PurchasePrice: 999, Currency: "USD", FxRate: money(26100),
		SoldAt: &soldAt, SoldPrice: &soldPrice,
	}, "")
	if err != nil {
		t.Fatalf("create USD device: %v", err)
	}
	if _, err := source.Exec(ctx,
		`INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, cost, "updatedAt")
		 VALUES ('zz_test_cur_rt_w', $1, 'STANDARD', NOW(), NOW() + INTERVAL '12 months', 12, 99, NOW())`,
		usdDev.ID); err != nil {
		t.Fatalf("insert warranty: %v", err)
	}

	payload, err := ExportBackup(ctx, source, userA)
	if err != nil {
		t.Fatalf("export: %v", err)
	}

	// The payload must carry the pair for the USD device and omit it for the VND
	// one. `omitempty` is what keeps a VND-only file byte-identical to the old
	// format (proved separately below).
	var usdBackup, vndBackup *BackupDevice
	for i := range payload.Devices {
		switch payload.Devices[i].ID {
		case usdDev.ID:
			usdBackup = &payload.Devices[i]
		case vndDev.ID:
			vndBackup = &payload.Devices[i]
		}
	}
	if usdBackup == nil || vndBackup == nil {
		t.Fatalf("export is missing a device: %+v", payload.Devices)
	}
	if usdBackup.Currency != "USD" || usdBackup.FxRate == nil || *usdBackup.FxRate != 26100 {
		t.Errorf("exported USD pair = %s/%v, want USD/26100", usdBackup.Currency, usdBackup.FxRate)
	}
	if vndBackup.Currency != "" || vndBackup.FxRate != nil {
		t.Errorf("exported VND pair = %q/%v, want empty/nil (the keys must disappear)", vndBackup.Currency, vndBackup.FxRate)
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal export: %v", err)
	}
	if !strings.Contains(string(raw), `"currency":"USD"`) {
		t.Error(`the exported JSON has no "currency":"USD" for the foreign-currency device`)
	}
	if !strings.Contains(string(raw), `"fxRate":26100`) {
		t.Error(`the exported JSON has no "fxRate":26100`)
	}
	// Exactly one currency key: the VND device must not carry one.
	if n := strings.Count(string(raw), `"currency"`); n != 1 {
		t.Errorf(`the payload has %d "currency" keys, want exactly 1 (VND devices omit it)`, n)
	}

	// Simulate the file on disk: decode the JSON back into a payload.
	var onDisk BackupExport
	if err := json.Unmarshal(raw, &onDisk); err != nil {
		t.Fatalf("decode the exported file: %v", err)
	}

	// ---- restore into a brand-new database --------------------------------
	targetDSN := createScratchDatabase(t, sourceDSN)
	gooseUp(t, targetDSN)
	target, err := pgxpool.New(ctx, targetDSN)
	if err != nil {
		t.Fatalf("connect target: %v", err)
	}
	t.Cleanup(target.Close)
	currencyUser(t, target, userB)

	if _, err := ImportBackup(ctx, target, userB, &onDisk, ImportMerge); err != nil {
		t.Fatalf("import into clean DB: %v", err)
	}

	q := store.New(target)
	restoredUSD, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: usdDev.ID, UserId: userB})
	if err != nil {
		t.Fatalf("read restored USD device: %v", err)
	}
	if restoredUSD.Currency != "USD" || restoredUSD.FxRate == nil || *restoredUSD.FxRate != 26100 {
		t.Errorf("restored pair = %s/%v, want USD/26100", restoredUSD.Currency, restoredUSD.FxRate)
	}
	if restoredUSD.PurchasePrice != 999 {
		t.Errorf("restored purchasePrice = %d, want 999 (not converted on write or on restore)", restoredUSD.PurchasePrice)
	}
	usdVND := withVND(restoredUSD)
	if usdVND.PurchasePriceVnd == nil || *usdVND.PurchasePriceVnd != 999*26100 {
		t.Errorf("restored purchasePriceVnd = %v, want %d", usdVND.PurchasePriceVnd, 999*26100)
	}
	if usdVND.SoldPriceVnd == nil || *usdVND.SoldPriceVnd != 700*26100 {
		t.Errorf("restored soldPriceVnd = %v, want %d", usdVND.SoldPriceVnd, 700*26100)
	}

	restoredVND, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: vndDev.ID, UserId: userB})
	if err != nil {
		t.Fatalf("read restored VND device: %v", err)
	}
	if restoredVND.Currency != "VND" || restoredVND.FxRate != nil {
		t.Errorf("restored VND pair = %s/%v, want VND/nil", restoredVND.Currency, restoredVND.FxRate)
	}
	if got := withVND(restoredVND).PurchasePriceVnd; got == nil || *got != 25_000_000 {
		t.Errorf("restored VND purchasePriceVnd = %v, want 25000000", got)
	}

	// The restored warranty still contributes its converted cost to stats.
	targetStats, err := Snapshot(ctx, target, userB)
	if err != nil {
		t.Fatalf("target stats: %v", err)
	}
	if want := int64(25_000_000 + 999*26100); targetStats.Devices.TotalPurchasePrice != want {
		t.Errorf("restored totalPurchasePrice = %d, want %d", targetStats.Devices.TotalPurchasePrice, want)
	}
	if want := int64(99 * 26100); targetStats.Devices.TotalWarrantyCost != want {
		t.Errorf("restored totalWarrantyCost = %d, want %d", targetStats.Devices.TotalWarrantyCost, want)
	}

	// ---- an OLD payload (no currency/fxRate keys) imports as VND ----------
	// Decode the file generically, delete both keys from every device and import
	// again in replace mode. This is exactly what a pre-0022 file looks like, and
	// it must restore successfully instead of being refused or guessing a rate.
	var generic map[string]any
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatalf("decode generic: %v", err)
	}
	devices, ok := generic["devices"].([]any)
	if !ok {
		t.Fatal("payload has no devices array")
	}
	for _, entry := range devices {
		d, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		delete(d, "currency")
		delete(d, "fxRate")
	}
	oldRaw, err := json.Marshal(generic)
	if err != nil {
		t.Fatalf("marshal old payload: %v", err)
	}
	if strings.Contains(string(oldRaw), `"currency"`) || strings.Contains(string(oldRaw), `"fxRate"`) {
		t.Fatal("failed to strip the post-0022 keys; the compatibility check would prove nothing")
	}
	var oldPayload BackupExport
	if err := json.Unmarshal(oldRaw, &oldPayload); err != nil {
		t.Fatalf("decode old payload: %v", err)
	}

	if _, err := ImportBackup(ctx, target, userB, &oldPayload, ImportReplace); err != nil {
		t.Fatalf("import a pre-0022 payload: %v", err)
	}
	oldUSD, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: usdDev.ID, UserId: userB})
	if err != nil {
		t.Fatalf("read device restored from the old payload: %v", err)
	}
	if oldUSD.Currency != "VND" {
		t.Errorf("old payload restored currency = %q, want VND (the default)", oldUSD.Currency)
	}
	if oldUSD.FxRate != nil {
		t.Errorf("old payload restored fxRate = %v, want nil", oldUSD.FxRate)
	}
	if got := withVND(oldUSD).PurchasePriceVnd; got == nil || *got != 999 {
		t.Errorf("old payload purchasePriceVnd = %v, want 999 (VND at par, the pre-0022 meaning)", got)
	}

	// ---- a tampered payload is refused before it writes anything ----------
	// A foreign-currency device with no rate cannot be restored honestly: the
	// whole import must fail rather than silently treat USD 999 as VND 999.
	tampered := onDisk
	for i := range tampered.Devices {
		if tampered.Devices[i].ID == usdDev.ID {
			tampered.Devices[i].FxRate = nil
		}
	}
	_, err = ImportBackup(ctx, target, userB, &tampered, ImportReplace)
	if err == nil {
		t.Fatal("expected the import to refuse a USD device with no fxRate")
	}
	svc, ok := As(err)
	if !ok || svc.Code != "VALIDATION" {
		t.Fatalf("error = %#v, want a VALIDATION domain error", err)
	}
	if !strings.Contains(svc.Message, "thiếu tỷ giá") {
		t.Errorf("message = %q, want it to say the rate is missing", svc.Message)
	}
	// The refused import must not have run its replace-mode wipe: the previous
	// restore is still intact.
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: vndDev.ID, UserId: userB}); err != nil {
		t.Errorf("a refused import wiped the account: %v", err)
	}
}
