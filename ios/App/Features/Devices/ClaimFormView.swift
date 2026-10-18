import SwiftUI
import WarrlyKit

// ============================================================
// ClaimFormView — add / edit a repair claim ("Sửa chữa & bảo hành")
//
// Presented as a sheet from `ClaimsSection` on the device detail. The device is
// fixed: a claim belongs to the device whose screen opened this form, so the row
// is read-only and the payload always carries that `deviceId`.
//
// ## The three contract details this form must not get wrong
//
//   * `issue` is required and `cost` is non-negative — checked locally with
//     `ClaimRules.validationErrors` before any round trip.
//   * `coveredByWarranty` is TRI-STATE. "Chưa rõ" stays `nil` on the wire and
//     must never become `false`; `false` means "I paid", which is a real answer.
//   * `closedAt` is server-owned and is never sent. `ClaimInput` does not even
//     have the key.
//
// The 409 (`limit_reached`) is handled twice: proactively, when the store
// already knows about an open claim (an inline card with a way to it), and
// reactively from the server's own answer. Both paths lead to the same place —
// the open claim — because retrying the same create can never succeed.
// ============================================================

struct ClaimFormView: View {
    @ObservedObject var store: WarrantiesStore
    let device: Device
    let claim: Claim?
    /// Called when the user asks to go to the claim that is already open. The
    /// presenter dismisses this sheet and re-presents that claim in edit mode.
    let onOpenExisting: ((Claim) -> Void)?

    @Environment(\.dismiss) private var dismiss

    // Fields
    @State private var status: ClaimStatus
    @State private var openedAt: Date
    @State private var hasExpectedReturn: Bool
    @State private var expectedReturnAt: Date
    @State private var warrantyId: String?
    @State private var ticketNumber: String
    @State private var serviceCenter: String
    @State private var issue: String
    @State private var diagnosis: String
    @State private var outcome: String
    @State private var cost: Int?
    @State private var covered: CoveredChoice

    // UI state
    @State private var isSaving = false
    @State private var isDeleting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]
    @State private var saveFailure: ClaimSaveFailure?
    @State private var conflictClaim: Claim?
    @State private var showSaveFailure = false
    @State private var showDiscardAlert = false
    @State private var showDeleteAlert = false

    private var isEditing: Bool { claim != nil }

    init(store: WarrantiesStore, device: Device, claim: Claim?,
         onOpenExisting: ((Claim) -> Void)? = nil) {
        self.store = store
        self.device = device
        self.claim = claim
        self.onOpenExisting = onOpenExisting

        _status = State(initialValue: claim?.status ?? .OPEN)
        _openedAt = State(initialValue: ClaimRules.dayDate(claim?.openedAt) ?? Date())
        _hasExpectedReturn = State(initialValue: claim?.expectedReturnAt != nil)
        _expectedReturnAt = State(initialValue: ClaimRules.dayDate(claim?.expectedReturnAt)
            ?? Date().addingTimeInterval(7 * 24 * 60 * 60))
        _warrantyId = State(initialValue: claim?.warrantyId)
        _ticketNumber = State(initialValue: claim?.ticketNumber ?? "")
        _serviceCenter = State(initialValue: claim?.serviceCenter ?? "")
        _issue = State(initialValue: claim?.issue ?? "")
        _diagnosis = State(initialValue: claim?.diagnosis ?? "")
        _outcome = State(initialValue: claim?.outcome ?? "")
        _cost = State(initialValue: claim?.cost)
        _covered = State(initialValue: CoveredChoice(claim?.coveredByWarranty))
    }

    // MARK: - Validation

    private var validationErrors: [String: [String]] {
        ClaimRules.validationErrors(issue: issue, cost: cost)
    }

    private var isValid: Bool { validationErrors.isEmpty }

    /// The claim that would make this save a 409, when the store already knows
    /// about it. Editing that same claim is not a conflict with itself.
    ///
    /// Shown as an inline card rather than disabling Save: the store can be
    /// stale (the open claim may have been closed on another device), and
    /// blocking the button would prevent a legitimate save. The server stays the
    /// authority and its 409 is mapped below.
    private var blockingOpenClaim: Claim? {
        guard ClaimRules.isOpen(status) else { return nil }
        guard let open = store.openClaim else { return nil }
        if let claim, open.id == claim.id { return nil }
        return open
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 8)

                    deviceSection

                    if let blocking = blockingOpenClaim {
                        openClaimCard(blocking)
                            .padding(.top, 8)
                    }

                    statusSection
                    datesSection
                    warrantySection
                    detailsSection
                    costSection

                    if let topError {
                        Text(topError)
                            .font(.system(size: 13))
                            .foregroundStyle(WVColor.red)
                            .padding(.horizontal, 32)
                            .padding(.top, 10)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    saveButton

                    if isEditing {
                        deleteRow
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(isEditing ? L.t("Sửa lần sửa chữa") : L.t("Thêm lần sửa chữa"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { showDiscardAlert = true }
                        .foregroundStyle(WVColor.tint)
                        .disabled(isSaving || isDeleting)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(L.t("Lưu")) { Task { await submit() } }
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(isValid ? WVColor.tint : WVColor.label3)
                            .disabled(!isValid || isDeleting)
                    }
                }
            }
            .alert(L.t("Bỏ thay đổi?"), isPresented: $showDiscardAlert) {
                Button(L.t("Tiếp tục sửa"), role: .cancel) {}
                Button(L.t("Bỏ"), role: .destructive) { dismiss() }
            } message: {
                Text(L.t("Tất cả thông tin đã nhập sẽ mất."))
            }
            .alert(saveFailure?.title ?? "",
                   isPresented: $showSaveFailure,
                   presenting: saveFailure) { failure in
                if failure.isOpenClaimExists, let existing = conflictClaim {
                    Button(ClaimRules.openClaimActionTitle) { open(existing) }
                }
                Button(L.t("Đóng"), role: .cancel) {}
            } message: { failure in
                Text(failure.message)
            }
            .alert(L.t("Xoá lần sửa chữa?"), isPresented: $showDeleteAlert) {
                Button(L.t("Huỷ"), role: .cancel) {}
                Button(L.t("Xoá"), role: .destructive) { Task { await deleteClaim() } }
            } message: {
                Text(L.t("Lần sửa chữa này sẽ bị xoá vĩnh viễn. Không thể hoàn tác."))
            }
            .interactiveDismissDisabled(isSaving || isDeleting)
        }
    }

    // MARK: - Sections

    /// The device is prefilled and read-only: a claim cannot be moved between
    /// devices, and the API takes the id from this row.
    private var deviceSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Thiết bị"))
            WVGroup {
                WVRow(icon: WVCategory.icon(for: device.category),
                      iconColor: WVCategory.accent(for: device.category),
                      title: device.name,
                      subtitle: L.t("Lần sửa chữa thuộc thiết bị này"))
            }
            WVSectionFooter(L.t("Không đổi được thiết bị của một lần sửa chữa."))
        }
    }

    private var statusSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Trạng thái"))
            WVGroup {
                ForEach(Array(ClaimStatus.allCases.enumerated()), id: \.element) { index, candidate in
                    if index > 0 { WVDivider(inset: 16) }
                    Button {
                        status = candidate
                    } label: {
                        HStack(spacing: 12) {
                            WVChip(candidate.label, tone: tone(for: candidate))
                            Spacer(minLength: 8)
                            if status == candidate {
                                WVIcon("check", size: 15, weight: .bold)
                                    .foregroundStyle(WVColor.tint)
                            }
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .padding(.vertical, 7)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(WVRowButtonStyle())
                }
            }
            WVSectionFooter(L.t("Đóng lần sửa chữa bằng cách chọn Đã xử lý, Bị từ chối hoặc Đã huỷ; máy chủ tự ghi ngày đóng."))
        }
    }

    private var datesSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Thời gian"))
            WVGroup {
                WVRowContainer {
                    DatePicker(L.t("Ngày mở"), selection: $openedAt,
                               displayedComponents: .date)
                        .font(.system(size: 17))
                        .disabled(isSaving)
                }

                WVDivider()

                WVRowContainer {
                    Toggle(L.t("Có ngày dự kiến trả"), isOn: $hasExpectedReturn)
                        .font(.system(size: 17))
                        .disabled(isSaving)
                }

                if hasExpectedReturn {
                    WVDivider()
                    WVRowContainer {
                        DatePicker(L.t("Ngày dự kiến trả"), selection: $expectedReturnAt,
                                   displayedComponents: .date)
                            .font(.system(size: 17))
                            .disabled(isSaving)
                    }
                }

                // `closedAt` is server-owned: it is shown when it exists and
                // there is deliberately no control for it.
                if let closed = ClaimRules.dayLabel(claim?.closedAt) {
                    WVDivider()
                    WVRow(icon: "checkCircle", iconColor: WVColor.gray,
                          title: L.t("Ngày đóng"), detail: closed)
                }
            }
            WVSectionFooter(L.t("Ngày đóng do máy chủ đặt khi lần sửa chữa kết thúc; biểu mẫu không gửi ngày này."))
        }
    }

    private var warrantySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Gói bảo hành"))
            WVGroup {
                Menu {
                    Button(L.t("Không gắn gói nào")) { warrantyId = nil }
                    ForEach(store.warranties) { warranty in
                        Button(warrantyLabel(warranty)) { warrantyId = warranty.id }
                    }
                } label: {
                    HStack(spacing: 12) {
                        Text(L.t("Gói bảo hành"))
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label)
                        Spacer(minLength: 8)
                        Text(selectedWarrantyLabel)
                            .font(.system(size: 17))
                            .foregroundStyle(WVColor.label3)
                            .lineLimit(1)
                        WVIcon("arrowRight", size: 13, weight: .semibold)
                            .foregroundStyle(WVColor.label4)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .disabled(isSaving)
            }
            WVSectionFooter(store.warranties.isEmpty
                ? L.t("Thiết bị chưa có gói bảo hành nào.")
                : L.t("Chỉ các gói bảo hành của thiết bị này được chọn. Để trống nếu sửa ngoài bảo hành."))
            if let message = fieldErrors["warrantyId"]?.first {
                WVSectionFooter(message)
                    .foregroundStyle(WVColor.red)
            }
        }
    }

    private var detailsSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Chi tiết"))
            WVGroup {
                fieldRow(L.t("Số phiếu")) {
                    // Rune caps mirror the server's `maxLength`; over-long text
                    // would be a 400 after a round trip otherwise.
                    TextField(L.t("Ví dụ: BH-2026-0312"),
                              text: capped($ticketNumber, ClaimRules.maxTicketNumberRunes))
                        .multilineTextAlignment(.trailing)
                        .autocorrectionDisabled()
                        .disabled(isSaving)
                }
                if let message = fieldErrors["ticketNumber"]?.first {
                    WVDivider()
                    fieldErrorText(message)
                }

                WVDivider()

                fieldRow(L.t("Nơi sửa")) {
                    TextField(L.t("Ví dụ: FPT Shop Quận 1"),
                              text: capped($serviceCenter, ClaimRules.maxServiceCenterRunes))
                        .multilineTextAlignment(.trailing)
                        .autocorrectionDisabled()
                        .disabled(isSaving)
                }
                if let message = fieldErrors["serviceCenter"]?.first {
                    WVDivider()
                    fieldErrorText(message)
                }

                WVDivider()

                multilineRow(L.t("Mô tả lỗi"),
                             placeholder: L.t("Mô tả ngắn lỗi bạn mang máy đi sửa"),
                             text: $issue,
                             limit: ClaimRules.maxIssueRunes)
                if let message = fieldErrors["issue"]?.first {
                    WVDivider()
                    fieldErrorText(message)
                }

                WVDivider()

                multilineRow(L.t("Chẩn đoán"),
                             placeholder: L.t("Trung tâm nói gì"),
                             text: $diagnosis,
                             limit: ClaimRules.maxDiagnosisRunes)
                if let message = fieldErrors["diagnosis"]?.first {
                    WVDivider()
                    fieldErrorText(message)
                }

                WVDivider()

                multilineRow(L.t("Kết quả"),
                             placeholder: L.t("Sửa xong, đổi máy, hoàn tiền…"),
                             text: $outcome,
                             limit: ClaimRules.maxOutcomeRunes)
                if let message = fieldErrors["outcome"]?.first {
                    WVDivider()
                    fieldErrorText(message)
                }
            }
            WVSectionFooter(L.t("Mô tả lỗi là bắt buộc; các mục còn lại có thể để trống. Kết quả do trung tâm trả lời."))
        }
    }

    private var costSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVSectionHeader(L.t("Chi phí"))
            WVGroup {
                fieldRow(L.t("Chi phí")) {
                    WVMoneyField(value: $cost, placeholder: L.t("Tuỳ chọn"))
                        .frame(width: 160)
                        .disabled(isSaving)
                }
                if let message = fieldErrors["cost"]?.first {
                    WVDivider()
                    fieldErrorText(message)
                }

                WVDivider()

                VStack(alignment: .leading, spacing: 8) {
                    Text(L.t("Bảo hành chi trả"))
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                    WVSegmented(
                        options: CoveredChoice.allCases.map { (value: $0, label: $0.label) },
                        selection: $covered
                    )
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 44)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .disabled(isSaving)
            }
            WVSectionFooter(L.t("Chọn Có hoặc Không khi trung tâm đã trả lời; để Chưa rõ nếu chưa biết."))
        }
    }

    private var saveButton: some View {
        VStack(spacing: 0) {
            WVButton(isEditing ? L.t("Lưu thay đổi") : L.t("Thêm lần sửa chữa"),
                     icon: isEditing ? "save" : "plus",
                     kind: isValid ? .primary : .secondary) {
                Task { await submit() }
            }
            .disabled(!isValid || isSaving || isDeleting)
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.vertical, 20)
        }
    }

    private var deleteRow: some View {
        VStack(spacing: 0) {
            WVGroup {
                WVRow(icon: "trash", iconColor: WVColor.red,
                      title: L.t("Xoá lần sửa chữa"),
                      role: .destructive) {
                    showDeleteAlert = true
                }
                .disabled(isDeleting || isSaving)
            }
            if isDeleting {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.top, 8)
            }
        }
    }

    // MARK: - 409 card (proactive)

    private func openClaimCard(_ existing: Claim) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                WVIcon("alert", size: 14)
                    .foregroundStyle(WVColor.orange)
                    .padding(.top, 1)
                Text(ClaimRules.openClaimTitle)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WVColor.label)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text(ClaimRules.openClaimExistsMessage)
                .font(.system(size: 12))
                .foregroundStyle(WVColor.label2)
                .fixedSize(horizontal: false, vertical: true)
            if let opened = ClaimRules.dayLabel(existing.openedAt) {
                Text(L.t("Mở %@", opened))
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
            }
            Button {
                open(existing)
            } label: {
                Text(ClaimRules.openClaimActionTitle)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(WVColor.tint)
            }
            .disabled(isSaving)
            .padding(.top, 2)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.orange.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
    }

    // MARK: - Row helpers

    private func fieldRow<Content: View>(_ label: String,
                                         @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 17))
                .foregroundStyle(WVColor.label)
            Spacer(minLength: 8)
            content()
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 7)
    }

    private func multilineRow(_ label: String, placeholder: String,
                              text: Binding<String>, limit: Int) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.system(size: 13))
                .foregroundStyle(WVColor.label3)
            TextField(placeholder, text: capped(text, limit), axis: .vertical)
                .font(.system(size: 17))
                .foregroundStyle(WVColor.label)
                .lineLimit(2...6)
                .disabled(isSaving)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// A binding that refuses input past `limit` **runes**.
    ///
    /// Counted in Unicode scalars, which is what Go's `[]rune` counts — the same
    /// rule `WarrantyFormView` uses for its contract terms. A grapheme-cluster
    /// count would let a decomposed string through that the server then refuses.
    private func capped(_ binding: Binding<String>, _ limit: Int) -> Binding<String> {
        Binding(
            get: { binding.wrappedValue },
            set: { newValue in
                guard newValue.unicodeScalars.count > limit else {
                    binding.wrappedValue = newValue
                    return
                }
                var truncated = String.UnicodeScalarView()
                truncated.append(contentsOf: newValue.unicodeScalars.prefix(limit))
                binding.wrappedValue = String(truncated)
            }
        )
    }

    private func fieldErrorText(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 12))
            .foregroundStyle(WVColor.red)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Warranty picker copy

    private var selectedWarrantyLabel: String {
        guard let selected = store.warranties.first(where: { $0.id == warrantyId }) else {
            return L.t("Không gắn gói nào")
        }
        return warrantyLabel(selected)
    }

    private func warrantyLabel(_ warranty: Warranty) -> String {
        [warranty.provider ?? warranty.type.label,
         L.p("%d tháng", warranty.months),
         L.t("Hết %@", WVFormat.date(warranty.endDate))]
            .joined(separator: " · ")
    }

    private func tone(for status: ClaimStatus) -> WVChipTone {
        switch status {
        case .OPEN:      return .orange
        case .IN_REPAIR: return .blue
        case .RESOLVED:  return .green
        case .REJECTED:  return .red
        case .CANCELLED: return .gray
        }
    }

    // MARK: - Actions

    /// Leaves this form for the claim that is already open. The presenter owns
    /// the re-presentation: this sheet must dismiss first, so the callback only
    /// records the target.
    private func open(_ existing: Claim) {
        onOpenExisting?(existing)
        dismiss()
    }

    private func submit() async {
        fieldErrors = ClaimRules.validationErrors(issue: issue, cost: cost)
        guard fieldErrors.isEmpty else { return }
        topError = nil
        saveFailure = nil
        conflictClaim = nil
        isSaving = true
        defer { isSaving = false }

        var input = ClaimInput(
            deviceId: device.id,
            issue: issue.trimmingCharacters(in: .whitespacesAndNewlines),
            openedAt: ClaimRules.dayString(openedAt),
            status: status,
            warrantyId: warrantyId
        )
        input.expectedReturnAt = hasExpectedReturn
            ? ClaimRules.dayString(expectedReturnAt)
            : nil
        input.ticketNumber = filled(ticketNumber)
        input.serviceCenter = filled(serviceCenter)
        input.diagnosis = filled(diagnosis)
        input.outcome = filled(outcome)
        input.cost = cost
        input.coveredByWarranty = covered.value

        do {
            if let claim {
                try await store.updateClaim(id: claim.id, input)
            } else {
                try await store.createClaim(input)
            }
            dismiss()
        } catch {
            await handleSaveError(error)
        }
    }

    private func handleSaveError(_ error: Error) async {
        let failure = ClaimRules.saveFailure(error)

        if failure.isOpenClaimExists {
            // The authoritative read may know about the other claim even when
            // this form's store was stale. Reload before offering "go to it".
            await store.load()
            if let existing = store.openClaim {
                saveFailure = failure
                conflictClaim = existing
                showSaveFailure = true
            } else {
                // No open claim could be found: the same wire code also covers
                // the account-wide claim ceiling, and the server's own message
                // is the only accurate one in that case. Never claim "a repair
                // is open" when there is no repair to point at.
                topError = (error as? APIError)?.localizedDescription ?? failure.message
            }
            return
        }

        if failure.isClaimNotFound {
            topError = failure.message
            return
        }

        let serverFieldErrors = (error as? APIError)?.fieldErrors ?? [:]
        fieldErrors = serverFieldErrors
        // A field error is already rendered next to its field; the top banner
        // would just repeat it. Anything without a field keeps the sentence.
        topError = serverFieldErrors.isEmpty ? failure.message : nil
    }

    private func deleteClaim() async {
        guard let claim else { return }
        isDeleting = true
        defer { isDeleting = false }
        do {
            try await store.deleteClaim(id: claim.id)
            dismiss()
        } catch {
            topError = ClaimRules.saveFailure(error).message
        }
    }

    private func filled(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

// MARK: - Covered tri-state

/// The value of the nullable `coveredByWarranty` wire field.
///
/// A `Toggle` has two states, so it could not tell "the service center has not
/// answered" (`nil`) apart from "the warranty did not pay" (`false`). `false` is
/// the answer the user needs to see on the row ("I paid"), so it cannot be
/// invented from an empty control. `.unknown` leaves the key as an explicit
/// JSON null — see `ClaimInput`'s hand-written encoder.
private enum CoveredChoice: String, CaseIterable, Hashable {
    case unknown
    case yes
    case no

    var label: String {
        switch self {
        case .unknown: return L.t("Chưa rõ")
        case .yes:     return L.t("Có")
        case .no:      return L.t("Không")
        }
    }

    var value: Bool? {
        switch self {
        case .unknown: return nil
        case .yes:     return true
        case .no:      return false
        }
    }

    init(_ value: Bool?) {
        switch value {
        case .none:        self = .unknown
        case .some(true):  self = .yes
        case .some(false): self = .no
        }
    }
}
