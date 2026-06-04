import SwiftUI

/// Horizontal scrolling chip list that fills a text binding when tapped.
/// Used to surface catalog suggestions (brand / store / warranty provider) in editor sheets.
struct AutocompleteChips: View {
    let suggestions: [String]
    @Binding var text: String
    /// Optional callback fired when a chip is tapped (e.g. prefill phone/address from a provider).
    var onPick: ((String) -> Void)? = nil

    var body: some View {
        if suggestions.isEmpty {
            EmptyView()
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: WVSpacing.xs) {
                    ForEach(suggestions, id: \.self) { name in
                        Button {
                            text = name
                            onPick?(name)
                        } label: {
                            Text(name)
                                .font(.system(size: 12, weight: .medium))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(WVColor.fill3)
                                .foregroundStyle(WVColor.label)
                                .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}
