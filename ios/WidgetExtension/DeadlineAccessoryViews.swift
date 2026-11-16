import SwiftUI
import WarrlyKit
import WidgetKit

// MARK: - DeadlineAccessoryView

/// Lock Screen layouts (`accessoryCircular`, `accessoryRectangular`,
/// `accessoryInline`).
///
/// This view reads **`entry.accessory` only**. `entry.presentation` carries
/// device names for the home-screen families, and a Lock Screen widget is
/// rendered before the phone is unlocked — so a name must not be reachable from
/// this file at all. Every string and number here was decided by
/// `DeadlineAccessoryRules`.
///
/// Deliberately no `.containerBackground(for: .widget)`: that modifier is for
/// home-screen widgets. An accessory family uses `AccessoryWidgetBackground`
/// only in the circular case.
struct DeadlineAccessoryView: View {
    let entry: DeadlineWidgetEntry

    @Environment(\.widgetFamily) private var family

    private var accessory: DeadlineAccessoryPresentation { entry.accessory }

    var body: some View {
        switch family {
        case .accessoryCircular:
            circular
        case .accessoryRectangular:
            rectangular
        case .accessoryInline:
            inline
        default:
            EmptyView()
        }
    }

    // MARK: Circular

    private var circular: some View {
        ZStack {
            AccessoryWidgetBackground()
            if let value = accessory.circularValue {
                VStack(spacing: 0) {
                    Text(value)
                        .font(.system(size: 22, weight: .bold, design: .rounded))
                        .widgetAccentable()
                    if let label = accessory.circularLabel {
                        Text(label)
                            .font(.system(size: 9, weight: .semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                }
            } else {
                Image(systemName: accessory.circularSymbol)
                    .font(.system(size: 20, weight: .semibold))
                    .widgetAccentable()
            }
        }
        .accessibilityLabel(accessory.accessibilityText)
        .widgetURL(entry.firstDeviceURL)
    }

    // MARK: Rectangular

    private var rectangular: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(accessory.title)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                Spacer(minLength: 0)
                if let asOf = accessory.asOfText {
                    // Rectangular is the only family with room for the honesty
                    // stamp; a circle cannot fit it and inline has one line.
                    Text(asOf)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                }
            }

            if accessory.stats.isEmpty {
                Text(accessory.message ?? "")
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    ForEach(accessory.stats) { stat in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(stat.value)
                                .font(.system(size: 18, weight: .bold, design: .rounded))
                                .widgetAccentable()
                            Text(stat.title)
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessory.accessibilityText)
        .widgetURL(entry.firstDeviceURL)
    }

    // MARK: Inline

    private var inline: some View {
        // `accessoryInline` renders exactly one line and the system truncates
        // it; the rules already chose the shortest honest sentence. No
        // `widgetURL` here — inline widgets do not support one.
        Text(accessory.inlineText)
    }
}
