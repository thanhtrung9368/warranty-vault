package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// AI claim assessment (gap #7).
//
// This file owns the MODEL-FACING half of POST /api/v1/ai/assess-claim: the
// cached system prompt, the forced tool schema, the bounded user prompt and the
// response parser. It never touches the database and it never decides what the
// user's warranty says — services/ai_assess.go loads the real claim, device and
// warranty rows and passes their actual terms in. That split is the point of the
// feature: "here is what your contract probably covers" is only honest if the
// model is reading the contract, not our summary of it.
//
// # The honesty constraint
//
// The prompt and the coverage schema both require that LIKELY_COVERED is never
// asserted while a decisive term (scope / exclusions) is null. Two fields are
// NOT in that set on purpose: migration 0017 defines a null `component` as "the
// whole unit", and the warranty validator treats a null `claimsAllowed` as "no
// ceiling recorded", so neither is an unknown that should block a verdict. An unknown term must produce UNCLEAR plus a
// question asking for it, because "we do not know" and "you are not covered"
// send the user to two completely different places at the service counter. A
// null is rendered to the model as the literal string "KHÔNG RÕ (null — chưa
// được ghi nhận)" rather than being dropped from the prompt; a missing line
// would let the model assume a term instead of asking about it.
// services/ai_assess.go keeps a deterministic second line of defence
// (downgradeUnsupportedCoverage) for the same rule, since a prompt is a request
// to the model, not a guarantee.
//
// # Bounds
//
// A claim's issue/diagnosis and up to five warranties' contract terms are
// user-typed, and the claims/warranties write paths already cap each field. This
// layer does not trust that: every field is clipped, and the finished user prompt
// is hard-capped at MaxAssessInputRunes runes, so a pathological legacy row
// cannot turn one endpoint call into an unbounded token bill. The response is
// capped in two ways: MaxTokens on the wire, and a per-field rune cap applied by
// normalizeAssessment after parsing (reasoning, each question, the letter).
const (
	// MaxAssessInputRunes is the hard ceiling for the user message (the claim,
	// device and contract data). System prompt and tool schema are fixed and live
	// in the cached prefix. 20,000 runes is roughly 7-10k Vietnamese tokens —
	// comfortably inside the model's context and large enough that the
	// DB-bounded worst case (five fully-filled contracts plus a maxed
	// issue/diagnosis) fits WITHOUT truncating a warranty that might be the one
	// deciding the claim. The per-field caps below are the real cost guard; this
	// ceiling is the backstop for a future field or a row that bypassed the write
	// paths.
	MaxAssessInputRunes = 20000

	// Per-field input caps. They mirror the DB write bounds (MaxClaimIssueRunes =
	// 1000, MaxClaimDiagnosisRunes = 500, MaxWarrantyScopeRunes = 500, …) and
	// exist so a legacy/hand-edited row cannot bypass them.
	maxAssessIssueRunes         = 1000
	maxAssessDiagnosisRunes     = 500
	maxAssessShortTextRunes     = 200
	maxAssessWarrantyTextRunes  = 500
	assessTransferableFalse     = "Không"
	assessTransferableTrue      = "Có"
	assessUnknownValue          = "KHÔNG RÕ (null — chưa được ghi nhận)"
	assessWholeUnitValue        = "Toàn bộ thiết bị (null — gói áp dụng cho toàn bộ thiết bị)"
	assessTruncatedPromptNote   = "\n[GHI CHÚ: dữ liệu đã được rút gọn để giới hạn chi phí.]"
	maxAssessOutputTokens       = 4096
	maxAssessQuestionRunes      = 300
	maxAssessReasoningRunes     = 2000
	maxAssessDraftLetterRunes   = 2500
	assessCoverageLikelyCovered = "LIKELY_COVERED"
	assessCoverageUnclear       = "UNCLEAR"
	assessCoverageNotCovered    = "LIKELY_NOT_COVERED"
	assessConfidenceLow         = "LOW"
	assessConfidenceMedium      = "MEDIUM"
	assessConfidenceHigh        = "HIGH"
)

// MaxAssessQuestions is the maximum number of questions returned. Exported
// because services/ai_assess.go merges its deterministic "missing term"
// questions into the model's list and must respect the same ceiling.
const MaxAssessQuestions = 8

// Coverage and confidence values are contract strings, exported so the service
// and its tests can compare against the same constants instead of re-typing
// literals. The wire enum is frozen in openapi.yaml.
const (
	CoverageLikelyCovered    = assessCoverageLikelyCovered
	CoverageUnclear          = assessCoverageUnclear
	CoverageLikelyNotCovered = assessCoverageNotCovered

	ConfidenceLow    = assessConfidenceLow
	ConfidenceMedium = assessConfidenceMedium
	ConfidenceHigh   = assessConfidenceHigh
)

// ClaimFacts is the claim half of the model input.
type ClaimFacts struct {
	Issue         string
	Diagnosis     *string
	Cost          *int32 // VND
	TicketNumber  *string
	ServiceCenter *string
	Status        string
	OpenedAt      string // YYYY-MM-DD, empty when unknown
	WarrantyID    *string
}

// DeviceFacts is the device half of the model input.
type DeviceFacts struct {
	Name         string
	Category     string
	Brand        *string
	Model        *string
	SerialNumber *string
	PurchaseDate string // YYYY-MM-DD, empty when unknown
	Status       string
}

// WarrantyFacts carries the ACTUAL contract terms, not a summary. Every pointer
// is nullable on purpose: nil reaches the prompt as "KHÔNG RÕ (null …)", which is
// what makes the honesty rule enforceable.
type WarrantyFacts struct {
	ID            string
	Type          string
	Provider      *string
	StartDate     string // YYYY-MM-DD, empty when unknown
	EndDate       string
	Months        int32
	Component     *string
	Scope         *string
	Cap           *int32 // VND
	Deductible    *int32 // VND
	Exclusions    *string
	Region        *string
	Transferable  *bool
	ClaimsAllowed *int32
	ClaimsUsed    int32
}

// ClaimAssessmentInput is everything the model is allowed to reason about. It is
// built by services/ai_assess.go from the authenticated user's own rows.
type ClaimAssessmentInput struct {
	// Language is the request language for `reasoning` and `questions`: "vi" or
	// "en". `draftLetter` is always Vietnamese and deliberately does not follow
	// it — see the system prompt.
	Language   string
	Claim      ClaimFacts
	Device     DeviceFacts
	Warranties []WarrantyFacts
}

// ClaimAssessment is the structured response returned via forced tool-use.
// normalizeAssessment validates the enums and applies the output bounds before
// the service ever sees it.
type ClaimAssessment struct {
	Coverage    string   `json:"coverage"`
	Confidence  string   `json:"confidence"`
	Reasoning   string   `json:"reasoning"`
	Questions   []string `json:"questions"`
	DraftLetter string   `json:"draftLetter"`
}

// assessSystemPrompt is the cached prefix. It is intentionally explicit about the
// honesty rule, the unknown-term rendering and the language split; the test
// (TestAssessSystemPromptEncodesHonestyRule) pins all three so a future edit
// cannot quietly turn the feature into a confident guess.
const assessSystemPrompt = `Bạn là trợ lý đánh giá yêu cầu bảo hành cho người dùng Việt Nam. Bạn nhận được yêu cầu bảo hành thực tế (issue, diagnosis, cost, ticket…) và các gói bảo hành THẬT của thiết bị với đủ điều khoản đã lưu.

Nhiệm vụ: gọi công cụ emit_claim_assessment để trả về coverage, confidence, reasoning, questions và draftLetter.

QUY TẮC BẮT BUỘC (không được vi phạm):

1. CHỈ dùng dữ liệu được cung cấp. KHÔNG bịa, KHÔNG suy đoán điều khoản nào không có trong dữ liệu. Trường nào ghi "KHÔNG RÕ (null — chưa được ghi nhận)" nghĩa là chưa được ghi nhận: nó KHÔNG có nghĩa là "được bảo hành" và cũng KHÔNG có nghĩa là "bị loại trừ".

2. KHÔNG BAO GIỜ kết luận LIKELY_COVERED khi một điều khoản quyết định (scope, exclusions) đang là null / "KHÔNG RÕ". Khi đó câu trả lời trung thực là UNCLEAR, và questions PHẢI có ít nhất một câu hỏi về đúng điều khoản còn thiếu đó. Đây là quy tắc quan trọng nhất: thà nói "chưa đủ thông tin" còn hơn khẳng định sai rồi để người dùng bị từ chối ở quầy.
   Lưu ý riêng về component: null nghĩa là gói bảo hành áp dụng cho TOÀN BỘ thiết bị (đúng theo migration 0017), KHÔNG phải "không rõ". Nếu component ghi tên một bộ phận (ví dụ "Pin"), gói chỉ bảo hành bộ phận đó — lỗi ở bộ phận khác có thể không được bảo hành, và đây là dữ liệu ĐÃ BIẾT để lập luận, không phải lý do để nói UNCLEAR.
   Lưu ý riêng về claimsAllowed: null nghĩa là CHƯA GHI NHẬN giới hạn (app coi như không có trần), KHÔNG phải "đã hết lượt". Chỉ khi claimsAllowed đã biết và claimsUsed >= claimsAllowed thì mới được coi là hết lượt.

3. LIKELY_NOT_COVERED chỉ khi dữ liệu ĐÃ BIẾT cho thấy rõ ràng không được bảo hành (ví dụ: đã hết hạn, exclusions nêu đúng lỗi này, claimsAllowed đã dùng hết). Thiếu dữ liệu KHÔNG phải lý do để nói không được bảo hành; trường hợp đó là UNCLEAR.

4. Nếu không có gói bảo hành nào được ghi nhận: dùng UNCLEAR hoặc LIKELY_NOT_COVERED, và hỏi người dùng có hợp đồng/phiếu bảo hành nào chưa nhập vào ứng dụng không. KHÔNG được khẳng định LIKELY_COVERED khi danh sách gói bảo hành rỗng.

5. confidence phản ánh độ chắc chắn của KẾT LUẬN: HIGH chỉ khi các điều khoản quyết định đều đã biết và rõ ràng; nếu còn điều khoản quyết định bị thiếu thì tối đa là MEDIUM (thường là LOW/UNCLEAR).

6. reasoning và questions: viết bằng NGÔN NGỮ YÊU CẦU ghi ở đầu tin nhắn người dùng ("vi" = tiếng Việt, "en" = tiếng Anh). Không dịch tên riêng, số tiền, mã lỗi hay số serial.

7. draftLetter: LUÔN LUÔN viết bằng TIẾNG VIỆT, kể cả khi ngôn ngữ yêu cầu là "en". Lá thư này do trung tâm bảo hành Việt Nam đọc sau khi người dùng gửi đi, nên nó không đi theo ngôn ngữ màn hình. Đây phải là một LÁ THƯ, không phải bản tóm tắt: có người nhận (trung tâm bảo hành), thiết bị (tên/hãng/model/serial nếu có), số phiếu nếu có, mô tả lỗi, gói bảo hành đang được yêu cầu (loại + scope/thời hạn), và một đề nghị cụ thể (kiểm tra và sửa theo bảo hành, xác nhận bằng văn bản). Tối đa khoảng 2500 ký tự. KHÔNG bịa số hợp đồng, không hứa thay người dùng, không nêu điều khoản không có trong dữ liệu.

8. questions: tối đa 8 câu, ngắn gọn và thực dụng — đúng những gì quầy dịch vụ sẽ hỏi (hoá đơn, serial, tình trạng vật lý, thời hạn, điều khoản còn thiếu…). Không hỏi lại thông tin đã có trong dữ liệu, trừ khi cần xác nhận.

9. Đây là ý kiến tham khảo, không phải quyết định của hãng hay trung tâm bảo hành. Không khẳng định chắc chắn tuyệt đối; dùng "có khả năng", "theo điều khoản đã ghi".`

// emitClaimAssessmentTool is the single forced tool. Its input_schema is the
// model-facing contract; the coverage description repeats the honesty rule so a
// model that only reads the schema still sees it.
var emitClaimAssessmentTool = map[string]any{
	"name":        "emit_claim_assessment",
	"description": "Trả về đánh giá khả năng được bảo hành và thư gửi trung tâm bảo hành.",
	"input_schema": map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"required":             []any{"coverage", "confidence", "reasoning", "questions", "draftLetter"},
		"properties": map[string]any{
			"coverage": map[string]any{
				"type": "string",
				"enum": []any{assessCoverageLikelyCovered, assessCoverageUnclear, assessCoverageNotCovered},
				"description": "LIKELY_COVERED CHỈ khi mọi điều khoản quyết định (scope, exclusions) đã biết và ủng hộ việc được bảo hành. " +
					"Nếu một điều khoản quyết định là null / KHÔNG RÕ thì phải dùng UNCLEAR và hỏi lại trong questions. " +
					"LIKELY_NOT_COVERED chỉ khi dữ liệu đã biết chứng minh không được bảo hành (hết hạn, loại trừ, hết lượt).",
			},
			"confidence": map[string]any{
				"type":        "string",
				"enum":        []any{assessConfidenceLow, assessConfidenceMedium, assessConfidenceHigh},
				"description": "Độ chắc chắn của kết luận. HIGH chỉ khi các điều khoản quyết định đều đã biết.",
			},
			"reasoning": map[string]any{
				"type":        "string",
				"description": "Giải thích ngắn gọn dựa đúng trên điều khoản được cung cấp, bằng NGÔN NGỮ YÊU CẦU.",
			},
			"questions": map[string]any{
				"type":     "array",
				"maxItems": MaxAssessQuestions,
				"items":    map[string]any{"type": "string"},
				"description": "Các câu quầy dịch vụ sẽ hỏi / người dùng cần chuẩn bị, bằng NGÔN NGỮ YÊU CẦU. " +
					"Nếu một điều khoản quyết định bị thiếu, phải có câu hỏi về đúng điều khoản đó.",
			},
			"draftLetter": map[string]any{
				"type":        "string",
				"description": "Một LÁ THƯ gửi trung tâm bảo hành, LUÔN bằng TIẾNG VIỆT bất kể ngôn ngữ yêu cầu. Nêu thiết bị, số phiếu nếu có, lỗi, gói bảo hành đang yêu cầu và đề nghị cụ thể. Tối đa khoảng 2500 ký tự.",
			},
		},
	},
	"cache_control": map[string]any{"type": "ephemeral"},
}

// AssessClaim sends the bounded claim + contract facts to the Messages API with
// a forced tool call and returns the parsed, normalized assessment. It performs
// no database access and writes nothing.
func (c *Client) AssessClaim(ctx context.Context, in ClaimAssessmentInput) (ClaimAssessment, error) {
	if !c.Enabled() {
		return ClaimAssessment{}, &Error{
			Code:    "disabled",
			Message: "Tính năng đánh giá yêu cầu bảo hành bằng AI chưa được bật",
		}
	}

	reqBody := messageReq{
		Model:     c.model,
		MaxTokens: maxAssessOutputTokens,
		System: []map[string]any{{
			"type":          "text",
			"text":          assessSystemPrompt,
			"cache_control": map[string]any{"type": "ephemeral"},
		}},
		Tools:      []map[string]any{emitClaimAssessmentTool},
		ToolChoice: map[string]any{"type": "tool", "name": "emit_claim_assessment"},
		Messages: []wireMessage{{
			Role:    "user",
			Content: []contentBlock{{Type: "text", Text: buildAssessPrompt(in)}},
		}},
	}

	raw, err := json.Marshal(reqBody)
	if err != nil {
		return ClaimAssessment{}, &Error{Code: "upstream", Message: "Lỗi tạo yêu cầu"}
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(raw))
	if err != nil {
		return ClaimAssessment{}, &Error{Code: "upstream", Message: "Lỗi tạo yêu cầu"}
	}
	req.Header.Set("x-api-key", c.apiKey)
	req.Header.Set("anthropic-version", anthropicVersion)
	req.Header.Set("content-type", "application/json")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return ClaimAssessment{}, &Error{Code: "upstream", Message: "Không kết nối được dịch vụ AI"}
	}
	defer func() { _ = res.Body.Close() }()

	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if res.StatusCode == http.StatusTooManyRequests || res.StatusCode == 529 {
		return ClaimAssessment{}, &Error{Code: "rate_limited", Message: "Dịch vụ AI đang quá tải, thử lại sau"}
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ClaimAssessment{}, &Error{Code: "upstream", Message: fmt.Sprintf("Dịch vụ AI lỗi (%d)", res.StatusCode)}
	}

	return parseAssessResult(body)
}

// parseAssessResult pulls the emit_claim_assessment tool_use block out of the
// response and normalizes it.
func parseAssessResult(body []byte) (ClaimAssessment, error) {
	var resp messageResp
	if err := json.Unmarshal(body, &resp); err != nil {
		return ClaimAssessment{}, &Error{Code: "bad_output", Message: "Không đọc được kết quả AI"}
	}
	for _, block := range resp.Content {
		if block.Type == "tool_use" && block.Name == "emit_claim_assessment" && len(block.Input) > 0 {
			var out ClaimAssessment
			if err := json.Unmarshal(block.Input, &out); err != nil {
				return ClaimAssessment{}, &Error{Code: "bad_output", Message: "Kết quả AI không hợp lệ"}
			}
			return normalizeAssessment(out)
		}
	}
	return ClaimAssessment{}, &Error{Code: "bad_output", Message: "AI không trả về kết quả đánh giá"}
}

// normalizeAssessment validates the two closed enums and enforces every output
// bound. An empty reasoning or letter is rejected rather than returned: the
// caller paid for an assessment, and an empty letter would leave the user with
// nothing to hand to the counter.
func normalizeAssessment(in ClaimAssessment) (ClaimAssessment, error) {
	out := ClaimAssessment{
		Coverage:    strings.ToUpper(strings.TrimSpace(in.Coverage)),
		Confidence:  strings.ToUpper(strings.TrimSpace(in.Confidence)),
		Reasoning:   clipRunes(strings.TrimSpace(in.Reasoning), maxAssessReasoningRunes),
		DraftLetter: clipRunes(strings.TrimSpace(in.DraftLetter), maxAssessDraftLetterRunes),
	}

	switch out.Coverage {
	case assessCoverageLikelyCovered, assessCoverageUnclear, assessCoverageNotCovered:
	default:
		return ClaimAssessment{}, &Error{Code: "bad_output", Message: "Kết quả AI không hợp lệ"}
	}
	switch out.Confidence {
	case assessConfidenceLow, assessConfidenceMedium, assessConfidenceHigh:
	default:
		return ClaimAssessment{}, &Error{Code: "bad_output", Message: "Kết quả AI không hợp lệ"}
	}
	if out.Reasoning == "" || out.DraftLetter == "" {
		return ClaimAssessment{}, &Error{Code: "bad_output", Message: "Kết quả AI không hợp lệ"}
	}

	out.Questions = make([]string, 0, len(in.Questions))
	for _, q := range in.Questions {
		q = clipRunes(strings.TrimSpace(q), maxAssessQuestionRunes)
		if q == "" {
			continue
		}
		out.Questions = append(out.Questions, q)
		if len(out.Questions) == MaxAssessQuestions {
			break
		}
	}
	return out, nil
}

// buildAssessPrompt renders the bounded user message. Exported only through its
// test; the service does not build prompts itself.
//
// Every nullable term is rendered explicitly. Dropping a null line would be the
// subtle failure mode this feature exists to avoid: the model would have no way
// to tell "exclusions: none recorded" from "the prompt never mentioned
// exclusions", and the safest-looking answer (LIKELY_COVERED) is exactly the one
// that must not be guessed.
func buildAssessPrompt(in ClaimAssessmentInput) string {
	lang := normalizeAssessLanguage(in.Language)
	langName := "tiếng Việt"
	if lang == "en" {
		langName = "tiếng Anh"
	}

	var b strings.Builder
	b.WriteString("NGÔN NGỮ YÊU CẦU: ")
	b.WriteString(lang)
	b.WriteString(" (")
	b.WriteString(langName)
	b.WriteString(")\n")
	b.WriteString("- reasoning và questions: viết bằng ")
	b.WriteString(langName)
	b.WriteString(".\n")
	b.WriteString("- draftLetter: LUÔN viết bằng tiếng Việt (trung tâm bảo hành Việt Nam đọc).\n\n")

	b.WriteString("YÊU CẦU BẢO HÀNH\n")
	writeAssessLine(&b, "Nội dung lỗi (issue)", clipRunes(strings.TrimSpace(in.Claim.Issue), maxAssessIssueRunes))
	writeAssessLine(&b, "Chẩn đoán của trung tâm (diagnosis)", optText(in.Claim.Diagnosis, maxAssessDiagnosisRunes))
	writeAssessLine(&b, "Chi phí báo giá (cost, VND)", optMoney(in.Claim.Cost))
	writeAssessLine(&b, "Số phiếu (ticketNumber)", optText(in.Claim.TicketNumber, maxAssessShortTextRunes))
	writeAssessLine(&b, "Trung tâm bảo hành (serviceCenter)", optText(in.Claim.ServiceCenter, maxAssessShortTextRunes))
	writeAssessLine(&b, "Trạng thái yêu cầu", optTextValue(in.Claim.Status))
	writeAssessLine(&b, "Ngày mở yêu cầu", optTextValue(in.Claim.OpenedAt))
	writeAssessLine(&b, "Gói bảo hành được chỉ định (warrantyId)", optText(in.Claim.WarrantyID, maxAssessShortTextRunes))

	b.WriteString("\nTHIẾT BỊ\n")
	writeAssessLine(&b, "Tên thiết bị", clipRunes(strings.TrimSpace(in.Device.Name), maxAssessShortTextRunes))
	writeAssessLine(&b, "Danh mục", optTextValue(in.Device.Category))
	writeAssessLine(&b, "Hãng (brand)", optText(in.Device.Brand, maxAssessShortTextRunes))
	writeAssessLine(&b, "Model", optText(in.Device.Model, maxAssessShortTextRunes))
	writeAssessLine(&b, "Serial / IMEI", optText(in.Device.SerialNumber, 120))
	writeAssessLine(&b, "Ngày mua", optTextValue(in.Device.PurchaseDate))
	writeAssessLine(&b, "Trạng thái thiết bị", optTextValue(in.Device.Status))

	b.WriteString("\nHỢP ĐỒNG BẢO HÀNH (")
	fmt.Fprintf(&b, "%d", len(in.Warranties))
	b.WriteString(" gói)\n")
	if len(in.Warranties) == 0 {
		b.WriteString("- KHÔNG CÓ gói bảo hành nào được ghi nhận. Không được khẳng định LIKELY_COVERED; hãy hỏi người dùng có hợp đồng/phiếu bảo hành chưa nhập không.\n")
	}
	for i, w := range in.Warranties {
		fmt.Fprintf(&b, "\nGói %d", i+1)
		if in.Claim.WarrantyID != nil && *in.Claim.WarrantyID == w.ID {
			b.WriteString(" [ĐANG ĐƯỢC YÊU CẦU]")
		}
		b.WriteString(":\n")
		writeAssessLine(&b, "id", optTextValue(w.ID))
		writeAssessLine(&b, "Loại", optTextValue(w.Type))
		writeAssessLine(&b, "Nhà cung cấp", optText(w.Provider, maxAssessShortTextRunes))
		writeAssessLine(&b, "Bộ phận được bảo hành (component)", componentText(w.Component))
		writeAssessLine(&b, "Phạm vi (scope)", optText(w.Scope, maxAssessWarrantyTextRunes))
		writeAssessLine(&b, "Nội dung loại trừ (exclusions)", optText(w.Exclusions, maxAssessWarrantyTextRunes))
		writeAssessLine(&b, "Giới hạn chi trả (cap, VND)", optMoney(w.Cap))
		writeAssessLine(&b, "Mức khấu trừ (deductible, VND)", optMoney(w.Deductible))
		writeAssessLine(&b, "Khu vực áp dụng (region)", optText(w.Region, maxAssessShortTextRunes))
		writeAssessLine(&b, "Có thể chuyển nhượng (transferable)", optBool(w.Transferable))
		writeAssessLine(&b, "Số lần được phép (claimsAllowed)", claimsAllowedText(w.ClaimsAllowed))
		writeAssessLine(&b, "Số lần đã dùng (claimsUsed)", fmt.Sprintf("%d", w.ClaimsUsed))
		writeAssessLine(&b, "Ngày bắt đầu", optTextValue(w.StartDate))
		writeAssessLine(&b, "Ngày kết thúc", optTextValue(w.EndDate))
		writeAssessLine(&b, "Số tháng", fmt.Sprintf("%d", w.Months))
	}

	return clipAssessPrompt(b.String())
}

// Write helpers. `strings.Builder.WriteString` never returns a non-nil error, and
// this package already writes to Builder without inspecting it (fuzzy.go).

func writeAssessLine(b *strings.Builder, label, value string) {
	b.WriteString("- ")
	b.WriteString(label)
	b.WriteString(": ")
	if strings.TrimSpace(value) == "" {
		value = assessUnknownValue
	}
	b.WriteString(value)
	b.WriteString("\n")
}

func optText(p *string, max int) string {
	if p == nil {
		return ""
	}
	return clipRunes(strings.TrimSpace(*p), max)
}

func optTextValue(s string) string { return strings.TrimSpace(s) }

// componentText renders the one nullable term whose null has a DEFINED meaning:
// migration 0017 says a null component means the plan covers the whole unit.
// Passing it through the generic "unknown" line would tell the model the
// opposite of what the row means and would trigger a needless UNCLEAR.
func componentText(p *string) string {
	if p == nil || strings.TrimSpace(*p) == "" {
		return assessWholeUnitValue
	}
	return clipRunes(strings.TrimSpace(*p), maxAssessShortTextRunes)
}

func optMoney(p *int32) string {
	if p == nil {
		return ""
	}
	return fmt.Sprintf("%d VND", *p)
}

// claimsAllowedText renders the other term whose null is DEFINED rather than
// unknown: the warranty validator treats nil as "no ceiling recorded" (any
// claimsUsed is accepted), not as "no claims left". The note is kept in the value
// so a model reading only the data section still gets the right meaning.
func claimsAllowedText(p *int32) string {
	if p == nil {
		return "KHÔNG RÕ (null — chưa ghi nhận giới hạn; không phải đã hết lượt)"
	}
	return fmt.Sprintf("%d", *p)
}

func optBool(p *bool) string {
	if p == nil {
		return ""
	}
	if *p {
		return assessTransferableTrue
	}
	return assessTransferableFalse
}

func normalizeAssessLanguage(lang string) string {
	if strings.EqualFold(strings.TrimSpace(lang), "en") {
		return "en"
	}
	return "vi"
}

// clipRunes truncates on a rune boundary. It is applied per field during prompt
// building and again to the output fields after parsing.
func clipRunes(s string, max int) string {
	s = strings.ToValidUTF8(s, "")
	if max <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	if max == 1 {
		return "…"
	}
	return string(r[:max-1]) + "…"
}

// clipAssessPrompt applies the hard total cap AFTER the prompt is assembled, so
// no combination of per-field values (five warranties × long scope/exclusions)
// can exceed it. The truncation note is counted inside the cap.
func clipAssessPrompt(s string) string {
	r := []rune(s)
	if len(r) <= MaxAssessInputRunes {
		return s
	}
	note := []rune(assessTruncatedPromptNote)
	keep := MaxAssessInputRunes - len(note)
	if keep < 0 {
		keep = 0
	}
	return string(r[:keep]) + string(note)
}
