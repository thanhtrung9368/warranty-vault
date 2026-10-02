package services

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---- DB-free normalization --------------------------------------------------

func TestNormalizeDescription(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   *string
		want string // "" = nil
	}{
		{name: "absent", in: nil, want: ""},
		{name: "empty clears", in: strp(""), want: ""},
		{name: "whitespace clears", in: strp("   \n\t"), want: ""},
		{name: "trimmed", in: strp("  Hoá đơn FPT Shop  "), want: "Hoá đơn FPT Shop"},
		{name: "inner spaces kept", in: strp("Bảo hành 12 tháng"), want: "Bảo hành 12 tháng"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := NormalizeDescription(tc.in)
			switch {
			case tc.want == "":
				if got != nil {
					t.Errorf("got %q, want nil (clear)", *got)
				}
			case got == nil:
				t.Errorf("got nil, want %q", tc.want)
			case *got != tc.want:
				t.Errorf("got %q, want %q", *got, tc.want)
			}
		})
	}
}

// ---- real-database assertions ----------------------------------------------

// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres. The rows
// are inserted with raw SQL (no encryption / disk involved) because this path
// only ever touches the description column.
func TestUpdateAttachmentDescriptionAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		ownerID  = "zz_test_attach_owner"
		otherID  = "zz_test_attach_other"
		deviceID = "zz_test_attach_device"
		attID    = "zz_test_attach_file"
	)
	for _, u := range []string{ownerID, otherID} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
			 ON CONFLICT (id) DO NOTHING`, u, u+"@example.invalid"); err != nil {
			t.Fatalf("insert test user %s: %v", u, err)
		}
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Thiết bị test', 'PHONE', NOW(), 0, NOW())`, deviceID, ownerID); err != nil {
		t.Fatalf("insert test device: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Attachment" (id, "deviceId", "fileName", "storagePath", "fileType", "fileSize", iv, "wrappedKey", description, "uploadedAt")
		 VALUES ($1, $2, 'hoa-don.jpg', $3, 'image/jpeg', 1234, '\x00'::bytea, '\x00'::bytea, 'mô tả cũ', NOW())`,
		attID, deviceID, deviceID+"/blob.enc"); err != nil {
		t.Fatalf("insert test attachment: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`, []string{ownerID, otherID})
	})

	// 1. Owner updates the description.
	got, err := UpdateDescription(ctx, pool, ownerID, attID, strp("Hoá đơn FPT Shop"))
	if err != nil {
		t.Fatalf("UpdateDescription: %v", err)
	}
	if got.Description == nil || *got.Description != "Hoá đơn FPT Shop" {
		t.Errorf("returned description = %v, want %q", got.Description, "Hoá đơn FPT Shop")
	}
	// Other columns must be untouched.
	if got.FileName != "hoa-don.jpg" || got.FileType != "image/jpeg" || got.FileSize != 1234 {
		t.Errorf("update changed non-description columns: %+v", got)
	}

	// 2. Clear with nil (and NormalizeDescription turns "" into nil upstream).
	cleared, err := UpdateDescription(ctx, pool, ownerID, attID, NormalizeDescription(strp("   ")))
	if err != nil {
		t.Fatalf("UpdateDescription(clear): %v", err)
	}
	if cleared.Description != nil {
		t.Errorf("after clear, description = %q, want NULL", *cleared.Description)
	}

	// 3. Someone else's attachment → not_found (the handler maps NOT_FOUND to 404,
	//    never 403: it must not confirm the id exists).
	if _, err := UpdateDescription(ctx, pool, otherID, attID, strp("hijack")); err == nil {
		t.Fatal("UpdateDescription(other user) = nil, want not_found")
	} else if ae, ok := AsAttachmentError(err); !ok || ae.Code != "not_found" {
		t.Errorf("UpdateDescription(other user) = %v, want AttachmentError{not_found}", err)
	}

	// 4. Unknown id → not_found as well.
	if _, err := UpdateDescription(ctx, pool, ownerID, "zz_test_attach_missing", strp("x")); err == nil {
		t.Fatal("UpdateDescription(missing) = nil, want not_found")
	} else if ae, ok := AsAttachmentError(err); !ok || ae.Code != "not_found" {
		t.Errorf("UpdateDescription(missing) = %v, want AttachmentError{not_found}", err)
	}

	// 5. The description really persisted (read back through the owner-scoped
	//    query used by the list/download paths).
	row, err := GetAttachmentForUser(ctx, pool, ownerID, attID)
	if err != nil {
		t.Fatalf("GetAttachmentForUser: %v", err)
	}
	if row.Description != nil {
		t.Errorf("persisted description = %q, want NULL after the clear", *row.Description)
	}
	if _, err := GetAttachmentForUser(ctx, pool, otherID, attID); err == nil {
		t.Error("GetAttachmentForUser(other user) = nil, want not_found")
	}
}
