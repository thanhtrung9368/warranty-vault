package services

import (
	"encoding/json"
	"strings"
	"testing"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Multi-currency devices, caught at entry (migration 0022, gap #16).
//
// The rate is LOCKED on the row, so every refusal below is a refusal to guess:
// a defaulted or missing rate would silently corrupt every total. These are pure
// tests (no database); the end-to-end behaviour lives in
// internal/handlers/devices_currency_test.go and the round trip in
// internal/services/backup_currency_test.go.

func money(v int32) *int32 { return &v }

func baseDeviceInput() DeviceInput {
	return DeviceInput{
		Name:         "iPhone 15",
		Category:     "PHONE",
		PurchaseDate: "2026-01-15",
	}
}

// fieldError returns the first message for key, or "".
func fieldError(t *testing.T, err error, key string) string {
	t.Helper()
	svc, ok := As(err)
	if !ok {
		t.Fatalf("error %v is not a services.Error", err)
	}
	msgs := svc.FieldErrors[key]
	if len(msgs) == 0 {
		return ""
	}
	return msgs[0]
}

// Every rule the contract states must be a 400 with fieldErrors.<field>, not a
// default and not a 500.
func TestValidateDeviceCurrencyRules(t *testing.T) {
	cases := []struct {
		name        string
		currency    string
		fxRate      *int32
		wantField   string // "" = valid
		wantMessage string // Vietnamese, pinned (viCtx)
	}{
		{name: "absent pair is valid (defaults to VND on create)", wantField: ""},
		{name: "explicit VND without a rate", currency: "VND", wantField: ""},
		{name: "VND with a rate is rejected", currency: "VND", fxRate: money(26100), wantField: "fxRate", wantMessage: "Thiết bị dùng VND không được có tỷ giá"},
		{name: "foreign currency without a rate is rejected", currency: "USD", wantField: "fxRate", wantMessage: "Thiếu tỷ giá"},
		{name: "foreign currency with a zero rate is rejected", currency: "USD", fxRate: money(0), wantField: "fxRate", wantMessage: "Tỷ giá phải là số nguyên dương"},
		{name: "foreign currency with a negative rate is rejected", currency: "USD", fxRate: money(-5), wantField: "fxRate", wantMessage: "Tỷ giá phải là số nguyên dương"},
		{name: "foreign currency with a positive rate is valid", currency: "USD", fxRate: money(26100)},
		{name: "lowercase is normalised", currency: " usd ", fxRate: money(26100)},
		{name: "unsupported currency is rejected", currency: "USDD", fxRate: money(26100), wantField: "currency", wantMessage: "Loại tiền không hợp lệ"},
		{name: "currency absent with a positive rate is left to create resolution", fxRate: money(26100)},
		{name: "currency absent with a non-positive rate is rejected", fxRate: money(0), wantField: "fxRate", wantMessage: "Tỷ giá phải là số nguyên dương"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := baseDeviceInput()
			in.Currency = tc.currency
			in.FxRate = tc.fxRate
			err := ValidateDeviceInput(viCtx(), &in)
			if tc.wantField == "" {
				if err != nil {
					t.Fatalf("expected valid, got %v", err)
				}
				if tc.currency != "" && in.Currency != strings.ToUpper(strings.TrimSpace(tc.currency)) {
					t.Errorf("currency not normalised: %q", in.Currency)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected a %s error, got nil", tc.wantField)
			}
			msg := fieldError(t, err, tc.wantField)
			if msg == "" {
				t.Fatalf("no fieldErrors.%s in %#v", tc.wantField, err)
			}
			if tc.wantMessage != "" && msg != tc.wantMessage {
				t.Errorf("fieldErrors.%s = %q, want %q", tc.wantField, msg, tc.wantMessage)
			}
			// The headline moves with the field errors (i18n rule): a Vietnamese
			// request must not get an English envelope around Vietnamese fields.
			if svc, _ := As(err); svc.Message != "Dữ liệu không hợp lệ" {
				t.Errorf("headline = %q, want the generic Vietnamese sentence", svc.Message)
			}
		})
	}
}

// A VND-only create must behave EXACTLY as it did before migration 0022: no
// currency, no rate, same status default.
func TestValidateDeviceWithoutCurrencyIsUnchanged(t *testing.T) {
	in := baseDeviceInput()
	in.PurchasePrice = 25_000_000
	if err := ValidateDeviceInput(viCtx(), &in); err != nil {
		t.Fatalf("a plain VND create must stay valid: %v", err)
	}
	if in.Currency != "" {
		t.Errorf("currency = %q; an absent currency must stay absent through validation (create resolution defaults it)", in.Currency)
	}
	if in.FxRate != nil {
		t.Errorf("fxRate = %v, want nil", in.FxRate)
	}
	if in.Status != "ACTIVE" {
		t.Errorf("status = %q, want ACTIVE", in.Status)
	}
}

func TestResolveCreateCurrency(t *testing.T) {
	cases := []struct {
		name      string
		currency  string
		fxRate    *int32
		wantCur   string
		wantRate  *int32
		wantField string
	}{
		{name: "absent defaults to VND", wantCur: "VND"},
		{name: "explicit VND", currency: "VND", wantCur: "VND"},
		{name: "VND with a rate", currency: "VND", fxRate: money(26100), wantField: "fxRate"},
		{name: "absent currency with a rate is a VND device with a rate", fxRate: money(26100), wantField: "fxRate"},
		{name: "USD requires a rate", currency: "USD", wantField: "fxRate"},
		{name: "USD with zero", currency: "USD", fxRate: money(0), wantField: "fxRate"},
		{name: "USD locks the rate", currency: "USD", fxRate: money(26100), wantCur: "USD", wantRate: money(26100)},
		{name: "unsupported", currency: "GBP?", fxRate: money(1), wantField: "currency"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := baseDeviceInput()
			in.Currency = tc.currency
			in.FxRate = tc.fxRate
			cur, rate, err := resolveCreateCurrency(viCtx(), in)
			if tc.wantField != "" {
				if err == nil {
					t.Fatalf("expected error on %s, got %s/%v", tc.wantField, cur, rate)
				}
				if fieldError(t, err, tc.wantField) == "" {
					t.Fatalf("no fieldErrors.%s in %#v", tc.wantField, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cur != tc.wantCur {
				t.Errorf("currency = %q, want %q", cur, tc.wantCur)
			}
			if (rate == nil) != (tc.wantRate == nil) || (rate != nil && *rate != *tc.wantRate) {
				t.Errorf("rate = %v, want %v", rate, tc.wantRate)
			}
		})
	}
}

func usdDevice(rate int32) store.Device {
	return store.Device{Currency: "USD", FxRate: money(rate), PurchasePrice: 999}
}

func vndDevice() store.Device {
	return store.Device{Currency: "VND", PurchasePrice: 25_000_000}
}

func TestResolveUpdateCurrency(t *testing.T) {
	cases := []struct {
		name      string
		stored    store.Device
		currency  string
		fxRate    *int32
		wantCur   string
		wantRate  *int32
		wantField string
	}{
		{
			name:   "absent keeps the stored VND",
			stored: vndDevice(), wantCur: "VND",
		},
		{
			name:   "absent keeps the stored USD and its locked rate",
			stored: usdDevice(26100), wantCur: "USD", wantRate: money(26100),
		},
		{
			name: "absent on a USD device re-locks the rate when one is sent",
			// This is the old-client case: a client that predates `currency` can
			// still correct the rate without destroying the currency.
			stored: usdDevice(26100), fxRate: money(27000),
			wantCur: "USD", wantRate: money(27000),
		},
		{
			name:   "a rate without a currency on a VND device is rejected",
			stored: vndDevice(), fxRate: money(26100),
			wantField: "fxRate",
		},
		{
			name:   "explicit VND clears the stored rate",
			stored: usdDevice(26100), currency: "VND",
			wantCur: "VND",
		},
		{
			name:   "explicit non-VND requires a rate even when one is stored",
			stored: usdDevice(26100), currency: "EUR",
			wantField: "fxRate",
		},
		{
			name:   "currency change uses the NEW rate, never the old one",
			stored: usdDevice(26100), currency: "EUR", fxRate: money(29000),
			wantCur: "EUR", wantRate: money(29000),
		},
		{
			name:   "explicit same currency re-locks with the supplied rate",
			stored: usdDevice(26100), currency: "USD", fxRate: money(25500),
			wantCur: "USD", wantRate: money(25500),
		},
		{
			name:   "explicit same currency without a rate is rejected",
			stored: usdDevice(26100), currency: "USD",
			wantField: "fxRate",
		},
		{
			name:   "explicit VND on a VND device",
			stored: vndDevice(), currency: "VND", wantCur: "VND",
		},
		{
			name:   "VND with a rate is rejected",
			stored: vndDevice(), currency: "VND", fxRate: money(1),
			wantField: "fxRate",
		},
		{
			name:      "hand-edited USD row with no rate cannot stay non-VND",
			stored:    store.Device{Currency: "USD", PurchasePrice: 999},
			wantField: "fxRate",
		},
		{
			name:   "unsupported currency",
			stored: vndDevice(), currency: "USDD", fxRate: money(1),
			wantField: "currency",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := baseDeviceInput()
			in.Currency = tc.currency
			in.FxRate = tc.fxRate
			cur, rate, err := resolveUpdateCurrency(viCtx(), in, tc.stored)
			if tc.wantField != "" {
				if err == nil {
					t.Fatalf("expected error on %s, got %s/%v", tc.wantField, cur, rate)
				}
				if fieldError(t, err, tc.wantField) == "" {
					t.Fatalf("no fieldErrors.%s in %#v", tc.wantField, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cur != tc.wantCur {
				t.Errorf("currency = %q, want %q", cur, tc.wantCur)
			}
			if (rate == nil) != (tc.wantRate == nil) || (rate != nil && *rate != *tc.wantRate) {
				t.Errorf("rate = %v, want %v", rate, tc.wantRate)
			}
		})
	}
}

// The computed values are the only definition of the conversion; both the device
// reads and the stats rollup must agree with it.
func TestVNDValue(t *testing.T) {
	cases := []struct {
		name     string
		amount   int32
		currency string
		rate     *int32
		want     *int64
	}{
		{name: "VND is 1:1", amount: 25_000_000, currency: "VND", want: int64Ptr(25_000_000)},
		{name: "empty currency is VND (legacy row)", amount: 1_000_000, currency: "", want: int64Ptr(1_000_000)},
		{name: "USD uses the locked rate", amount: 999, currency: "USD", rate: money(26100), want: int64Ptr(26_073_900)},
		{name: "missing rate is unknown, not face value", amount: 999, currency: "USD", want: nil},
		{name: "zero rate is unknown", amount: 999, currency: "USD", rate: money(0), want: nil},
		{name: "negative rate is unknown", amount: 999, currency: "USD", rate: money(-1), want: nil},
		// 2e9 * 3 = 6e9, which overflows int32 but is a perfectly valid int64.
		// Money totals must not wrap to a negative number.
		{name: "product above int32 stays positive", amount: 2_000_000_000, currency: "USD", rate: money(3), want: int64Ptr(6_000_000_000)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := vndValue(tc.amount, tc.currency, tc.rate)
			if (got == nil) != (tc.want == nil) {
				t.Fatalf("vndValue = %v, want %v", got, tc.want)
			}
			if got != nil && *got != *tc.want {
				t.Errorf("vndValue = %d, want %d", *got, *tc.want)
			}
		})
	}
}

func int64Ptr(v int64) *int64 { return &v }

func TestWithVNDJSONShape(t *testing.T) {
	soldPrice := int32(21_000_000)
	dev := store.Device{
		ID:            "dev_usd",
		Name:          "iPhone",
		Currency:      "USD",
		FxRate:        money(26100),
		PurchasePrice: 999,
		SoldPrice:     &soldPrice,
	}
	raw, err := json.Marshal(withVND(dev))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if string(got["currency"]) != `"USD"` {
		t.Errorf("currency = %s", got["currency"])
	}
	if string(got["fxRate"]) != `26100` {
		t.Errorf("fxRate = %s", got["fxRate"])
	}
	if string(got["purchasePriceVnd"]) != `26073900` {
		t.Errorf("purchasePriceVnd = %s, want 26073900 (999 * 26100)", got["purchasePriceVnd"])
	}
	if string(got["soldPriceVnd"]) != `548100000000` {
		t.Errorf("soldPriceVnd = %s, want 548100000000 (21000000 * 26100)", got["soldPriceVnd"])
	}

	// Not sold: soldPriceVnd is omitted (the contract says "when sold").
	dev.SoldPrice = nil
	raw, err = json.Marshal(withVND(dev))
	if err != nil {
		t.Fatalf("marshal unsold: %v", err)
	}
	var unsold map[string]json.RawMessage
	if err := json.Unmarshal(raw, &unsold); err != nil {
		t.Fatalf("unmarshal unsold: %v", err)
	}
	if _, ok := unsold["soldPriceVnd"]; ok {
		t.Error("soldPriceVnd must be absent on a device that is not sold")
	}
	if string(unsold["purchasePriceVnd"]) != `26073900` {
		t.Errorf("purchasePriceVnd = %s", unsold["purchasePriceVnd"])
	}

	// A VND device still gets purchasePriceVnd, and it equals purchasePrice.
	vnd := store.Device{Currency: "VND", PurchasePrice: 25_000_000}
	raw, err = json.Marshal(withVND(vnd))
	if err != nil {
		t.Fatalf("marshal vnd: %v", err)
	}
	var vndMap map[string]json.RawMessage
	if err := json.Unmarshal(raw, &vndMap); err != nil {
		t.Fatalf("unmarshal vnd: %v", err)
	}
	if string(vndMap["purchasePriceVnd"]) != `25000000` {
		t.Errorf("purchasePriceVnd = %s, want 25000000", vndMap["purchasePriceVnd"])
	}
	if string(vndMap["fxRate"]) != `null` {
		t.Errorf("a VND device's fxRate must serialise as null, got %s", vndMap["fxRate"])
	}

	// A non-VND row with no rate must NOT report its face value as VND.
	broken := store.Device{Currency: "EUR", PurchasePrice: 999}
	raw, err = json.Marshal(withVND(broken))
	if err != nil {
		t.Fatalf("marshal broken: %v", err)
	}
	var brokenMap map[string]json.RawMessage
	if err := json.Unmarshal(raw, &brokenMap); err != nil {
		t.Fatalf("unmarshal broken: %v", err)
	}
	if string(brokenMap["purchasePriceVnd"]) != `null` {
		t.Errorf("purchasePriceVnd = %s, want null for a non-VND row without a rate", brokenMap["purchasePriceVnd"])
	}
}
