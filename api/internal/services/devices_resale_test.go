package services

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---- DB-free validation -----------------------------------------------------

// The resale pair rule (roadmap #12 / migration 0006): a sale is recorded with
// BOTH soldAt and soldPrice or neither. Exactly one is a 400 on the missing
// field, and a negative price is rejected exactly like purchasePrice.
func TestValidateDeviceInputResalePair(t *testing.T) {
	base := func() DeviceInput {
		return DeviceInput{
			Name:         "iPhone 15 Pro",
			Category:     "PHONE",
			PurchaseDate: "2025-01-01",
		}
	}
	i32 := func(v int32) *int32 { return &v }

	for _, tc := range []struct {
		name      string
		mutate    func(*DeviceInput)
		wantField string // "" = valid
	}{
		{name: "not sold (both absent)", mutate: func(in *DeviceInput) {}},
		{name: "sold with date and price", mutate: func(in *DeviceInput) {
			in.SoldAt = strp("2026-03-01")
			in.SoldPrice = i32(7_500_000)
		}},
		{name: "free giveaway (price 0)", mutate: func(in *DeviceInput) {
			in.SoldAt = strp("2026-03-01")
			in.SoldPrice = i32(0)
		}},
		{name: "price without date", mutate: func(in *DeviceInput) {
			in.SoldPrice = i32(7_500_000)
		}, wantField: "soldAt"},
		{name: "date without price", mutate: func(in *DeviceInput) {
			in.SoldAt = strp("2026-03-01")
		}, wantField: "soldPrice"},
		{name: "negative price", mutate: func(in *DeviceInput) {
			in.SoldAt = strp("2026-03-01")
			in.SoldPrice = i32(-1)
		}, wantField: "soldPrice"},
		{name: "blank date counts as absent", mutate: func(in *DeviceInput) {
			in.SoldAt = strp("   ")
			in.SoldPrice = i32(7_500_000)
		}, wantField: "soldAt"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := base()
			tc.mutate(&in)
			err := ValidateDeviceInput(&in)
			if tc.wantField == "" {
				if err != nil {
					t.Fatalf("ValidateDeviceInput = %v, want nil", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("ValidateDeviceInput = nil, want fieldErrors[%s]", tc.wantField)
			}
			svc, ok := As(err)
			if !ok {
				t.Fatalf("error is %T, want *services.Error", err)
			}
			if len(svc.FieldErrors[tc.wantField]) == 0 {
				t.Errorf("fieldErrors = %v, want a message for %q", svc.FieldErrors, tc.wantField)
			}
		})
	}
}

func TestParseSoldAt(t *testing.T) {
	if ts, err := parseSoldAt(nil); err != nil || ts.Valid {
		t.Errorf("parseSoldAt(nil) = (%v, %v), want an invalid timestamp (SQL NULL)", ts, err)
	}
	for _, in := range []string{"2026-03-01", "2026-03-01T10:30:00Z", "2026-03-01T10:30:00+07:00"} {
		ts, err := parseSoldAt(strp(in))
		if err != nil {
			t.Errorf("parseSoldAt(%q) = %v, want nil", in, err)
			continue
		}
		if !ts.Valid {
			t.Errorf("parseSoldAt(%q) produced an invalid timestamp", in)
		}
	}
	if _, err := parseSoldAt(strp("31/03/2026")); err == nil {
		t.Error("parseSoldAt(\"31/03/2026\") = nil, want a soldAt field error")
	} else if svc, ok := As(err); !ok || len(svc.FieldErrors["soldAt"]) == 0 {
		t.Errorf("parseSoldAt(invalid) = %v, want fieldErrors[soldAt]", err)
	}
}

// ---- real-database assertions ----------------------------------------------

// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres.
func TestDeviceResaleRoundTripAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userID  = "zz_test_resale_user"
		otherID = "zz_test_resale_other"
	)
	for _, u := range []string{userID, otherID} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
			 ON CONFLICT (id) DO NOTHING`, u, u+"@example.invalid"); err != nil {
			t.Fatalf("insert test user %s: %v", u, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`, []string{userID, otherID})
	})

	price := int32(7_500_000)
	in := DeviceInput{
		Name:          "iPhone 15 Pro",
		Category:      "PHONE",
		PurchaseDate:  "2025-01-01",
		PurchasePrice: 28_990_000,
		Status:        "SOLD",
		SoldAt:        strp("2026-03-01"),
		SoldPrice:     &price,
	}

	// 1. Create carries the resale pair.
	created, err := CreateDevice(ctx, pool, userID, in, "")
	if err != nil {
		t.Fatalf("CreateDevice: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "Device" WHERE id = $1`, created.ID)
	})
	if !created.SoldAt.Valid || created.SoldAt.Time.UTC().Format("2006-01-02") != "2026-03-01" {
		t.Errorf("created soldAt = %v, want 2026-03-01", created.SoldAt)
	}
	if created.SoldPrice == nil || *created.SoldPrice != price {
		t.Errorf("created soldPrice = %v, want %d", created.SoldPrice, price)
	}

	// 2. The wire shape the clients bind to: these exact JSON names, and a NULL
	//    soldAt/soldPrice must serialise as null (not "" or 0).
	//
	//    Note the timestamp format: pgtype.Timestamp marshals as
	//    "2006-01-02T15:04:05.999999999" — no "Z"/offset — exactly like the
	//    existing purchaseDate/createdAt fields (the DB column is
	//    `timestamp without time zone`, UTC by convention). The backup payload,
	//    by contrast, uses RFC3339Nano with "Z" for its dates.
	wire := marshalToMap(t, created)
	if got := wire["soldAt"]; got != "2026-03-01T00:00:00" {
		t.Errorf(`wire[%q] = %v, want "2026-03-01T00:00:00" (same shape as purchaseDate)`, "soldAt", got)
	}
	if got := wire["soldPrice"]; got != float64(price) {
		t.Errorf(`wire[%q] = %v, want %d`, "soldPrice", got, price)
	}

	// 3. GetDevice (detail DTO) and ListDevices (list DTO) embed the same fields.
	detail, err := GetDevice(ctx, pool, userID, created.ID)
	if err != nil {
		t.Fatalf("GetDevice: %v", err)
	}
	if detail.SoldPrice == nil || *detail.SoldPrice != price || !detail.SoldAt.Valid {
		t.Errorf("DeviceDetail sold fields = (%v, %v), want the created pair", detail.SoldAt, detail.SoldPrice)
	}
	items, err := ListDevices(ctx, pool, userID, DeviceFilter{})
	if err != nil {
		t.Fatalf("ListDevices: %v", err)
	}
	found := false
	for _, it := range items {
		if it.ID == created.ID {
			found = true
			if it.SoldPrice == nil || *it.SoldPrice != price || !it.SoldAt.Valid {
				t.Errorf("DeviceListItem sold fields = (%v, %v), want the created pair", it.SoldAt, it.SoldPrice)
			}
		}
	}
	if !found {
		t.Fatalf("created device %s missing from ListDevices", created.ID)
	}

	// 4. Clearing: both null → both columns back to NULL (and the JSON null again).
	in.SoldAt = nil
	in.SoldPrice = nil
	in.Status = "ACTIVE"
	updated, err := UpdateDevice(ctx, pool, userID, created.ID, in)
	if err != nil {
		t.Fatalf("UpdateDevice(clear): %v", err)
	}
	if updated.SoldAt.Valid || updated.SoldPrice != nil {
		t.Errorf("after clear: soldAt=%v soldPrice=%v, want NULL/NULL", updated.SoldAt, updated.SoldPrice)
	}
	wire = marshalToMap(t, updated)
	if v, ok := wire["soldAt"]; !ok || v != nil {
		t.Errorf(`after clear: wire["soldAt"] = %v (present=%v), want null`, v, ok)
	}
	if v, ok := wire["soldPrice"]; !ok || v != nil {
		t.Errorf(`after clear: wire["soldPrice"] = %v (present=%v), want null`, v, ok)
	}

	// 5. Ownership: another user can neither read nor write the resale fields.
	if _, err := GetDevice(ctx, pool, otherID, created.ID); err == nil {
		t.Error("GetDevice(other user) = nil, want NOT_FOUND")
	}
	if _, err := UpdateDevice(ctx, pool, otherID, created.ID, in); err == nil {
		t.Error("UpdateDevice(other user) = nil, want NOT_FOUND")
	}
}

func marshalToMap(t *testing.T, v any) map[string]any {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}
