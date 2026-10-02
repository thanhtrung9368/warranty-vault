package ai

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
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

// IsSupportedImageType stays the narrow `image` block predicate…
func TestIsSupportedImageType(t *testing.T) {
	for _, mt := range []string{"image/jpeg", "image/png", "image/webp"} {
		if !IsSupportedImageType(mt) {
			t.Errorf("IsSupportedImageType(%q) = false, want true", mt)
		}
	}
	for _, mt := range []string{"application/pdf", "image/gif", "image/heic", "image/heif", "", "text/plain"} {
		if IsSupportedImageType(mt) {
			t.Errorf("IsSupportedImageType(%q) = true, want false — only JPEG/PNG/WEBP ride in an image block", mt)
		}
	}
}

// …while the OCR gate also accepts PDF, which goes as a `document` block
// (roadmap #15). GIF/HEIC are uploadable attachments but have no block type, so
// the service must still refuse them with a 400 before any paid round-trip.
func TestIsSupportedReceiptType(t *testing.T) {
	for _, mt := range []string{"image/jpeg", "image/png", "image/webp", "application/pdf"} {
		if !IsSupportedReceiptType(mt) {
			t.Errorf("IsSupportedReceiptType(%q) = false, want true", mt)
		}
	}
	for _, mt := range []string{"image/gif", "image/heic", "image/heif", "", "text/plain", "application/x-pdf"} {
		if IsSupportedReceiptType(mt) {
			t.Errorf("IsSupportedReceiptType(%q) = true, want false", mt)
		}
	}
}

// The wire shape is the contract with the Messages API: a PDF must be sent as a
// `document` content block with media_type application/pdf (base64), never as an
// `image` block — the API rejects that. A JPEG must stay an `image` block.
func TestExtractReceipt_SendsPdfAsDocumentBlock(t *testing.T) {
	for _, tc := range []struct {
		mediaType  string
		wantBlock  string
		wantPrompt string
	}{
		{mediaType: "application/pdf", wantBlock: "document", wantPrompt: "PDF"},
		{mediaType: "image/jpeg", wantBlock: "image", wantPrompt: "ảnh"},
	} {
		t.Run(tc.mediaType, func(t *testing.T) {
			var captured messageReq
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				if err := json.Unmarshal(body, &captured); err != nil {
					t.Errorf("unmarshal request: %v", err)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"content":[{"type":"tool_use","name":"emit_receipt","input":{"name":"Hoá đơn"}}]}`))
			}))
			defer srv.Close()

			c := &Client{apiKey: "test", model: "claude-haiku-4-5-20251001", endpoint: srv.URL, httpClient: srv.Client()}
			if _, err := c.ExtractReceipt(context.Background(), []byte("doc-bytes"), tc.mediaType); err != nil {
				t.Fatalf("ExtractReceipt: %v", err)
			}
			if len(captured.Messages) != 1 || len(captured.Messages[0].Content) < 2 {
				t.Fatalf("request content = %+v, want a document/image block plus a text block", captured.Messages)
			}
			block := captured.Messages[0].Content[0]
			if block.Type != tc.wantBlock {
				t.Errorf("first content block type = %q, want %q", block.Type, tc.wantBlock)
			}
			if block.Source == nil {
				t.Fatal("first content block has no source")
			}
			if block.Source.Type != "base64" || block.Source.MediaType != tc.mediaType {
				t.Errorf("source = %+v, want base64/%s", *block.Source, tc.mediaType)
			}
			if want := base64.StdEncoding.EncodeToString([]byte("doc-bytes")); block.Source.Data != want {
				t.Errorf("source data = %q, want %q", block.Source.Data, want)
			}
			if text := captured.Messages[0].Content[1].Text; !strings.Contains(text, tc.wantPrompt) {
				t.Errorf("prompt text = %q, want it to mention %q", text, tc.wantPrompt)
			}
			// The tool schema, model and forced tool choice are unchanged.
			if captured.Model != "claude-haiku-4-5-20251001" {
				t.Errorf("model = %q", captured.Model)
			}
			if len(captured.Tools) != 1 {
				t.Errorf("tools = %d, want the single emit_receipt tool", len(captured.Tools))
			}
		})
	}
}

// The system prompt is prompt-cached, so its content matters for cache hits and
// for model accuracy; pdf work must not have dropped the Vietnamese rules.
func TestSystemPromptCoversPdfAndStaysVietnamese(t *testing.T) {
	for _, want := range []string{"PDF", "serialNumber", "IMEI", "warrantyMonths", "confidence"} {
		if !strings.Contains(systemPrompt, want) {
			t.Errorf("system prompt lost %q", want)
		}
	}
}
