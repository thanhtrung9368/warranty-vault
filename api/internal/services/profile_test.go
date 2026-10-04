package services

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// ---- DB-free validation -----------------------------------------------------

func TestNormalizeDisplayName(t *testing.T) {
	for _, tc := range []struct {
		name    string
		raw     *string
		present bool
		want    string // "" means nil (clear)
		// wantChanged is the tri-state output: false means "leave the stored
		// value ALONE" (the key was absent), true means "write this value,
		// including a nil that clears it".
		wantChanged bool
		wantErr     string // field name expected in fieldErrors, "" = no error
	}{
		{name: "set trimmed value", raw: strp("  Nguyễn Văn A  "), present: true, want: "Nguyễn Văn A", wantChanged: true},
		{name: "empty string clears", raw: strp(""), present: true, want: "", wantChanged: true},
		{name: "whitespace clears", raw: strp("   "), present: true, want: "", wantChanged: true},
		{name: "explicit null clears", raw: nil, present: true, want: "", wantChanged: true},
		// The absent key is NOT an error any more: a language picker sends
		// `{"locale": "vi"}` with no displayName. It means "unchanged".
		{name: "missing key leaves it unchanged", raw: nil, present: false, want: "", wantChanged: false},
		{name: "80 bytes accepted", raw: strp(strings.Repeat("a", 80)), present: true, want: strings.Repeat("a", 80), wantChanged: true},
		{name: "81 bytes rejected", raw: strp(strings.Repeat("a", 81)), present: true, wantErr: "displayName"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, changed, err := NormalizeDisplayName(context.Background(), tc.raw, tc.present)
			if changed != tc.wantChanged {
				t.Errorf("changed = %v, want %v", changed, tc.wantChanged)
			}
			if tc.wantErr != "" {
				if err == nil {
					t.Fatalf("NormalizeDisplayName(%v, present=%v) = %v, want fieldErrors[%s]",
						tc.raw, tc.present, got, tc.wantErr)
				}
				svc, ok := As(err)
				if !ok {
					t.Fatalf("error is %T, want *services.Error", err)
				}
				if len(svc.FieldErrors[tc.wantErr]) == 0 {
					t.Errorf("fieldErrors = %v, want a message for %q", svc.FieldErrors, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("NormalizeDisplayName: unexpected error %v", err)
			}
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

// The byte cap is inherited from Register; make that explicit so a future change
// to one path without the other fails loudly.
func TestMaxDisplayNameBytesMatchesRegisterConvention(t *testing.T) {
	if MaxDisplayNameBytes != 80 {
		t.Errorf("MaxDisplayNameBytes = %d, want 80 (handlers.Register uses len(trimmed) > 80)", MaxDisplayNameBytes)
	}
	// 40 two-byte Vietnamese chars = 80 bytes: still accepted.
	vietnamese80 := strings.Repeat("ê", 40)
	if len(vietnamese80) != 80 {
		t.Fatalf("test fixture is %d bytes, want 80", len(vietnamese80))
	}
	if _, _, err := NormalizeDisplayName(context.Background(), &vietnamese80, true); err != nil {
		t.Errorf("80-byte Vietnamese name rejected: %v", err)
	}
}

// ---- real-database assertions ----------------------------------------------

// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres (helpers
// from category_seed_test.go).
func TestUpdateDisplayNameAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_profile_user"
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert test user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	// 1. Set a name.
	got, err := UpdateProfile(ctx, pool, userID, strp("Nguyễn Văn A"), true, nil, false)
	if err != nil {
		t.Fatalf("UpdateProfile(set): %v", err)
	}
	if got.Name == nil || *got.Name != "Nguyễn Văn A" {
		t.Errorf("returned name = %v, want %q — the handler answers with this row", got.Name, "Nguyễn Văn A")
	}
	if got.Email != userID+"@example.invalid" {
		t.Errorf("returned email = %q, want the unchanged account email", got.Email)
	}

	// The row really changed (not just the returned struct).
	row, err := store.New(pool).GetUserByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserByID: %v", err)
	}
	if row.Name == nil || *row.Name != "Nguyễn Văn A" {
		t.Errorf("persisted name = %v, want %q", row.Name, "Nguyễn Văn A")
	}

	// 2. Clear it (nil → SQL NULL).
	cleared, err := UpdateProfile(ctx, pool, userID, nil, true, nil, false)
	if err != nil {
		t.Fatalf("UpdateProfile(clear): %v", err)
	}
	if cleared.Name != nil {
		t.Errorf("after clear, name = %q, want nil", *cleared.Name)
	}
	row, err = store.New(pool).GetUserByID(ctx, userID)
	if err != nil {
		t.Fatalf("GetUserByID after clear: %v", err)
	}
	if row.Name != nil {
		t.Errorf("persisted name after clear = %q, want NULL", *row.Name)
	}

	// 3. Unknown user → NOT_FOUND (the handler maps it to 404).
	if _, err := UpdateProfile(ctx, pool, "zz_test_profile_missing", strp("X"), true, nil, false); err == nil {
		t.Fatal("UpdateProfile(missing user) = nil, want NOT_FOUND")
	} else if svc, ok := As(err); !ok || svc.Code != "NOT_FOUND" {
		t.Errorf("UpdateProfile(missing user) = %v, want NOT_FOUND", err)
	}
}
