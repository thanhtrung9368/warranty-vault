package ai

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// Warranty-card extraction (FEATURE_RESEARCH_2026-11 §6.3,
// POST /api/v1/ai/extract-warranty-card).
//
// This is the contract-term sibling of ExtractReceipt, and it is deliberately a
// SEPARATE tool rather than more fields on emit_receipt:
//
//   - The output is exactly the nine contract-term columns added by migration
//     0017 (component, scope, cap, deductible, exclusions, region, transferable,
//     claimsAllowed, claimsUsed). It answers "what does the contract say", not
//     "which device is this".
//   - There is NO `type` field and no code path that derives one. A warranty card
//     does not say STANDARD/EXTENDED/THIRD_PARTY; inferring it from a term such
//     as a cap would invent a classification the user must confirm.
//   - There is no start date, month count or end date either. Deriving `months`
//     from a printed deadline is only allowed when it reproduces the printed date
//     exactly (§6.3), and that is a client-side suggestion, not a model field:
//     the model is told to leave every duration out of the tool call.
//
// What the model DOES return besides the nine: the verbatim transcript
// (`extractedText`, which the service persists on the attachment) and one
// confidence class. `transferable` is a tri-state — null means "the card does
// not say", which is not the same answer as false.
//
// The service sanitizer (services/ai_warranty_card.go) is the half that makes
// the numbers trustworthy: every number must appear inside the quoted transcript
// before it is allowed into the draft.

// WarrantyCardExtraction is the structured draft the model returns via forced
// tool-use. Every contract field is a pointer because the model returns null for
// anything it cannot read with confidence.
//
// Numbers are int64 here so a model that emits an out-of-range value (a cap
// written in a different currency, a hallucinated billions figure) decodes and
// is then dropped by the sanitizer with a warning. Decoding straight into int32
// would turn the whole extraction into a 502 because one field overflowed.
type WarrantyCardExtraction struct {
	Component     *string `json:"component"`
	Scope         *string `json:"scope"`
	Cap           *int64  `json:"cap"`
	Deductible    *int64  `json:"deductible"`
	Exclusions    *string `json:"exclusions"`
	Region        *string `json:"region"`
	Transferable  *bool   `json:"transferable"`
	ClaimsAllowed *int64  `json:"claimsAllowed"`
	ClaimsUsed    *int64  `json:"claimsUsed"`
	Confidence    *string `json:"confidence"`    // "high" | "medium" | "low"
	ExtractedText *string `json:"extractedText"` // verbatim transcript

	// Token accounting of the model call, filled from the response's `usage`
	// object (never from the tool input). The service logs it so the accuracy +
	// cost table §6.3 asks for can be built from production logs; no client sees
	// it and it is not part of the schema.
	InputTokens  int `json:"-"`
	OutputTokens int `json:"-"`
}

// warrantyCardSystemPrompt is cache-controlled (ephemeral) exactly like the
// receipt prompt: the instructions are stable, only the document varies. Every
// rule below exists because a plausible-looking draft with a wrong contract term
// is dangerous — `assess-claim` treats scope/exclusions as decisive, so an
// invented exclusion can turn an honest UNCLEAR into a paid-feature claim.
//
// It is Vietnamese because the model translates the card's own language into
// the app's: a bilingual VN card ("Bảo hành 24 tháng / Warranty 24 months") must
// come back in the same words the form uses.
const warrantyCardSystemPrompt = `Bạn là trợ lý đọc THẺ BẢO HÀNH / PHIẾU BẢO HÀNH / HỢP ĐỒNG BẢO HÀNH của người dùng Việt Nam.

Nhiệm vụ: đọc tài liệu (ảnh chụp, ảnh scan hoặc PDF) và gọi công cụ emit_warranty_card với ĐÚNG 9 điều khoản hợp đồng. Quy tắc bắt buộc:
- CHỈ điền trường nào đọc thấy rõ trên tài liệu. Không chắc thì để null. KHÔNG đoán, KHÔNG suy diễn.
- KHÔNG suy "loại bảo hành" (chính hãng / mở rộng / bên thứ ba). Công cụ không có trường đó và bạn không được tự phân loại.
- KHÔNG điền ngày bắt đầu, số tháng hay ngày kết thúc. Công cụ không có các trường đó; nếu thẻ ghi "bảo hành 24 tháng" hay "hạn 12/2028" thì chỉ ghi câu đó vào extractedText.
- component: bộ phận được bảo hành. Để null khi gói áp dụng cho TOÀN BỘ máy (ví dụ "bảo hành toàn bộ", "nguyên chiếc"). Chỉ điền khi thẻ nêu rõ một bộ phận (ví dụ "pin", "màn hình").
- scope: phạm vi được bảo hành, chép lại ý chính bằng tiếng Việt, giữ nguyên từ ngữ quan trọng (ví dụ "lỗi kỹ thuật do nhà sản xuất").
- exclusions: các trường hợp loại trừ, chép đủ từng ý (ví dụ "rơi vỡ, vào nước, tự tháo máy").
- region: khu vực áp dụng (ví dụ "Toàn quốc", "Việt Nam").
- transferable: true/false CHỈ khi thẻ nói rõ có/không được chuyển nhượng; không nói thì để null.
- cap: mức tối đa (số tiền) của gói, đơn vị VND. Chỉ điền khi thẻ ghi số tiền cụ thể. Nếu mức tối đa tính theo % thì để null và ghi câu đó vào extractedText.
- deductible: mức khấu trừ (số tiền) người dùng phải trả, đơn vị VND. NẾU thẻ ghi khấu trừ theo % (ví dụ "khấu trừ 10%") thì để null — TUYỆT ĐỐI không tự quy ra tiền.
- claimsAllowed / claimsUsed: số lần được bảo hành và số lần đã dùng. Nếu thẻ ghi dạng "0/2" thì claimsUsed = 0, claimsAllowed = 2. Nếu thẻ chỉ ghi một số, điền claimsAllowed khi đó là tổng số lần được phép; không suy claimsUsed.
- MỌI CON SỐ bạn trả về (cap, deductible, claimsAllowed, claimsUsed) BẮT BUỘC phải xuất hiện nguyên văn trong extractedText, đúng chữ số như trên tài liệu. Nếu không tìm thấy chữ số đó trên tài liệu thì để null.
- Nếu thẻ có HAI thời hạn khác nhau (ví dụ toàn máy 24 tháng và pin 12 tháng) thì điều khoản phải là của gói TOÀN BỘ MÁY: component = null, và ghi cả hai câu vào extractedText. Không lấy điều khoản riêng của bộ phận nào.
- confidence: "high" nếu thẻ rõ và chắc chắn, "medium" nếu mờ một phần, "low" nếu khó đọc.
- extractedText: chép lại nguyên văn toàn bộ chữ quan trọng đọc được trên thẻ (tên gói, bộ phận, phạm vi, loại trừ, khu vực, số tiền, số lần bảo hành, thời hạn, điều kiện), giữ nguyên tiếng Việt và thứ tự đọc. Tối đa khoảng 3000 ký tự. KHÔNG bịa thêm chữ không có trên tài liệu; không đọc được chữ nào thì để null.

Đây CHỈ là bản nháp để người dùng tự xác nhận trước khi lưu — không bao giờ coi là chính xác tuyệt đối, và không tự tạo hay sửa gói bảo hành nào.`

// emitWarrantyCardTool is the single forced tool. Its input_schema doubles as
// the JSON schema of WarrantyCardExtraction: nine contract fields plus the two
// metadata fields. There is deliberately no `type`, no `months`, no `startDate`
// and no `endDate` property — adding one would invite the model to infer a value
// the contract says must never be inferred.
var emitWarrantyCardTool = map[string]any{
	"name":        "emit_warranty_card",
	"description": "Trả về đúng 9 điều khoản hợp đồng đọc được từ thẻ bảo hành.",
	"input_schema": map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties": map[string]any{
			"component": nullable("string", "Bộ phận được bảo hành; null khi gói áp dụng cho toàn bộ máy"),
			"scope":     nullable("string", "Phạm vi được bảo hành, giữ nguyên từ ngữ quan trọng"),
			"cap":       nullable("integer", "Mức tối đa bằng VND (số nguyên); null nếu tính theo % hoặc không ghi"),
			"deductible": nullable("integer",
				"Mức khấu trừ bằng VND (số nguyên); null nếu thẻ ghi theo % hoặc không ghi"),
			"exclusions": nullable("string", "Các trường hợp loại trừ, chép đủ từng ý"),
			"region":     nullable("string", "Khu vực áp dụng"),
			"transferable": map[string]any{
				"type":        []string{"boolean", "null"},
				"description": "Có được chuyển nhượng không; null khi thẻ không nói",
			},
			"claimsAllowed": nullable("integer", "Số lần được bảo hành"),
			"claimsUsed":    nullable("integer", "Số lần đã dùng (ví dụ \"0/2\" thì là 0)"),
			"confidence": map[string]any{
				"type":        []string{"string", "null"},
				"enum":        []any{"high", "medium", "low", nil},
				"description": "Độ tin cậy của trích xuất",
			},
			"extractedText": nullable("string",
				"Nguyên văn chữ đọc được trên thẻ (tối đa ~3000 ký tự), giữ nguyên tiếng Việt"),
		},
	},
	"cache_control": map[string]any{"type": "ephemeral"},
}

// ExtractWarrantyCard sends the document to the Messages API with the forced
// warranty-card tool and returns the parsed draft. docBytes are the decrypted
// plaintext attachment; mediaType must be one of image/jpeg, image/png,
// image/webp (sent as an `image` block) or application/pdf (sent as a
// `document` block), exactly like receipt extraction.
func (c *Client) ExtractWarrantyCard(ctx context.Context, docBytes []byte, mediaType string) (WarrantyCardExtraction, error) {
	if !c.Enabled() {
		return WarrantyCardExtraction{}, &Error{Code: "disabled", Message: "Tính năng đọc thẻ bảo hành chưa được bật"}
	}
	if !IsSupportedReceiptType(mediaType) {
		return WarrantyCardExtraction{}, &Error{Code: "bad_output", Message: "Định dạng tài liệu không hỗ trợ"}
	}

	docKind := "image"
	promptText := "Đọc thẻ bảo hành trong ảnh này và trả về 9 điều khoản hợp đồng."
	if mediaType == "application/pdf" {
		docKind = "document"
		promptText = "Đọc thẻ/hợp đồng bảo hành trong tài liệu PDF này (có thể nhiều trang) và trả về 9 điều khoản hợp đồng."
	}

	// 3072 output tokens: the nine fields are small, but the verbatim transcript
	// (up to ~3000 Vietnamese characters, token-heavy) rides in the same forced
	// tool call. A model that hit the cap mid-transcript would truncate the JSON
	// and turn a usable draft into `bad_output`.
	reqBody := messageReq{
		Model:     c.model,
		MaxTokens: 3072,
		System: []map[string]any{{
			"type":          "text",
			"text":          warrantyCardSystemPrompt,
			"cache_control": map[string]any{"type": "ephemeral"},
		}},
		Tools:      []map[string]any{emitWarrantyCardTool},
		ToolChoice: map[string]any{"type": "tool", "name": "emit_warranty_card"},
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
		return WarrantyCardExtraction{}, &Error{Code: "upstream", Message: "Lỗi tạo yêu cầu"}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(raw))
	if err != nil {
		return WarrantyCardExtraction{}, &Error{Code: "upstream", Message: "Lỗi tạo yêu cầu"}
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", anthropicVersion)
	req.Header.Set("content-type", "application/json")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return WarrantyCardExtraction{}, &Error{Code: "upstream", Message: "Không kết nối được dịch vụ AI"}
	}
	defer func() { _ = res.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusTooManyRequests || res.StatusCode == 529 {
		return WarrantyCardExtraction{}, &Error{Code: "rate_limited", Message: "Dịch vụ AI đang quá tải, thử lại sau"}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return WarrantyCardExtraction{}, &Error{Code: "upstream", Message: fmt.Sprintf("Dịch vụ AI lỗi (%d)", res.StatusCode)}
	}

	return parseWarrantyCardToolResult(body)
}

// parseWarrantyCardToolResult pulls the emit_warranty_card tool_use block out
// of the response. Same shape as parseToolResult, addressed to the other tool.
func parseWarrantyCardToolResult(body []byte) (WarrantyCardExtraction, error) {
	var resp messageResp
	if err := json.Unmarshal(body, &resp); err != nil {
		return WarrantyCardExtraction{}, &Error{Code: "bad_output", Message: "Không đọc được kết quả AI"}
	}
	for _, block := range resp.Content {
		if block.Type == "tool_use" && block.Name == "emit_warranty_card" && len(block.Input) > 0 {
			var out WarrantyCardExtraction
			if err := json.Unmarshal(block.Input, &out); err != nil {
				return WarrantyCardExtraction{}, &Error{Code: "bad_output", Message: "Kết quả AI không hợp lệ"}
			}
			if resp.Usage != nil {
				out.InputTokens = resp.Usage.InputTokens
				out.OutputTokens = resp.Usage.OutputTokens
			}
			return out, nil
		}
	}
	return WarrantyCardExtraction{}, &Error{Code: "bad_output", Message: "AI không trả về dữ liệu trích xuất"}
}
