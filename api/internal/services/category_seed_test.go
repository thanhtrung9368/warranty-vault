package services

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver used by goose below
	"github.com/pressly/goose/v3"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// The category catalog is seeded by this migration and validated by
// assertCategoryExists. Before the migration existed the table was empty on a
// fresh database, so every device / wishlist write failed with
// "Loại thiết bị không hợp lệ".
const categorySeedMigration = "0004_seed_category_catalog.sql"

// activeCategoryCodes lists the codes CATEGORY_LABELS is expected to contain, in
// declaration order. This mirrors website/src/lib/types.ts::CATEGORY_LABELS; the
// tests below re-parse that file so the two cannot drift silently.
const categoryLabelCount = 20

type seededCategory struct {
	Code      string
	Name      string
	SortOrder int
	IsActive  bool
}

var (
	// `  PHONE: 'Điện thoại',` inside the CATEGORY_LABELS object literal.
	categoryLabelLine = regexp.MustCompile(`^\s*([A-Z][A-Z0-9_]*):\s*'([^']*)',\s*$`)
	// `('PHONE', 'Điện thoại', 10, true)` — used by both the INSERT (up) and the
	// VALUES list of the DELETE (down).
	categorySeedTuple = regexp.MustCompile(`\('([A-Z][A-Z0-9_]*)',\s*'([^']*)',\s*(\d+),\s*(true|false)\)`)
)

// repoFile resolves a repo-relative path. This package lives in api/internal/services,
// so the monorepo root is three levels up.
func repoFile(t *testing.T, rel string) string {
	t.Helper()
	p := filepath.Join("..", "..", "..", rel)
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("cannot read %s: %v (these tests expect the monorepo layout with website/ next to api/)", rel, err)
	}
	return p
}

// parseCategoryLabels reads CATEGORY_LABELS from website/src/lib/types.ts, the
// source of truth for the category catalog.
func parseCategoryLabels(t *testing.T) []seededCategory {
	t.Helper()
	path := repoFile(t, filepath.Join("website", "src", "lib", "types.ts"))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	block := regexp.MustCompile(`(?s)CATEGORY_LABELS[^=]*=\s*\{(.*?)\n\};`).FindStringSubmatch(string(raw))
	if block == nil {
		t.Fatalf("%s: could not find the CATEGORY_LABELS object literal", path)
	}
	var out []seededCategory
	for _, line := range strings.Split(block[1], "\n") {
		m := categoryLabelLine.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		out = append(out, seededCategory{Code: m[1], Name: m[2]})
	}
	return out
}

// parseCategorySeedMigration splits the seed migration into its up and down
// value tuples. Regex-based on purpose: the point is to compare the *data* the
// migration carries against the website labels, not to be a general SQL parser.
func parseCategorySeedMigration(t *testing.T) (up, down []seededCategory, upSection string) {
	t.Helper()
	path := repoFile(t, filepath.Join("api", "migrations", categorySeedMigration))
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	src := string(raw)
	upIdx := strings.Index(src, "-- +goose Up")
	downIdx := strings.Index(src, "-- +goose Down")
	if upIdx < 0 || downIdx < 0 || downIdx < upIdx {
		t.Fatalf("%s: expected both a '-- +goose Up' and a '-- +goose Down' section", path)
	}
	upSection = src[upIdx:downIdx]
	return parseCategoryTuples(upSection), parseCategoryTuples(src[downIdx:]), upSection
}

func parseCategoryTuples(section string) []seededCategory {
	matches := categorySeedTuple.FindAllStringSubmatch(section, -1)
	out := make([]seededCategory, 0, len(matches))
	for _, m := range matches {
		order, err := strconv.Atoi(m[3])
		if err != nil {
			continue
		}
		out = append(out, seededCategory{Code: m[1], Name: m[2], SortOrder: order, IsActive: m[4] == "true"})
	}
	return out
}

// mapCategoryLookup is an in-memory categoryLookup: it mirrors what the real
// GetCategoryByCode does (`WHERE code = $1 AND "isActive" = true`, i.e. a miss for
// a missing OR inactive row) without needing a database.
type mapCategoryLookup struct {
	active map[string]store.Category
}

func (m mapCategoryLookup) GetCategoryByCode(_ context.Context, code string) (store.Category, error) {
	c, ok := m.active[code]
	if !ok || !c.IsActive {
		return store.Category{}, pgx.ErrNoRows
	}
	return c, nil
}

func categoryInvalid(err error) bool {
	de, ok := As(err)
	return ok && de.Code == "CATEGORY_INVALID"
}

// TestCategorySeedMatchesWebsiteLabels is the anti-drift test: the codes and
// Vietnamese names seeded by migration 0004 must equal CATEGORY_LABELS.
func TestCategorySeedMatchesWebsiteLabels(t *testing.T) {
	labels := parseCategoryLabels(t)
	if len(labels) != categoryLabelCount {
		t.Fatalf("CATEGORY_LABELS has %d entries, expected %d — if the catalog changed on purpose, update migration %s and this constant",
			len(labels), categoryLabelCount, categorySeedMigration)
	}
	up, down, _ := parseCategorySeedMigration(t)

	if len(up) != len(labels) {
		t.Fatalf("migration seeds %d categories, CATEGORY_LABELS has %d", len(up), len(labels))
	}
	for i, want := range labels {
		got := up[i]
		if got.Code != want.Code {
			t.Errorf("category #%d: migration seeds %q, CATEGORY_LABELS has %q", i, got.Code, want.Code)
			continue
		}
		if got.Name != want.Name {
			t.Errorf("category %s: migration name %q, CATEGORY_LABELS name %q", got.Code, got.Name, want.Name)
		}
		if !got.IsActive {
			t.Errorf("category %s: seeded as inactive — assertCategoryExists would reject it", got.Code)
		}
		// sortOrder mirrors declaration order (10, 20, ... 200) so the web picker
		// lists categories exactly like the TS map it replaced.
		if want := (i + 1) * 10; got.SortOrder != want {
			t.Errorf("category %s: sortOrder %d, expected %d", got.Code, got.SortOrder, want)
		}
	}

	// down must remove exactly what up inserted, no more.
	if len(down) != len(up) {
		t.Fatalf("down deletes %d rows but up inserts %d", len(down), len(up))
	}
	for i := range up {
		if up[i] != down[i] {
			t.Errorf("down tuple #%d is %+v, up tuple is %+v", i, down[i], up[i])
		}
	}
}

func TestCategorySeedIsIdempotent(t *testing.T) {
	_, _, upSection := parseCategorySeedMigration(t)
	if !strings.Contains(upSection, "ON CONFLICT (code) DO NOTHING") {
		t.Error(`migration must be idempotent: expected "ON CONFLICT (code) DO NOTHING" in the up section`)
	}
}

// TestAssertCategoryExistsAcceptsEverySeededCode locks the two halves together:
// every code the migration seeds must pass the validation gate that device create
// (services/devices.go) and wishlist create (services/wishlist.go) apply.
func TestAssertCategoryExistsAcceptsEverySeededCode(t *testing.T) {
	up, _, _ := parseCategorySeedMigration(t)
	lookup := mapCategoryLookup{active: make(map[string]store.Category, len(up))}
	for _, c := range up {
		if _, dup := lookup.active[c.Code]; dup {
			t.Fatalf("migration seeds %s twice", c.Code)
		}
		lookup.active[c.Code] = store.Category{Code: c.Code, Name: c.Name, SortOrder: int32(c.SortOrder), IsActive: c.IsActive}
	}

	ctx := context.Background()
	for _, c := range up {
		if err := assertCategoryExists(ctx, lookup, c.Code); err != nil {
			t.Errorf("assertCategoryExists(%s) = %v, want nil — device create would fail with 400", c.Code, err)
		}
	}

	// Negative cases: unknown and empty codes, and a code that exists but is inactive.
	for _, code := range []string{"", "NOT_A_CATEGORY", "phone"} {
		if err := assertCategoryExists(ctx, lookup, code); !categoryInvalid(err) {
			t.Errorf("assertCategoryExists(%q) = %v, want CATEGORY_INVALID", code, err)
		}
	}
	inactive := mapCategoryLookup{active: map[string]store.Category{}}
	inactive.active["PHONE"] = store.Category{Code: "PHONE", Name: "Điện thoại", IsActive: false}
	// GetCategoryByCode filters on isActive, so an inactive row is a miss.
	if err := assertCategoryExists(ctx, inactive, "PHONE"); !categoryInvalid(err) {
		t.Errorf("assertCategoryExists(inactive PHONE) = %v, want CATEGORY_INVALID", err)
	}

	// A real database error must not be reported as an invalid category.
	boom := errors.New("connection reset")
	if err := assertCategoryExists(ctx, failingCategoryLookup{err: boom}, "PHONE"); err == nil || categoryInvalid(err) {
		t.Errorf("assertCategoryExists(db error) = %v, want a wrapped non-CATEGORY_INVALID error", err)
	}
}

type failingCategoryLookup struct{ err error }

func (f failingCategoryLookup) GetCategoryByCode(context.Context, string) (store.Category, error) {
	return store.Category{}, f.err
}

// ---- real-database assertions ----------------------------------------------
//
// These run only when WV_TEST_DATABASE_URL points at a throwaway Postgres. They
// apply the goose migrations themselves, so the target may be an empty database;
// point them at a scratch/test database, never at production.

func testDatabaseURL(t *testing.T) string {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("WV_TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("WV_TEST_DATABASE_URL not set (e.g. postgres://postgres@127.0.0.1:5432/wv_test?sslmode=disable): skipping real-Postgres assertions")
	}
	return dsn
}

func migrationsDir(t *testing.T) string {
	t.Helper()
	dir, err := filepath.Abs(filepath.Join("..", "..", "migrations"))
	if err != nil {
		t.Fatalf("resolve migrations dir: %v", err)
	}
	return dir
}

func gooseUp(t *testing.T, dsn string) {
	t.Helper()
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open database/sql handle: %v", err)
	}
	defer func() { _ = db.Close() }()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose dialect: %v", err)
	}
	if err := goose.Up(db, migrationsDir(t)); err != nil {
		t.Fatalf("goose up: %v", err)
	}
}

// TestCategorySeedAgainstRealPostgres proves the fix end-to-end: the migration
// applies, every seeded code passes the real assertCategoryExists query, and the
// diacritic-insensitive search matches an accented device name from unaccented input.
func TestCategorySeedAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	// Registered before the row cleanup below so it runs last (cleanups are LIFO);
	// a plain `defer pool.Close()` would fire before the t.Cleanup deletes.
	t.Cleanup(pool.Close)

	up, _, _ := parseCategorySeedMigration(t)
	q := store.New(pool)

	for _, c := range up {
		row, err := q.GetCategoryByCode(ctx, c.Code)
		if err != nil {
			t.Errorf("GetCategoryByCode(%s): %v", c.Code, err)
			continue
		}
		if row.Name != c.Name {
			t.Errorf("category %s: db name %q, migration name %q", c.Code, row.Name, c.Name)
		}
		if err := assertCategoryExists(ctx, q, c.Code); err != nil {
			t.Errorf("assertCategoryExists(%s) = %v, want nil", c.Code, err)
		}
	}
	if err := assertCategoryExists(ctx, q, "NOT_A_CATEGORY"); !categoryInvalid(err) {
		t.Errorf("assertCategoryExists(NOT_A_CATEGORY) = %v, want CATEGORY_INVALID", err)
	}

	// unaccent must fold Vietnamese diacritics, including đ (which has no Unicode
	// decomposition and is covered by unaccent.rules directly).
	var folded string
	if err := pool.QueryRow(ctx, `SELECT public.wv_unaccent(lower($1))`, "Điện thoại / Tủ lạnh").Scan(&folded); err != nil {
		t.Fatalf("wv_unaccent: %v", err)
	}
	if folded != "dien thoai / tu lanh" {
		t.Errorf("wv_unaccent(lower('Điện thoại / Tủ lạnh')) = %q, want %q", folded, "dien thoai / tu lanh")
	}

	// The wrapper must be IMMUTABLE and the four functional indexes must be GIN
	// trigram indexes — that pairing is what makes the search indexable at all.
	var volatility string
	if err := pool.QueryRow(ctx, `SELECT provolatile::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'wv_unaccent'`).Scan(&volatility); err != nil {
		t.Fatalf("look up wv_unaccent volatility: %v", err)
	}
	if volatility != "i" {
		t.Errorf("public.wv_unaccent provolatile = %q, want \"i\" (IMMUTABLE) — a functional index cannot be built on it otherwise", volatility)
	}
	for _, idx := range []string{"Device_name_trgm_idx", "Device_brand_trgm_idx", "Device_model_trgm_idx", "Device_serialNumber_trgm_idx"} {
		var def string
		if err := pool.QueryRow(ctx, `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`, idx).Scan(&def); err != nil {
			t.Errorf("index %s missing: %v", idx, err)
			continue
		}
		if !strings.Contains(def, "gin_trgm_ops") || !strings.Contains(def, "wv_unaccent(lower(") {
			t.Errorf("index %s definition is not a wv_unaccent(lower(...)) trigram index: %s", idx, def)
		}
	}

	// Search: an accented device name must be found from unaccented input.
	const (
		testUserID = "zz_test_unaccent_user"
		testDevID  = "zz_test_unaccent_device"
	)
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, $3, NOW())
		 ON CONFLICT (id) DO NOTHING`, testUserID, "zz_test_unaccent@example.invalid", "x"); err != nil {
		t.Fatalf("insert test user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "Device" WHERE id = $1`, testDevID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, testUserID)
	})
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, brand, model, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, $3, 'PHONE', $4, $5, NOW(), 0, NOW())`,
		testDevID, testUserID, "Điện thoại Samsung Galaxy S24", "Điện Máy Xanh", "SM-S921"); err != nil {
		t.Fatalf("insert test device: %v", err)
	}

	for _, tc := range []struct {
		query string
		want  int
	}{
		{"dien thoai", 1},     // name, fully unaccented
		{"Điện thoại", 1},     // name, accented (parity with the old ILIKE behaviour)
		{"dien may xanh", 1},  // brand
		{"sm-s921", 1},        // model, no accents involved
		{"tu lanh", 0},        // must not over-match
		{"dien THOAI sam", 1}, // mixed case + partial words
	} {
		rows, err := q.ListDevicesByUser(ctx, store.ListDevicesByUserParams{
			UserId:  testUserID,
			Column2: "",
			Column3: "",
			Column4: tc.query,
		})
		if err != nil {
			t.Fatalf("ListDevicesByUser(%q): %v", tc.query, err)
		}
		if len(rows) != tc.want {
			t.Errorf("search %q returned %d devices, want %d", tc.query, len(rows), tc.want)
		}
	}

	// End-to-end at the service layer: the original bug was that device create and
	// wishlist create rejected every category on a fresh database (HTTP 400
	// "Loại thiết bị không hợp lệ" / "Loại sản phẩm không hợp lệ").
	created, err := CreateDevice(ctx, pool, testUserID, DeviceInput{
		Name:         "Thiết bị tạo trong test",
		Category:     "PHONE",
		PurchaseDate: "2026-01-01",
	}, "")
	if err != nil {
		t.Fatalf("CreateDevice(category=PHONE) = %v, want nil — before migration 0004 no device could be created", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "Device" WHERE id = $1`, created.ID)
	})

	wish, err := CreateWishlist(ctx, pool, testUserID, WishlistInput{
		Name:     "Món tạo trong test",
		Category: strp("PHONE"),
	})
	if err != nil {
		t.Fatalf("CreateWishlist(category=PHONE) = %v, want nil", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "WishlistItem" WHERE id = $1`, wish.ID)
	})
}

// TestCategorySeedMigrationDownAndUp exercises down/up against a real database:
// down must remove the seeded rows and the search objects, and a second up must
// restore them (idempotency, not just "works on an empty database").
func TestCategorySeedMigrationDownAndUp(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	t.Cleanup(func() { gooseUp(t, dsn) }) // always leave the database migrated

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("open database/sql handle: %v", err)
	}
	defer func() { _ = db.Close() }()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("goose dialect: %v", err)
	}
	dir := migrationsDir(t)

	up, _, _ := parseCategorySeedMigration(t)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	countSeeded := func() int {
		t.Helper()
		n := 0
		for _, c := range up {
			var exists bool
			if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM public."Category" WHERE code = $1)`, c.Code).Scan(&exists); err != nil {
				t.Fatalf("count %s: %v", c.Code, err)
			}
			if exists {
				n++
			}
		}
		return n
	}

	if got := countSeeded(); got != len(up) {
		t.Fatalf("after up: %d/%d seeded categories present", got, len(up))
	}

	// Roll back 0005 then 0004.
	if err := goose.Down(db, dir); err != nil {
		t.Fatalf("goose down (0005): %v", err)
	}
	if err := goose.Down(db, dir); err != nil {
		t.Fatalf("goose down (0004): %v", err)
	}
	if got := countSeeded(); got != 0 {
		t.Errorf("after down: %d seeded categories still present, want 0", got)
	}
	var fnExists, idxExists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'wv_unaccent')`).Scan(&fnExists); err != nil {
		t.Fatalf("check function: %v", err)
	}
	if fnExists {
		t.Error("down left public.wv_unaccent() behind")
	}
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'Device_name_trgm_idx')`).Scan(&idxExists); err != nil {
		t.Fatalf("check index: %v", err)
	}
	if idxExists {
		t.Error("down left Device_name_trgm_idx behind")
	}

	// Re-apply: must be a clean second up.
	gooseUp(t, dsn)
	if got := countSeeded(); got != len(up) {
		t.Errorf("after second up: %d/%d seeded categories present", got, len(up))
	}
	// The extensions are deliberately kept by down, so this must still work.
	var folded string
	if err := pool.QueryRow(ctx, `SELECT public.wv_unaccent('Điện thoại')`).Scan(&folded); err != nil {
		t.Fatalf("wv_unaccent after round-trip: %v", err)
	}
	if folded != "Dien thoai" {
		t.Errorf("wv_unaccent('Điện thoại') = %q, want %q", folded, "Dien thoai")
	}
}
