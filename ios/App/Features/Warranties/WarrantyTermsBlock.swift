import SwiftUI
import WarrlyKit

// ============================================================
// WarrantyTermsBlock — the contract terms under a warranty row
//
// Shown on the device detail screen in both places a warranty appears: the
// "Tổng quan bảo hành" timeline (compact) and the warranty list (full). The
// caller only renders it when `terms.hasAnyTerms` is true, which is the same
// rule that decides whether the form section starts expanded — a row without
// terms must look exactly as it did before this feature.
//
// Everything money-shaped comes from `WarrantyTerms.capLabel` /
// `.deductibleLabel`, which use the Kit's locale-independent `VndFormat`; this
// view never formats a number itself. Everything label-shaped is a literal
// `L.t` key so the String Catalog scan can see it.
// ============================================================

struct WarrantyTermsBlock: View {
    let terms: WarrantyTerms

    /// The timeline card is an overview: same fields where they matter, tighter
    /// line limits so five warranties with caps do not turn it into a page.
    var compact: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(terms.componentTitle)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(WVColor.label2)
                .lineLimit(1)

            if let economics {
                Text(economics)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(1)
            }

            if let coverage {
                Text(coverage)
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(compact ? 1 : 2)
            }

            if let exclusions = terms.exclusions {
                Text(L.t("Loại trừ: %@", exclusions))
                    .font(.system(size: 12))
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(compact ? 1 : 3)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Maximum payout, what the user pays, and the claims counter, in the order
    /// the contract reads: the ceiling first, then the per-claim cost, then how
    /// much of the allowance is gone.
    private var economics: String? {
        var parts: [String] = []
        if let cap = terms.capLabel {
            parts.append(L.t("Tối đa %@", cap))
        }
        if let deductible = terms.deductibleLabel {
            parts.append(L.t("Khấu trừ %@", deductible))
        }
        if let claims = terms.claimsLabel {
            parts.append(terms.hasUnboundedClaims
                         ? L.t("Lượt BH: %@ (không giới hạn)", claims)
                         : L.t("Lượt BH: %@", claims))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    /// What the contract covers and where. Kept on its own line so the money
    /// line stays scannable, and so a row with only `scope` does not render a
    /// bare "Phạm vi" heading.
    private var coverage: String? {
        var parts: [String] = []
        if let scope = terms.scope {
            parts.append(L.t("Phạm vi: %@", scope))
        }
        if let region = terms.region {
            parts.append(L.t("Khu vực: %@", region))
        }
        if let transferable = terms.transferableLabel {
            parts.append(L.t("Chuyển nhượng: %@", transferable))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}
