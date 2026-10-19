package services

import (
	"context"
	"strings"
	"testing"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// Pure (database-free) tests for the bulk device planner. The transaction,
// quota and HTTP behaviour are covered in internal/handlers/devices_bulk_test.go;
// these tests pin the rule that is easiest to get wrong and cheapest to test here:
// every row is validated independently, in request order, and the failure index
// is the REQUEST index rather than the failure position.

func bulkTestInput(name string) DeviceInput {
	return DeviceInput{
		Name:          name,
		Category:      "PHONE",
		PurchaseDate:  "2026-01-15",
		PurchasePrice: 12_000_000,
	}
}

func bulkTestCategories() catalogCategoryLookup {
	return catalogCategoryLookup{"PHONE": {}}
}

// One bad row does not stop the others, and the arrays keep request order. The
// failing rows span the three per-row rules: field validation, category, and the
// create-only date parse (which is NOT in ValidateDeviceInput).
func TestPlanBulkDevicesPartialSuccessAndRequestOrder(t *testing.T) {
	inputs := []DeviceInput{
		bulkTestInput("Máy 0"),
		{Name: "", Category: "PHONE", PurchaseDate: "2026-01-15"}, // bad: name
		bulkTestInput("Máy 2"),
		{Name: "Máy 3", Category: "NOT_A_CATEGORY", PurchaseDate: "2026-01-15"}, // bad: category
		{Name: "Máy 4", Category: "PHONE", PurchaseDate: "31/12/2025"},          // bad: date parse
	}

	plan, err := planBulkDevices(viCtx(), inputs, bulkTestCategories())
	if err != nil {
		t.Fatalf("planBulkDevices: %v", err)
	}

	if len(plan.candidates) != 2 {
		t.Fatalf("candidates = %d, want 2", len(plan.candidates))
	}
	if plan.candidates[0].index != 0 || plan.candidates[1].index != 2 {
		t.Errorf("candidate request indices = %d,%d, want 0,2 — created order and gaps must be preserved",
			plan.candidates[0].index, plan.candidates[1].index)
	}
	if plan.candidates[0].input.Name != "Máy 0" || plan.candidates[1].input.Name != "Máy 2" {
		t.Errorf("candidate order = %q,%q, want request order Máy 0,Máy 2",
			plan.candidates[0].input.Name, plan.candidates[1].input.Name)
	}

	wantFailures := []struct {
		index     int
		code      string
		field     string
		viMessage string
	}{
		{1, "validation", "name", "Tên thiết bị bắt buộc"},
		{3, "category_invalid", "category", "Loại thiết bị không hợp lệ"},
		{4, "validation", "purchaseDate", "Ngày mua không hợp lệ"},
	}
	if len(plan.failures) != len(wantFailures) {
		t.Fatalf("failures = %d, want %d: %+v", len(plan.failures), len(wantFailures), plan.failures)
	}
	for i, want := range wantFailures {
		got := plan.failures[i]
		if got.Index != want.index {
			t.Errorf("failures[%d].index = %d, want %d (request index, not failure position)", i, got.Index, want.index)
		}
		if got.Code != want.code {
			t.Errorf("failures[%d].code = %q, want %q", i, got.Code, want.code)
		}
		messages := got.FieldErrors[want.field]
		if len(messages) == 0 {
			t.Errorf("failures[%d].fieldErrors = %v, want a %q entry", i, got.FieldErrors, want.field)
			continue
		}
		if messages[0] != want.viMessage {
			t.Errorf("failures[%d].fieldErrors[%q] = %q, want %q", i, want.field, messages[0], want.viMessage)
		}
	}
}

// A wholly invalid batch is a valid 200-shaped outcome: nothing to insert, every
// row accounted for. The service decides the HTTP status; the planner must not
// invent a quota error or drop rows.
func TestPlanBulkDevicesAllRowsFail(t *testing.T) {
	plan, err := planBulkDevices(viCtx(), []DeviceInput{
		{Name: "", Category: "PHONE", PurchaseDate: "2026-01-15"},
		{Name: "Máy", Category: "", PurchaseDate: "2026-01-15"},
		{Name: "Máy", Category: "PHONE", PurchaseDate: ""},
	}, bulkTestCategories())
	if err != nil {
		t.Fatalf("planBulkDevices: %v", err)
	}
	if len(plan.candidates) != 0 {
		t.Fatalf("candidates = %d, want 0", len(plan.candidates))
	}
	if len(plan.failures) != 3 {
		t.Fatalf("failures = %d, want 3", len(plan.failures))
	}
	for i, failure := range plan.failures {
		if failure.Index != i {
			t.Errorf("failures[%d].index = %d, want %d", i, failure.Index, i)
		}
		if len(failure.FieldErrors) == 0 {
			t.Errorf("failures[%d] has no fieldErrors: %+v", i, failure)
		}
	}
}

func TestValidateBulkBatchSize(t *testing.T) {
	for _, tc := range []struct {
		name string
		n    int
		ok   bool
	}{
		{"empty", 0, false},
		{"one", 1, true},
		{"exactly 50", MaxBulkDeviceRows, true},
		{"51", MaxBulkDeviceRows + 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateBulkBatchSize(viCtx(), tc.n)
			if tc.ok {
				if err != nil {
					t.Fatalf("validateBulkBatchSize(%d) = %v, want nil", tc.n, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("validateBulkBatchSize(%d) = nil, want a 400-shaped error", tc.n)
			}
			svc, ok := As(err)
			if !ok || svc.Code != "VALIDATION" {
				t.Fatalf("error = %#v, want VALIDATION", err)
			}
			if len(svc.FieldErrors["devices"]) == 0 {
				t.Errorf("fieldErrors = %v, want a `devices` entry", svc.FieldErrors)
			}
		})
	}

	// The two sentences are part of the contract's error surface, so pin both
	// languages rather than only the code. Error.Error() returns the Vietnamese
	// source (the key); the handler renders MessageKey, which is what follows the
	// request language.
	errEN := ValidateBulkBatchSize(context.Background(), 0)
	if errEN == nil {
		t.Fatal("empty batch (en) = nil, want an error")
	}
	if svc, ok := As(errEN); !ok || i18n.Text(context.Background(), svc.MessageKey) != "At least one device is required" {
		t.Errorf("empty batch (en) = %#v, want the translated sentence", errEN)
	}
	errVI := ValidateBulkBatchSize(viCtx(), MaxBulkDeviceRows+1)
	if errVI == nil || !strings.Contains(errVI.Error(), "tối đa 50 thiết bị") {
		t.Errorf("over-cap batch (vi) = %v, want the translated sentence", errVI)
	}
}

// The per-row message must follow the request's language even though the error
// is built deep inside the service. This is the MessageKey path in
// bulkFailureFromError, and it is the same rendering the single endpoint's
// envelope writer performs.
func TestBulkFailureMessageFollowsRequestLanguage(t *testing.T) {
	allBad := []DeviceInput{{Name: "Máy", Category: "NOT_A_CATEGORY", PurchaseDate: "2026-01-15"}}

	enPlan, err := planBulkDevices(context.Background(), allBad, bulkTestCategories())
	if err != nil {
		t.Fatalf("plan (en): %v", err)
	}
	if len(enPlan.failures) != 1 || enPlan.failures[0].Message != "Invalid device category" {
		t.Fatalf("en failure = %+v, want message %q", enPlan.failures, "Invalid device category")
	}

	viPlan, err := planBulkDevices(viCtx(), allBad, bulkTestCategories())
	if err != nil {
		t.Fatalf("plan (vi): %v", err)
	}
	if len(viPlan.failures) != 1 || viPlan.failures[0].Message != "Loại thiết bị không hợp lệ" {
		t.Fatalf("vi failure = %+v, want message %q", viPlan.failures, "Loại thiết bị không hợp lệ")
	}
}

// The single create and the bulk planner must generate the same field errors for
// the same invalid input. This is the unit-level half of the no-behaviour-change
// proof; the HTTP-level half lives in the handler test.
func TestBulkAndSingleValidationMessagesAgree(t *testing.T) {
	in := DeviceInput{Name: "", Category: "", PurchaseDate: ""}

	singleErr := ValidateDeviceInput(viCtx(), &in)
	if singleErr == nil {
		t.Fatal("single validation accepted an empty input")
	}
	singleSvc, _ := As(singleErr)

	plan, err := planBulkDevices(viCtx(), []DeviceInput{in}, bulkTestCategories())
	if err != nil {
		t.Fatalf("planBulkDevices: %v", err)
	}
	if len(plan.failures) != 1 {
		t.Fatalf("failures = %d, want 1", len(plan.failures))
	}
	bulkFailure := plan.failures[0]

	if bulkFailure.Code != strings.ToLower(singleSvc.Code) {
		t.Errorf("bulk code = %q, single code = %q", bulkFailure.Code, strings.ToLower(singleSvc.Code))
	}
	if bulkFailure.Message != i18n.Text(viCtx(), singleSvc.MessageKey) {
		t.Errorf("bulk message = %q, single message = %q", bulkFailure.Message, i18n.Text(viCtx(), singleSvc.MessageKey))
	}
	for field, singleMessages := range singleSvc.FieldErrors {
		bulkMessages := bulkFailure.FieldErrors[field]
		if len(bulkMessages) != len(singleMessages) {
			t.Errorf("field %q: bulk %v, single %v", field, bulkMessages, singleMessages)
			continue
		}
		for i := range singleMessages {
			if bulkMessages[i] != singleMessages[i] {
				t.Errorf("field %q message %d: bulk %q, single %q", field, i, bulkMessages[i], singleMessages[i])
			}
		}
	}
}
