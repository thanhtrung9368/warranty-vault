import SwiftUI
import UIKit
import WarrlyKit

// ============================================================
// ClaimAssessmentView — "Đánh giá bảo hành" for one claim
//
// Presented from `ClaimsSection` on the device detail. The endpoint takes only
// a claim id and writes nothing, so this sheet has no save button and no form:
// it reads, shows advice, and gets out of the way.
//
// ## The design constraint: this is advice, not a verdict
//
// A user at a service counter who reads "được bảo hành" will expect a free
// repair. The API says no such thing — `LIKELY_COVERED` is a probability — so
// the screen has to make three things unmissable:
//
//   1. The headline is hedged (`ClaimAssessmentRules.advice(for:confidence:)`),
//      and the confidence is a visible chip next to it, never implied.
//   2. The disclaimer sits *inside* the advice card, above the reasoning, and
//      says in plain words that the service centre decides.
//   3. There is no green tick, no red cross, no "Đã duyệt"/"Từ chối" state.
//      Coverage is text; the colour code is reserved for "there is no colour
//      code" — the accent stays neutral so the class cannot read as an outcome.
//
// ## The letter is Vietnamese on purpose
//
// `draftLetter` always comes back in Vietnamese because a Vietnamese service
// centre reads it, while `reasoning` and `questions` follow the app language.
// The letter block says so, keeps its text untouched, and offers copy/share.
// Translating it here would produce a letter the counter cannot use.
//
// ## The gates are states, not errors
//
// The shared AI opt-in (the same switch as receipt scanning) is checked before
// the call. Off → an inline card that explains what would be sent and offers to
// turn it on, then retries. The server's 503 (`feature_disabled`) is a calm
// "not available", not a red failure. Only a genuine failure gets error tone.
// ============================================================

struct ClaimAssessmentView: View {
    let client: APIClient
    let claim: Claim

    @Environment(\.dismiss) private var dismiss

    /// Client-side gate from the opt-in read, or the server's documented
    /// refusal mapped by `ClaimAssessmentGate.from(error:)`.
    @State private var gate: ClaimAssessmentGate = .ready
    /// `false` until the opt-in read completes, so the screen never flashes a
    /// "turn AI on" card at a user whose flag is on.
    @State private var checkedOptIn = false
    @State private var isRunning = false
    @State private var isEnabling = false
    @State private var assessment: ClaimAssessment?
    @State private var errorMessage: String?
    /// Error from the in-place opt-in enable. Separate from `errorMessage`
    /// because the two have different recovery: one retries the enable, the
    /// other retries the assessment.
    @State private var optInError: String?
    @State private var copiedLetter = false

    private var filledTicket: String? {
        guard let ticket = claim.ticketNumber?
            .trimmingCharacters(in: .whitespacesAndNewlines), !ticket.isEmpty
        else { return nil }
        return ticket
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 8)
                    claimCard
                    content
                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Đánh giá bảo hành"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L.t("Đóng")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                }
            }
            .task { await begin() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if !checkedOptIn {
            loadingCard(L.t("Đang kiểm tra cài đặt AI…"))
        } else if gate.needsOptIn {
            optInCard
        } else if gate.isFeatureDisabled {
            featureDisabledCard
        } else if isRunning {
            loadingCard(L.t("Đang đọc điều khoản và lần sửa chữa…"))
        } else if let assessment {
            result(assessment)
        } else if let errorMessage {
            failureCard(errorMessage)
        }
    }

    // MARK: - What is being assessed

    /// The claim is the context of the advice. It is shown first and stays
    /// above the result so the user can tell which repair the letter describes.
    private var claimCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Lần sửa chữa"))
            WVGroup {
                WVRowContainer {
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(alignment: .center, spacing: 8) {
                            Text(claim.issue)
                                .font(.system(size: 17))
                                .foregroundStyle(WVColor.label)
                                .lineLimit(2)
                            Spacer(minLength: 8)
                            WVChip(claim.status.label, tone: claim.status.chipTone)
                        }
                        if let ticket = filledTicket {
                            Text(L.t("Phiếu %@", ticket))
                                .font(.system(size: 13))
                                .foregroundStyle(WVColor.label3)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Result

    private func result(_ assessment: ClaimAssessment) -> some View {
        let advice = ClaimAssessmentRules.advice(for: assessment.coverage,
                                                 confidence: assessment.confidence)
        return VStack(alignment: .leading, spacing: 0) {
            adviceCard(advice, confidence: assessment.confidence)

            // "Unclear, with questions" is the success case this selector
            // exists for: the questions ARE the deliverable.
            if let intro = ClaimAssessmentRules.questionsIntro(
                for: assessment.coverage,
                questions: assessment.questionsOrEmpty
            ) {
                Text(intro)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(WVColor.label2)
                    .padding(.horizontal, 32)
                    .padding(.top, 10)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if assessment.hasQuestions {
                questionsSection(assessment.visibleQuestions)
            }

            reasoningSection(assessment.reasoning)

            if assessment.hasDraftLetter {
                letterSection(assessment.draftLetter)
            }

            WVSectionFooter(L.t("Đánh giá này chỉ đọc dữ liệu và không sửa gì."))
        }
    }

    /// The advice card. Everything that keeps this from looking like a verdict
    /// lives here: the "advice, not a decision" eyebrow, the hedged headline, a
    /// visible confidence chip, and the disclaimer *above* the reasoning.
    private func adviceCard(
        _ advice: ClaimAssessmentAdvice,
        confidence: ClaimAssessmentConfidence
    ) -> some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 6) {
                    WVIcon("sparkles", size: 14)
                        .foregroundStyle(WVColor.indigo)
                    Text(L.t("Gợi ý, không phải kết luận"))
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(WVColor.label2)
                    Spacer(minLength: 8)
                    WVChip(L.t("Độ tin cậy: %@", advice.confidenceLabel),
                           tone: confidenceTone(confidence))
                }

                Text(advice.headline)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(WVColor.label)
                    .fixedSize(horizontal: false, vertical: true)

                Text(advice.summary)
                    .font(.system(size: 14))
                    .foregroundStyle(WVColor.label2)
                    .fixedSize(horizontal: false, vertical: true)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .top, spacing: 8) {
                        WVIcon("info", size: 14)
                            .foregroundStyle(WVColor.orange)
                            .padding(.top, 1)
                        Text(advice.disclaimer)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(WVColor.label)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text(advice.confidenceNote)
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label2)
                        .padding(.leading, 22)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(WVColor.orange.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .padding(.top, 2)
    }

    /// Questions the counter will ask. Numbered because they are a checklist to
    /// take with you, not prose.
    private func questionsSection(_ questions: [String]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Trung tâm có thể sẽ hỏi"))
            WVGroup {
                ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
                    if index > 0 { WVDivider(inset: 16) }
                    HStack(alignment: .top, spacing: 10) {
                        Text("\(index + 1)")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(WVColor.tint)
                            .frame(width: 22, height: 22)
                            .background(WVColor.brandSoft)
                            .clipShape(Circle())
                        Text(question)
                            .font(.system(size: 16))
                            .foregroundStyle(WVColor.label)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            WVSectionFooter(L.t("Mang danh sách này tới trung tâm — trả lời được càng nhiều càng tốt."))
        }
    }

    @ViewBuilder
    private func reasoningSection(_ reasoning: String) -> some View {
        let trimmed = reasoning.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                WVSectionHeader(L.t("Vì sao"))
                WVCard(padding: 16) {
                    Text(trimmed)
                        .font(.system(size: 15))
                        .foregroundStyle(WVColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                }
                WVSectionFooter(L.t("AI đọc điều khoản bảo hành và thông tin lần sửa chữa bạn đã lưu."))
            }
        }
    }

    // MARK: - The Vietnamese letter

    /// `draftLetter` is Vietnamese for a Vietnamese reader. The block says that
    /// in words and never transforms the text — only copy/share.
    private func letterSection(_ letter: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Thư nháp gửi trung tâm"))
            WVCard(padding: 16) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        WVLeadingIcon(icon: "receipt", color: WVColor.blue, size: 30)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(L.t("Luôn bằng tiếng Việt"))
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(WVColor.label)
                            Text(L.t("Đọc được ở quầy bảo hành Việt Nam"))
                                .font(.system(size: 13))
                                .foregroundStyle(WVColor.label3)
                        }
                        Spacer(minLength: 0)
                    }

                    Text(ClaimAssessmentRules.letterLanguageNote)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label2)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(letter)
                        .font(.system(size: 14))
                        .foregroundStyle(WVColor.label)
                        .textSelection(.enabled)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(WVColor.fill3)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                    HStack(spacing: 10) {
                        WVButton(copiedLetter ? L.t("Đã sao chép") : L.t("Sao chép thư"),
                                 icon: copiedLetter ? "check" : nil,
                                 kind: copiedLetter ? .secondary : .primary) {
                            UIPasteboard.general.string = letter
                            copiedLetter = true
                        }
                        ShareLink(item: letter) {
                            HStack(spacing: 6) {
                                Image(systemName: "square.and.arrow.up")
                                Text(L.t("Chia sẻ"))
                            }
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(WVColor.tint)
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(WVColor.fill2)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                    }
                }
            }
        }
    }

    // MARK: - Gates

    /// Opt-in off. The switch is the *existing* one under Settings → AI
    /// assistant (the same flag receipt scanning uses). This card enables that
    /// same flag in place so the user does not lose the claim they were looking
    /// at, and it says what will be sent before offering the button — the flag
    /// is a privacy decision, not a UI permission.
    private var optInCard: some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    WVIcon("sparkles", size: 18)
                        .foregroundStyle(WVColor.indigo)
                    Text(L.t("Bật trợ lý AI để đánh giá"))
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text(L.t("Đánh giá bảo hành dùng chung một lần bật AI với tính năng quét hoá đơn. Khi bật, thông tin lần sửa chữa (mô tả lỗi, chẩn đoán, chi phí) và điều khoản bảo hành sẽ được gửi tới dịch vụ AI bên thứ ba để phân tích."))
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label2)
                    .fixedSize(horizontal: false, vertical: true)

                Text(L.t("Bạn có thể tắt lại bất cứ lúc nào trong Cài đặt → Trợ lý AI."))
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)

                if let optInError {
                    Text(optInError)
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.red)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if isEnabling {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    WVButton(L.t("Bật và đánh giá"), icon: "sparkles") {
                        Task { await enableAndRun() }
                    }
                }
            }
        }
        .padding(.top, 2)
    }

    /// 503 `feature_disabled`: the server has no model key. Nothing the user can
    /// fix, so it is calm copy — no red, no exclamation mark, no "error".
    private var featureDisabledCard: some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    WVIcon("info", size: 16)
                        .foregroundStyle(WVColor.label3)
                    Text(L.t("Tính năng đánh giá bằng AI chưa khả dụng"))
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(WVColor.label)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(L.t("Máy chủ chưa bật tính năng này. Đây không phải lỗi của bạn — bạn vẫn có thể xem điều khoản bảo hành và tiếp tục dùng app bình thường."))
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.label2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 2)
    }

    private func loadingCard(_ title: String) -> some View {
        WVCard(padding: 20) {
            HStack(spacing: 12) {
                ProgressView()
                Text(title)
                    .font(.system(size: 14))
                    .foregroundStyle(WVColor.label2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 2)
    }

    private func failureCard(_ message: String) -> some View {
        WVCard(padding: 16) {
            VStack(alignment: .leading, spacing: 10) {
                Text(L.t("Không đánh giá được lúc này."))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                Text(message)
                    .font(.system(size: 13))
                    .foregroundStyle(WVColor.red)
                    .fixedSize(horizontal: false, vertical: true)
                WVButton(L.t("Thử lại"), kind: .secondary) {
                    Task { await run() }
                }
            }
        }
        .padding(.top, 2)
    }

    // MARK: - Actions

    /// Reads the shared opt-in before spending a model call.
    ///
    /// A failed read leaves the gate `.ready`: the flag is unknown, and the
    /// server's 403 is the authority. Blocking here would make a network hiccup
    /// look like "AI is off".
    private func begin() async {
        guard !checkedOptIn else { return }
        do {
            let enabled = try await client.getAIOptIn()
            gate = ClaimAssessmentGate(aiOptIn: enabled)
        } catch {
            gate = .ready
        }
        checkedOptIn = true
        guard gate.isReady else { return }
        await run()
    }

    private func run() async {
        guard !isRunning else { return }
        isRunning = true
        errorMessage = nil
        assessment = nil
        copiedLetter = false
        defer { isRunning = false }

        do {
            assessment = try await client.assessClaim(claimId: claim.id)
        } catch {
            if let mapped = ClaimAssessmentGate.from(error: error) {
                gate = mapped
            } else {
                errorMessage = (error as? APIError)?.localizedDescription
                    ?? L.t("Không kết nối được máy chủ.")
            }
        }
    }

    /// Enables the SAME opt-in flag Settings shows, then immediately retries.
    /// It is not a second preference: one `PUT /api/v1/ai/opt-in`, one switch.
    private func enableAndRun() async {
        guard !isEnabling else { return }
        isEnabling = true
        optInError = nil
        defer { isEnabling = false }

        do {
            _ = try await client.setAIOptIn(true)
            gate = .ready
            await run()
        } catch let APIError.server(_, envelope) {
            optInError = envelope.message
                ?? envelope.fieldErrors?.values.first?.first
                ?? L.t("Không bật được trợ lý AI.")
        } catch {
            optInError = L.t("Không bật được trợ lý AI.")
        }
    }

    // MARK: - Tones

    /// Neutral by design: a green "high confidence" chip next to "likely
    /// covered" would read as approval. The confidence is information, not a
    /// status light.
    private func confidenceTone(_ confidence: ClaimAssessmentConfidence) -> WVChipTone {
        switch confidence {
        case .LOW:    return .gray
        case .MEDIUM: return .blue
        case .HIGH:   return .indigo
        }
    }
}

// MARK: - Shared claim-status tone

extension ClaimStatus {
    /// The chip tone for a repair status. Shared by the claim row and the
    /// assessment sheet so the same status cannot be two colours.
    var chipTone: WVChipTone {
        switch self {
        case .OPEN:      return .orange
        case .IN_REPAIR: return .blue
        case .RESOLVED:  return .green
        case .REJECTED:  return .red
        case .CANCELLED: return .gray
        }
    }
}
