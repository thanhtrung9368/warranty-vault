package services

import (
	"testing"

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
		Name:          strp("iPhone 15 Pro"),
		Brand:         strp("apple"),
		PurchasePlace: strp("the gioi di dong"),
		PurchasePrice: i64p(28990000),
		WarrantyMonths: intp(12),
		Category:      strp("Điện thoại"),
		Confidence:    strp("high"),
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
		Brand:         strp("Xiaomi"),        // not in catalog
		PurchasePlace: strp("Cửa hàng lạ"),   // not in catalog
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

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}
