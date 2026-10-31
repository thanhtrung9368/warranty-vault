import SwiftUI
import WarrlyKit

// ============================================================
// Dashboard — the deadline-first home
//
// The old home was a 2×2 grid of counts ("Còn BH 4 / Sắp hết 1 / Đã hết 0").
// A count answers "how many" but never "which one, and when" — there was no
// date anywhere on it, so nothing on the screen could be acted on. This file is
// the presentation half of the replacement.
//
// `DeadlineBoard` (in WarrlyKit) still owns the ordering rule, but the *view*
// now picks the lead: the first candidate that has not already passed. An
// overdue date is a fact the user can no longer change, so it must not outrank
// the nearest one they still can — which is what the old "earliest date wins"
// board did on this account, putting an iCloud renewal from 2022 above a watch
// with 18 days left (§1.4).
//
// The card is this screen's one lead surface: the day count at 28 pt in the
// state colour, over its absolute date (§6 — the number is the lead, the date
// is its caption). The rows below keep the row form instead: `WarrantyPill`,
// which prints the absolute date past 90 days and a day count only inside the
// window where the count changes a decision.
// ============================================================

// MARK: - Lead card

/// The next deadline the user can still act on.
///
/// Three lines in the order §6 gives a lead surface — what it is, how long is
/// left, and the absolute date as the caption — plus the 4 pt urgency strip,
/// which is the card's only fill.
struct DeadlineCard: View {
    let candidate: DeadlineCandidate
    let navigation: ActionQueueNav

    private var tone: Color { deadlineTone(candidate.days) }

    /// The kind of deadline, or `Đã qua` when the whole board is in the past: a
    /// card whose candidate is already overdue is only drawn because there is
    /// nothing left to act on, and the eyebrow has to say that instead of
    /// implying a deadline the user can still make.
    private var eyebrow: String {
        candidate.days < 0 ? L.t("Đã qua") : DeadlineCopy.kindLabel(candidate.kind)
    }

    /// The lead is the *number*, including past 90 days — where the row form
    /// prints the date instead (§6). "How long do I have?" is the question the
    /// card exists to answer; for a board that is entirely past, the grey
    /// `Đã hết hạn` is the calm statement of the state, not an alarm.
    private var lead: String {
        if candidate.days < 0 { return L.t("Đã hết hạn") }
        if candidate.days == 0 { return L.t("Hết hạn hôm nay") }
        return L.p("còn %d ngày", candidate.days)
    }

    var body: some View {
        NavigationLink(value: navigation) {
            VStack(alignment: .leading, spacing: WVSpacing.sm) {
                Text(eyebrow)
                    .wvFont(.footnoteEmphasis)
                    .foregroundStyle(WVColor.label3)
                Text(candidate.title)
                    .wvFont(.title3Emphasis)
                    .foregroundStyle(WVColor.label)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Text(lead)
                    .wvFont(.statValue)
                    .foregroundStyle(tone)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .fixedSize(horizontal: false, vertical: true)
                Text(DeadlineCopy.dateLabel(kind: candidate.kind,
                                            dateText: WVFormat.date(candidate.date)))
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(WVSpacing.gutter)
            .background(WVColor.bg2)
            .overlay(alignment: .leading) {
                // The urgency colour, without tinting the whole card: a red
                // wash would read as an error, and an expired warranty is a
                // fact, not a failure dialog. A capsule, so the strip's radius
                // is its width / 2 rather than a typed number (§4), inset 14
                // vertically as before (§9.5 keeps the strip exactly).
                Capsule()
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

// MARK: - Content row

/// One content row, with the same anatomy everywhere on this screen (§8.1): a
/// 28 pt leading slot, a title with one meta line, and a trailing value.
///
/// `tile` is the only difference between the three lists here: a deadline row
/// wears the neutral `fill3` tile of the devices list, while the subscription
/// and wishlist previews use the bare 20 pt glyph their own screens use (§8.5,
/// §8.6). Both reserve the same 28 pt slot, so every title starts on the one
/// left edge — 16 + 28 + 12 = 56 — and one `WVDivider` inset serves all three
/// groups.
///
/// The title keeps `layoutPriority(1)` and the value is capped at 96 pt, so a
/// long name pushes the trailing column down before truncating itself (§1.13).
/// At Accessibility sizes the value moves onto its own line under the title,
/// the same axis change `WVRow` makes.
struct DashboardRow<Value: View>: View {
    var icon: String
    var tile: Bool = true
    var title: String
    var meta: String?
    var chevron: Bool = false
    @ViewBuilder var value: Value

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                accessibleLayout
            } else {
                regularLayout
            }
        }
        .padding(.horizontal, WVSpacing.gutter)
        .frame(minHeight: 44)
        .padding(.vertical, WVSpacing.sm)
        .contentShape(Rectangle())
    }

    private var regularLayout: some View {
        HStack(spacing: WVSpacing.md) {
            leading
            titleBlock
                .layoutPriority(1)
            Spacer(minLength: WVSpacing.sm)
            value
                .frame(maxWidth: 96, alignment: .trailing)
            if chevron { chevronGlyph }
        }
    }

    private var accessibleLayout: some View {
        VStack(alignment: .leading, spacing: WVSpacing.xs) {
            HStack(alignment: .top, spacing: WVSpacing.md) {
                leading
                titleBlock
                if chevron { chevronGlyph }
            }
            value
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 28 + WVSpacing.md)
        }
    }

    @ViewBuilder
    private var leading: some View {
        if tile {
            WVLeadingIcon(icon: icon, size: 28)
        } else {
            // A bare glyph on the same 28 pt slot, so the title still lands on
            // the 56 left edge and one divider inset fits every list.
            WVIcon(icon, size: 20)
                .foregroundStyle(WVColor.label2)
                .frame(width: 28, height: 28)
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            Text(title)
                .wvFont(.bodyEmphasis)
                .foregroundStyle(WVColor.label)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 1)
                .fixedSize(horizontal: false, vertical: true)
            if let meta {
                Text(meta)
                    .wvFont(.footnote)
                    .foregroundStyle(WVColor.label3)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var chevronGlyph: some View {
        WVIcon("arrowRight", size: 13, weight: .semibold)
            .foregroundStyle(WVColor.label4)
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
            .padding(.horizontal, WVSpacing.gutter)
            .padding(.top, WVSpacing.gutter)
    }
}

// MARK: - Loading skeleton

/// The card's shape while the three feeds answer. Static and redacted, like the
/// other skeletons in the app: a spinner in an empty page is the defect this
/// dashboard was already fixed for once (§9.2 — the behaviour stays, the shape
/// now promises the card it replaces: eyebrow, name, day count, date).
struct DeadlineSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: WVSpacing.sm) {
            bar(width: 84, height: 12)
            bar(width: 190, height: 22)
            bar(width: 150, height: 28)
            bar(width: 170, height: 13)
        }
        .padding(WVSpacing.gutter)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(WVColor.bg2)
        .clipShape(RoundedRectangle(cornerRadius: WVRadius.card, style: .continuous))
        .padding(.horizontal, WVSpacing.gutter)
        .redacted(reason: .placeholder)
    }

    /// A placeholder text bar: 4 is the one radius a bar keeps (§4).
    private func bar(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(WVColor.fill3)
            .frame(width: width, height: height)
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
