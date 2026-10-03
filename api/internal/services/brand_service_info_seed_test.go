package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Warranty directory seed (FEATURE_IDEAS #15, migration 0012).
//
// These tests are DB-free: they parse the migration text, exactly like
// catalog_seed_test.go does for 0008. The claim they defend is the honesty claim
// in the migration header — "every URL below is COPIED, not researched" — and the
// structural claim that comes with it: the table has no phone and no address
// column, so nobody can fill in a hotline this repo cannot verify.

const brandServiceInfoMigration = "0012_brand_service_info.sql"

const insertBrandServiceInfo = `INSERT INTO public."BrandServiceInfo" ("brandId", "serviceLocatorUrl", "supportUrl", notes, "isActive") VALUES`

// minSeededBrandServiceInfo is a floor, so a truncated file fails loudly instead
// of quietly shrinking the directory.
const minSeededBrandServiceInfo = 10

func parseBrandServiceInfoMigration(t *testing.T) (up, down, whole string) {
	t.Helper()
	path := repoFile(t, filepath.Join("api", "migrations", brandServiceInfoMigration))
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
	return src[upIdx:downIdx], src[downIdx:], src
}

// TestBrandServiceInfoSeedIntroducesNoNewExternalClaims is the core honesty test:
// every URL the directory ships must already exist verbatim in migration 0008's
// WarrantyProvider rows. If a future edit adds a freshly researched link, this
// fails and forces the author to say where it came from — which is the point,
// because the app presents these links to a user standing at a counter.
func TestBrandServiceInfoSeedIntroducesNoNewExternalClaims(t *testing.T) {
	up, _, _ := parseBrandServiceInfoMigration(t)
	knownURLs := map[string]bool{}
	// 0008's provider tuples are (id, name, slug, phone, address, websiteUrl,
	// notes, isActive); only the websiteUrl column may be reused.
	catalogUp, _ := parseCatalogSeedMigration(t)
	for _, f := range parseSeedTuples(catalogUp, insertProviders) {
		if len(f) != 8 {
			t.Fatalf("0008 provider tuple %v: want 8 fields", f)
		}
		if f[5] != "" {
			knownURLs[f[5]] = true
		}
	}
	if len(knownURLs) == 0 {
		t.Fatal("could not read any websiteUrl from migration 0008 — this check would be vacuous")
	}

	rows := parseSeedTuples(up, insertBrandServiceInfo)
	if len(rows) < minSeededBrandServiceInfo {
		t.Fatalf("seeded directory rows = %d, want >= %d", len(rows), minSeededBrandServiceInfo)
	}
	for _, f := range rows {
		if len(f) != 5 {
			t.Fatalf("directory tuple %v: want 5 fields", f)
		}
		brandID, locator, support, notes, active := f[0], f[1], f[2], f[3], f[4]
		if brandID == "" {
			t.Fatal("a directory row has no brandId")
		}
		if active != "true" {
			t.Errorf("directory row %s: isActive = %q, want true", brandID, active)
		}
		if locator == "" && support == "" {
			t.Errorf("directory row %s has neither URL — it would answer nothing", brandID)
		}
		if strings.TrimSpace(notes) == "" {
			t.Errorf("directory row %s has no notes explaining what the link is for", brandID)
		}
		for _, u := range []string{locator, support} {
			if u == "" {
				continue
			}
			if !knownURLs[u] {
				t.Errorf("directory row %s uses %q, which is NOT one of the URLs already seeded by 0008 — a new external claim needs a source", brandID, u)
			}
		}
	}
}

// TestBrandServiceInfoSeedBrandsExist keeps the FK honest without a database: a
// typo would otherwise only fail when the migration runs.
func TestBrandServiceInfoSeedBrandsExist(t *testing.T) {
	up, _, _ := parseBrandServiceInfoMigration(t)
	catalogUp, _ := parseCatalogSeedMigration(t)
	known := map[string]bool{}
	for _, f := range parseSeedTuples(catalogUp, insertBrands) {
		known[f[0]] = true
	}
	if len(known) == 0 {
		t.Fatal("could not parse the brand seed — this check would be vacuous")
	}
	seen := map[string]bool{}
	for _, f := range parseSeedTuples(up, insertBrandServiceInfo) {
		if !known[f[0]] {
			t.Errorf("directory row %q points at a brand that migration 0008 does not seed", f[0])
		}
		if seen[f[0]] {
			t.Errorf("directory row %q is seeded twice (the PK would abort the migration)", f[0])
		}
		seen[f[0]] = true
	}
}

// TestBrandServiceInfoTableHasNoContactColumns pins the decision that makes this
// feature honest. 0008 left WarrantyProvider.phone/address NULL because
// "a wrong hotline is worse than an empty one"; 0012 must not reintroduce the
// problem one table over by giving the column a home. Adding one is allowed — but
// it has to be a deliberate edit that also updates this test and the migration
// header, not an accident.
func TestBrandServiceInfoTableHasNoContactColumns(t *testing.T) {
	_, _, whole := parseBrandServiceInfoMigration(t)
	start := strings.Index(whole, `CREATE TABLE public."BrandServiceInfo"`)
	if start < 0 {
		t.Fatal("migration 0012 does not create the BrandServiceInfo table")
	}
	end := strings.Index(whole[start:], ");")
	if end < 0 {
		t.Fatal("could not find the end of the CREATE TABLE statement")
	}
	ddl := strings.ToLower(whole[start : start+end])
	for _, forbidden := range []string{"phone", "hotline", "address"} {
		if strings.Contains(ddl, forbidden) {
			t.Errorf("BrandServiceInfo gained a %q column — a hotline/address this repo cannot verify must not have a home", forbidden)
		}
	}
	for _, want := range []string{"servicelocatorurl", "supporturl", "notes"} {
		if !strings.Contains(ddl, want) {
			t.Errorf("BrandServiceInfo is missing the %q column", want)
		}
	}
}

func TestBrandServiceInfoIsIdempotentAndFullyReversible(t *testing.T) {
	up, down, _ := parseBrandServiceInfoMigration(t)
	if !strings.Contains(up, `ON CONFLICT ("brandId") DO NOTHING`) {
		t.Error("up section does not use ON CONFLICT (brandId) DO NOTHING — re-running on an edited database would fail")
	}
	if !strings.Contains(down, `DROP TABLE IF EXISTS public."BrandServiceInfo"`) {
		t.Error("down section must drop the table this migration created")
	}
}
