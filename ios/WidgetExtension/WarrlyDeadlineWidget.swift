import SwiftUI
import WarrlyKit
import WidgetKit

// MARK: - Entry

/// One rendered widget state. All copy is already localized here, so the view
/// only lays it out and the timeline provider can build entries for midnight
/// and staleness boundaries without touching the catalog again.
struct DeadlineWidgetEntry: TimelineEntry {
    let date: Date
    let presentation: DeadlineWidgetPresentation
    let language: AppLanguage
    /// Tapping the widget opens the soonest device. `nil` when there is nothing
    /// to open (empty state, or the first run before the app synced).
    let firstDeviceURL: URL?
}

// MARK: - Provider

struct DeadlineTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> DeadlineWidgetEntry {
        let now = Date()
        let language = SharedInboxLanguage.resolved()
        return entry(
            date: now,
            family: context.family,
            snapshot: Self.sampleSnapshot(now: now, language: language),
            language: language
        )
    }

    func getSnapshot(
        in context: Context,
        completion: @escaping (DeadlineWidgetEntry) -> Void
    ) {
        // The widget gallery is shown before the user has chosen this widget;
        // it must not preview the real account's device names. Real data is
        // only read for a live widget.
        if context.isPreview {
            completion(placeholder(in: context))
        } else {
            completion(entry(date: Date(), family: context.family))
        }
    }

    /// The timeline is deliberately day-granular plus two staleness marks:
    ///
    ///  * **midnight** for the next seven days — the only instant at which a
    ///    day count changes ("1 day left" → "expires today"). The app writes a
    ///    new snapshot on foreground/mutation, so this is a fallback, not the
    ///    primary update path;
    ///  * **capture + 6 h / 48 h** — the only other visible change, the "as of"
    ///    line and then the refresh hint, without waiting for midnight;
    ///  * `.atEnd` after those entries. An hourly wake could not fetch anything
    ///    new: this widget has no network and no token, so re-reading the same
    ///    file every hour would burn the refresh budget to relabel nothing.
    ///    Six hours is the staleness threshold; the app reloads the timeline
    ///    itself after it writes a fresh snapshot.
    func getTimeline(
        in context: Context,
        completion: @escaping (Timeline<DeadlineWidgetEntry>) -> Void
    ) {
        let now = Date()
        let snapshot = DeadlineSnapshotStore()?.read()
        let language = SharedInboxLanguage.resolved()

        var entries = [
            entry(date: now, family: context.family, snapshot: snapshot, language: language),
        ]

        if let captured = snapshot?.capturedAt {
            let staleAt = captured.addingTimeInterval(DeadlineWidgetRules.staleAfter)
            if staleAt > now {
                entries.append(entry(
                    date: staleAt, family: context.family,
                    snapshot: snapshot, language: language
                ))
            }
            let severelyStaleAt = captured.addingTimeInterval(
                DeadlineWidgetRules.severelyStaleAfter
            )
            if severelyStaleAt > now {
                entries.append(entry(
                    date: severelyStaleAt, family: context.family,
                    snapshot: snapshot, language: language
                ))
            }
        }

        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        for offset in 1...7 {
            guard let day = calendar.date(byAdding: .day, value: offset, to: today) else {
                continue
            }
            entries.append(entry(
                date: day, family: context.family,
                snapshot: snapshot, language: language
            ))
        }

        entries.sort { $0.date < $1.date }
        var unique: [DeadlineWidgetEntry] = []
        for entry in entries where unique.last?.date != entry.date {
            unique.append(entry)
        }

        // No snapshot: ask again in six hours in case the app wrote one without
        // a timeline reload (e.g. it was killed mid-refresh). With a snapshot,
        // the entries above are enough; `.atEnd` keeps the widget quiet.
        let policy: TimelineReloadPolicy = snapshot == nil
            ? .after(now.addingTimeInterval(6 * 60 * 60))
            : .atEnd
        completion(Timeline(entries: unique, policy: policy))
    }

    // MARK: Helpers

    private func entry(
        date: Date,
        family: WidgetFamily,
        snapshot: DeadlineSnapshot? = nil,
        language: AppLanguage? = nil
    ) -> DeadlineWidgetEntry {
        let resolvedLanguage = language ?? SharedInboxLanguage.resolved()
        let limit = family == .systemSmall
            ? DeadlineWidgetRules.smallLimit
            : DeadlineWidgetRules.mediumLimit
        let currentSnapshot = snapshot ?? DeadlineSnapshotStore()?.read()
        let presentation = DeadlineWidgetRules.presentation(
            snapshot: currentSnapshot,
            now: date,
            limit: limit,
            language: resolvedLanguage
        )
        let firstURL = presentation.rows.first.flatMap {
            WarrlyDeepLink.deviceURL(id: $0.deviceId)
        }
        return DeadlineWidgetEntry(
            date: date,
            presentation: presentation,
            language: resolvedLanguage,
            firstDeviceURL: firstURL
        )
    }

    /// Gallery/placeholder data only — never written to the App Group and never
    /// shown as if it were the user's account.
    private static func sampleSnapshot(now: Date, language: AppLanguage) -> DeadlineSnapshot {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        let first = calendar.date(byAdding: .day, value: 2, to: today) ?? now
        let second = calendar.date(byAdding: .day, value: 9, to: today) ?? now

        return DeadlineSnapshot(
            capturedAt: now,
            windowDays: 90,
            deadlines: [
                SnapshotDeadline(
                    warrantyId: "sample-warranty-1",
                    deviceId: "sample-device-1",
                    deviceName: L.t("Laptop", language: language),
                    deviceCategory: "LAPTOP",
                    warrantyType: "STANDARD",
                    provider: "Apple",
                    endDate: first
                ),
                SnapshotDeadline(
                    warrantyId: "sample-warranty-2",
                    deviceId: "sample-device-2",
                    deviceName: L.t("Máy giặt / Sấy", language: language),
                    deviceCategory: "WASHING",
                    warrantyType: "EXTENDED",
                    provider: nil,
                    endDate: second
                ),
            ],
            devices: []
        )
    }
}

// MARK: - View

struct DeadlineWidgetView: View {
    let entry: DeadlineWidgetEntry

    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    @Environment(\.isLuminanceReduced) private var luminanceReduced

    private var isSmall: Bool { family == .systemSmall }

    /// Privacy decision: this extension declares no `.accessory*` family, so it
    /// is a home-screen widget and is not rendered before unlock. The extra
    /// check is defence in depth: if the system ever draws it in a
    /// vibrant/luminance-reduced context, device names are replaced by a
    /// generic label instead of leaking out of a locked phone.
    private var hidesDeviceNames: Bool {
        renderingMode == .vibrant || luminanceReduced
    }

    var body: some View {
        VStack(alignment: .leading, spacing: isSmall ? 5 : 6) {
            header
            content
            Spacer(minLength: 0)
            footer
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .containerBackground(for: .widget) { background }
        .widgetURL(entry.firstDeviceURL)
    }

    private var header: some View {
        HStack(spacing: 5) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: isSmall ? 10 : 11, weight: .semibold))
                .foregroundStyle(palette.teal)
            Text(entry.presentation.title)
                .font(.system(size: isSmall ? 11 : 12, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch entry.presentation.state {
        case .notConfigured, .empty:
            Text(entry.presentation.message ?? "")
                .font(.system(size: isSmall ? 11 : 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.85))
                .lineLimit(isSmall ? 4 : 3)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        case let .deadlines(rows):
            VStack(alignment: .leading, spacing: isSmall ? 4 : 5) {
                ForEach(rows) { row in
                    rowView(row)
                }
            }
        }
    }

    private func rowView(_ row: DeadlineWidgetRow) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Circle()
                .fill(color(for: row.urgency))
                .frame(width: 6, height: 6)
            VStack(alignment: .leading, spacing: 0) {
                Text(hidesDeviceNames
                     ? L.t("Thiết bị", language: entry.language)
                     : row.deviceName)
                    .font(.system(size: isSmall ? 12 : 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .privacySensitive()
                Text(row.daysText)
                    .font(.system(size: isSmall ? 10 : 11, weight: .medium))
                    .foregroundStyle(color(for: row.urgency))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var footer: some View {
        if let asOf = entry.presentation.asOfText {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 3) {
                    Image(systemName: entry.presentation.refreshHint == nil
                          ? "clock" : "exclamationmark.triangle.fill")
                        .font(.system(size: 8, weight: .semibold))
                    Text(asOf)
                        .font(.system(size: 9, weight: .medium))
                        .lineLimit(1)
                }
                .foregroundStyle(entry.presentation.refreshHint == nil
                                 ? Color.white.opacity(0.55)
                                 : palette.amber)

                if let hint = entry.presentation.refreshHint {
                    Text(hint)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(palette.amber)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            .privacySensitive()
        }
    }

    private var background: some View {
        LinearGradient(
            colors: [palette.backgroundTop, palette.backgroundBottom],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private func color(for urgency: DeadlineUrgency) -> Color {
        switch urgency {
        case .expired: return palette.red
        case .today:   return palette.orange
        case .soon:    return palette.amber
        case .later:   return palette.teal
        }
    }

    private struct Palette {
        let backgroundTop = Color(red: 0.05, green: 0.08, blue: 0.14)
        let backgroundBottom = Color(red: 0.04, green: 0.16, blue: 0.18)
        let teal = Color(red: 0.33, green: 0.88, blue: 0.74)
        let amber = Color(red: 0.99, green: 0.77, blue: 0.31)
        let orange = Color(red: 0.98, green: 0.55, blue: 0.25)
        let red = Color(red: 0.98, green: 0.36, blue: 0.35)
    }

    private var palette: Palette { Palette() }
}

// MARK: - Widget

@main
struct WarrlyDeadlineWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(
            kind: WarrlySurface.widgetKind,
            provider: DeadlineTimelineProvider()
        ) { entry in
            DeadlineWidgetView(entry: entry)
        }
        .configurationDisplayName(
            DeadlineWidgetRules.widgetTitle(language: SharedInboxLanguage.resolved())
        )
        .description(
            DeadlineWidgetRules.galleryDescription(language: SharedInboxLanguage.resolved())
        )
        // Home Screen only, on purpose. No `.accessoryRectangular` /
        // `.accessoryInline` / `.accessoryCircular`: those render on the Lock
        // Screen, where a device name would be readable by anyone holding the
        // phone. The widget is therefore invisible before unlock.
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
