import SwiftUI
import WarrlyKit

// ============================================================
// Dashboard — the deadline-first home
//
// The old home was a 2×2 grid of counts ("Còn BH 4 / Sắp hết 1 / Đã hết 0").
// A count answers "how many" but never "which one, and when" — there was no
// date anywhere on it, so nothing on the screen could be acted on. The pill on
// the row below said "9d left", which is a countdown, not a deadline: as it
// recedes the same label becomes "~3th" and then "2 năm", so the actual date is
// unreachable exactly when it matters.
//
// This is the replacement's presentation half. `DeadlineBoard` (in WarrlyKit)
// owns the ordering rule and `DeadlineCopy` owns the "Hết hạn 12/03/2027 ·
// còn 9 ngày" wording; these views only draw one card, three rows and a quiet
// summary line.
// ============================================================

// MARK: - Nearest-deadline card

/// The single nearest deadline. Prints what it is, the absolute date, the day
/// count and the one action that applies (open the thing it belongs to).
struct DeadlineCard: View {
    let candidate: DeadlineCandidate
    let navigation: ActionQueueNav

    private var tone: Color {
        deadlineTone(candidate.days)
    }

    var body: some View {
        NavigationLink(value: navigation) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    WVLeadingIcon(
                        icon: WVCategory.icon(for: candidate.category),
                        color: WVCategory.accent(for: candidate.category),
                        size: 30
                    )
                    Text(DeadlineCopy.kindLabel(candidate.kind).uppercased())
                        .wvFont(.captionEmphasis)
                        .foregroundStyle(WVColor.label3)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    WVIcon("arrowRight", size: 13, weight: .semibold)
                        .foregroundStyle(WVColor.label4)
                }

                Text(candidate.title)
                    .wvFont(.title3Emphasis)
                    .foregroundStyle(WVColor.label)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)

                // The whole point of the card: the absolute date is printed,
                // in the same wording every other deadline row uses.
                Text(DeadlineCopy.label(
                    kind: candidate.kind,
                    dateText: WVFormat.date(candidate.date),
                    days: candidate.days
                ))
                .wvFont(.bodyEmphasis)
                .foregroundStyle(tone)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

                Text(L.t("Xem chi tiết"))
                    .wvFont(.subheadlineEmphasis)
                    .foregroundStyle(WVColor.tint)
                    .padding(.top, 2)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(WVColor.bg2)
            .overlay(alignment: .leading) {
                // The urgency colour, without tinting the whole card: a red
                // wash would read as an error, and an expired warranty is a
                // fact, not a failure dialog.
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(tone)
                    .frame(width: 4)
                    .padding(.vertical, 14)
            }
            .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        }
        .buttonStyle(WVPressableStyle())
        .padding(.horizontal, WVSpacing.gutter)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Next rows

/// One of the next three deadlines. Same absolute date as the card, one line
/// smaller.
struct DeadlineRow: View {
    let candidate: DeadlineCandidate

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            WVLeadingIcon(
                icon: WVCategory.icon(for: candidate.category),
                color: WVCategory.accent(for: candidate.category),
                size: 34
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(candidate.title)
                    .wvFont(.calloutEmphasis)
                    .foregroundStyle(WVColor.label)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                    .fixedSize(horizontal: false, vertical: true)
                Text(DeadlineCopy.label(
                    kind: candidate.kind,
                    dateText: WVFormat.date(candidate.date),
                    days: candidate.days
                ))
                .wvFont(.footnote)
                .foregroundStyle(deadlineTone(candidate.days))
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 4 : 2)
                .fixedSize(horizontal: false, vertical: true)
            }
            .layoutPriority(1)
            Spacer(minLength: 8)
            WVIcon("arrowRight", size: 13)
                .foregroundStyle(WVColor.label4)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 44)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
    }
}

// MARK: - Quiet rollup

/// The four numbers the old grid shouted, now one quiet line:
/// "6 thiết bị · 4 còn BH · 1 sắp hết · 0 đã hết".
///
/// It keeps `warrantyRollup` as the single source, so Dashboard, Stats and
/// Android still agree on what "in warranty" and "ending soon" mean. It is
/// deliberately below the action blocks: a count is context, not a to-do.
struct DeadlineSummaryLine: View {
    let rollup: WarrantyRollup

    var body: some View {
        Text(L.p("%d thiết bị · %d còn BH · %d sắp hết · %d đã hết",
                 rollup.total, rollup.inWarranty, rollup.soon, rollup.expired))
            .wvFont(.footnote)
            .foregroundStyle(WVColor.label3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 32)
            .padding(.top, 18)
    }
}

// MARK: - Loading skeleton

/// The card's shape while the three feeds answer. Static and redacted, like the
/// other skeletons in the app: a spinner in an empty page is the defect this
/// dashboard was already fixed for once.
struct DeadlineSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(WVColor.fill3)
                    .frame(width: 30, height: 30)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(WVColor.fill3)
                    .frame(width: 90, height: 12)
                Spacer(minLength: 0)
            }
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(WVColor.fill3)
                .frame(height: 22)
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(WVColor.fill3)
                .frame(width: 200, height: 16)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.bg2)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
        .redacted(reason: .placeholder)
    }
}

// MARK: - Tone

/// The same safe/warn/danger/expired mapping the warranty pill uses, so a date
/// on this screen cannot be friendlier than the same date elsewhere.
func deadlineTone(_ days: Int) -> Color {
    switch WarrantyPillCopy.status(daysLeft: days) {
    case .safe:    return WVColor.green
    case .warn:    return WVColor.orange
    case .danger:  return WVColor.red
    case .expired: return WVColor.label3
    }
}
