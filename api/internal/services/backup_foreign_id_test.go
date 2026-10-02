package services

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Roadmap "Import with a foreign id returns 500": two halves of the same story.
//
// BEFORE the guard, the import inserted straight into a table whose primary key is
// global, so a device id owned by another account produced a raw PostgreSQL
// unique-violation (SQLSTATE 23505). ImportBackup wraps that in fmt.Errorf, which
// is not a *services.Error, so writeServiceError/the import handler could only
// answer 500.
//
// AFTER the guard, the same payload is refused before the transaction opens, with
// a typed VALIDATION error → HTTP 400 and a Vietnamese message naming the id.
func TestForeignDeviceIDSQLStateAndImportGuard(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		owner    = "zz_test_foreign_owner"
		importer = "zz_test_foreign_importer"
		deviceID = "zz_test_foreign_device"
	)
	for _, u := range []string{owner, importer} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
			 ON CONFLICT (id) DO NOTHING`, u, u+"@example.invalid"); err != nil {
			t.Fatalf("insert user %s: %v", u, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`, []string{owner, importer})
	})
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Máy ảnh Canon', 'CAMERA', '2025-01-01', 9000000, NOW())`, deviceID, owner); err != nil {
		t.Fatalf("insert device: %v", err)
	}

	// BEFORE: the raw insert the old import path performed — a 23505 that the
	// handler can only surface as 500.
	err = store.New(pool).BackupInsertDevice(ctx, store.BackupInsertDeviceParams{
		ID:            deviceID,
		UserId:        importer,
		Name:          "Máy ảnh Canon",
		Category:      "CAMERA",
		PurchaseDate:  pgts("2025-01-01"),
		PurchasePrice: 9000000,
		Status:        "ACTIVE",
		CreatedAt:     pgts("2025-01-01"),
		UpdatedAt:     pgts("2025-01-01"),
	})
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("raw cross-account insert = %v, want SQLSTATE 23505 (the old 500 path)", err)
	}

	// AFTER: the same payload through the import API is a clean VALIDATION error.
	payload := &BackupExport{
		Version:       MetadataOnlyBackupVersion,
		ExportedAt:    "2025-01-01T00:00:00Z",
		Subscriptions: []BackupSubscription{},
		Wishlist:      []BackupWishlistItem{},
		Devices: []BackupDevice{{
			ID: deviceID, Name: "Máy ảnh Canon", Category: "CAMERA",
			PurchaseDate: "2025-01-01T00:00:00Z", PurchasePrice: 9000000, Status: "ACTIVE",
			CreatedAt: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z",
			Warranties: []BackupWarranty{}, Attachments: []BackupAttachment{},
		}},
	}
	for _, mode := range []ImportMode{ImportMerge, ImportReplace} {
		_, ierr := ImportBackup(ctx, pool, importer, payload, mode)
		if ierr == nil {
			t.Fatalf("ImportBackup(foreign id, %s) = nil, want VALIDATION", mode)
		}
		svc, ok := As(ierr)
		if !ok || svc.Code != "VALIDATION" {
			t.Fatalf("ImportBackup(foreign id, %s) = %v, want VALIDATION", mode, ierr)
		}
		if svc.HTTPStatus() != 400 {
			t.Errorf("VALIDATION maps to %d, want 400", svc.HTTPStatus())
		}
		if !strings.Contains(svc.Message, deviceID) {
			t.Errorf("message %q does not name the conflicting device id", svc.Message)
		}
	}

	// The refused import must not have touched the importing user's data.
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "Device" WHERE "userId" = $1`, importer).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("importer owns %d devices after refused imports, want 0", count)
	}
	// …and must not have replaced the other account's row either.
	var ownerCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "Device" WHERE "userId" = $1`, owner).Scan(&ownerCount); err != nil {
		t.Fatalf("count owner: %v", err)
	}
	if ownerCount != 1 {
		t.Errorf("owner device count = %d, want 1 (the guard must run before the replace wipe)", ownerCount)
	}
}
