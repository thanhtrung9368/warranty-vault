package services

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
)

func strp(s string) *string { return &s }
func i64p(i int64) *int64   { return &i }
func intp(i int) *int       { return &i }

func testCatalog() *Catalog {
	return &Catalog{
		Categories: []CategoryOption{
			{Code: "PHONE", Name: "Điện thoại"},
			{Code: "LAPTOP", Name: "Laptop"},
		},
		Brands: []BrandOption{
			{ID: "brand_apple", Name: "Apple"},
			{ID: "brand_samsung", Name: "Samsung"},
		},
		Stores: []StoreOption{
			{ID: "store_tgdd", Name: "Thế Giới Di Động"},
			{ID: "store_dmx", Name: "Điện Máy Xanh"},
		},
	}
}

func TestBuildDraft_MapsCatalogDiacriticInsensitive(t *testing.T) {
	// Store name without diacritics (typical OCR output) must still bind.
	e := ai.ExtractedReceipt{
		Name:           strp("iPhone 15 Pro"),
		Brand:          strp("apple"),
		PurchasePlace:  strp("the gioi di dong"),
		PurchasePrice:  i64p(28990000),
		WarrantyMonths: intp(12),
		Category:       strp("Điện thoại"),
		Confidence:     strp("high"),
	}
	d := buildDraft(e, testCatalog())

	if d.BrandID == nil || *d.BrandID != "brand_apple" {
		t.Errorf("brand not mapped: %+v", d.BrandID)
	}
	if d.StoreID == nil || *d.StoreID != "store_tgdd" {
		t.Errorf("store not mapped: %+v", d.StoreID)
	}
	if d.Category == nil || *d.Category != "PHONE" {
		t.Errorf("category not mapped to code: %+v", d.Category)
	}
	if d.Confidence != "high" {
		t.Errorf("confidence = %q, want high", d.Confidence)
	}
	if d.PurchasePrice == nil || *d.PurchasePrice != 28990000 {
		t.Errorf("price passthrough failed: %+v", d.PurchasePrice)
	}
	if len(d.Unmatched) != 0 {
		t.Errorf("expected no unmatched, got %v", d.Unmatched)
	}
}

func TestBuildDraft_UnmatchedFreeText(t *testing.T) {
	e := ai.ExtractedReceipt{
		Brand:         strp("Xiaomi"),      // not in catalog
		PurchasePlace: strp("Cửa hàng lạ"), // not in catalog
	}
	d := buildDraft(e, testCatalog())

	if d.BrandID != nil {
		t.Errorf("expected no brand bind, got %v", *d.BrandID)
	}
	if d.Brand == nil || *d.Brand != "Xiaomi" {
		t.Errorf("expected raw brand kept, got %v", d.Brand)
	}
	if d.StoreID != nil {
		t.Errorf("expected no store bind, got %v", *d.StoreID)
	}
	if !contains(d.Unmatched, "brand") || !contains(d.Unmatched, "purchasePlace") {
		t.Errorf("expected brand+purchasePlace unmatched, got %v", d.Unmatched)
	}
}

func TestBuildDraft_DefaultConfidence(t *testing.T) {
	d := buildDraft(ai.ExtractedReceipt{Name: strp("X")}, testCatalog())
	if d.Confidence != "medium" {
		t.Errorf("default confidence = %q, want medium", d.Confidence)
	}
	if d.Unmatched == nil {
		t.Error("Unmatched should be non-nil empty slice for JSON []")
	}
}

// Roadmap #15: serial/IMEI + warranty months must reach the draft, and values
// the model gets wrong must be dropped rather than handed to the form.
func TestBuildDraft_SerialAndWarrantyMonths(t *testing.T) {
	e := ai.ExtractedReceipt{
		SerialNumber:   strp("  356789012345678 "), // OCR padding is trimmed
		WarrantyMonths: intp(24),
	}
	d := buildDraft(e, testCatalog())
	if d.SerialNumber == nil || *d.SerialNumber != "356789012345678" {
		t.Errorf("serialNumber = %v, want trimmed %q", d.SerialNumber, "356789012345678")
	}
	if d.WarrantyMonths == nil || *d.WarrantyMonths != 24 {
		t.Errorf("warrantyMonths = %v, want 24", d.WarrantyMonths)
	}
	if len(d.Unmatched) != 0 {
		t.Errorf("unmatched = %v, want none for in-range values", d.Unmatched)
	}
}

func TestBuildDraft_WarrantyMonthsBounds(t *testing.T) {
	for _, tc := range []struct {
		name       string
		months     *int
		wantNil    bool
		wantFlag   bool
		wantMonths int
	}{
		{name: "absent → null, not flagged", months: nil, wantNil: true},
		{name: "zero is valid (no warranty)", months: intp(0), wantMonths: 0},
		{name: "twelve", months: intp(12), wantMonths: 12},
		{name: "upper bound 120 accepted", months: intp(120), wantMonths: 120},
		{name: "121 dropped", months: intp(121), wantNil: true, wantFlag: true},
		{name: "1200 (OCR misread) dropped", months: intp(1200), wantNil: true, wantFlag: true},
		{name: "negative dropped", months: intp(-12), wantNil: true, wantFlag: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := buildDraft(ai.ExtractedReceipt{WarrantyMonths: tc.months}, testCatalog())
			if tc.wantNil {
				if d.WarrantyMonths != nil {
					t.Errorf("warrantyMonths = %d, want nil (out-of-range values must not reach the form)", *d.WarrantyMonths)
				}
			} else if d.WarrantyMonths == nil || *d.WarrantyMonths != tc.wantMonths {
				t.Errorf("warrantyMonths = %v, want %d", d.WarrantyMonths, tc.wantMonths)
			}
			if got := contains(d.Unmatched, "warrantyMonths"); got != tc.wantFlag {
				t.Errorf("unmatched contains warrantyMonths = %v, want %v (%v)", got, tc.wantFlag, d.Unmatched)
			}
		})
	}
}

func TestBuildDraft_SerialNumberSanitising(t *testing.T) {
	d := buildDraft(ai.ExtractedReceipt{SerialNumber: strp("   ")}, testCatalog())
	if d.SerialNumber != nil {
		t.Errorf("blank serialNumber = %q, want nil", *d.SerialNumber)
	}
	if contains(d.Unmatched, "serialNumber") {
		t.Errorf("a blank serial is \"not found\", not junk: unmatched = %v", d.Unmatched)
	}

	// Implausibly long value (junk OCR text) is dropped and flagged for manual entry.
	junk := strp(strings.Repeat("A", maxDraftSerialBytes+1))
	d = buildDraft(ai.ExtractedReceipt{SerialNumber: junk}, testCatalog())
	if d.SerialNumber != nil {
		t.Errorf("over-long serialNumber = %q, want nil", *d.SerialNumber)
	}
	if !contains(d.Unmatched, "serialNumber") {
		t.Errorf("unmatched = %v, want serialNumber flagged", d.Unmatched)
	}

	// Exactly at the cap is still accepted.
	ok := strp(strings.Repeat("B", maxDraftSerialBytes))
	d = buildDraft(ai.ExtractedReceipt{SerialNumber: ok}, testCatalog())
	if d.SerialNumber == nil || *d.SerialNumber != *ok {
		t.Errorf("serialNumber at the cap = %v, want passthrough", d.SerialNumber)
	}
}

// ---- real-database assertions ----------------------------------------------
//
// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres (helpers
// from category_seed_test.go).

// ExtractReceipt is exercised end-to-end at the service layer with a fake
// extractor: no network, no Anthropic key, no encrypted blobs. The direct-upload
// branch (`in.Body`) is used, which is exactly what the multipart handler feeds
// after its own MIME validation.
func TestExtractReceiptAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_ocr_user"
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt", "aiOptIn") VALUES ($1, $2, 'x', NOW(), true)
		 ON CONFLICT (id) DO UPDATE SET "aiOptIn" = true`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert test user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	// 1. Types with no Messages-API block are refused with bad_input BEFORE the
	//    extractor is called. PDF used to be in this list; as of roadmap #15 it is
	//    supported (step 1b), so only GIF/HEIC remain — they are accepted as
	//    attachments but cannot be sent as an image or document block.
	for _, mt := range []string{"image/gif", "image/heic"} {
		fake := &fakeExtractor{result: ai.ExtractedReceipt{Name: strp("must not be used")}}
		_, err := ExtractReceipt(ctx, pool, fake, userID, ExtractInput{
			Body:      []byte("not an image"),
			MediaType: mt,
		})
		ae, ok := AsAttachmentError(err)
		if !ok || ae.Code != "bad_input" {
			t.Errorf("ExtractReceipt(mediaType=%q) error = %v, want bad_input", mt, err)
			continue
		}
		if fake.calls != 0 {
			t.Errorf("ExtractReceipt(mediaType=%q) called the extractor %d times, want 0", mt, fake.calls)
		}
	}

	// 1b. PDF IS accepted now and reaches the extractor as application/pdf.
	pdfFake := &fakeExtractor{result: ai.ExtractedReceipt{Name: strp("Hoá đơn PDF")}}
	pdfDraft, err := ExtractReceipt(ctx, pool, pdfFake, userID, ExtractInput{
		Body:      []byte("%PDF-1.4 fake"),
		MediaType: "application/pdf",
	})
	if err != nil {
		t.Fatalf("ExtractReceipt(application/pdf) = %v, want it accepted", err)
	}
	if pdfFake.calls != 1 {
		t.Errorf("PDF called the extractor %d times, want 1", pdfFake.calls)
	}
	if pdfFake.lastMediaType != "application/pdf" {
		t.Errorf("extractor saw media type %q, want application/pdf", pdfFake.lastMediaType)
	}
	if pdfDraft.Name == nil || *pdfDraft.Name != "Hoá đơn PDF" {
		t.Errorf("PDF draft name = %v, want the extractor's value", pdfDraft.Name)
	}

	// 2. A supported image flows through, and the OCR fields reach the draft with
	//    the sanity bounds applied (9999 months → null + flagged).
	fake := &fakeExtractor{result: ai.ExtractedReceipt{
		Name:           strp("iPhone 15 Pro"),
		Brand:          strp("Apple"),
		SerialNumber:   strp(" 356789012345678 "),
		WarrantyMonths: intp(9999),
		Confidence:     strp("high"),
	}}
	draft, err := ExtractReceipt(ctx, pool, fake, userID, ExtractInput{
		Body:      []byte{0xFF, 0xD8, 0xFF, 0xE0},
		MediaType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("ExtractReceipt(image/jpeg): %v", err)
	}
	if fake.calls != 1 {
		t.Errorf("extractor calls = %d, want 1", fake.calls)
	}
	if draft.SerialNumber == nil || *draft.SerialNumber != "356789012345678" {
		t.Errorf("draft.serialNumber = %v, want trimmed %q", draft.SerialNumber, "356789012345678")
	}
	if draft.WarrantyMonths != nil {
		t.Errorf("draft.warrantyMonths = %d, want nil (9999 is out of range)", *draft.WarrantyMonths)
	}
	if !contains(draft.Unmatched, "warrantyMonths") {
		t.Errorf("draft.unmatched = %v, want warrantyMonths flagged", draft.Unmatched)
	}
}

// fakeExtractor satisfies ReceiptExtractor with no network and no DB.
type fakeExtractor struct {
	calls         int
	lastMediaType string
	result        ai.ExtractedReceipt
	err           error
}

func (f *fakeExtractor) Enabled() bool { return true }

func (f *fakeExtractor) ExtractReceipt(_ context.Context, _ []byte, mediaType string) (ai.ExtractedReceipt, error) {
	f.calls++
	f.lastMediaType = mediaType
	return f.result, f.err
}

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}
