package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Warranty-lookup seed (gap #11, migration 0023).
//
// Migration 0012's header lays down the rule this test defends: every URL the
// app shows a user standing at a counter must be SOURCED, never guessed. 0023
// adds the brand's warranty-STATUS page for the brands where such a page could
// actually be verified, and leaves the rest NULL. The test pins that list in
// code, so adding a URL requires editing this file and documenting where it came
// from — the deliberate act the honesty rule asks for.
//
// This is DB-free: it parses the migration text, like
// brand_service_info_seed_test.go does for 0012.

const warrantyLookupMigration = "0023_brand_warranty_lookup.sql"

const warrantyLookupSeedMarker = `UPDATE public."BrandServiceInfo" AS b`

// warrantyLookupAllowlist is the COMPLETE set of URLs 0023 may seed. Each entry
// records what was actually verified when this feature was written. The values
// are not fetched by the app or by this test — the guarantee is that a human
// looked at the live official page, not that the page is up today.
var warrantyLookupAllowlist = map[string]string{
	// Apple's own "AppleCare & Warranty" coverage checker. The page resolves to
	// a country selector that lists Việt Nam; it is the tool Apple support links
	// for "check your warranty or AppleCare contract".
	"apple": "https://checkcoverage.apple.com/",
	// Samsung Việt Nam, page title "Kiểm tra thời hạn bảo hành điện tử".
	"samsung": "https://www.samsung.com/vn/support/warrantycheck/",
	// ASUS Việt Nam, page title "Kiểm tra tình trạng bảo hành".
	"asus": "https://www.asus.com/vn/support/warranty-status-inquiry/",
	// Lenovo Support VN, page title "Lenovo Warranty Check | Device Warranty
	// Lookup | Lenovo Support VN".
	"lenovo": "https://pcsupport.lenovo.com/vn/vi/warranty-lookup",
}

// brandsLeftNullForLackOfAVerifiableLookupURL are the 0012 brands 0023
// deliberately does NOT seed. Most publish only a warranty POLICY or a how-to
// article; Dell/HP/Acer could not be verified from this machine. The list is
// asserted so a future edit cannot quietly turn one of them into a guess.
var brandsLeftNullForLackOfAVerifiableLookupURL = []string{
	"xiaomi", "oppo", "vivo", "realme", "sony", "lg",
	"panasonic", "daikin", "electrolux", "acer", "dell", "hp",
}

func parseWarrantyLookupMigration(t *testing.T) (up, down, whole string) {
	t.Helper()
	path := repoFile(t, filepath.Join("api", "migrations", warrantyLookupMigration))
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

func TestWarrantyLookupSeedOnlySourcedURLs(t *testing.T) {
	up, _, _ := parseWarrantyLookupMigration(t)
	rows := parseSeedTuples(up, warrantyLookupSeedMarker)
	if len(rows) != len(warrantyLookupAllowlist) {
		t.Fatalf("seeded warranty lookup URLs = %d, want %d (the allowlist is the complete set)", len(rows), len(warrantyLookupAllowlist))
	}

	seen := map[string]bool{}
	for _, f := range rows {
		if len(f) != 2 {
			t.Fatalf("warranty lookup tuple %v: want 2 fields (brandId, url)", f)
		}
		brandID, got := f[0], f[1]
		want, ok := warrantyLookupAllowlist[brandID]
		if !ok {
			t.Errorf("0023 seeds %q, which is NOT in the verified allowlist — a new external claim needs a documented source", brandID)
			continue
		}
		if seen[brandID] {
			t.Errorf("0023 seeds %q twice", brandID)
		}
		seen[brandID] = true
		if got != want {
			t.Errorf("0023 seeds %s = %q, want %q", brandID, got, want)
		}
		if !strings.HasPrefix(got, "https://") {
			t.Errorf("0023 seeds a non-https URL for %s: %q", brandID, got)
		}
		if strings.TrimSpace(got) != got || strings.ContainsAny(got, " \t\r\n") {
			t.Errorf("0023 seeds a URL with whitespace for %s: %q", brandID, got)
		}
	}
	for brandID := range warrantyLookupAllowlist {
		if !seen[brandID] {
			t.Errorf("allowlist has %q but 0023 does not seed it", brandID)
		}
	}
	for _, brandID := range brandsLeftNullForLackOfAVerifiableLookupURL {
		if seen[brandID] {
			t.Errorf("%q was seeded even though no official lookup page could be verified", brandID)
		}
	}
}

// TestWarrantyLookupSeedBrandsHaveADirectoryRow keeps the UPDATE honest without
// a database: a URL can only be attached to a brand that migration 0012 already
// seeds a directory row for.
func TestWarrantyLookupSeedBrandsHaveADirectoryRow(t *testing.T) {
	up, _, _ := parseWarrantyLookupMigration(t)
	directoryUp, _, _ := parseBrandServiceInfoMigration(t)
	known := map[string]bool{}
	for _, f := range parseSeedTuples(directoryUp, insertBrandServiceInfo) {
		known[f[0]] = true
	}
	if len(known) == 0 {
		t.Fatal("could not parse migration 0012 — this check would be vacuous")
	}
	for _, f := range parseSeedTuples(up, warrantyLookupSeedMarker) {
		if !known[f[0]] {
			t.Errorf("0023 sets a warrantyLookupUrl for %q, which has no BrandServiceInfo row in migration 0012", f[0])
		}
	}
}

func TestWarrantyLookupMigrationShape(t *testing.T) {
	up, down, whole := parseWarrantyLookupMigration(t)

	// The five device columns and the directory column are all added by 0023.
	for _, col := range []string{
		`"brandWarrantyStatus"`, `"brandWarrantyStart"`, `"brandWarrantyEnd"`,
		`"brandCheckedAt"`, `"brandLookupUrl"`,
	} {
		if !strings.Contains(up, col) {
			t.Errorf("up section does not add Device.%s", col)
		}
	}
	if !strings.Contains(up, `ADD COLUMN IF NOT EXISTS "warrantyLookupUrl" text`) {
		t.Error(`up section does not add BrandServiceInfo."warrantyLookupUrl" text`)
	}

	// warrantyMismatch is derived. It must not appear in an ALTER TABLE at all.
	// (The header mentions it to explain why it is absent; that is not a column.)
	for _, line := range strings.Split(whole, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "--") {
			continue
		}
		if strings.Contains(trimmed, `"warrantyMismatch"`) {
			t.Errorf("0023 references a warrantyMismatch column: %s", trimmed)
		}
	}

	// Re-running must not overwrite an operator correction.
	if !strings.Contains(up, `AND b."warrantyLookupUrl" IS NULL`) {
		t.Error("the seed does not guard on warrantyLookupUrl IS NULL — a re-run would overwrite operator edits")
	}

	// Rollback removes every column the migration added.
	for _, col := range []string{
		`DROP COLUMN IF EXISTS "warrantyLookupUrl"`,
		`DROP COLUMN IF EXISTS "brandLookupUrl"`,
		`DROP COLUMN IF EXISTS "brandCheckedAt"`,
		`DROP COLUMN IF EXISTS "brandWarrantyEnd"`,
		`DROP COLUMN IF EXISTS "brandWarrantyStart"`,
		`DROP COLUMN IF EXISTS "brandWarrantyStatus"`,
	} {
		if !strings.Contains(down, col) {
			t.Errorf("down section is missing %q", col)
		}
	}
}
