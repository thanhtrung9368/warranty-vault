package services

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---- DB-free: the payload must describe itself ------------------------------

// Roadmap #2: a client must be able to warn "backup này không gồm ảnh" from the
// payload alone, without hardcoding the assumption. This pins the exact JSON
// names + values the three clients will read for the METADATA-ONLY JSON export —
// which is deliberately still version 5 even though the blob-carrying archive
// writes version 6 (see newBlobBackupExport), so a v5-only client/importer keeps
// reading this document unchanged.
func TestBackupEnvelopeDeclaresMissingAttachmentBytes(t *testing.T) {
	env := newBackupExport(0, 0, 0)

	if env.IncludesAttachmentBytes {
		t.Error("includesAttachmentBytes = true, want false — the JSON export carries attachment metadata only")
	}
	if env.Version != MetadataOnlyBackupVersion {
		t.Errorf("version = %d, want %d (the JSON document format did not change in the blob work)",
			env.Version, MetadataOnlyBackupVersion)
	}
	if MetadataOnlyBackupVersion > BackupVersion {
		t.Errorf("MetadataOnlyBackupVersion (%d) > BackupVersion (%d)", MetadataOnlyBackupVersion, BackupVersion)
	}
	if env.AttachmentBytesNote == "" {
		t.Fatal("attachmentBytesNote is empty; clients need a ready-to-display Vietnamese warning")
	}
	if !strings.Contains(strings.ToLower(env.AttachmentBytesNote), "không") {
		t.Errorf("attachmentBytesNote = %q, want an explicit Vietnamese negative statement", env.AttachmentBytesNote)
	}

	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if v, ok := wire["includesAttachmentBytes"]; !ok || v != false {
		t.Errorf(`wire["includesAttachmentBytes"] = %v (present=%v), want false`, v, ok)
	}
	note, ok := wire["attachmentBytesNote"].(string)
	if !ok || note != AttachmentBytesNoteVN {
		t.Errorf(`wire["attachmentBytesNote"] = %v, want %q`, wire["attachmentBytesNote"], AttachmentBytesNoteVN)
	}
	// Empty collections must serialise as [] (not null) — unchanged contract.
	for _, key := range []string{"devices", "wishlist", "subscriptions"} {
		if v, ok := wire[key].([]any); !ok || len(v) != 0 {
			t.Errorf(`wire[%q] = %v, want []`, key, wire[key])
		}
	}
}

// ---- DB-free: version range ------------------------------------------------

// Regression pin for the equality check that used to be `payload.Version != 5`.
// The parameters are explicit so the future-bump case can be exercised today:
// when BackupVersion becomes 6, a 5 payload MUST keep importing.
func TestBackupVersionErrorRange(t *testing.T) {
	const min, max = 5, 6 // simulated state right after a bump to v6
	for _, tc := range []struct {
		name    string
		version int
		wantErr bool
	}{
		{name: "older supported version still imports", version: 5},
		{name: "current version imports", version: 6},
		{name: "too old is refused", version: 4, wantErr: true},
		{name: "future version is refused", version: 7, wantErr: true},
		{name: "missing version (0) is refused", version: 0, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := backupVersionError(tc.version, min, max)
			if tc.wantErr && err == nil {
				t.Fatalf("backupVersionError(%d, %d, %d) = nil, want an error", tc.version, min, max)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("backupVersionError(%d, %d, %d) = %v, want nil — bumping the version must not invalidate older backups",
					tc.version, min, max, err)
			}
			if err != nil && !strings.Contains(err.Error(), strconv.Itoa(tc.version)) {
				t.Errorf("error %q does not name the received version %d", err.Error(), tc.version)
			}
		})
	}
}

// The production constants themselves: today's accepted range must include the
// version we write, and ImportBackup must refuse a payload from the future.
func TestImportBackupVersionGuards(t *testing.T) {
	if err := backupVersionError(BackupVersion, MinBackupVersion, BackupVersion); err != nil {
		t.Errorf("the version we write (%d) is rejected by our own importer: %v", BackupVersion, err)
	}
	// Rejected before any DB access, so a nil pool is safe here.
	future := &BackupExport{Version: BackupVersion + 1}
	if _, err := ImportBackup(context.Background(), nil, "u", future, ImportMerge); err == nil {
		t.Error("ImportBackup(future version) = nil, want VALIDATION — a newer payload must not be silently accepted")
	} else if svc, ok := As(err); !ok || svc.Code != "VALIDATION" {
		t.Errorf("ImportBackup(future version) = %v, want VALIDATION", err)
	} else if !strings.Contains(svc.Message, strconv.Itoa(BackupVersion+1)) {
		t.Errorf("message %q does not name the received version", svc.Message)
	}
	tooOld := &BackupExport{Version: MinBackupVersion - 1}
	if _, err := ImportBackup(context.Background(), nil, "u", tooOld, ImportMerge); err == nil {
		t.Error("ImportBackup(too-old version) = nil, want VALIDATION")
	} else if svc, ok := As(err); !ok || !strings.Contains(svc.Message, "cũ") {
		t.Errorf("ImportBackup(too-old version) = %v, want a 'quá cũ' VALIDATION message", err)
	}
}

// ---- real-database: resale fields + honesty fields survive a round trip -----

// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres.
func TestBackupExportImportRoundTripAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userA    = "zz_test_backup_a"
		userB    = "zz_test_backup_b"
		deviceID = "zz_test_backup_device"
	)
	for _, u := range []string{userA, userB} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
			 ON CONFLICT (id) DO NOTHING`, u, u+"@example.invalid"); err != nil {
			t.Fatalf("insert test user %s: %v", u, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`, []string{userA, userB})
	})

	// A sold device owned by A, with a recorded sale (migration 0006 pair).
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "serialNumber", "purchaseDate", "purchasePrice",
		                       "purchasePlace", status, notes, "soldAt", "soldPrice", "updatedAt")
		 VALUES ($1, $2, 'iPhone 15 Pro', 'PHONE', '356789012345678', '2025-01-01', 28990000,
		         'FPT Shop', 'SOLD', 'bán nâng cấp', '2026-03-01', 7500000, NOW())`, deviceID, userA); err != nil {
		t.Fatalf("insert test device: %v", err)
	}

	payload, err := ExportBackup(ctx, pool, userA)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}

	// 1. Honesty metadata is present on a real export.
	if payload.IncludesAttachmentBytes {
		t.Error("ExportBackup: includesAttachmentBytes = true, want false")
	}
	if payload.AttachmentBytesNote != AttachmentBytesNoteVN {
		t.Errorf("ExportBackup: attachmentBytesNote = %q, want %q", payload.AttachmentBytesNote, AttachmentBytesNoteVN)
	}

	// 2. The resale pair is exported with the documented names.
	var exported *BackupDevice
	for i := range payload.Devices {
		if payload.Devices[i].ID == deviceID {
			exported = &payload.Devices[i]
		}
	}
	if exported == nil {
		t.Fatalf("device %s missing from the export", deviceID)
	}
	if exported.SoldPrice == nil || *exported.SoldPrice != 7_500_000 {
		t.Errorf("exported soldPrice = %v, want 7500000", exported.SoldPrice)
	}
	if exported.SoldAt == nil || !strings.HasPrefix(*exported.SoldAt, "2026-03-01") {
		t.Errorf("exported soldAt = %v, want 2026-03-01T00:00:00Z", exported.SoldAt)
	}

	// 3. Restore it into a different account (merge mode): the sale must survive,
	//    i.e. the export is not silently lossy for the new columns.
	//
	//    Device ids are globally unique (PK), so "restore onto a fresh server" is
	//    simulated by removing the source rows first — a payload whose device id
	//    still exists under the *same* account is skipped by merge, and one whose
	//    id exists under another account would collide (see the audit note in the
	//    task report).
	if _, err := pool.Exec(ctx, `DELETE FROM "Device" WHERE "userId" = $1`, userA); err != nil {
		t.Fatalf("clear source devices: %v", err)
	}
	if _, err := ImportBackup(ctx, pool, userB, payload, ImportMerge); err != nil {
		t.Fatalf("ImportBackup: %v", err)
	}
	var soldAt *string
	var soldPrice *int32
	if err := pool.QueryRow(ctx,
		`SELECT "soldAt"::text, "soldPrice" FROM "Device" WHERE id = $1 AND "userId" = $2`,
		deviceID, userB).Scan(&soldAt, &soldPrice); err != nil {
		t.Fatalf("read imported device: %v", err)
	}
	if soldPrice == nil || *soldPrice != 7_500_000 {
		t.Errorf("imported soldPrice = %v, want 7500000", soldPrice)
	}
	if soldAt == nil || !strings.HasPrefix(*soldAt, "2026-03-01") {
		t.Errorf("imported soldAt = %v, want 2026-03-01", soldAt)
	}

	// 4. An OLD v5 export (no soldAt/soldPrice keys at all) must still import:
	//    they decode as NULL, the "not sold" state.
	legacy := *payload
	legacy.Devices = []BackupDevice{{
		ID:            "zz_test_backup_legacy",
		Name:          "Máy cũ",
		Category:      "PHONE",
		PurchaseDate:  "2024-05-05T00:00:00Z",
		PurchasePrice: 1_000_000,
		Status:        "ACTIVE",
		CreatedAt:     "2024-05-05T00:00:00Z",
		UpdatedAt:     "2024-05-05T00:00:00Z",
		Warranties:    []BackupWarranty{},
		Attachments:   []BackupAttachment{},
	}}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "Device" WHERE id = $1`, "zz_test_backup_legacy")
	})
	if _, err := ImportBackup(ctx, pool, userB, &legacy, ImportMerge); err != nil {
		t.Fatalf("ImportBackup(legacy payload without resale keys): %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT "soldAt"::text, "soldPrice" FROM "Device" WHERE id = $1 AND "userId" = $2`,
		"zz_test_backup_legacy", userB).Scan(&soldAt, &soldPrice); err != nil {
		t.Fatalf("read legacy-imported device: %v", err)
	}
	if soldAt != nil || soldPrice != nil {
		t.Errorf("legacy import produced soldAt=%v soldPrice=%v, want NULL/NULL", soldAt, soldPrice)
	}
}

// Cron dedup markers must survive a restore. Losing Reminder.lastNotifiedAt or
// Subscription.lastNotifiedRenewalAt makes the next cron sweep re-notify the
// user about things they were already told about (migration 0002 exists purely
// to make those markers effective).
func TestBackupPreservesCronDedupMarkersAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userA = "zz_test_backup_marker_a"
		userB = "zz_test_backup_marker_b"
		dev   = "zz_test_backup_marker_dev"
		war   = "zz_test_backup_marker_war"
		rem   = "zz_test_backup_marker_rem"
		sub   = "zz_test_backup_marker_sub"
	)
	for _, u := range []string{userA, userB} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
			 ON CONFLICT (id) DO NOTHING`, u, u+"@example.invalid"); err != nil {
			t.Fatalf("insert test user %s: %v", u, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`, []string{userA, userB})
	})

	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Máy test', 'PHONE', NOW(), 0, NOW())`, dev, userA); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, "updatedAt")
		 VALUES ($1, $2, 'STANDARD', NOW(), NOW() + INTERVAL '12 months', 12, NOW())`, war, dev); err != nil {
		t.Fatalf("insert warranty: %v", err)
	}
	// The marker is set: cron already pushed the 30-day notice for this warranty.
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Reminder" (id, "warrantyId", "isDismissed", "lastNotifiedAt", "createdAt")
		 VALUES ($1, $2, false, '2026-02-01 08:00:00', NOW())`, rem, war); err != nil {
		t.Fatalf("insert reminder: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Subscription" (id, "userId", name, "billingCycle", price, "startedAt", "renewalDate",
		                             "lastNotifiedRenewalAt", "updatedAt")
		 VALUES ($1, $2, 'Netflix', 'MONTHLY', 260000, NOW(), NOW() + INTERVAL '20 days', '2026-02-10 09:30:00', NOW())`,
		sub, userA); err != nil {
		t.Fatalf("insert subscription: %v", err)
	}

	payload, err := ExportBackup(ctx, pool, userA)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	if len(payload.Devices) != 1 || len(payload.Devices[0].Warranties) != 1 || len(payload.Devices[0].Warranties[0].Reminders) != 1 {
		t.Fatalf("unexpected export shape: %+v", payload.Devices)
	}
	exportedRem := payload.Devices[0].Warranties[0].Reminders[0]
	if exportedRem.LastNotifiedAt == nil || !strings.HasPrefix(*exportedRem.LastNotifiedAt, "2026-02-01") {
		t.Errorf("exported reminder lastNotifiedAt = %v, want 2026-02-01T08:00:00Z — omitting it re-notifies after restore", exportedRem.LastNotifiedAt)
	}
	if len(payload.Subscriptions) != 1 {
		t.Fatalf("expected 1 subscription, got %d", len(payload.Subscriptions))
	}
	if payload.Subscriptions[0].LastNotifiedRenewalAt == nil ||
		!strings.HasPrefix(*payload.Subscriptions[0].LastNotifiedRenewalAt, "2026-02-10") {
		t.Errorf("exported lastNotifiedRenewalAt = %v, want 2026-02-10T09:30:00Z", payload.Subscriptions[0].LastNotifiedRenewalAt)
	}

	// Restore into another account and read the markers back from the columns the
	// cron actually queries. Device and Subscription ids are globally unique, so
	// drop the source rows first (simulating a restore onto a fresh server).
	if _, err := pool.Exec(ctx, `DELETE FROM "Device" WHERE "userId" = $1`, userA); err != nil {
		t.Fatalf("clear source devices: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM "Subscription" WHERE "userId" = $1`, userA); err != nil {
		t.Fatalf("clear source subscriptions: %v", err)
	}
	if _, err := ImportBackup(ctx, pool, userB, payload, ImportMerge); err != nil {
		t.Fatalf("ImportBackup: %v", err)
	}
	var remNotified, subNotified *string
	if err := pool.QueryRow(ctx,
		`SELECT r."lastNotifiedAt"::text FROM "Reminder" r
		 JOIN "Warranty" w ON w.id = r."warrantyId"
		 JOIN "Device" d ON d.id = w."deviceId"
		 WHERE d."userId" = $1 AND r.id = $2`, userB, rem).Scan(&remNotified); err != nil {
		t.Fatalf("read imported reminder: %v", err)
	}
	if remNotified == nil || !strings.HasPrefix(*remNotified, "2026-02-01") {
		t.Errorf("imported reminder lastNotifiedAt = %v, want 2026-02-01 08:00:00", remNotified)
	}
	if err := pool.QueryRow(ctx,
		`SELECT "lastNotifiedRenewalAt"::text FROM "Subscription" WHERE id = $1 AND "userId" = $2`,
		sub, userB).Scan(&subNotified); err != nil {
		t.Fatalf("read imported subscription: %v", err)
	}
	if subNotified == nil || !strings.HasPrefix(*subNotified, "2026-02-10") {
		t.Errorf("imported lastNotifiedRenewalAt = %v, want 2026-02-10 09:30:00", subNotified)
	}
}
