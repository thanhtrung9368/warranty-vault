package ai

import (
	"strings"
	"testing"
)

func TestParseToolResult_OK(t *testing.T) {
	body := []byte(`{
		"content": [
			{"type":"text","text":"reasoning"},
			{"type":"tool_use","name":"emit_receipt","input":{
				"name":"iPhone 15 Pro",
				"brand":"Apple",
				"serialNumber":"356789012345678",
				"purchaseDate":"2026-05-01",
				"purchasePrice":28990000,
				"purchasePlace":"Thế Giới Di Động",
				"warrantyMonths":12,
				"confidence":"high"
			}}
		]
	}`)
	got, err := parseToolResult(body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Name == nil || *got.Name != "iPhone 15 Pro" {
		t.Errorf("name not parsed: %+v", got.Name)
	}
	if got.PurchasePrice == nil || *got.PurchasePrice != 28990000 {
		t.Errorf("price not parsed: %+v", got.PurchasePrice)
	}
	if got.WarrantyMonths == nil || *got.WarrantyMonths != 12 {
		t.Errorf("warrantyMonths not parsed: %+v", got.WarrantyMonths)
	}
	if got.SerialNumber == nil || *got.SerialNumber != "356789012345678" {
		t.Errorf("serialNumber not parsed: %+v", got.SerialNumber)
	}
	if got.Confidence == nil || *got.Confidence != "high" {
		t.Errorf("confidence not parsed: %+v", got.Confidence)
	}
}

// The forced tool's input schema is the model-facing contract; the two
// warranty-identifier fields (roadmap #15) must stay declared, nullable, and
// carry the [0, 120] bound in their description so a client reading the schema
// sees the same rule the service enforces.
func TestEmitReceiptToolDeclaresSerialAndWarrantyMonths(t *testing.T) {
	schema, ok := emitReceiptTool["input_schema"].(map[string]any)
	if !ok {
		t.Fatal("emit_receipt has no input_schema object")
	}
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatal("input_schema has no properties")
	}
	for _, field := range []string{"serialNumber", "warrantyMonths"} {
		if _, ok := props[field]; !ok {
			t.Errorf("tool schema is missing %q", field)
		}
	}
	sn, _ := props["serialNumber"].(map[string]any)
	if sn == nil {
		t.Fatal("serialNumber is not an object schema")
	}
	if types, ok := sn["type"].([]string); !ok || len(types) != 2 {
		t.Errorf("serialNumber type = %v, want [string null]", sn["type"])
	}
	wm, _ := props["warrantyMonths"].(map[string]any)
	if wm == nil {
		t.Fatal("warrantyMonths is not an object schema")
	}
	desc, _ := wm["description"].(string)
	if desc == "" || !strings.Contains(desc, "120") {
		t.Errorf("warrantyMonths description = %q, want it to state the 0-120 bound", desc)
	}
	if !strings.Contains(systemPrompt, "serialNumber") || !strings.Contains(systemPrompt, "IMEI") {
		t.Error("system prompt should instruct the model about serialNumber/IMEI extraction")
	}
}

func TestParseToolResult_Nulls(t *testing.T) {
	body := []byte(`{"content":[{"type":"tool_use","name":"emit_receipt","input":{
		"name":"Máy lạnh","brand":null,"purchaseDate":null,"purchasePrice":null,
		"serialNumber":null,"warrantyMonths":null
	}}]}`)
	got, err := parseToolResult(body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Brand != nil || got.PurchaseDate != nil || got.PurchasePrice != nil {
		t.Errorf("expected nil fields, got %+v", got)
	}
	if got.SerialNumber != nil || got.WarrantyMonths != nil {
		t.Errorf("expected nil serialNumber/warrantyMonths, got %+v", got)
	}
}

func TestParseToolResult_NoToolUse(t *testing.T) {
	body := []byte(`{"content":[{"type":"text","text":"sorry"}]}`)
	if _, err := parseToolResult(body); err == nil {
		t.Fatal("expected error when no tool_use block present")
	} else if e, ok := AsError(err); !ok || e.Code != "bad_output" {
		t.Errorf("expected bad_output error, got %v", err)
	}
}

func TestParseToolResult_Malformed(t *testing.T) {
	if _, err := parseToolResult([]byte(`not json`)); err == nil {
		t.Fatal("expected error on malformed JSON")
	}
}

func TestExtractReceipt_Disabled(t *testing.T) {
	c := &Client{}                                             // empty apiKey → disabled
	_, err := c.ExtractReceipt(nil, []byte{0x1}, "image/jpeg") //nolint:staticcheck // nil ctx ok, returns before use
	if e, ok := AsError(err); !ok || e.Code != "disabled" {
		t.Errorf("expected disabled error, got %v", err)
	}
}

// PDF is accepted as an *attachment* by internal/files (AllowedMIMEs), but the
// OCR pipeline is image-only. This guards the boundary both ways: the service
// uses IsSupportedImageType to answer 400 before spending an upstream call, so
// it must stay false for PDF and for the other uploadable non-OCR types.
func TestIsSupportedImageType(t *testing.T) {
	for _, mt := range []string{"image/jpeg", "image/png", "image/webp"} {
		if !IsSupportedImageType(mt) {
			t.Errorf("IsSupportedImageType(%q) = false, want true", mt)
		}
	}
	for _, mt := range []string{"application/pdf", "image/gif", "image/heic", "image/heif", "", "text/plain"} {
		if IsSupportedImageType(mt) {
			t.Errorf("IsSupportedImageType(%q) = true, want false — OCR is image-only (JPEG/PNG/WEBP)", mt)
		}
	}
}
