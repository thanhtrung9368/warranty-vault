import SwiftUI

/// Chip list that fills a text binding when tapped. Used to surface catalog
/// suggestions in editor sheets.
///
/// It **wraps** instead of scrolling horizontally. A horizontal `ScrollView`
/// reports its content width as its ideal width, and at Accessibility sizes a
/// couple of chips are wider than the phone: inside a form's VStack that made
/// the whole card wider than the screen. A flow layout measures each chip at its
/// natural size and wraps at the width the form actually offers.
struct AutocompleteChips: View {
    let suggestions: [String]
    @Binding var text: String
    /// Optional callback fired when a chip is tapped (e.g. prefill phone/address from a provider).
    var onPick: ((String) -> Void)? = nil

    var body: some View {
        if suggestions.isEmpty {
            EmptyView()
        } else {
            WVFlowLayout(spacing: WVSpacing.xs) {
                ForEach(suggestions, id: \.self) { name in
                    Button {
                        text = name
                        onPick?(name)
                    } label: {
                        Text(name)
                            .wvFont(.caption, weight: .medium)
                            .padding(.horizontal, WVSpacing.md)
                            .padding(.vertical, WVSpacing.sm)
                            .background(WVColor.fill3)
                            .foregroundStyle(WVColor.label)
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.vertical, WVSpacing.sm)
        }
    }
}

/// Left-aligned wrapping layout for natural-width chips.
private struct WVFlowLayout: Layout {
    var spacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var used: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            used = max(used, x - spacing)
        }
        return CGSize(width: used, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize,
                       subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
