package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
)

// Error carries a code → HTTP status hint so the service/handler can map
// upstream failures without depending on this package's internals.
type Error struct {
	Code    string // "disabled" | "upstream" | "rate_limited" | "bad_output"
	Message string
}

func (e *Error) Error() string { return e.Message }

// ExtractedReceipt is the structured draft the model returns via forced
// tool-use. Every field is a pointer because the model returns null for
// anything it cannot read with confidence. Free-text fields (brand, place) are
// returned verbatim — the service maps them to catalog rows.
type ExtractedReceipt struct {
	Name           *string `json:"name"`
	Brand          *string `json:"brand"`
	Model          *string `json:"model"`
	SerialNumber   *string `json:"serialNumber"`
	PurchaseDate   *string `json:"purchaseDate"`   // YYYY-MM-DD
	PurchasePrice  *int64  `json:"purchasePrice"`  // VND, plain integer
	PurchasePlace  *string `json:"purchasePlace"`  // store / shop name
	WarrantyMonths *int    `json:"warrantyMonths"` // duration in months if printed
	Category       *string `json:"category"`       // model's free-text guess
	Confidence     *string `json:"confidence"`     // "high" | "medium" | "low"
}

// systemPrompt is cached (cache_control ephemeral) so repeated uploads only pay
// for the variable image. It is intentionally explicit about Vietnamese OCR
// pitfalls: never invent/"correct" names, return null when unsure.
const systemPrompt = `Bạn là trợ lý trích xuất thông tin từ ẢNH hoặc FILE PDF của HOÁ ĐƠN / PHIẾU BẢO HÀNH của người dùng Việt Nam.

Nhiệm vụ: đọc tài liệu (ảnh chụp, ảnh scan, hoặc PDF nhiều trang) và gọi công cụ emit_receipt với các trường đọc được. Quy tắc bắt buộc:
- CHỈ điền trường nào nhìn thấy rõ trên tài liệu. Không chắc thì để null. PDF nhiều trang: tìm trang có hoá đơn/phiếu bảo hành, bỏ qua trang quảng cáo hay điều khoản chung.
- KHÔNG tự đoán hay "sửa" tên cửa hàng / hãng / model. Trả về đúng chữ đọc được, kể cả khi thiếu dấu tiếng Việt.
- purchaseDate: chuẩn hoá về định dạng YYYY-MM-DD. Nếu chỉ có tháng/năm hoặc không rõ, để null.
- purchasePrice: số nguyên VND, bỏ dấu chấm/phẩy/ký hiệu đ/VND (ví dụ "28.990.000đ" -> 28990000). Đây là giá sản phẩm, không phải tổng hoá đơn nếu có nhiều món.
- serialNumber: số serial hoặc IMEI in trên máy / trên phiếu (ví dụ "IMEI: 356789012345678" -> "356789012345678"). Đọc đúng từng ký tự, KHÔNG thêm dấu cách hay dấu gạch ngang nếu tài liệu không có. Đây là định danh bảo hành điện tử ở Việt Nam nên chỉ điền khi đọc chắc chắn; ảnh mờ / PDF không rõ thì để null.
- warrantyMonths: số tháng bảo hành nếu in trên phiếu (ví dụ "Bảo hành 12 tháng" -> 12). Chỉ nhận giá trị từ 0 đến 120; lớn hơn hoặc không rõ thì để null.
- purchasePlace: tên cửa hàng/hệ thống bán (ví dụ "Thế Giới Di Động"). brand: hãng sản phẩm (ví dụ "Apple", "Samsung").
- confidence: "high" nếu tài liệu rõ và chắc chắn, "medium" nếu mờ một phần, "low" nếu khó đọc.

Đây CHỈ là bản nháp để người dùng tự xác nhận trước khi lưu — không bao giờ coi là chính xác tuyệt đối.`

// emitReceiptTool is the single forced tool. Its input_schema doubles as the
// JSON schema of ExtractedReceipt.
var emitReceiptTool = map[string]any{
	"name":        "emit_receipt",
	"description": "Trả về thông tin trích xuất từ ảnh hoá đơn / phiếu bảo hành.",
	"input_schema": map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"name":           nullable("string", "Tên sản phẩm/thiết bị"),
			"brand":          nullable("string", "Hãng sản xuất"),
			"model":          nullable("string", "Mã model"),
			"serialNumber":   nullable("string", "Số serial / IMEI đọc được nguyên văn, không thêm dấu cách"),
			"purchaseDate":   nullable("string", "Ngày mua, định dạng YYYY-MM-DD"),
			"purchasePrice":  nullable("integer", "Giá mua, số nguyên VND"),
			"purchasePlace":  nullable("string", "Tên cửa hàng/nơi mua"),
			"warrantyMonths": nullable("integer", "Số tháng bảo hành (0-120; ngoài khoảng này để null)"),
			"category":       nullable("string", "Loại thiết bị (đoán)"),
			"confidence": map[string]any{
				"type":        []string{"string", "null"},
				"enum":        []any{"high", "medium", "low", nil},
				"description": "Độ tin cậy của trích xuất",
			},
		},
	},
	"cache_control": map[string]any{"type": "ephemeral"},
}

func nullable(t, desc string) map[string]any {
	return map[string]any{
		"type":        []string{t, "null"},
		"description": desc,
	}
}

// ---- wire types ------------------------------------------------------------

type messageReq struct {
	Model      string           `json:"model"`
	MaxTokens  int              `json:"max_tokens"`
	System     []map[string]any `json:"system"`
	Tools      []map[string]any `json:"tools"`
	ToolChoice map[string]any   `json:"tool_choice"`
	Messages   []wireMessage    `json:"messages"`
}

type wireMessage struct {
	Role    string         `json:"role"`
	Content []contentBlock `json:"content"`
}

type contentBlock struct {
	Type   string       `json:"type"`             // "image" | "text" | "tool_use"
	Source *imageSource `json:"source,omitempty"` // for image
	Text   string       `json:"text,omitempty"`   // for text
	// response-only fields for tool_use blocks
	Name  string          `json:"name,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
}

type imageSource struct {
	Type      string `json:"type"`       // "base64"
	MediaType string `json:"media_type"` // image/jpeg | image/png | image/webp
	Data      string `json:"data"`
}

type messageResp struct {
	Content []contentBlock `json:"content"`
}

// ExtractReceipt sends the document to the Messages API with a forced tool call
// and returns the parsed draft. docBytes are the decrypted plaintext attachment;
// mediaType must be one of image/jpeg, image/png, image/webp (sent as an `image`
// block) or application/pdf (sent as a `document` block).
func (c *Client) ExtractReceipt(ctx context.Context, docBytes []byte, mediaType string) (ExtractedReceipt, error) {
	if !c.Enabled() {
		return ExtractedReceipt{}, &Error{Code: "disabled", Message: "Tính năng quét hoá đơn chưa được bật"}
	}
	if !IsSupportedReceiptType(mediaType) {
		return ExtractedReceipt{}, &Error{Code: "bad_output", Message: "Định dạng tài liệu không hỗ trợ"}
	}

	// One content block, typed by media: a PDF goes as `document` (Claude reads
	// text + page images), everything else as `image`. Both use the same base64
	// `source` shape.
	docKind := "image"
	promptText := "Trích xuất thông tin từ ảnh này."
	if mediaType == "application/pdf" {
		docKind = "document"
		promptText = "Trích xuất thông tin từ tài liệu PDF này (có thể nhiều trang)."
	}

	reqBody := messageReq{
		Model:     c.model,
		MaxTokens: 1024,
		System: []map[string]any{{
			"type":          "text",
			"text":          systemPrompt,
			"cache_control": map[string]any{"type": "ephemeral"},
		}},
		Tools:      []map[string]any{emitReceiptTool},
		ToolChoice: map[string]any{"type": "tool", "name": "emit_receipt"},
		Messages: []wireMessage{{
			Role: "user",
			Content: []contentBlock{
				{Type: docKind, Source: &imageSource{
					Type:      "base64",
					MediaType: mediaType,
					Data:      base64.StdEncoding.EncodeToString(docBytes),
				}},
				{Type: "text", Text: promptText},
			},
		}},
	}

	raw, err := json.Marshal(reqBody)
	if err != nil {
		return ExtractedReceipt{}, &Error{Code: "upstream", Message: "Lỗi tạo yêu cầu"}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(raw))
	if err != nil {
		return ExtractedReceipt{}, &Error{Code: "upstream", Message: "Lỗi tạo yêu cầu"}
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", anthropicVersion)
	req.Header.Set("content-type", "application/json")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return ExtractedReceipt{}, &Error{Code: "upstream", Message: "Không kết nối được dịch vụ AI"}
	}
	defer func() { _ = res.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusTooManyRequests || res.StatusCode == 529 {
		return ExtractedReceipt{}, &Error{Code: "rate_limited", Message: "Dịch vụ AI đang quá tải, thử lại sau"}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ExtractedReceipt{}, &Error{Code: "upstream", Message: fmt.Sprintf("Dịch vụ AI lỗi (%d)", res.StatusCode)}
	}

	return parseToolResult(body)
}

// parseToolResult pulls the emit_receipt tool_use block out of the response.
func parseToolResult(body []byte) (ExtractedReceipt, error) {
	var resp messageResp
	if err := json.Unmarshal(body, &resp); err != nil {
		return ExtractedReceipt{}, &Error{Code: "bad_output", Message: "Không đọc được kết quả AI"}
	}
	for _, block := range resp.Content {
		if block.Type == "tool_use" && block.Name == "emit_receipt" && len(block.Input) > 0 {
			var out ExtractedReceipt
			if err := json.Unmarshal(block.Input, &out); err != nil {
				return ExtractedReceipt{}, &Error{Code: "bad_output", Message: "Kết quả AI không hợp lệ"}
			}
			return out, nil
		}
	}
	return ExtractedReceipt{}, &Error{Code: "bad_output", Message: "AI không trả về dữ liệu trích xuất"}
}

// IsSupportedImageType reports whether the media type can ride in an `image`
// content block.
func IsSupportedImageType(mt string) bool {
	switch mt {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

// IsSupportedReceiptType reports whether the OCR pipeline can send this media
// type to the Messages API at all: the three image types plus PDF.
//
// PDF support (roadmap #15, the part that was left out): the Messages API takes a
// `document` content block with `media_type: application/pdf`, and every active
// model — including the default extraction model (Claude Haiku 4.5) — supports
// PDF processing (text, tables and page images):
// https://platform.claude.com/docs/en/build-with-claude/pdf-support
// Limits from that page: 32 MB per request and 100 pages when the request's
// context window is under 1M tokens, standard (unencrypted) PDFs only.
//
// The app's own bounds already sit well inside the size limit: an attachment is
// capped at 5 MB by services/attachments.go, so a request can never approach
// 32 MB. Page count is NOT pre-checked — counting pages would mean parsing the
// PDF — so an absurdly large document is refused by the upstream API and surfaces
// as the existing 502 "Dịch vụ AI lỗi" path, not as a silent wrong draft.
//
// GIF and HEIC remain unsupported: they are accepted as *attachments* by
// internal/files, but neither can be sent as an image or document block, so the
// service rejects them with a 400 before any paid round-trip.
func IsSupportedReceiptType(mt string) bool {
	return IsSupportedImageType(mt) || mt == "application/pdf"
}

// AsError returns the typed *Error if err is one.
func AsError(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}
