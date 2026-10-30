import SwiftUI
import WarrlyKit

// ============================================================
// WVDisclosure — one collapsed block on a detail screen
//
// A detail screen that lists sixteen sections in one scroll reads as a
// document, not as an answer. This is the container for the second tier: the
// facts that are real but are only needed when the user goes looking for
// them. The header stays a full-width row (icon, title, one-line subtitle,
// chevron) so the block is discoverable, and the content keeps the same
// `WVSectionHeader` + card structure it had as a top-level section.
//
// It is hand-built rather than `DisclosureGroup` so the header matches
// `WVRow` at every Dynamic Type size: at accessibility sizes the title and
// subtitle wrap and the chevron stays on the trailing edge instead of
// squeezing the title into one clipped line.
// ============================================================

struct WVDisclosure<Content: View>: View {
    let title: String
    var subtitle: String?
    var icon: String?
    var iconColor: Color = WVColor.gray
    @Binding var isExpanded: Bool
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            WVGroup {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
                } label: {
                    HStack(alignment: .top, spacing: 12) {
                        if let icon {
                            WVLeadingIcon(icon: icon, color: iconColor, size: 32)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(title)
                                .wvFont(.bodyEmphasis)
                                .foregroundStyle(WVColor.label)
                                .fixedSize(horizontal: false, vertical: true)
                            if let subtitle {
                                Text(subtitle)
                                    .wvFont(.footnote)
                                    .foregroundStyle(WVColor.label3)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        Spacer(minLength: 8)
                        WVIcon(isExpanded ? "arrowDown" : "arrowRight",
                               size: 15, weight: .semibold)
                            .foregroundStyle(WVColor.label4)
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 52)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(WVRowButtonStyle())
                .accessibilityLabel(title)
                .accessibilityHint(isExpanded ? L.t("Thu gọn") : L.t("Mở chi tiết"))
            }

            if isExpanded {
                content
                    .transition(.opacity)
            }
        }
    }
}
