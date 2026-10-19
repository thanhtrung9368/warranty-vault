package ai

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"
)

// These tests pin the two things that CANNOT be checked against a live model in
// CI: that the prompt/schema encode the honesty rule, and that the token budget
// is bounded no matter what the database hands us. No network call is made anywhere
// in this file; the one wire test talks to an httptest.Server.

// The rule is only as strong as the prompt that states it. This test exists so a
// future prompt edit cannot silently drop the "unknown term ⇒ UNCLEAR" half.
func TestAssessSystemPromptEncodesHonestyRule(t *testing.T) {
	for _, want := range []string{
		"LIKELY_COVERED",
		"UNCLEAR",
		"LIKELY_NOT_COVERED",
		"KHÔNG RÕ",
		"null",
		"component",
		"scope",
		"exclusions",
		"claimsAllowed",
		"draftLetter",
		"tiếng Việt",
		"KHÔNG BAO GIỜ kết luận LIKELY_COVERED",
	} {
		if !strings.Contains(assessSystemPrompt, want) {
			t.Errorf("assessSystemPrompt is missing %q — the honesty rule must stay in the cached prompt", want)
		}
	}
	// The two halves of the rule must appear as one instruction, not as two
	// unrelated sentences a reader could interpret separately.
	if !strings.Contains(assessSystemPrompt, "questions PHẢI có ít nhất một câu hỏi") {
		t.Error("assessSystemPrompt does not require a question for the missing decisive term")
	}
	// The language split is contract: reasoning/questions follow the request,
	// the letter never does.
	if !strings.Contains(assessSystemPrompt, "reasoning và questions: viết bằng NGÔN NGỮ YÊU CẦU") {
		t.Error("assessSystemPrompt does not pin reasoning/questions to the request language")
	}
	if !strings.Contains(assessSystemPrompt, "draftLetter: LUÔN LUÔN viết bằng TIẾNG VIỆT") {
		t.Error("assessSystemPrompt does not pin draftLetter to Vietnamese")
	}
}

// The forced tool's input_schema is the model-facing contract. It must expose the
// three closed verdicts / three confidence levels, require every response field,
// and repeat the honesty rule where a model reads it (the coverage description).
func TestEmitClaimAssessmentToolSchema(t *testing.T) {
	if emitClaimAssessmentTool["name"] != "emit_claim_assessment" {
		t.Fatalf("tool name = %v", emitClaimAssessmentTool["name"])
	}
	schema, ok := emitClaimAssessmentTool["input_schema"].(map[string]any)
	if !ok {
		t.Fatal("emit_claim_assessment has no input_schema object")
	}
	if schema["additionalProperties"] != false {
		t.Error("input_schema must reject additional properties")
	}
	required, _ := schema["required"].([]any)
	for _, field := range []string{"coverage", "confidence", "reasoning", "questions", "draftLetter"} {
		if !containsAny(required, field) {
			t.Errorf("input_schema.required is missing %q", field)
		}
	}
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatal("input_schema has no properties")
	}

	coverage, _ := props["coverage"].(map[string]any)
	if coverage == nil {
		t.Fatal("coverage is not an object schema")
	}
	coverageEnum, _ := coverage["enum"].([]any)
	if len(coverageEnum) != 3 {
		t.Fatalf("coverage enum = %v, want exactly the three frozen verdicts", coverageEnum)
	}
	for _, want := range []string{CoverageLikelyCovered, CoverageUnclear, CoverageLikelyNotCovered} {
		if !containsAny(coverageEnum, want) {
			t.Errorf("coverage enum is missing %q", want)
		}
	}
	coverageDesc, _ := coverage["description"].(string)
	for _, want := range []string{"UNCLEAR", "null", "KHÔNG RÕ", "LIKELY_COVERED"} {
		if !strings.Contains(coverageDesc, want) {
			t.Errorf("coverage description is missing %q — the schema itself must state the honesty rule", want)
		}
	}

	confidence, _ := props["confidence"].(map[string]any)
	if confidence == nil {
		t.Fatal("confidence is not an object schema")
	}
	confidenceEnum, _ := confidence["enum"].([]any)
	if len(confidenceEnum) != 3 {
		t.Errorf("confidence enum = %v, want LOW/MEDIUM/HIGH", confidenceEnum)
	}

	questions, _ := props["questions"].(map[string]any)
	if questions == nil {
		t.Fatal("questions is not an object schema")
	}
	if questions["type"] != "array" {
		t.Errorf("questions type = %v, want array", questions["type"])
	}
	if questions["maxItems"] != MaxAssessQuestions {
		t.Errorf("questions maxItems = %v, want %d", questions["maxItems"], MaxAssessQuestions)
	}
	items, _ := questions["items"].(map[string]any)
	if items == nil || items["type"] != "string" {
		t.Errorf("questions items = %v, want string items", questions["items"])
	}

	letter, _ := props["draftLetter"].(map[string]any)
	if letter == nil {
		t.Fatal("draftLetter is not an object schema")
	}
	letterDesc, _ := letter["description"].(string)
	if !strings.Contains(letterDesc, "TIẾNG VIỆT") {
		t.Error("draftLetter description must tell the model the letter is always Vietnamese")
	}
}

// Every null contract term must reach the model explicitly, never be omitted —
// as "unknown" when the column has no defined null meaning, or as its defined
// meaning when it does (component = whole unit). This is the prompt half of
// "LIKELY_COVERED is not asserted when the decisive term is null": the model has
// to be able to SEE that it is null.
func TestBuildAssessPrompt_RendersNullTermsAsUnknown(t *testing.T) {
	in := ClaimAssessmentInput{
		Language: "en",
		Claim: ClaimFacts{
			Issue:      "Màn hình bị sọc sau khi rơi",
			Diagnosis:  ptrString("Màn hình hỏng"),
			WarrantyID: ptrString("w1"),
		},
		Device: DeviceFacts{Name: "iPhone 15 Pro", Category: "PHONE"},
		Warranties: []WarrantyFacts{{
			ID:    "w1",
			Type:  "STANDARD",
			Scope: ptrString("Lỗi phần cứng do nhà sản xuất"),
		}},
	}
	p := buildAssessPrompt(in)

	if !strings.Contains(p, "NGÔN NGỮ YÊU CẦU: en") {
		t.Errorf("prompt does not declare the request language:\n%s", p)
	}
	for _, label := range []string{
		"(exclusions)",
		"(claimsAllowed)",
		"(cap, VND)",
		"(deductible, VND)",
		"(transferable)",
		"Nhà cung cấp",
		"Ngày bắt đầu",
		"Ngày kết thúc",
		"Serial / IMEI",
	} {
		line := findPromptLine(p, label)
		if line == "" {
			t.Errorf("prompt has no line for %q — a null term was dropped instead of being marked unknown", label)
			continue
		}
		if !strings.Contains(line, "KHÔNG RÕ") {
			t.Errorf("line %q does not mark the null term as unknown", line)
		}
	}
	// component is the exception: a null component means "the whole unit" in
	// migration 0017, so it must NOT be presented to the model as unknown.
	componentLine := findPromptLine(p, "(component)")
	if !strings.Contains(componentLine, "Toàn bộ thiết bị") {
		t.Errorf("component line = %q, want null rendered as the whole unit", componentLine)
	}
	if strings.Contains(componentLine, "KHÔNG RÕ") {
		t.Errorf("component line = %q, but a null component is known (whole unit), not unknown", componentLine)
	}
	// The known scope must still be there verbatim: "unknown" is not a blanket.
	if !strings.Contains(p, "Lỗi phần cứng do nhà sản xuất") {
		t.Error("prompt dropped the known scope")
	}
	if !strings.Contains(p, "[ĐANG ĐƯỢC YÊU CẦU]") {
		t.Error("prompt does not mark the warranty named by the claim")
	}
}

// The prompt must carry the ACTUAL terms and dates, not a summary we invented.
func TestBuildAssessPrompt_CarriesActualContractTerms(t *testing.T) {
	capVND, deductible := int32(5000000), int32(200000)
	yes, allowed, used := true, int32(3), int32(1)
	in := ClaimAssessmentInput{
		Language: "vi",
		Claim: ClaimFacts{
			Issue:         "Pin tụt nhanh",
			Diagnosis:     ptrString("Pin chai"),
			Cost:          ptrInt32(1500000),
			TicketNumber:  ptrString("SC-123"),
			ServiceCenter: ptrString("TTBH Apple Q.1"),
			Status:        "OPEN",
			OpenedAt:      "2026-10-01",
		},
		Device: DeviceFacts{
			Name:         "iPhone 15 Pro",
			Category:     "PHONE",
			Brand:        ptrString("Apple"),
			Model:        ptrString("A3102"),
			SerialNumber: ptrString("356938035643809"),
			PurchaseDate: "2024-11-20",
			Status:       "ACTIVE",
		},
		Warranties: []WarrantyFacts{{
			ID:            "w1",
			Type:          "EXTENDED",
			Provider:      ptrString("AppleCare+"),
			StartDate:     "2024-11-20",
			EndDate:       "2026-11-20",
			Months:        24,
			Component:     ptrString("Pin và màn hình"),
			Scope:         ptrString("Lỗi phần cứng do nhà sản xuất"),
			Cap:           &capVND,
			Deductible:    &deductible,
			Exclusions:    ptrString("Rơi vỡ, vào nước"),
			Region:        ptrString("Việt Nam"),
			Transferable:  &yes,
			ClaimsAllowed: &allowed,
			ClaimsUsed:    used,
		}},
	}
	p := buildAssessPrompt(in)
	for _, want := range []string{
		"Pin tụt nhanh", "Pin chai", "1500000 VND", "SC-123", "TTBH Apple Q.1",
		"2026-10-01", "iPhone 15 Pro", "PHONE", "Apple", "A3102", "356938035643809",
		"2024-11-20", "ACTIVE", "EXTENDED", "AppleCare+", "2026-11-20",
		"Pin và màn hình", "Lỗi phần cứng do nhà sản xuất", "5000000 VND",
		"200000 VND", "Rơi vỡ, vào nước", "Việt Nam", "Có", "3", "1", "24",
	} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt lost contract value %q", want)
		}
	}
	// A claim with no warranties must say so explicitly rather than leaving the
	// model to conclude "no warranty means covered".
	empty := buildAssessPrompt(ClaimAssessmentInput{Language: "vi"})
	if !strings.Contains(empty, "KHÔNG CÓ gói bảo hành nào") {
		t.Error("prompt does not state explicitly that there are zero warranties")
	}
}

// A pathological issue / scope must not blow the token budget. The assertion is
// in runes, matching the cap, and uses an emoji so the count cannot be polluted
// by a Latin letter appearing in the labels.
func TestBuildAssessPrompt_BoundsPathologicalInput(t *testing.T) {
	huge := strings.Repeat("🦄", 50000)
	warranties := make([]WarrantyFacts, 0, 12)
	for i := 0; i < 12; i++ {
		warranties = append(warranties, WarrantyFacts{
			ID:         "w",
			Type:       "STANDARD",
			Provider:   ptrString(huge),
			Component:  ptrString(huge),
			Scope:      ptrString(huge),
			Exclusions: ptrString(huge),
			Region:     ptrString(huge),
		})
	}
	in := ClaimAssessmentInput{
		Language:   "vi",
		Claim:      ClaimFacts{Issue: huge, Diagnosis: ptrString(huge)},
		Device:     DeviceFacts{Name: huge, Brand: ptrString(huge), Model: ptrString(huge)},
		Warranties: warranties,
	}
	p := buildAssessPrompt(in)

	if n := utf8.RuneCountInString(p); n > MaxAssessInputRunes {
		t.Fatalf("prompt = %d runes, want at most %d", n, MaxAssessInputRunes)
	}
	issueLine := findPromptLine(p, "Nội dung lỗi (issue)")
	if issueLine == "" {
		t.Fatal("prompt has no issue line")
	}
	if n := strings.Count(issueLine, "🦄"); n > maxAssessIssueRunes {
		t.Errorf("issue rune count in prompt = %d, want at most %d", n, maxAssessIssueRunes)
	}
	// Per-field caps are applied before the total cap, so even the fields further
	// down the first warranty cannot be unbounded.
	for label, max := range map[string]int{
		"Chẩn đoán của trung tâm (diagnosis)": maxAssessDiagnosisRunes,
		"Tên thiết bị":                        maxAssessShortTextRunes,
		"Nhà cung cấp":                        maxAssessShortTextRunes,
		"Bộ phận được bảo hành (component)":   maxAssessShortTextRunes,
		"Phạm vi (scope)":                     maxAssessWarrantyTextRunes,
		"Nội dung loại trừ (exclusions)":      maxAssessWarrantyTextRunes,
		"Khu vực áp dụng (region)":            maxAssessShortTextRunes,
	} {
		line := findPromptLine(p, label)
		if line == "" {
			t.Errorf("prompt has no %q line", label)
			continue
		}
		if n := strings.Count(line, "🦄"); n > max {
			t.Errorf("%s carries %d runes, want at most %d", label, n, max)
		}
	}
	if !strings.HasSuffix(p, assessTruncatedPromptNote) {
		t.Error("an over-budget prompt must end with the truncation note so the cut is visible")
	}
}

// The total cap must not fire for any input the WRITE PATHS can actually
// produce. Five fully-filled contracts plus a maxed claim/device is the
// DB-bounded worst case; a legitimate claim must not lose its deciding warranty
// to truncation (the honesty guard reasons over the DB rows, not the prompt, so
// a truncated prompt could let an overclaim through).
func TestBuildAssessPrompt_DBBoundedWorstCaseFits(t *testing.T) {
	text := func(n int) string { return strings.Repeat("ạ", n) }
	warranties := make([]WarrantyFacts, 0, 5)
	for i := 0; i < 5; i++ {
		warranties = append(warranties, WarrantyFacts{
			ID:            "w",
			Type:          "EXTENDED",
			Provider:      ptrString(text(200)),
			StartDate:     "2024-11-20",
			EndDate:       "2026-11-20",
			Months:        24,
			Component:     ptrString(text(200)),
			Scope:         ptrString(text(500)),
			Exclusions:    ptrString(text(500)),
			Region:        ptrString(text(200)),
			ClaimsAllowed: ptrInt32(3),
		})
	}
	in := ClaimAssessmentInput{
		Language: "vi",
		Claim: ClaimFacts{
			Issue:         text(1000),
			Diagnosis:     ptrString(text(500)),
			TicketNumber:  ptrString(text(100)),
			ServiceCenter: ptrString(text(200)),
		},
		Device: DeviceFacts{
			Name:         text(200),
			Brand:        ptrString(text(200)),
			Model:        ptrString(text(200)),
			SerialNumber: ptrString(text(120)),
		},
		Warranties: warranties,
	}
	p := buildAssessPrompt(in)
	if strings.HasSuffix(p, assessTruncatedPromptNote) {
		t.Fatalf("DB-bounded worst case was truncated (%d runes) — raise MaxAssessInputRunes or lower a per-field cap",
			utf8.RuneCountInString(p))
	}
	if n := utf8.RuneCountInString(p); n > MaxAssessInputRunes {
		t.Fatalf("prompt = %d runes, want at most %d", n, MaxAssessInputRunes)
	}
	// Every one of the five contracts must still be visible, including the last.
	if !strings.Contains(p, "Gói 5:") {
		t.Error("the fifth warranty was truncated out of the prompt")
	}
}

func TestParseAssessResult_OK(t *testing.T) {
	body := []byte(`{"content":[{"type":"tool_use","name":"emit_claim_assessment","input":{
		"coverage":"LIKELY_COVERED",
		"confidence":"HIGH",
		"reasoning":"Theo điều khoản, lỗi phần cứng được bảo hành.",
		"questions":["Anh/chị có hoá đơn mua máy không?","Serial trên máy là gì?"],
		"draftLetter":"Kính gửi trung tâm bảo hành, ..."
	}}]}`)
	got, err := parseAssessResult(body)
	if err != nil {
		t.Fatalf("parseAssessResult: %v", err)
	}
	if got.Coverage != CoverageLikelyCovered || got.Confidence != ConfidenceHigh {
		t.Errorf("coverage/confidence = %s/%s", got.Coverage, got.Confidence)
	}
	if len(got.Questions) != 2 {
		t.Errorf("questions = %v, want 2", got.Questions)
	}
	if !strings.Contains(got.DraftLetter, "Kính gửi") {
		t.Errorf("draftLetter = %q", got.DraftLetter)
	}
}

// The response is bounded twice (max_tokens on the wire, rune caps after
// parsing); this pins the second half so a runaway model cannot hand the client
// a 20-question, 50k-character response.
func TestParseAssessResult_BoundsOutput(t *testing.T) {
	questions := make([]string, 0, 20)
	for i := 0; i < 20; i++ {
		questions = append(questions, strings.Repeat("q", 1000))
	}
	input := map[string]any{
		"coverage":    "UNCLEAR",
		"confidence":  "LOW",
		"reasoning":   strings.Repeat("r", 10000),
		"questions":   questions,
		"draftLetter": strings.Repeat("l", 10000),
	}
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	body := []byte(`{"content":[{"type":"tool_use","name":"emit_claim_assessment","input":` + string(raw) + `}]}`)

	got, err := parseAssessResult(body)
	if err != nil {
		t.Fatalf("parseAssessResult: %v", err)
	}
	if n := utf8.RuneCountInString(got.Reasoning); n > maxAssessReasoningRunes {
		t.Errorf("reasoning = %d runes, want at most %d", n, maxAssessReasoningRunes)
	}
	if n := utf8.RuneCountInString(got.DraftLetter); n > maxAssessDraftLetterRunes {
		t.Errorf("draftLetter = %d runes, want at most %d", n, maxAssessDraftLetterRunes)
	}
	if len(got.Questions) != MaxAssessQuestions {
		t.Errorf("questions = %d, want %d", len(got.Questions), MaxAssessQuestions)
	}
	for i, q := range got.Questions {
		if n := utf8.RuneCountInString(q); n > maxAssessQuestionRunes {
			t.Errorf("question %d = %d runes, want at most %d", i, n, maxAssessQuestionRunes)
		}
	}
	if got.Questions == nil {
		t.Error("questions must never be nil (JSON null)")
	}
}

func TestParseAssessResult_InvalidEnumIsBadOutput(t *testing.T) {
	for _, field := range []string{
		`{"coverage":"PROBABLY_FINE","confidence":"HIGH","reasoning":"x","questions":[],"draftLetter":"y"}`,
		`{"coverage":"UNCLEAR","confidence":"ABSOLUTE","reasoning":"x","questions":[],"draftLetter":"y"}`,
		`{"coverage":"UNCLEAR","confidence":"LOW","reasoning":"","questions":[],"draftLetter":"y"}`,
		`{"coverage":"UNCLEAR","confidence":"LOW","reasoning":"x","questions":[],"draftLetter":""}`,
	} {
		body := []byte(`{"content":[{"type":"tool_use","name":"emit_claim_assessment","input":` + field + `}]}`)
		if _, err := parseAssessResult(body); err == nil {
			t.Errorf("invalid assessment %s was accepted", field)
		} else if e, ok := AsError(err); !ok || e.Code != "bad_output" {
			t.Errorf("invalid assessment error = %v, want bad_output", err)
		}
	}
}

func TestParseAssessResult_NoToolUse(t *testing.T) {
	body := []byte(`{"content":[{"type":"text","text":"sorry"}]}`)
	_, err := parseAssessResult(body)
	if e, ok := AsError(err); !ok || e.Code != "bad_output" {
		t.Fatalf("error = %v, want bad_output", err)
	}
	if e, _ := AsError(err); e.Message != "AI không trả về kết quả đánh giá" {
		t.Errorf("message = %q", e.Message)
	}
}

func TestAssessClaim_Disabled(t *testing.T) {
	c := &Client{} // empty apiKey → disabled
	_, err := c.AssessClaim(context.Background(), ClaimAssessmentInput{})
	if e, ok := AsError(err); !ok || e.Code != "disabled" {
		t.Fatalf("error = %v, want disabled", err)
	}
}

// The wire shape against the Messages API: one bounded text message, the forced
// tool, prompt caching and a max_tokens ceiling. No real model is involved.
func TestAssessClaim_RequestShape(t *testing.T) {
	var captured messageReq
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &captured); err != nil {
			t.Errorf("unmarshal request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"tool_use","name":"emit_claim_assessment","input":{
			"coverage":"UNCLEAR","confidence":"LOW","reasoning":"Thiếu điều khoản.",
			"questions":["Hợp đồng ghi gì?"],"draftLetter":"Kính gửi trung tâm bảo hành."}}]}`))
	}))
	defer srv.Close()

	c := NewClientForEndpoint("test-key-never-used", "test-model", srv.URL)
	got, err := c.AssessClaim(context.Background(), ClaimAssessmentInput{
		Language: "vi",
		Claim:    ClaimFacts{Issue: "Màn hình bị sọc"},
		Device:   DeviceFacts{Name: "iPhone 15 Pro"},
	})
	if err != nil {
		t.Fatalf("AssessClaim: %v", err)
	}
	if got.Coverage != CoverageUnclear {
		t.Errorf("coverage = %q", got.Coverage)
	}
	if captured.Model != "test-model" {
		t.Errorf("model = %q, want test-model", captured.Model)
	}
	if captured.MaxTokens != maxAssessOutputTokens {
		t.Errorf("max_tokens = %d, want %d", captured.MaxTokens, maxAssessOutputTokens)
	}
	if len(captured.Tools) != 1 || captured.Tools[0]["name"] != "emit_claim_assessment" {
		t.Fatalf("tools = %+v, want the single emit_claim_assessment tool", captured.Tools)
	}
	if captured.ToolChoice["type"] != "tool" || captured.ToolChoice["name"] != "emit_claim_assessment" {
		t.Errorf("tool_choice = %+v, want a forced emit_claim_assessment", captured.ToolChoice)
	}
	if len(captured.System) != 1 {
		t.Fatalf("system = %+v, want one cached text block", captured.System)
	}
	if cc, _ := captured.System[0]["cache_control"].(map[string]any); cc["type"] != "ephemeral" {
		t.Errorf("system cache_control = %v, want ephemeral", captured.System[0]["cache_control"])
	}
	if len(captured.Messages) != 1 || len(captured.Messages[0].Content) != 1 {
		t.Fatalf("messages = %+v, want one text message", captured.Messages)
	}
	prompt := captured.Messages[0].Content[0].Text
	if !strings.Contains(prompt, "Màn hình bị sọc") || !strings.Contains(prompt, "iPhone 15 Pro") {
		t.Errorf("prompt does not carry the claim/device facts: %s", prompt)
	}
	if n := utf8.RuneCountInString(prompt); n > MaxAssessInputRunes {
		t.Errorf("wire prompt = %d runes, want at most %d", n, MaxAssessInputRunes)
	}
}

func ptrString(s string) *string { return &s }
func ptrInt32(i int32) *int32    { return &i }

func containsAny(haystack []any, needle string) bool {
	for _, v := range haystack {
		if s, ok := v.(string); ok && s == needle {
			return true
		}
	}
	return false
}

// findPromptLine returns the first "- ..." line containing label, or "".
func findPromptLine(prompt, label string) string {
	for _, line := range strings.Split(prompt, "\n") {
		if strings.HasPrefix(line, "- ") && strings.Contains(line, label) {
			return line
		}
	}
	return ""
}
