import SwiftUI
import WarrlyKit

// ============================================================
// InstallmentSection — the device-detail "Trả góp" block and its edit sheet.
//
// FEATURE_RESEARCH_2026-11 §6.5, migration 0031.
//
// ## What it shows
//
//   * progress: how many of the plan's payments the user says are done;
//   * the money still owed (`remainingAmount`) and the plan's total cost;
//   * the next due day (`nextDueAt`, computed by the server with its month-clamp
//     rule — never re-derived here);
//   * an explicit note when the figures are a LOWER BOUND because a fee was not
//     recorded (`hasUnknownFees`).
//
// ## What it deliberately never says
//
// `paidCount` is self-reported — the app cannot see a bank transaction — so the
// card never calls a payment late and wave 1 schedules no reminder. It states
// the next due DAY and lets the reader judge. A "quá hạn" would be the most
// trust-destroying error a money feature can make (the §6.5 brief is explicit
// about this).
//
// ## Why the editor is a sheet, not part of the device form
//
// `PATCH /api/v1/devices/{id}` replaces the whole device and does not carry the
// plan; the plan has its own `PUT`/`DELETE /devices/{id}/installment`. Keeping
// the editor separate means a device save can never erase the plan (the exact
// reason the field is not in `DeviceInput`), and a plan validation error cannot
// block a device edit.
//
// Money is in the DEVICE's currency, so every amount is formatted with
// `WVFormat.currency(_, code)`, never as ₫ unless the device is VND.
// ============================================================

struct InstallmentSection: View {
    let client: APIClient
    /// The list projection (`Device`), which carries `installment` and
    /// `ownershipCostVnd` on every read. Re-read after a save by the parent.
    let device: Device
    /// Called after a successful save/delete so the parent refreshes its
    /// projection — the card, the resale profit/loss and the stats totals all
    /// derive from those server values.
    let onChanged: () -> Void

    @State private var showSheet = false

    private var plan: InstallmentPlan? { device.installment }
    private var currency: String { device.currencyCode }

    private func money(_ amount: Int) -> String {
        WVFormat.currency(amount, currency)
    }

    var body: some View {
        Group {
            WVSectionHeader(L.t("Trả góp"))
            WVGroup {
                if let plan {
                    progressRow(plan)
                    WVDivider()
                    DeviceFactRow(icon: "wallet",
                                  title: L.t("Còn nợ"),
                                  subtitle: plan.hasUnknownFees
                                      ? L.t("Chưa ghi phí, nên đây là mức tối thiểu")
                                      : nil,
                                  detail: plan.completed
                                      ? L.t("Đã trả xong")
                                      : money(plan.remainingAmount))
                    WVDivider()
                    DeviceFactRow(icon: "calendar",
                                  title: L.t("Kỳ tới"),
                                  subtitle: L.t("Kỳ đầu %@", dayLabel(plan.firstDueAt) ?? "—"),
                                  detail: plan.completed
                                      ? L.t("Đã trả xong")
                                      : (dayLabel(plan.nextDueAt) ?? "—"))
                    WVDivider()
                    DeviceFactRow(icon: "tag",
                                  title: L.t("Tổng chi phí sở hữu"),
                                  subtitle: plan.lender,
                                  detail: money(plan.totalCost))
                    WVDivider()
                    WVRow(icon: "pencil",
                          title: L.t("Sửa kế hoạch trả góp"),
                          chevron: true,
                          action: { showSheet = true })
                } else {
                    DeviceFactRow(icon: "wallet",
                                  title: L.t("Chưa ghi trả góp"),
                                  subtitle: L.t("Ghi kế hoạch để chi phí sở hữu và lãi/lỗ khi bán lại tính đúng số tiền bạn thật sự trả."),
                                  detail: nil)
                    WVDivider()
                    WVRow(icon: "plus",
                          title: L.t("Ghi kế hoạch trả góp"),
                          chevron: true,
                          action: { showSheet = true })
                }
            }
            if let plan, plan.hasUnknownFees {
                WVSectionFooter(L.t("Chưa ghi phí hồ sơ / phí hàng tháng, nên tổng chi phí là mức tối thiểu."))
            }
        }
        .sheet(isPresented: $showSheet) {
            InstallmentSheet(client: client,
                             device: device,
                             plan: plan,
                             onSaved: { onChanged() })
        }
    }

    /// "Đã trả 3/12 kỳ" + the bar. Counts PAYMENTS, not money — that is what the
    /// user declares.
    @ViewBuilder
    private func progressRow(_ plan: InstallmentPlan) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(L.t("Đã trả %d/%d kỳ", plan.paidCount, plan.months))
                    .wvFont(.body)
                    .foregroundStyle(WVColor.label)
                Spacer(minLength: 8)
                Text("\(percent(plan))%")
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .monospacedDigit()
            }
            WVProgressBar(value: Double(percent(plan)) / 100.0,
                          tone: plan.completed ? WVColor.green : WVColor.blue)
            Text(L.t("%@/kỳ", money(plan.monthlyAmount)))
                .wvFont(.footnote)
                .foregroundStyle(WVColor.label3)
        }
        .padding(.horizontal, WVSpacing.gutter)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }

    private func percent(_ plan: InstallmentPlan) -> Int {
        guard plan.months > 0 else { return 0 }
        let raw = Int((Double(plan.paidCount) / Double(plan.months) * 100).rounded())
        return min(100, max(0, raw))
    }

    /// A calendar day from the wire, formatted through the shared day rules.
    /// `nextDueAt`/`firstDueAt` are days, not instants — a `Date` round trip
    /// could show the previous day in a negative-offset zone.
    private func dayLabel(_ wire: String?) -> String? {
        guard let wire, let day = DeviceReturnWindow.dayPrefix(wire) else { return nil }
        return DeviceReturnWindow.deadlineLabel(day)
    }
}

// MARK: - The editor

/// `PUT`/`DELETE /api/v1/devices/{id}/installment`.
///
/// The form mirrors the contract's rules in the field layout only — months
/// 1…60, `monthlyAmount > 0`, `paidCount` 0…months — the server is the authority
/// and its `fieldErrors` are rendered under the field they belong to, in the
/// request's language.
///
/// Blank fee = **not recorded** (`nil` on the wire), which makes the total a
/// lower bound; blank is deliberately not `0`.
struct InstallmentSheet: View {
    let client: APIClient
    let device: Device
    let plan: InstallmentPlan?
    let onSaved: () -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var downPayment: Int?
    @State private var months: Int
    @State private var monthlyAmount: Int?
    @State private var firstDueAt: Date
    @State private var fileFee: Int?
    @State private var monthlyFee: Int?
    @State private var paidCount: Int
    @State private var lender: String
    @State private var isSaving = false
    @State private var deleting = false
    @State private var topError: String?
    @State private var fieldErrors: [String: [String]] = [:]

    private var currency: String { device.currencyCode }
    private var groupingSeparator: String {
        currency == "VND" ? "." : ","
    }

    init(client: APIClient,
         device: Device,
         plan: InstallmentPlan?,
         onSaved: @escaping () -> Void) {
        self.client = client
        self.device = device
        self.plan = plan
        self.onSaved = onSaved
        _downPayment = State(initialValue: plan?.downPayment)
        _months = State(initialValue: plan.map { max(1, $0.months) } ?? 12)
        _monthlyAmount = State(initialValue: plan?.monthlyAmount)
        // The stored day is a calendar day; parse it in the DEVICE's locale day,
        // never as an instant (a Z-less value would shift west of UTC).
        _firstDueAt = State(
            initialValue: DeviceResale.dayDate(plan?.firstDueAt) ?? Date()
        )
        _fileFee = State(initialValue: plan?.fileFee)
        _monthlyFee = State(initialValue: plan?.monthlyFee)
        _paidCount = State(initialValue: plan?.paidCount ?? 0)
        _lender = State(initialValue: plan?.lender ?? "")
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Spacer().frame(height: 8)

                    Text(L.t("Kế hoạch bạn tự ghi: trả trước, số kỳ và số tiền mỗi kỳ. App không biết ngân hàng đã trừ hay chưa."))
                        .wvFont(.footnote)
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.bottom, WVSpacing.sm)

                    WVGroup {
                        moneyRow(L.t("Trả trước"), value: $downPayment)
                        WVDivider()
                        intRow(L.t("Số kỳ (tháng)"), value: $months, range: 1...60, field: "months")
                        WVDivider()
                        moneyRow(L.t("Mỗi kỳ trả"), value: $monthlyAmount, field: "monthlyAmount")
                        WVDivider()
                        dateRow
                        WVDivider()
                        moneyRow(L.t("Phí hồ sơ"), value: $fileFee, field: "fileFee")
                        WVDivider()
                        moneyRow(L.t("Phí mỗi kỳ"), value: $monthlyFee, field: "monthlyFee")
                        WVDivider()
                        intRow(L.t("Đã trả (số kỳ)"), value: $paidCount, range: 0...60, field: "paidCount")
                        WVDivider()
                        HStack {
                            Text(L.t("Nơi trả góp"))
                                .wvFont(.body)
                                .foregroundStyle(WVColor.label)
                            TextField(L.t("Ví dụ: Home Credit"), text: $lender)
                                .multilineTextAlignment(.trailing)
                                .wvFont(.body)
                                .disabled(isSaving)
                        }
                        .padding(.horizontal, WVSpacing.gutter)
                        .frame(minHeight: 44)
                    }

                    fieldError("months")
                    fieldError("monthlyAmount")
                    fieldError("firstDueAt")
                    fieldError("fileFee")
                    fieldError("monthlyFee")
                    fieldError("paidCount")
                    fieldError("downPayment")
                    fieldError("lender")

                    WVSectionFooter(L.t("Để trống một khoản phí nghĩa là “chưa biết”, không phải 0 — khi đó tổng chi phí chỉ là mức tối thiểu."))
                    WVSectionFooter(L.t("Số tiền tính theo đơn vị tiền của thiết bị (%@).", currency))

                    if let topError {
                        Text(topError)
                            .wvFont(.footnote)
                            .foregroundStyle(WVColor.red)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, WVSpacing.gutter)
                            .padding(.top, 8)
                    }

                    if plan != nil {
                        Button(role: .destructive) {
                            Task { await deletePlan() }
                        } label: {
                            HStack {
                                if deleting {
                                    ProgressView()
                                } else {
                                    Text(L.t("Xoá kế hoạch trả góp"))
                                        .wvFont(.body)
                                }
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .disabled(isSaving || deleting)
                        .padding(.horizontal, WVSpacing.gutter)
                        .padding(.top, WVSpacing.lg)
                    }

                    Spacer().frame(height: 24)
                }
            }
            .wvScreen()
            .navigationTitle(L.t("Trả góp"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(L.t("Huỷ")) { dismiss() }
                        .foregroundStyle(WVColor.tint)
                        .disabled(isSaving || deleting)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button(L.t("Lưu")) { Task { await save() } }
                            .wvFont(.bodyEmphasis)
                            .foregroundStyle(WVColor.tint)
                            .disabled(deleting)
                    }
                }
            }
        }
        .presentationDetents([.large])
    }

    // MARK: - Rows

    private func moneyRow(_ title: String, value: Binding<Int?>,
                          field: String? = nil) -> some View {
        HStack {
            Text(title)
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
            Spacer(minLength: 8)
            WVMoneyField(value: value,
                         placeholder: L.t("Chưa biết"),
                         groupingSeparator: groupingSeparator)
                .disabled(isSaving)
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .onChange(of: value.wrappedValue) { _, _ in
            if let field { fieldErrors[field] = nil }
        }
    }

    private func intRow(_ title: String, value: Binding<Int>,
                        range: ClosedRange<Int>, field: String) -> some View {
        HStack {
            Text(title)
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
            Spacer(minLength: 8)
            TextField("0", value: value, format: .number)
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .wvFont(.body)
                .disabled(isSaving)
                .onChange(of: value.wrappedValue) { _, next in
                    // Clamp to the contract's range so the stepper-free field
                    // cannot produce a value the server would reject for a
                    // reason the user cannot fix in this row.
                    if next < range.lowerBound { value.wrappedValue = range.lowerBound }
                    if next > range.upperBound { value.wrappedValue = range.upperBound }
                    fieldErrors[field] = nil
                }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
    }

    private var dateRow: some View {
        HStack {
            Text(L.t("Ngày kỳ đầu"))
                .wvFont(.body)
                .foregroundStyle(WVColor.label)
            Spacer(minLength: 8)
            DatePicker("", selection: $firstDueAt, displayedComponents: .date)
                .labelsHidden()
                .disabled(isSaving)
                .onChange(of: firstDueAt) { _, _ in fieldErrors["firstDueAt"] = nil }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
    }

    @ViewBuilder
    private func fieldError(_ key: String) -> some View {
        if let message = fieldErrors[key]?.first {
            Text(message)
                .wvFont(.caption)
                .foregroundStyle(WVColor.red)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, WVSpacing.gutter)
                .padding(.top, 6)
        }
    }

    // MARK: - Writes

    private func save() async {
        guard !isSaving, !deleting else { return }
        topError = nil
        fieldErrors = [:]
        isSaving = true
        defer { isSaving = false }

        let input = InstallmentInput(
            downPayment: downPayment ?? 0,
            months: months,
            monthlyAmount: monthlyAmount ?? 0,
            // A calendar day in the user's own timezone: the picker shows Local
            // days, and the server stores the day it is given.
            firstDueAt: DeviceResale.dayString(firstDueAt),
            fileFee: fileFee,
            monthlyFee: monthlyFee,
            paidCount: paidCount,
            lender: lender.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : lender.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        do {
            _ = try await client.saveInstallment(deviceId: device.id, input)
            onSaved()
            dismiss()
        } catch let err as APIError {
            fieldErrors = err.fieldErrors
            if err.fieldErrors.isEmpty {
                topError = err.localizedDescription
            }
        } catch {
            topError = L.t("Không kết nối được máy chủ.")
        }
    }

    private func deletePlan() async {
        guard !deleting, !isSaving else { return }
        topError = nil
        deleting = true
        defer { deleting = false }
        do {
            _ = try await client.deleteInstallment(deviceId: device.id)
            onSaved()
            dismiss()
        } catch let err as APIError {
            topError = err.localizedDescription
        } catch {
            topError = L.t("Không kết nối được máy chủ.")
        }
    }
}
