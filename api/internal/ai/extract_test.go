package ai

import "testing"

func TestParseToolResult_OK(t *testing.T) {
	body := []byte(`{
		"content": [
			{"type":"text","text":"reasoning"},
			{"type":"tool_use","name":"emit_receipt","input":{
				"name":"iPhone 15 Pro",
				"brand":"Apple",
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
	if got.Confidence == nil || *got.Confidence != "high" {
		t.Errorf("confidence not parsed: %+v", got.Confidence)
	}
}

func TestParseToolResult_Nulls(t *testing.T) {
	body := []byte(`{"content":[{"type":"tool_use","name":"emit_receipt","input":{
		"name":"Máy lạnh","brand":null,"purchaseDate":null,"purchasePrice":null
	}}]}`)
	got, err := parseToolResult(body)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got.Brand != nil || got.PurchaseDate != nil || got.PurchasePrice != nil {
		t.Errorf("expected nil fields, got %+v", got)
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
