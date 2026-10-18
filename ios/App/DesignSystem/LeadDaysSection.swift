import SwiftUI
import WarrlyKit

// MARK: - Reminder lead-time editor
//
// Shared by `DeviceFormView` and `SubscriptionFormView` so the two forms cannot
// drift: preset chips (60/30/14/7/1/0), a custom-day field, and the chosen days
// as removable chips sorted descending.
//
// The rules are NOT in this file — `LeadDaysRules` in WarrlyKit clamps to
// 0...365, dedupes, sorts descending and caps at five, and `wireValue` is the
// 1...5 gate the form checks before sending. That is what makes the logic
// testable without a simulator (`LeadDaysRulesTests`).
//
// `days` is a plain `[Int]` binding rather than an optional: a create form
// starts at the server's `[30, 7]` default, and an edit form starts from the
// loaded device/subscription. "Nothing selected" is represented as `[]` on
// purpose — the user has to see that state (and the red requirement line), not
// get a schedule silently invented for them.
struct LeadDaysSection: View {

    @Binding var days: [Int]

    /// The server's own `fieldErrors.leadDays` message, shown verbatim. The
    /// forms also disable Save while the local list is empty, so this is the
    /// defensive path for anything the server rejects beyond that.
    var error: String?

    @State private var customText = ""

    private var isFull: Bool { days.count >= LeadDaysRules.maximumCount }

    var body: some View {
        VStack(spacing: 0) {
            WVSectionHeader(L.t("Nhắc trước"))
            WVSectionFooter(L.t("Chọn 1–5 mốc nhắc, mỗi mốc từ 0 đến 365 ngày. Mốc 0 là nhắc đúng ngày hết hạn."))

            WVGroup {
                selectedRow
                WVDivider()
                presetRow
                WVDivider()
                customRow
            }

            if let error {
                Text(error)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 32)
                    .padding(.top, 6)
            }
        }
        // Every mutation already goes through `LeadDaysRules`; this also
        // normalises values pushed in from outside (a decoded payload, a
        // restored form state) without a second code path in each form.
        .onChange(of: days) { _, newValue in
            let normalized = LeadDaysRules.normalize(newValue)
            if normalized != newValue { days = normalized }
        }
    }

    // MARK: - Selected days

    private var selectedRow: some View {
        WVRowContainer {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(L.t("Đã chọn"))
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(WVColor.label)
                    Spacer(minLength: 8)
                    Text("\(days.count)/\(LeadDaysRules.maximumCount)")
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.label3)
                }

                if days.isEmpty {
                    // Required, not optional: an empty array is a 400 on the
                    // server, so the form says so before the user taps Save.
                    Text(L.t("Chọn ít nhất 1 mốc nhắc"))
                        .font(.system(size: 13))
                        .foregroundStyle(WVColor.red)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: WVSpacing.sm) {
                            ForEach(days, id: \.self) { day in
                                Button {
                                    days = LeadDaysRules.toggling(days, day: day)
                                } label: {
                                    dayChip(day, removable: true)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 1)
                    }
                }
            }
        }
    }

    // MARK: - Presets

    private var presetRow: some View {
        WVRowContainer {
            VStack(alignment: .leading, spacing: 8) {
                Text(L.t("Mốc có sẵn"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(WVColor.label)

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: WVSpacing.sm) {
                        ForEach(LeadDaysRules.presets, id: \.self) { day in
                            presetChip(day)
                        }
                    }
                    .padding(.vertical, 1)
                }

                if isFull {
                    Text(L.t("Tối đa 5 mốc"))
                        .font(.system(size: 12))
                        .foregroundStyle(WVColor.label3)
                }
            }
        }
    }

    private func presetChip(_ day: Int) -> some View {
        let selected = days.contains(day)
        let blocked = !selected && isFull
        return Button {
            days = LeadDaysRules.toggling(days, day: day)
        } label: {
            dayChip(day, selected: selected, removable: false)
        }
        .buttonStyle(.plain)
        .disabled(blocked)
        .opacity(blocked ? 0.4 : 1)
    }

    // MARK: - Custom day

    private var customRow: some View {
        WVRowContainer {
            HStack(spacing: 12) {
                Text(L.t("Mốc khác"))
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                Spacer(minLength: 8)
                TextField("90", text: $customText)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .font(.system(size: 17))
                    .foregroundStyle(WVColor.label)
                    .frame(width: 80)
                    .onChange(of: customText) { _, newValue in
                        // Keep it to three digits (the range's upper bound is
                        // 365); `LeadDaysRules.clamp` does the final clamping
                        // when the day is added.
                        let digits = String(newValue.filter(\.isNumber).prefix(3))
                        if digits != newValue { customText = digits }
                    }
                Button(L.t("Thêm")) { addCustom() }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(canAddCustom ? WVColor.tint : WVColor.label4)
                    .disabled(!canAddCustom)
            }
        }
    }

    private var customValue: Int? {
        guard let raw = Int(customText) else { return nil }
        return LeadDaysRules.clamp(raw)
    }

    private var canAddCustom: Bool {
        guard let value = customValue, !isFull else { return false }
        return !days.contains(value)
    }

    private func addCustom() {
        guard let value = customValue, !isFull, !days.contains(value) else { return }
        days = LeadDaysRules.normalize(days + [value])
        customText = ""
    }

    // MARK: - Chip

    /// One capsule. Preset chips show a check when selected; the chosen-day
    /// chips carry an × and are the only removable ones.
    private func dayChip(_ day: Int, selected: Bool = true, removable: Bool) -> some View {
        HStack(spacing: 4) {
            if selected && !removable {
                WVIcon("check", size: 10, weight: .bold)
            }
            Text(L.p("%d ngày", day))
            if removable {
                WVIcon("x", size: 9, weight: .bold)
            }
        }
        .font(.system(size: 13, weight: .semibold))
        .foregroundStyle(selected ? WVColor.tint : WVColor.label2)
        .padding(.horizontal, 10)
        .frame(height: 30)
        .background(selected ? WVColor.tint.opacity(0.14) : WVColor.fill3)
        .clipShape(Capsule())
        .contentShape(Capsule())
    }
}
