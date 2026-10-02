package services

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// TestVietnameseSearchAgainstCLocaleDatabase pins the bug fixed by migration
// 0007 on a database that actually has the C locale.
//
// Why this test exists: `public.wv_unaccent(lower(x))` (migration 0005) calls
// lower() first. In a C/POSIX-locale database lower() is ASCII-only, so 'Đ'
// survives it and unaccent maps it to an UPPERCASE 'D' — stored and queried
// values both gain a capital, LIKE compares 'Dien…' with 'dien…' and Vietnamese
// search silently returns zero rows. `lower(public.wv_unaccent(x))` folds case
// only after unaccent has made the string ASCII, so it behaves the same under
// every collation.
//
// The test builds a throwaway C-locale database on the test cluster, applies the
// goose migrations to it, and proves both the expression and the real
// ListDevicesByUser search work there. It skips (not fails) when the role cannot
// CREATE DATABASE or the server refuses the C locale; the UTF-8 assertions in
// category_seed_test.go still cover the expression order in that case.
func TestVietnameseSearchAgainstCLocaleDatabase(t *testing.T) {
	dsn := testDatabaseURL(t)

	admin, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open admin handle: %v", err)
	}
	// Registered BEFORE the DROP cleanup below so it runs LAST (cleanups are LIFO):
	// the drop needs a live connection, so a plain `defer admin.Close()` — which
	// runs before t.Cleanup — would leak the scratch database on every run.
	t.Cleanup(func() { _ = admin.Close() })

	var canCreate bool
	if err := admin.QueryRow(
		`SELECT rolsuper OR rolcreatedb FROM pg_roles WHERE rolname = current_user`).Scan(&canCreate); err != nil {
		t.Fatalf("check CREATE DATABASE privilege: %v", err)
	}
	if !canCreate {
		t.Skip("current role lacks CREATEDB; skipping the C-locale reproduction")
	}

	scratch := fmt.Sprintf("wv_locale_test_%d", os.Getpid())
	scratchDSN, ok := withDatabaseName(dsn, scratch)
	if !ok {
		t.Skipf("cannot derive a scratch DSN from %q", dsn)
	}

	// Identifier is generated above (no user input), so interpolation is safe;
	// CREATE DATABASE cannot take bind parameters anyway.
	if _, err := admin.Exec(`DROP DATABASE IF EXISTS ` + scratch + ` WITH (FORCE)`); err != nil {
		t.Fatalf("pre-drop scratch database: %v", err)
	}
	if _, err := admin.Exec(
		`CREATE DATABASE ` + scratch + ` TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'`); err != nil {
		t.Skipf("CREATE DATABASE with LC_COLLATE=C failed on this server: %v", err)
	}
	// Registered after the admin.Close cleanup above and before pool.Close below:
	// execution order is pool.Close → DROP → admin.Close.
	t.Cleanup(func() {
		if _, err := admin.Exec(`DROP DATABASE IF EXISTS ` + scratch + ` WITH (FORCE)`); err != nil {
			t.Errorf("drop scratch database %s: %v", scratch, err)
		}
	})

	gooseUp(t, scratchDSN)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, scratchDSN)
	if err != nil {
		t.Fatalf("connect to scratch database: %v", err)
	}
	t.Cleanup(pool.Close)

	var collate, ctype string
	if err := pool.QueryRow(ctx,
		`SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()`).Scan(&collate, &ctype); err != nil {
		t.Fatalf("read scratch database locale: %v", err)
	}
	if collate != "C" || ctype != "C" {
		t.Skipf("scratch database locale is (%q, %q), not C — nothing to reproduce here", collate, ctype)
	}

	// 1. The fixed expression folds Vietnamese under the C locale.
	var newOrder string
	if err := pool.QueryRow(ctx, `SELECT lower(public.wv_unaccent($1))`, "Điện thoại / Tủ lạnh").Scan(&newOrder); err != nil {
		t.Fatalf("lower(wv_unaccent(...)): %v", err)
	}
	if newOrder != "dien thoai / tu lanh" {
		t.Errorf("lower(wv_unaccent('Điện thoại / Tủ lạnh')) = %q in a C-locale database, want %q",
			newOrder, "dien thoai / tu lanh")
	}

	// 2. Characterize the trap this ordering avoids: with the old order the 'Đ'
	//    stays uppercase because lower() is ASCII-only here, unaccent turns it
	//    into 'D', and the leading capital breaks every LIKE comparison. If this
	//    ever starts returning lowercase, PostgreSQL has changed lower()'s
	//    behaviour under the C locale and the migration-0007 comment needs a
	//    re-read.
	var oldOrder string
	if err := pool.QueryRow(ctx, `SELECT public.wv_unaccent(lower($1))`, "Điện thoại / Tủ lạnh").Scan(&oldOrder); err != nil {
		t.Fatalf("wv_unaccent(lower(...)): %v", err)
	}
	if oldOrder == newOrder {
		t.Logf("note: wv_unaccent(lower(x)) now also yields %q under C locale; "+
			"the locale rationale in migration 0007 may be obsolete", oldOrder)
	} else {
		t.Logf("characterized locale trap: wv_unaccent(lower(x)) = %q, lower(wv_unaccent(x)) = %q", oldOrder, newOrder)
	}

	// 3. The indexes must be built on the SAME expression the query uses.
	for _, idx := range []string{
		"Device_name_trgm_idx", "Device_brand_trgm_idx",
		"Device_model_trgm_idx", "Device_serialNumber_trgm_idx",
	} {
		var def string
		if err := pool.QueryRow(ctx,
			`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, idx).Scan(&def); err != nil {
			t.Errorf("index %s missing after migrations: %v", idx, err)
			continue
		}
		if !strings.Contains(def, "lower(wv_unaccent(") {
			t.Errorf("index %s is not on lower(wv_unaccent(...)): %s", idx, def)
		}
		if strings.Contains(def, "wv_unaccent(lower(") {
			t.Errorf("index %s still uses the locale-dependent ordering: %s", idx, def)
		}
	}

	// 4. End to end through the real query: an accented device must be found from
	//    unaccented, lower-case input on this C-locale database.
	const (
		userID   = "zz_test_locale_user"
		deviceID = "zz_test_locale_device"
	)
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`,
		userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert test user: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, brand, model, "serialNumber", "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, $3, 'PHONE', $4, $5, $6, NOW(), 0, NOW())`,
		deviceID, userID, "Điện thoại Samsung Galaxy S24", "Điện Máy Xanh", "SM-S921", "IMEI356789012345678"); err != nil {
		t.Fatalf("insert test device: %v", err)
	}

	q := store.New(pool)
	for _, query := range []string{"dien thoai", "dien may xanh", "dien THOAI sam", "Điện thoại", "imei356"} {
		rows, err := q.ListDevicesByUser(ctx, store.ListDevicesByUserParams{
			UserId:  userID,
			Column2: "",
			Column3: "",
			Column4: query,
		})
		if err != nil {
			t.Fatalf("ListDevicesByUser(%q): %v", query, err)
		}
		if len(rows) != 1 {
			t.Errorf("C-locale search %q returned %d devices, want 1 — migration 0007's ordering is what makes this work",
				query, len(rows))
		}
	}

	// 5. Informational: with seq scans disabled the planner can use the trigram
	//    index for the new expression (proves index/predicate equivalence). The
	//    assertion above already guarantees correctness, so a fallback to a
	//    sequential scan is logged, not failed — same trade-off the query comment
	//    in devices.sql describes (generic vs custom plan).
	var plan string
	_ = pool.QueryRow(ctx,
		`EXPLAIN (COSTS OFF) SELECT id FROM "Device"
		 WHERE lower(public.wv_unaccent(name)) LIKE '%' || lower(public.wv_unaccent('dien thoai')) || '%'`).Scan(&plan)
	t.Logf("EXPLAIN plan for the unaccented LIKE:\n%s", plan)
}

// withDatabaseName rewrites the database name in a postgres URL or keyword/value
// DSN. Returns ok=false when the DSN shape is not recognized.
func withDatabaseName(dsn, name string) (string, bool) {
	if i := strings.Index(dsn, "://"); i >= 0 {
		prefix, rest := dsn[:i+3], dsn[i+3:]
		slash := strings.Index(rest, "/")
		if slash < 0 {
			return "", false
		}
		host, tail := rest[:slash], rest[slash+1:]
		query := ""
		if q := strings.Index(tail, "?"); q >= 0 {
			query = tail[q:]
		}
		return prefix + host + "/" + name + query, true
	}
	// keyword/value form: ... dbname=old ...
	fields := strings.Fields(dsn)
	replaced := false
	for i, f := range fields {
		if strings.HasPrefix(f, "dbname=") {
			fields[i] = "dbname=" + name
			replaced = true
		}
	}
	if !replaced {
		return "", false
	}
	return strings.Join(fields, " "), true
}
