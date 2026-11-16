package services

import (
	"context"
	"log/slog"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// Warranty-card extraction (FEATURE_RESEARCH_2026-11 §6.3,
// POST /api/v1/ai/extract-warranty-card).
//
// The endpoint returns a DRAFT of the nine contract-term fields added by
// migration 0017 and nothing else. It is the input path for `assess-claim`: the
// nine columns are what makes that endpoint answer something better than
// UNCLEAR. It writes NO Warranty and NO Device row — the only write in this
// file is the OCR transcript on the attachment it was read from
// (Attachment.extractedText, migration 0019), so the card becomes findable in
// `GET /api/v1/search`. Confirming the draft is the user's job in the warranty
// form.
//
// # Why the sanitizer is the important half
//
// The model reads Vietnamese paper cards whose terms are terse and easy to
// misread. A wrong `exclusions` is worse than a missing one: `assess-claim`
// treats scope/exclusions as decisive, so a fabricated exclusion can turn an
// honest "UNCLEAR" into a paid feature telling the user they are covered. The
// rules below are therefore deterministic and conservative:
//
//   - a percentage deductible is null + warning, never converted to đồng;
//   - a "0/2" claim counter is split into used/allowed, and used > allowed drops
//     used (the validator would reject it otherwise);
//   - a card with two clocks (whole unit + a part) keeps the whole-unit terms and
//     warns — it never takes the longer term;
//   - every number must appear inside the quoted transcript (`extractedText`);
//     a number that is not in the text is dropped, because there is no evidence
//     for it;
//   - text is truncated on a rune boundary to the exact bounds
//     ValidateWarrantyInput enforces, so a draft can always be mapped into
//     `WarrantyInput` without a 400.
//
// No `type` is produced or inferred here or anywhere else in this path. The
// client keeps the user's type choice; a card does not state STANDARD /
// EXTENDED / THIRD_PARTY.

// Warranty-card warning codes. They are contract (openapi.yaml
// → WarrantyCardWarning → code) and, unlike the messages, never move with the
// request language.
const (
	warnDeductiblePercentage = "DEDUCTIBLE_PERCENTAGE"
	warnNumberNotInQuote     = "NUMBER_NOT_IN_QUOTE"
	warnNumberOutOfRange     = "NUMBER_OUT_OF_RANGE"
	warnClaimsUsedOverLimit  = "CLAIMS_USED_OVER_ALLOWED"
	warnMultipleClocks       = "MULTIPLE_CLOCKS"
	warnTruncated            = "TRUNCATED"
)

// WarrantyCardExtractor is the AI boundary this service depends on. *ai.Client
// satisfies it; tests inject a fake. Same shape as ReceiptExtractor so the
// services package stays free of HTTP concerns.
type WarrantyCardExtractor interface {
	Enabled() bool
	ExtractWarrantyCard(ctx context.Context, docBytes []byte, mediaType string) (ai.WarrantyCardExtraction, error)
}

// WarrantyCardWarning is the advisory sibling of `unmatched`: it explains a
// value that was DROPPED (`DEDUCTIBLE_PERCENTAGE`, `NUMBER_NOT_IN_QUOTE`,
// `NUMBER_OUT_OF_RANGE`, `CLAIMS_USED_OVER_ALLOWED`) or a choice the sanitizer
// made (`MULTIPLE_CLOCKS` keeps the whole-unit package; `TRUNCATED` cut a long
// term to the form's bound). It never means the request failed.
//
// The shape is the existing DeviceWarning one (code/field/message) on purpose:
// clients already know how to render a non-blocking yellow advisory.
type WarrantyCardWarning struct {
	Code    string `json:"code"`
	Field   string `json:"field"`
	Message string `json:"message"`
}

// WarrantyCardDraft mirrors the contract fields of WarrantyInput, so a client
// maps it 1:1 into the warranty form. Every scalar is nullable: null means "the
// card does not say" (or the sanitizer refused the value), never zero.
//
// `transferable` stays a true tri-state — nil is "not stated", which is
// different from false ("not transferable"). Nothing here has a `type`,
// `months`, `startDate` or `endDate`: the card's durations are deliberately not
// turned into a warranty length, because that would require inventing the start
// date the card does not carry.
//
// Always-present arrays: `unmatched` and `warnings` are `[]`, never null.
type WarrantyCardDraft struct {
	Component     *string `json:"component"`
	Scope         *string `json:"scope"`
	Cap           *int32  `json:"cap"`
	Deductible    *int32  `json:"deductible"`
	Exclusions    *string `json:"exclusions"`
	Region        *string `json:"region"`
	Transferable  *bool   `json:"transferable"`
	ClaimsAllowed *int32  `json:"claimsAllowed"`
	ClaimsUsed    *int32  `json:"claimsUsed"`

	// Confidence is "high" | "medium" | "low". An absent/unknown class degrades
	// to "low": a draft whose certainty cannot be classified must not look more
	// certain than the model said.
	Confidence string `json:"confidence"`
	// Unmatched lists the fields whose value was dropped, so the form can ask
	// the user to fill them in by hand.
	Unmatched []string `json:"unmatched"`
	// Warnings explains each drop and the two conservative choices above.
	Warnings []WarrantyCardWarning `json:"warnings"`
	// ExtractedTextStored is true only when the transcript was actually written
	// to the attachment. A best-effort DB failure still returns the draft, so the
	// UI must read this flag instead of assuming searchability.
	ExtractedTextStored bool `json:"extractedTextStored"`
}

// ExtractWarrantyCard gates (server key → per-user AI opt-in → optional
// Premium), decrypts one owned attachment, asks the model, sanitizes the answer
// and stores the transcript. It never writes a Warranty/Device row.
//
// Gates, in order, and why:
//
//  1. `ANTHROPIC_API_KEY` missing → 503 feature_disabled (no model call, no
//     database read);
//  2. `User.aiOptIn` false → 403 ai_optin_required. The decrypted card leaves the
//     box to Anthropic, so consent comes before any payment question;
//  3. env `WARRANTY_CARD_PREMIUM` ON and the account is not Premium → 403
//     premium_required. The env is OFF by default: Premium gating is only
//     switched on after the accuracy gate in §6.3 is met, and no client shows a
//     Premium badge for this feature before then.
//
// Ownership is the attachment pipeline's: someone else's attachment id is a 404,
// never a 403 (the same rule as every other attachment read).
func ExtractWarrantyCard(
	ctx context.Context,
	db *pgxpool.Pool,
	client WarrantyCardExtractor,
	userID, attachmentID string,
) (WarrantyCardDraft, error) {
	if strings.TrimSpace(attachmentID) == "" {
		return WarrantyCardDraft{}, badInput(i18n.Text(ctx, "Thiếu attachmentId"))
	}

	gate, gerr := checkAIGate(ctx, db, client != nil && client.Enabled(), userID)
	if gerr != nil {
		return WarrantyCardDraft{}, gerr
	}
	switch gate {
	case aiGateFeatureDisabled:
		return WarrantyCardDraft{}, &AttachmentError{
			Code:    "feature_disabled",
			Message: i18n.Text(ctx, "Tính năng đọc thẻ bảo hành chưa được bật"),
		}
	case aiGateOptInRequired:
		return WarrantyCardDraft{}, &AttachmentError{
			Code:    "ai_optin_required",
			Message: i18n.Text(ctx, "Cần bật Trợ lý AI trong Cài đặt trước khi đọc thẻ bảo hành"),
		}
	}

	if warrantyCardPremiumRequired() {
		premium, err := IsPremium(ctx, db, userID)
		if err != nil {
			return WarrantyCardDraft{}, internalErr(i18n.Text(ctx, "Lỗi tải thông tin Premium"))
		}
		if !premium {
			return WarrantyCardDraft{}, &AttachmentError{
				Code:    "premium_required",
				Message: i18n.Text(ctx, "Đọc thẻ bảo hành là tính năng Premium"),
			}
		}
	}

	plain, mediaType, _, derr := decryptAttachment(ctx, db, userID, attachmentID)
	if derr != nil {
		return WarrantyCardDraft{}, derr
	}
	if !ai.IsSupportedReceiptType(mediaType) {
		return WarrantyCardDraft{}, badInput(i18n.Text(ctx, "Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF"))
	}

	extracted, err := client.ExtractWarrantyCard(ctx, plain, mediaType)
	if err != nil {
		if ae, ok := ai.AsError(err); ok {
			return WarrantyCardDraft{}, mapAIError(ctx, ae)
		}
		return WarrantyCardDraft{}, internalErr(i18n.Text(ctx, "Lỗi đọc thẻ bảo hành"))
	}

	draft := sanitizeWarrantyCardDraft(ctx, extracted)

	// Only the transcript is persisted, and only on the attachment it came from.
	// A re-scan that reads nothing must not erase an earlier transcript: the
	// best-effort write below is skipped when normalizeExtractedText returns nil.
	transcript := normalizeExtractedText(extracted.ExtractedText)
	if transcript != nil {
		if perr := SetAttachmentExtractedText(ctx, db, userID, attachmentID, transcript); perr != nil {
			slog.Warn("persist warranty-card text failed",
				"err", perr, "attachmentId", attachmentID, "userId", userID)
		} else {
			draft.ExtractedTextStored = true
		}
	}

	// Measurement (§6.3): enough to build the accuracy table per field and the
	// cost per scan, with the transcript itself deliberately absent (PII) and the
	// attachment id the only way back to the row.
	slog.Info("warranty card extracted",
		"userId", userID,
		"attachmentId", attachmentID,
		"mediaType", mediaType,
		"bytes", len(plain),
		"confidence", draft.Confidence,
		"unmatched", draft.Unmatched,
		"warnings", warrantyCardWarningCodes(draft.Warnings),
		"transcriptStored", draft.ExtractedTextStored,
		"inputTokens", extracted.InputTokens,
		"outputTokens", extracted.OutputTokens,
	)

	return draft, nil
}

// warrantyCardPremiumRequired reports whether this deployment charges Premium
// for warranty-card reading. `WARRANTY_CARD_PREMIUM` defaults OFF on purpose:
// §6.3 makes Premium conditional on an accuracy measurement (≥80% exact-or-null
// on cap/deductible/exclusions/scope) that has not happened yet. Until an
// operator sets this env, an opted-in Free account can use the feature; turning
// it on is what makes the 403 `premium_required` path reachable. Read at request
// time rather than captured at boot so a restart is the only deployment step.
func warrantyCardPremiumRequired() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("WARRANTY_CARD_PREMIUM"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// sanitizeWarrantyCardDraft turns the model's answer into a draft that is safe
// to pre-fill into WarrantyInput. It is pure except for `ctx` (message
// language); every rule is deterministic.
func sanitizeWarrantyCardDraft(ctx context.Context, e ai.WarrantyCardExtraction) WarrantyCardDraft {
	d := WarrantyCardDraft{
		Confidence: "low",
		Unmatched:  []string{},
		Warnings:   []WarrantyCardWarning{},
	}
	if e.Confidence != nil {
		switch strings.ToLower(strings.TrimSpace(*e.Confidence)) {
		case "high":
			d.Confidence = "high"
		case "medium":
			d.Confidence = "medium"
		}
	}

	transcript := normalizeExtractedText(e.ExtractedText)
	text := ""
	if transcript != nil {
		text = *transcript
	}

	// 1. Percentage deductible — never converted to đồng. Checked BEFORE the
	// quote rule, so a model that returned "10" for "khấu trừ 10%" cannot slip
	// the number through just because "10" appears in the text.
	deductibleFromPercent := hasPercentDeductible(text)

	// 2. "0/2"-style claim counters. A verbatim pair in the transcript is better
	// evidence than the model's two independent guesses, so when one is present
	// it supplies BOTH counters. The pair is already inside the quote.
	allowedFromPair, usedFromPair, hasPair := parseClaimCounterPair(text)

	// 3. Text terms, trimmed and truncated to the validator's rune bounds. A
	// truncated value is kept (it is still the card's words) and flagged.
	d.Component = sanitizeWarrantyCardText(ctx, e.Component, MaxWarrantyComponentRunes, "component", &d.Warnings)
	d.Scope = sanitizeWarrantyCardText(ctx, e.Scope, MaxWarrantyScopeRunes, "scope", &d.Warnings)
	d.Exclusions = sanitizeWarrantyCardText(ctx, e.Exclusions, MaxWarrantyExclusionsRunes, "exclusions", &d.Warnings)
	d.Region = sanitizeWarrantyCardText(ctx, e.Region, MaxWarrantyRegionRunes, "region", &d.Warnings)

	// 4. Two clocks on one card (whole unit + one part). Keep the whole-unit
	// package, which means null component, and say so. Taking the longer of the
	// two terms is exactly what §6.3 forbids.
	if d.Component != nil && hasMultipleClocks(text) {
		d.Component = nil
		d.Warnings = append(d.Warnings, WarrantyCardWarning{
			Code:  warnMultipleClocks,
			Field: "component",
			Message: i18n.Text(ctx,
				"Thẻ ghi nhiều thời hạn khác nhau (toàn máy và một bộ phận) — bản nháp giữ điều khoản của gói toàn bộ máy; hãy kiểm tra lại."),
		})
	}

	// 5. Numeric terms, each independently checked for range and for being
	// inside the quoted transcript. `dropNumber` is the single place a value
	// becomes null + warning + unmatched.
	d.Cap = sanitizeWarrantyCardNumber(ctx, e.Cap, "cap", text, &d)
	if deductibleFromPercent {
		// The card states a percentage, which this feature must never convert to
		// đồng. Drop whatever the model returned and flag the field.
		d.Deductible = nil
		dropWarrantyCardNumber(ctx, "deductible", warnDeductiblePercentage,
			i18n.Text(ctx, "Khấu trừ ghi theo % — bản nháp để trống ô này, bạn tự nhập số tiền."), &d)
	} else {
		d.Deductible = sanitizeWarrantyCardNumber(ctx, e.Deductible, "deductible", text, &d)
	}

	if hasPair {
		d.ClaimsAllowed = int32PtrFromQuote(ctx, allowedFromPair, "claimsAllowed", text, &d)
		d.ClaimsUsed = int32PtrFromQuote(ctx, usedFromPair, "claimsUsed", text, &d)
	} else {
		d.ClaimsAllowed = sanitizeWarrantyCardNumber(ctx, e.ClaimsAllowed, "claimsAllowed", text, &d)
		d.ClaimsUsed = sanitizeWarrantyCardNumber(ctx, e.ClaimsUsed, "claimsUsed", text, &d)
	}

	// 6. The validator's cross-field rule, applied here so the draft can never be
	// a WarrantyInput the server would reject. A known allowance and a larger
	// used count is the one case where the pair itself is contradictory; dropping
	// used (not the allowance) matches §6.3 and leaves the trustworthy number.
	if d.ClaimsAllowed != nil && d.ClaimsUsed != nil && *d.ClaimsUsed > *d.ClaimsAllowed {
		d.ClaimsUsed = nil
		d.Warnings = append(d.Warnings, WarrantyCardWarning{
			Code:  warnClaimsUsedOverLimit,
			Field: "claimsUsed",
			Message: i18n.Text(ctx,
				"Số lần đã dùng lớn hơn số lần được phép — bản nháp bỏ số đã dùng."),
		})
		addUnmatched(&d.Unmatched, "claimsUsed")
	}

	// 7. Transferable is a tri-state carried through untouched: nil means the
	// card does not say, which is NOT false.
	d.Transferable = e.Transferable

	return d
}

// sanitizeWarrantyCardText trims, drops empty values and truncates to `max`
// runes — the exact bound ValidateWarrantyInput applies. Truncation keeps the
// value (it is still the card's own words) and reports `TRUNCATED`; clients show
// it as an advisory, never as a save error.
func sanitizeWarrantyCardText(
	ctx context.Context, raw *string, max int, field string, warnings *[]WarrantyCardWarning,
) *string {
	if raw == nil {
		return nil
	}
	v := strings.TrimSpace(*raw)
	if v == "" {
		return nil
	}
	if runes := []rune(v); len(runes) > max {
		v = strings.TrimSpace(string(runes[:max]))
		*warnings = append(*warnings, WarrantyCardWarning{
			Code:  warnTruncated,
			Field: field,
			Message: i18n.Text(ctx,
				"Nội dung đọc được dài hơn giới hạn của biểu mẫu nên đã được rút gọn — hãy kiểm tra lại."),
		})
	}
	return &v
}

// sanitizeWarrantyCardNumber applies the range + quote rules to one number and
// returns the int32 the warranty form takes, or nil with a warning.
func sanitizeWarrantyCardNumber(
	ctx context.Context, raw *int64, field, text string, d *WarrantyCardDraft,
) *int32 {
	if raw == nil {
		return nil
	}
	return int32PtrFromQuote(ctx, *raw, field, text, d)
}

// int32PtrFromQuote is the shared range + "must be inside the quote" gate.
//
// `text` is the model's own verbatim transcript. A number that does not appear
// there has no evidence on the card, so it is dropped rather than trusted; this
// is the deterministic half of "mọi số phải nằm trong quote". Values outside
// int32 or negative are dropped too — WarrantyInput is int32 and the validator
// rejects negative money/counts, so forwarding them would only produce a 400 the
// user cannot fix in the form.
func int32PtrFromQuote(ctx context.Context, raw int64, field, text string, d *WarrantyCardDraft) *int32 {
	if raw < 0 || raw > math.MaxInt32 {
		dropWarrantyCardNumber(ctx, field, warnNumberOutOfRange, "", d)
		return nil
	}
	if !numberAppearsInText(raw, text) {
		dropWarrantyCardNumber(ctx, field, warnNumberNotInQuote, "", d)
		return nil
	}
	v := int32(raw)
	return &v
}

// dropWarrantyCardNumber records one dropped field in both halves of the
// response: `unmatched` tells the form which field to ask for, and `warnings`
// explains why. `message` may be empty for the two generic quote/range reasons,
// in which case the caller-specific explanation is filled in below.
func dropWarrantyCardNumber(ctx context.Context, field, code, message string, d *WarrantyCardDraft) {
	switch code {
	case warnNumberOutOfRange:
		message = i18n.Text(ctx, "Con số đọc được nằm ngoài khoảng hợp lệ — bản nháp để trống ô này.")
	case warnNumberNotInQuote:
		message = i18n.Text(ctx,
			"Không tìm thấy con số này trong phần chữ đọc được trên thẻ — bản nháp để trống ô này.")
	}
	d.Warnings = append(d.Warnings, WarrantyCardWarning{Code: code, Field: field, Message: message})
	addUnmatched(&d.Unmatched, field)
}

func addUnmatched(list *[]string, field string) {
	for _, f := range *list {
		if f == field {
			return
		}
	}
	*list = append(*list, field)
}

func warrantyCardWarningCodes(warnings []WarrantyCardWarning) []string {
	out := make([]string, 0, len(warnings))
	for _, w := range warnings {
		out = append(out, w.Code)
	}
	return out
}

// ---- quote / counter / clock detection -------------------------------------

var (
	// A percentage anywhere in the transcript; hasPercentDeductible decides
	// whether it belongs to the deductible.
	percentRe = regexp.MustCompile(`\d{1,3}\s*%`)
	// The claim-counter pair ("0/2", "1 / 3"). A date ("12/2028") or a ratio
	// ("24/7") is filtered out by the keyword window below.
	claimPairRe = regexp.MustCompile(`(\d{1,6})\s*/\s*(\d{1,6})`)
	// Durations, used only to recognise "two clocks" on one card.
	durationRe = regexp.MustCompile(`(?i)(\d{1,3})\s*(tháng|months?|năm|years?)`)
)

var deductibleWords = []string{"khấu trừ", "deductible", "mức trừ"}
var claimWords = []string{"lần", "claim", "used", "allowed", "đã dùng", "số lần"}

// hasPercentDeductible reports whether the transcript states a deductible as a
// percentage. Both word orders are accepted ("khấu trừ 10%" / "10% khấu trừ"),
// because Vietnamese cards use both.
func hasPercentDeductible(text string) bool {
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	for _, loc := range percentRe.FindAllStringIndex(lower, -1) {
		if nearAnyWord(lower, loc, deductibleWords, 40) {
			return true
		}
	}
	return false
}

// parseClaimCounterPair finds the first "used/allowed" pair near a claim
// keyword. It returns the two numbers (unvalidated int64s; the caller checks
// range) and whether a pair was found. A card that prints only "Số lần bảo
// hành: 2" has no pair and keeps the model's independent fields.
func parseClaimCounterPair(text string) (allowed, used int64, ok bool) {
	if text == "" {
		return 0, 0, false
	}
	lower := strings.ToLower(text)
	for _, loc := range claimPairRe.FindAllStringSubmatchIndex(lower, -1) {
		if !nearAnyWord(lower, loc, claimWords, 40) {
			continue
		}
		// loc = [fullStart, fullEnd, usedStart, usedEnd, allowedStart, allowedEnd]
		usedRaw, allowedRaw := lower[loc[2]:loc[3]], lower[loc[4]:loc[5]]
		used, err1 := strconv.ParseInt(usedRaw, 10, 64)
		if err1 != nil {
			continue
		}
		allowed, err2 := strconv.ParseInt(allowedRaw, 10, 64)
		if err2 != nil {
			continue
		}
		// "0/2" means used=0, allowed=2.
		return allowed, used, true
	}
	return 0, 0, false
}

// nearAnyWord reports whether any of `words` occurs within `window` bytes of the
// match, on either side. Byte distance is fine here: the keywords and the
// numbers are ASCII or near enough that a slightly wider/narrower window cannot
// turn a correct pair into a wrong one.
func nearAnyWord(text string, loc []int, words []string, window int) bool {
	start := loc[0] - window
	if start < 0 {
		start = 0
	}
	end := loc[1] + window
	if end > len(text) {
		end = len(text)
	}
	around := text[start:end]
	for _, w := range words {
		if strings.Contains(around, w) {
			return true
		}
	}
	return false
}

// hasMultipleClocks reports whether the card states at least two distinct
// durations while also naming a component. The caller keeps the whole-unit
// package (component = null) and warns; it must never pick the longer duration.
func hasMultipleClocks(text string) bool {
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	seen := map[int]bool{}
	for _, m := range durationRe.FindAllStringSubmatch(lower, -1) {
		n, err := strconv.Atoi(m[1])
		if err != nil || n <= 0 {
			continue
		}
		if strings.HasPrefix(m[2], "năm") || strings.HasPrefix(m[2], "year") {
			n *= 12
		}
		seen[n] = true
	}
	if len(seen) < 2 {
		return false
	}
	for _, w := range warrantyCardPartWords {
		if strings.Contains(lower, w) {
			return true
		}
	}
	return false
}

var warrantyCardPartWords = []string{
	"pin", "battery", "màn hình", "screen", "display", "vỏ máy", "case",
	"bàn phím", "keyboard", "camera", "loa", "speaker", "mainboard",
	"bo mạch", "ổ cứng", "ssd", "adapter", "củ sạc", "chuột", "mouse",
}

// numberAppearsInText reports whether n occurs in text as a complete digit run,
// allowing the usual Vietnamese thousand separators between digits
// ("2000000", "2.000.000", "2,000,000", "2 000 000"). This is the evidence rule:
// a number the model emitted but the document does not contain is not a fact
// about the card.
func numberAppearsInText(n int64, text string) bool {
	if text == "" {
		return false
	}
	digits := strconv.FormatInt(n, 10)
	for i := 0; i < len(text); i++ {
		if text[i] != digits[0] {
			continue
		}
		if i > 0 && isASCIIDigit(text[i-1]) {
			continue // inside a longer number — not an occurrence
		}
		if matchDigitRun(text, i, digits) {
			return true
		}
	}
	return false
}

func matchDigitRun(text string, start int, digits string) bool {
	di := 0
	i := start
	for i < len(text) {
		if di == len(digits) {
			// The run must end on a non-digit; otherwise this is a prefix of a
			// longer number ("500000" inside "5000000").
			return !isASCIIDigit(text[i])
		}
		c := text[i]
		if isASCIIDigit(c) {
			if c != digits[di] {
				return false
			}
			di++
			i++
			continue
		}
		if di > 0 {
			r, size := utf8.DecodeRuneInString(text[i:])
			if isNumberSeparator(r) {
				i += size
				continue
			}
		}
		return false
	}
	return di == len(digits)
}

func isASCIIDigit(c byte) bool { return c >= '0' && c <= '9' }

func isNumberSeparator(r rune) bool {
	switch r {
	case '.', ',', ' ', '\t', '\u00a0', '\u202f', '-':
		return true
	default:
		return false
	}
}
