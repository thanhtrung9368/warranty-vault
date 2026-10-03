package services

import "testing"

// Pure tests for the warranty-directory matcher (FEATURE_IDEAS #15). No database:
// splitting bestCatalogMatch out of BuildServiceDirectory is what makes the rule —
// including the cases where it must REFUSE to answer — pinnable exactly.
//
// The rule is direction-only: the user's text must CONTAIN a whole catalog name.

func TestBestCatalogMatchRequiresTheCatalogNameToBeContained(t *testing.T) {
	brands := []string{"Apple", "Samsung", "LG", "HONOR"}
	cases := []struct {
		name  string
		input string
		want  string
	}{
		{"exact", "Samsung", "Samsung"},
		{"different case", "samsung", "Samsung"},
		{"model after the brand", "Samsung Galaxy S24 Ultra", "Samsung"},
		{"words before the brand", "Điện thoại Samsung", "Samsung"},
		{"accent folding", "Điện thoại HONOR", "HONOR"},
		{"short brand as its own token", "LG G8 ThinQ", "LG"},
		{"surrounding spaces", "  Apple  ", "Apple"},
		{"punctuation is dropped, not glued", "Apple, iPhone 15", "Apple"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			idx, ok := bestCatalogMatch(tc.input, brands)
			if !ok {
				t.Fatalf("bestCatalogMatch(%q) = no match, want %q", tc.input, tc.want)
			}
			if got := brands[idx]; got != tc.want {
				t.Fatalf("bestCatalogMatch(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}

func TestBestCatalogMatchRefusesToGuess(t *testing.T) {
	// Every case must return ok=false. A directory entry sends the user to a
	// specific counter, so "no answer" is strictly better than a plausible wrong one.
	brands := []string{"Apple", "Samsung", "LG", "Tân Á Đại Thành"}
	for _, input := range []string{
		"",
		"   ",
		"Máy giặt cửa trước",
		"Applesauce", // a partial word is not a shared token
		"Tân Á",      // a prefix of a multi-token brand is not the brand name
		"Tân Đại",    // nor is an out-of-order subset of its tokens
		"iPhone 15",  // the model, not the brand
	} {
		t.Run(input, func(t *testing.T) {
			if idx, ok := bestCatalogMatch(input, brands); ok {
				t.Fatalf("bestCatalogMatch(%q) = %q, want NO match", input, brands[idx])
			}
		})
	}
}

func TestBestCatalogMatchRejectsGenericProviderWords(t *testing.T) {
	// The failure this rule exists to prevent: with a bidirectional token rule,
	// "uỷ quyền" is a subset of EXACTLY ONE seeded provider row and would silently
	// resolve to Apple. Generic words identify nothing and must match nothing.
	providers := []string{
		"Trung tâm bảo hành Apple uỷ quyền",
		"Trung tâm bảo hành Samsung",
		"Trung tâm bảo hành Xiaomi",
	}
	for _, generic := range []string{"Trung tâm bảo hành", "bảo hành", "uỷ quyền", "trung tâm"} {
		t.Run(generic, func(t *testing.T) {
			if idx, ok := bestCatalogMatch(generic, providers); ok {
				t.Fatalf("generic %q resolved to %q, want NO match", generic, providers[idx])
			}
		})
	}

	// The full names — what the device form picker actually inserts — do resolve.
	for _, full := range providers {
		idx, ok := bestCatalogMatch(full, providers)
		if !ok || providers[idx] != full {
			t.Fatalf("picker value %q did not resolve: ok=%v", full, ok)
		}
	}
	// …and so does a hand-typed value that qualifies one of them.
	idx, ok := bestCatalogMatch("Trung tâm bảo hành Samsung Quận 7", providers)
	if !ok || providers[idx] != "Trung tâm bảo hành Samsung" {
		t.Fatalf("qualified provider name did not resolve: ok=%v idx=%d", ok, idx)
	}
}

func TestBestCatalogMatchTieIsNoMatch(t *testing.T) {
	// Two catalog names contained equally well in the same input: any answer would
	// be arbitrary. This is the remaining ambiguity the rule cannot resolve.
	brands := []string{"Apple", "Samsung"}
	if idx, ok := bestCatalogMatch("Apple Samsung", brands); ok {
		t.Fatalf("ambiguous input matched %q, want NO match", brands[idx])
	}
}

func TestBestCatalogMatchPrefersTheMostSpecificCandidate(t *testing.T) {
	// A short catalog name that is also contained in a longer one must not shadow it.
	names := []string{"Xiaomi", "Trung tâm bảo hành Xiaomi"}
	idx, ok := bestCatalogMatch("Trung tâm bảo hành Xiaomi", names)
	if !ok {
		t.Fatal("expected a match")
	}
	if names[idx] != "Trung tâm bảo hành Xiaomi" {
		t.Fatalf("matched %q, want the longest (most specific) candidate", names[idx])
	}
	// And a bare brand still resolves to the short one, not to nothing.
	idx, ok = bestCatalogMatch("Xiaomi", names)
	if !ok || names[idx] != "Xiaomi" {
		t.Fatalf("bare brand did not resolve to its own row: ok=%v idx=%d", ok, idx)
	}
}

func TestTokenSetFoldsVietnameseDiacritics(t *testing.T) {
	got := tokenSet("Điện Thoại  Samsung  ")
	want := map[string]bool{"dien": true, "thoai": true, "samsung": true}
	if len(got) != len(want) {
		t.Fatalf("tokenSet = %v, want %v", got, want)
	}
	for tok := range want {
		if !got[tok] {
			t.Errorf("tokenSet missing %q (got %v)", tok, got)
		}
	}
}
