package services

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// The Brand / Store / WarrantyProvider catalogs are seeded by this migration.
// Before it existed the tables were empty on a fresh database, so every picker
// in the device form (brand, store, warranty provider) rendered blank.
const catalogSeedMigration = "0008_seed_brand_store_warranty_provider.sql"

// Minimal expected seed sizes. The exact numbers are pinned by the parsed
// migration below; these floors exist so an accidental truncation of the file
// fails loudly instead of quietly shrinking the picker.
const (
	minSeededBrands     = 40
	minSeededStores     = 20
	minSeededProviders  = 15
	minSeededBrandLinks = 100
)

// ---- static parsing of the migration ---------------------------------------

type seededBrand struct {
	ID       string
	Name     string
	Slug     string
	IsActive bool
}

type seededStore struct {
	ID       string
	Name     string
	Slug     string
	Type     string
	IsActive bool
}

type seededProvider struct {
	ID         string
	Name       string
	Slug       string
	Phone      string // "" = NULL
	Address    string // "" = NULL
	WebsiteURL string // "" = NULL
	Notes      string
	IsActive   bool
}

const (
	// Unique markers for the up (INSERT ... VALUES) and down (DELETE ... USING
	// (VALUES)) forms of each seeded table.
	insertBrands    = `INSERT INTO public."Brand" (id, name, slug, "isActive") VALUES`
	deleteBrands    = `DELETE FROM public."Brand" AS b`
	insertStores    = `INSERT INTO public."Store" (id, name, slug, type, "isActive") VALUES`
	deleteStores    = `DELETE FROM public."Store" AS s`
	insertProviders = `INSERT INTO public."WarrantyProvider" (id, name, slug, phone, address, "websiteUrl", notes, "isActive") VALUES`
	deleteProviders = `DELETE FROM public."WarrantyProvider" AS w`
	insertBrandCats = `INSERT INTO public."BrandCategory" ("brandId", "categoryCode") VALUES`
)

// splitSQLTuple turns `('a', 'b c', NULL, true)` into its raw fields (outer
// parens stripped, quotes removed, NULL kept as ""). Quote-aware so a comma
// inside a Vietnamese name or note cannot split a field.
func splitSQLTuple(line string) []string {
	line = strings.TrimSpace(line)
	line = strings.TrimSuffix(line, ",")
	line = strings.TrimSpace(line)
	line = strings.TrimPrefix(line, "(")
	line = strings.TrimSuffix(line, ")")

	var fields []string
	var b strings.Builder
	inQuote := false
	for i := 0; i < len(line); i++ {
		c := line[i]
		switch {
		case c == '\'':
			if inQuote && i+1 < len(line) && line[i+1] == '\'' {
				b.WriteByte('\'')
				i++
				continue
			}
			inQuote = !inQuote
		case c == ',' && !inQuote:
			fields = append(fields, strings.TrimSpace(b.String()))
			b.Reset()
		default:
			b.WriteByte(c)
		}
	}
	fields = append(fields, strings.TrimSpace(b.String()))
	// Unquoted SQL NULL becomes the empty string so callers can compare the
	// migration's up/down halves field by field.
	for i, v := range fields {
		if v == "NULL" {
			fields[i] = ""
		}
	}
	return fields
}

// parseSeedTuples returns the tuple field-lists of the statement identified by
// marker, from either the up or the down section. Returns nil when the statement
// is absent (the Down of BrandCategory is deliberately absent — its rows go
// with the FK cascade).
func parseSeedTuples(section, marker string) [][]string {
	i := strings.Index(section, marker)
	if i < 0 {
		return nil
	}
	rest := section[i:]
	v := strings.Index(rest, "VALUES")
	if v < 0 {
		return nil
	}
	rest = rest[v+len("VALUES"):]
	if end := strings.Index(rest, "-- +goose StatementEnd"); end >= 0 {
		rest = rest[:end]
	}
	var out [][]string
	for _, raw := range strings.Split(rest, "\n") {
		line := strings.TrimSpace(raw)
		if !strings.HasPrefix(line, "(") {
			continue
		}
		out = append(out, splitSQLTuple(line))
	}
	return out
}

func parseCatalogSeedMigration(t *testing.T) (up, down string) {
	t.Helper()
	path := repoFile(t, filepath.Join("api", "migrations", catalogSeedMigration))
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
	return src[upIdx:downIdx], src[downIdx:]
}

func parseSeededBrands(t *testing.T) []seededBrand {
	t.Helper()
	up, _ := parseCatalogSeedMigration(t)
	var out []seededBrand
	for _, f := range parseSeedTuples(up, insertBrands) {
		if len(f) != 4 {
			t.Fatalf("brand tuple %v: want 4 fields", f)
		}
		out = append(out, seededBrand{ID: f[0], Name: f[1], Slug: f[2], IsActive: f[3] == "true"})
	}
	return out
}

// ---- DB-free assertions -----------------------------------------------------

// Roadmap #1: a fresh database must show real suggestions in every picker. This
// pins the catalog sizes and the honesty rules the migration header claims.
func TestCatalogSeedMigrationShape(t *testing.T) {
	up, down := parseCatalogSeedMigration(t)

	brands := parseSeedTuples(up, insertBrands)
	stores := parseSeedTuples(up, insertStores)
	providers := parseSeedTuples(up, insertProviders)
	links := parseSeedTuples(up, insertBrandCats)

	if len(brands) < minSeededBrands {
		t.Errorf("seeded brands = %d, want >= %d", len(brands), minSeededBrands)
	}
	if len(stores) < minSeededStores {
		t.Errorf("seeded stores = %d, want >= %d", len(stores), minSeededStores)
	}
	if len(providers) < minSeededProviders {
		t.Errorf("seeded providers = %d, want >= %d", len(providers), minSeededProviders)
	}
	if len(links) < minSeededBrandLinks {
		t.Errorf("seeded brand/category links = %d, want >= %d", len(links), minSeededBrandLinks)
	}

	// Every store type must render a hint in the web combobox: it special-cases
	// 'ONLINE' and 'OFFLINE' (website/src/components/device-form.tsx).
	for _, f := range stores {
		if len(f) != 5 {
			t.Fatalf("store tuple %v: want 5 fields", f)
		}
		if f[3] != "ONLINE" && f[3] != "OFFLINE" {
			t.Errorf("store %s type = %q, want ONLINE or OFFLINE (the web hint only understands those two)", f[0], f[3])
		}
	}

	// Providers deliberately carry no unverifiable contact data.
	for _, f := range providers {
		if len(f) != 8 {
			t.Fatalf("provider tuple %v: want 8 fields", f)
		}
		if f[3] != "" || f[4] != "" {
			t.Errorf("provider %s: phone/address must stay NULL (unverifiable in a migration), got %q / %q", f[0], f[3], f[4])
		}
		if strings.TrimSpace(f[6]) == "" {
			t.Errorf("provider %s: notes must explain how to find the centre", f[0])
		}
	}

	// Idempotency + "down removes only what up inserted" conventions.
	if !strings.Contains(up, "ON CONFLICT") {
		t.Error("up section has no ON CONFLICT — re-running the migration on an edited database would fail")
	}
	if !strings.Contains(down, "IS NOT DISTINCT FROM") {
		t.Error("down section does not compare nullable columns with IS NOT DISTINCT FROM — NULL-safe comparison required")
	}
}

// Every category referenced by a seeded BrandCategory row must be one of the 20
// codes seeded by migration 0004. The FK would also catch this once applied, but
// this check runs without a database and names the offending code.
func TestCatalogSeedBrandCategoriesUseSeededCategories(t *testing.T) {
	cats, _, _ := parseCategorySeedMigration(t)
	known := make(map[string]bool, len(cats))
	for _, c := range cats {
		known[c.Code] = true
	}
	if len(known) == 0 {
		t.Fatal("could not parse the category seed migration — brand/category check would be vacuous")
	}

	up, _ := parseCatalogSeedMigration(t)
	brandIDs := map[string]bool{}
	for _, f := range parseSeedTuples(up, insertBrands) {
		brandIDs[f[0]] = true
	}

	seen := map[string]bool{}
	for _, f := range parseSeedTuples(up, insertBrandCats) {
		if len(f) != 2 {
			t.Fatalf("brandCategory tuple %v: want 2 fields", f)
		}
		if !brandIDs[f[0]] {
			t.Errorf("BrandCategory references unknown brand id %q", f[0])
		}
		if !known[f[1]] {
			t.Errorf("BrandCategory(%s) references category code %q which 0004 does not seed", f[0], f[1])
		}
		if seen[f[0]+"/"+f[1]] {
			t.Errorf("duplicate BrandCategory pair %s/%s", f[0], f[1])
		}
		seen[f[0]+"/"+f[1]] = true
	}
}

// The down section must delete exactly the rows up inserts, with identical
// values — otherwise a rollback either leaves orphans behind or deletes rows it
// did not create.
func TestCatalogSeedDownMirrorsUp(t *testing.T) {
	up, down := parseCatalogSeedMigration(t)

	collect := func(section, marker string, width int) map[string][]string {
		out := map[string][]string{}
		for _, f := range parseSeedTuples(section, marker) {
			if len(f) != width {
				t.Fatalf("%s tuple %v: want %d fields", marker, f, width)
			}
			out[f[0]] = f
		}
		return out
	}

	for _, tc := range []struct {
		name       string
		upMarker   string
		downMarker string
		width      int
	}{
		{"Brand", insertBrands, deleteBrands, 4},
		{"Store", insertStores, deleteStores, 5},
		{"WarrantyProvider", insertProviders, deleteProviders, 8},
	} {
		t.Run(tc.name, func(t *testing.T) {
			upRows := collect(up, tc.upMarker, tc.width)
			downRows := collect(down, tc.downMarker, tc.width)
			if len(upRows) == 0 || len(downRows) == 0 {
				t.Fatalf("could not parse %s tuples (up=%d down=%d)", tc.name, len(upRows), len(downRows))
			}
			for id, upFields := range upRows {
				downFields, ok := downRows[id]
				if !ok {
					t.Errorf("%s %s: inserted by up but not listed in down", tc.name, id)
					continue
				}
				for i := range upFields {
					if upFields[i] != downFields[i] {
						t.Errorf("%s %s field %d: up %q vs down %q — down would not match the row up inserted",
							tc.name, id, i, upFields[i], downFields[i])
					}
				}
			}
			for id := range downRows {
				if _, ok := upRows[id]; !ok {
					t.Errorf("%s %s: listed in down but never inserted by up", tc.name, id)
				}
			}
		})
	}
}

// ---- real-database assertions ----------------------------------------------
//
// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres (helpers in
// category_seed_test.go apply the goose migrations themselves).

func TestCatalogSeedAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	q := store.New(pool)

	// The exact strings the roadmap calls out as the reason this migration
	// exists must be present, with their Vietnamese names.
	wantStores := map[string]string{
		"dien-may-xanh": "Điện Máy Xanh",
		"fpt-shop":      "FPT Shop",
		"cellphones":    "CellphoneS",
		"shopee":        "Shopee",
	}
	stores, err := q.ListStores(ctx)
	if err != nil {
		t.Fatalf("ListStores: %v", err)
	}
	gotStores := map[string]string{}
	slugs := map[string]bool{}
	for _, s := range stores {
		gotStores[s.ID] = s.Name
		if slugs[s.Slug] {
			t.Errorf("duplicate store slug %q", s.Slug)
		}
		slugs[s.Slug] = true
		if s.Type != "ONLINE" && s.Type != "OFFLINE" {
			t.Errorf("store %s type = %q, want ONLINE/OFFLINE", s.ID, s.Type)
		}
	}
	for id, name := range wantStores {
		if gotStores[id] != name {
			t.Errorf("ListStores[%s] = %q, want %q (picker would be empty/misspelled on a fresh database)", id, gotStores[id], name)
		}
	}

	providers, err := q.ListWarrantyProviders(ctx)
	if err != nil {
		t.Fatalf("ListWarrantyProviders: %v", err)
	}
	if len(providers) == 0 {
		t.Fatal("ListWarrantyProviders returned 0 rows — fresh DB shows an empty warranty-centre picker")
	}
	for _, p := range providers {
		if p.Phone != nil || p.Address != nil {
			t.Errorf("provider %s carries unverifiable phone/address (%v / %v); the migration header promises NULL", p.ID, p.Phone, p.Address)
		}
	}

	brands, err := q.ListBrands(ctx)
	if err != nil {
		t.Fatalf("ListBrands: %v", err)
	}
	gotBrands := map[string]bool{}
	for _, b := range brands {
		gotBrands[b.ID] = true
	}
	for _, id := range []string{"apple", "samsung", "asus", "panasonic"} {
		if !gotBrands[id] {
			t.Errorf("brand %q missing from ListBrands", id)
		}
	}

	// The category-aware link must be readable through the same query the
	// catalog bundle uses, and the OCR brand matcher needs the names.
	links, err := q.ListAllBrandCategories(ctx)
	if err != nil {
		t.Fatalf("ListAllBrandCategories: %v", err)
	}
	appleCats := map[string]bool{}
	for _, l := range links {
		if l.BrandId == "apple" {
			appleCats[l.CategoryCode] = true
		}
	}
	if !appleCats["PHONE"] || !appleCats["LAPTOP"] {
		t.Errorf("apple category links = %v, want to include PHONE and LAPTOP", appleCats)
	}

	// The OCR draft path binds free text to a catalog brand via MatchScore; the
	// seeded names must therefore be non-empty and correctly cased.
	var apple string
	if err := pool.QueryRow(ctx, `SELECT name FROM "Brand" WHERE id = 'apple'`).Scan(&apple); err != nil {
		t.Fatalf("select apple: %v", err)
	}
	if apple != "Apple" {
		t.Errorf("Brand apple name = %q, want %q", apple, "Apple")
	}

	// The whole catalog bundle must come back non-empty so the pickers render.
	InvalidateCatalogCache()
	cat, err := ListCatalog(ctx, pool)
	if err != nil {
		t.Fatalf("ListCatalog: %v", err)
	}
	if len(cat.Stores) == 0 || len(cat.WarrantyProviders) == 0 || len(cat.Brands) == 0 {
		t.Fatalf("catalog bundle incomplete: %d stores, %d providers, %d brands",
			len(cat.Stores), len(cat.WarrantyProviders), len(cat.Brands))
	}
}

// Guards the regex-free parser itself: a tuple with a comma inside a Vietnamese
// note must not be split in two.
func TestSplitSQLTupleRespectsQuotedCommas(t *testing.T) {
	got := splitSQLTuple(`('apple-aasp', 'Trung tâm bảo hành Apple uỷ quyền', 'apple-aasp', NULL, NULL, 'https://locate.apple.com/', 'AASP tại Việt Nam, tra cứu trên locate.apple.com.', true),`)
	want := []string{"apple-aasp", "Trung tâm bảo hành Apple uỷ quyền", "apple-aasp", "", "", "https://locate.apple.com/", "AASP tại Việt Nam, tra cứu trên locate.apple.com.", "true"}
	if len(got) != len(want) {
		t.Fatalf("splitSQLTuple fields = %d (%v), want %d", len(got), got, len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("field %d = %q, want %q", i, got[i], want[i])
		}
	}
}
