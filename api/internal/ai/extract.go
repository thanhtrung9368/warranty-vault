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
const systemPrompt = `Bạn là trợ lý trích xuất thông tin từ ảnh HOÁ ĐƠN hoặc PHIẾU BẢO HÀNH của người dùng Việt Nam.

Nhiệm vụ: đọc ảnh và gọi công cụ emit_receipt với các trường đọc được. Quy tắc bắt buộc:
- CHỈ điền trường nào nhìn thấy rõ trên ảnh. Không chắc thì để null.
- KHÔNG tự đoán hay "sửa" tên cửa hàng / hãng / model. Trả về đúng chữ đọc được, kể cả khi thiếu dấu tiếng Việt.
- purchaseDate: chuẩn hoá về định dạng YYYY-MM-DD. Nếu chỉ có tháng/năm hoặc không rõ, để null.
- purchasePrice: số nguyên VND, bỏ dấu chấm/phẩy/ký hiệu đ/VND (ví dụ "28.990.000đ" -> 28990000). Đây là giá sản phẩm, không phải tổng hoá đơn nếu có nhiều món.
- warrantyMonths: số tháng bảo hành nếu in trên phiếu (ví dụ "Bảo hành 12 tháng" -> 12). Không rõ thì null.
- purchasePlace: tên cửa hàng/hệ thống bán (ví dụ "Thế Giới Di Động"). brand: hãng sản phẩm (ví dụ "Apple", "Samsung").
- confidence: "high" nếu ảnh rõ và chắc chắn, "medium" nếu mờ một phần, "low" nếu khó đọc.

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
			"serialNumber":   nullable("string", "Số serial / IMEI"),
			"purchaseDate":   nullable("string", "Ngày mua, định dạng YYYY-MM-DD"),
			"purchasePrice":  nullable("integer", "Giá mua, số nguyên VND"),
			"purchasePlace":  nullable("string", "Tên cửa hàng/nơi mua"),
			"warrantyMonths": nullable("integer", "Số tháng bảo hành"),
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

// ExtractReceipt sends the image to the Messages API with a forced tool call
// and returns the parsed draft. imageBytes are the decrypted plaintext image;
// mediaType must be one of image/jpeg, image/png, image/webp.
func (c *Client) ExtractReceipt(ctx context.Context, imageBytes []byte, mediaType string) (ExtractedReceipt, error) {
	if !c.Enabled() {
		return ExtractedReceipt{}, &Error{Code: "disabled", Message: "Tính năng quét hoá đơn chưa được bật"}
	}
	if !isSupportedImageType(mediaType) {
		return ExtractedReceipt{}, &Error{Code: "bad_output", Message: "Định dạng ảnh không hỗ trợ"}
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
				{Type: "image", Source: &imageSource{
					Type:      "base64",
					MediaType: mediaType,
					Data:      base64.StdEncoding.EncodeToString(imageBytes),
				}},
				{Type: "text", Text: "Trích xuất thông tin từ ảnh này."},
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

func isSupportedImageType(mt string) bool {
	switch mt {
	case "image/jpeg", "image/png", "image/webp":
		return true
	default:
		return false
	}
}

// AsError returns the typed *Error if err is one.
func AsError(err error) (*Error, bool) {
	var e *Error
	if errors.As(err, &e) {
		return e, true
	}
	return nil, false
}
