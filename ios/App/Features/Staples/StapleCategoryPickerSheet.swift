import SwiftUI
import WarrlyKit

/// The category vocabulary for essentials.
///
/// Values are Vietnamese on purpose: `Staple.category` is free text shared with
/// the web client, and the web picker stores the same Vietnamese keys. Only the
/// label is translated, so switching the app language never rewrites saved data.
enum StapleCategories {
    static let presets = [
        "Đồ dùng cá nhân",
        "Đồ dùng nhà cửa",
        "Đồ dùng nhà bếp",
        "Đồ dùng vệ sinh",
        "Thực phẩm khô",
        "Đồ dùng em bé",
        "Đồ dùng thú cưng",
        "Đồ dùng xe",
        "Văn phòng",
    ]

    static func label(_ value: String) -> String {
        presets.contains(value) ? L.t(value) : value
    }

    static func options(existing: [String]) -> [String] {
        var seen = Set(presets)
        var out = presets
        for raw in existing {
            let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty, seen.insert(value).inserted else { continue }
            out.append(value)
        }
        return out
    }
}

/// Sheet picker for `Staple.category`. Presets and categories already used by
/// the account are one tap; "Khác" reveals a text field for a genuinely new one.
struct StapleCategoryPickerSheet: View {
    @Binding var selected: String
    let existing: [String]

    @Environment(\.dismiss) private var dismiss
    @State private var customMode = false
    @State private var custom = ""

    private var options: [String] { StapleCategories.options(existing: existing) }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: WVSpacing.sm)

                WVGroup {
                    ForEach(Array(options.enumerated()), id: \.element) { idx, value in
                        if idx > 0 { WVDivider() }
                        Button {
                            selected = value
                            dismiss()
                        } label: {
                            HStack(spacing: WVSpacing.sm) {
                                Text(StapleCategories.label(value))
                                    .wvFont(.body)
                                    .foregroundStyle(WVColor.label)
                                    .lineLimit(1)
                                Spacer()
                                if selected == value {
                                    WVIcon("check", size: 16, weight: .bold)
                                        .foregroundStyle(WVColor.tint)
                                }
                            }
                            .padding(.horizontal, WVSpacing.gutter)
                            .frame(minHeight: 44)
                            .padding(.vertical, WVSpacing.xs)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(WVRowButtonStyle())
                    }
                    WVDivider()
                    Button {
                        customMode = true
                    } label: {
                        HStack(spacing: WVSpacing.sm) {
                            Text(L.t("Khác"))
                                .wvFont(.body)
                                .foregroundStyle(WVColor.label)
                            Spacer()
                            if customMode {
                                WVIcon("check", size: 16, weight: .bold)
                                    .foregroundStyle(WVColor.tint)
                            }
                        }
                        .padding(.horizontal, WVSpacing.gutter)
                        .frame(minHeight: 44)
                        .padding(.vertical, WVSpacing.xs)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(WVRowButtonStyle())
                }

                if customMode {
                    WVSectionHeader(L.t("Nhóm khác..."))
                    WVGroup {
                        WVRowContainer {
                            TextField(L.t("Nhóm khác..."), text: $custom)
                                .wvFont(.body)
                                .textInputAutocapitalization(.sentences)
                        }
                        WVDivider()
                        Button {
                            let value = custom.trimmingCharacters(in: .whitespacesAndNewlines)
                            guard !value.isEmpty else { return }
                            selected = value
                            dismiss()
                        } label: {
                            HStack {
                                Text(L.t("Dùng nhóm này"))
                                    .wvFont(.bodyEmphasis)
                                    .foregroundStyle(WVColor.tint)
                                Spacer()
                                WVIcon("arrowRight", size: 13, weight: .semibold)
                                    .foregroundStyle(WVColor.tint)
                            }
                            .padding(.horizontal, WVSpacing.gutter)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(WVRowButtonStyle())
                        .disabled(custom.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }

                Spacer().frame(height: WVSpacing.xl)
            }
        }
        .wvScreen()
        .navigationTitle(L.t("Chọn nhóm"))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(L.t("Xong")) { dismiss() }
                    .wvFont(.bodyEmphasis)
                    .foregroundStyle(WVColor.tint)
            }
        }
    }
}
