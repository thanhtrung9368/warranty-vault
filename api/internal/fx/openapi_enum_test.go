package fx

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// openapiCurrencyEnum matches the four currency lists in openapi.yaml (the
// `base` query parameter and the Device / DeviceInput / BackupDevice schemas).
// They all start with VND, USD; requiring that prefix keeps the match from
// picking up unrelated enums such as Forecast.currency ([VND]).
var openapiCurrencyEnum = regexp.MustCompile(`enum: \[(VND, [A-Z]{3}(?:, [A-Z]{3})*)\]`)

// The supported list is a frozen part of the contract: the three clients build
// their currency pickers from the OpenAPI enum, and the server validates
// against this package's list. If the two drift, a client offers a code the
// server rejects (or hides one it would accept) — a failure no Go test would
// otherwise catch. This mirrors category_seed_test.go's re-parse of
// website/src/lib/types.ts.
func TestSupportedCurrenciesMatchOpenAPIEnum(t *testing.T) {
	raw, err := os.ReadFile("../../../openapi.yaml")
	if err != nil {
		t.Fatalf("read openapi.yaml: %v", err)
	}
	matches := openapiCurrencyEnum.FindAllStringSubmatch(string(raw), -1)
	if len(matches) < 4 {
		t.Fatalf("found %d currency enums in openapi.yaml, want at least 4 (base param + Device + DeviceInput + BackupDevice)", len(matches))
	}

	want := map[string]bool{}
	for _, c := range SupportedCurrencies() {
		want[c] = true
	}
	for i, m := range matches {
		codes := strings.Split(m[1], ", ")
		got := map[string]bool{}
		for _, c := range codes {
			got[c] = true
		}
		if len(got) != len(want) {
			t.Errorf("openapi.yaml currency enum #%d has %d codes, SupportedCurrencies has %d", i+1, len(got), len(want))
		}
		for c := range want {
			if !got[c] {
				t.Errorf("openapi.yaml currency enum #%d is missing %s", i+1, c)
			}
		}
		for c := range got {
			if !want[c] {
				t.Errorf("openapi.yaml currency enum #%d offers %s, which SupportedCurrencies rejects", i+1, c)
			}
		}
	}
}
