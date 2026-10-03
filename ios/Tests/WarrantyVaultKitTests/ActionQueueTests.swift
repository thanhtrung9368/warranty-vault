import Foundation
import XCTest
@testable import WarrantyVaultKit

/// "Việc cần xử lý" — the pure half of the action queue.
///
/// The risky parts of this feature are not the layout but three contract details
/// the server cannot enforce for us: a badge that must read `counts.total` and
/// never the rows on screen, a row that must not become a dead link, and a snooze
/// that must stay inside the server's `1–365` window. Each is pinned here.
final class ActionQueueTests: KitTestCase {

    private func item(_ key: String, kind: String = "WARRANTY_EXPIRED",
                      severity: String = "HIGH", dueDate: String? = nil,
                      deviceId: String? = nil, warrantyId: String? = nil,
                      subscriptionId: String? = nil, wishlistItemId: String? = nil,
                      amountVnd: Int64? = nil, snoozedUntil: String? = nil) -> ActionItem {
        var json: [String: Any] = [
            "itemKey": key, "kind": kind, "severity": severity,
            "title": "Tiêu đề do server viết", "detail": "Chi tiết do server viết",
        ]
        if let dueDate { json["dueDate"] = dueDate }
        if let deviceId { json["deviceId"] = deviceId }
        if let warrantyId { json["warrantyId"] = warrantyId }
        if let subscriptionId { json["subscriptionId"] = subscriptionId }
        if let wishlistItemId { json["wishlistItemId"] = wishlistItemId }
        if let amountVnd { json["amountVnd"] = amountVnd }
        if let snoozedUntil { json["snoozedUntil"] = snoozedUntil }
        let data = try! JSONSerialization.data(withJSONObject: json)
        return try! APIClient.decoder.decode(ActionItem.self, from: data)
    }

    // MARK: - The badge (the test both other clients pinned)

    /// A `?snoozed=true` read ADDS rows. Three rows on screen, two actionable
    /// items, and the badge must say 2 — counting rows would overstate the
    /// workload the moment the "Đang hoãn" view is opened.
    func testBadgeReadsCountsTotalAndNeverTheRowCount() throws {
        let json = """
        {
          "generatedAt": "2026-03-15T00:00:00Z",
          "items": [
            {"itemKey": "WARRANTY_EXPIRED:w1", "kind": "WARRANTY_EXPIRED", "severity": "HIGH",
             "title": "Bảo hành đã hết hạn", "detail": "…", "deviceId": "d1"},
            {"itemKey": "DEVICE_MISSING_SERIAL:d2", "kind": "DEVICE_MISSING_SERIAL",
             "severity": "LOW", "title": "Thiếu số serial / IMEI", "detail": "…", "deviceId": "d2"},
            {"itemKey": "DEVICE_MISSING_RECEIPT:d3", "kind": "DEVICE_MISSING_RECEIPT",
             "severity": "LOW", "title": "Chưa có ảnh hoá đơn", "detail": "…", "deviceId": "d3",
             "snoozedUntil": "2026-06-13T00:00:00Z"}
          ],
          "counts": {"total": 2, "high": 1, "medium": 0, "low": 1},
          "snoozedCount": 1,
          "note": "Danh sách này chỉ gồm những việc app TỰ SUY RA…"
        }
        """
        let queue = try APIClient.decoder.decode(ActionQueue.self, from: Data(json.utf8))

        XCTAssertEqual(queue.items.count, 3, "the snoozed read really does add a row")
        XCTAssertEqual(ActionQueueRules.badgeCount(queue.counts), 2)
        XCTAssertNotEqual(ActionQueueRules.badgeCount(queue.counts), queue.items.count,
                          "the row count would overstate the workload")
        XCTAssertEqual(ActionQueueRules.actionable(queue.items).count, 2)
        XCTAssertEqual(ActionQueueRules.snoozed(queue.items).map(\.itemKey),
                       ["DEVICE_MISSING_RECEIPT:d3"])
        XCTAssertEqual(queue.snoozedCount, 1)
    }

    /// The default read carries no `snoozedUntil` at all, and the counts are the
    /// whole set.
    func testDefaultReadHasNoSnoozedRows() throws {
        let json = """
        {"generatedAt": "2026-03-15T00:00:00Z",
         "items": [{"itemKey": "DEVICE_NO_WARRANTY:d1", "kind": "DEVICE_NO_WARRANTY",
                    "severity": "MEDIUM", "title": "t", "detail": "d", "deviceId": "d1"}],
         "counts": {"total": 1, "high": 0, "medium": 1, "low": 0},
         "snoozedCount": 0, "note": "n"}
        """
        let queue = try APIClient.decoder.decode(ActionQueue.self, from: Data(json.utf8))

        XCTAssertFalse(queue.items[0].isSnoozed)
        XCTAssertEqual(ActionQueueRules.badgeCount(queue.counts), 1)
        XCTAssertTrue(ActionQueueRules.snoozed(queue.items).isEmpty)
    }

    /// A partial payload still renders its rows; only `counts` is required, and a
    /// missing count must fail loudly rather than claim "0 việc".
    func testMissingCountsIsAnErrorWhileMissingItemsDegradeToEmpty() throws {
        let withoutCounts = """
        {"generatedAt": "2026-03-15T00:00:00Z", "items": [], "note": "n"}
        """
        XCTAssertThrowsError(try APIClient.decoder.decode(ActionQueue.self, from: Data(withoutCounts.utf8)))

        let partial = """
        {"counts": {"total": 0, "high": 0, "medium": 0, "low": 0}}
        """
        let queue = try APIClient.decoder.decode(ActionQueue.self, from: Data(partial.utf8))
        XCTAssertTrue(queue.items.isEmpty)
        XCTAssertEqual(queue.snoozedCount, 0)
        XCTAssertEqual(queue.note, "")
    }

    // MARK: - Severity

    func testSeverityCodesMapAndUnknownCodesSortLast() {
        XCTAssertEqual(ActionSeverity.of("HIGH"), .HIGH)
        XCTAssertEqual(ActionSeverity.of(" medium "), .MEDIUM)
        XCTAssertEqual(ActionSeverity.of("LOW"), .LOW)
        // A code from a newer server renders instead of blanking the queue.
        XCTAssertEqual(ActionSeverity.of("CRITICAL"), .UNKNOWN)
        XCTAssertEqual(ActionSeverity.of(""), .UNKNOWN)
        XCTAssertEqual(ActionSeverity.of("HIGH").rank < ActionSeverity.of("MEDIUM").rank, true)
        XCTAssertEqual(ActionSeverity.of("LOW").rank < ActionSeverity.of("CRITICAL").rank, true)
    }

    func testSectionsOrderBySeverityAndKeepTheServersWithinGroupOrder() {
        let items = [
            item("WISHLIST_TARGET_PASSED:w1", severity: "LOW"),
            item("WARRANTY_EXPIRED:w2", severity: "HIGH"),
            item("DEVICE_NO_WARRANTY:d1", severity: "MEDIUM"),
            item("RETURN_WINDOW_CLOSING:d2", severity: "HIGH", dueDate: "2026-03-20T00:00:00"),
        ]

        let sections = ActionQueueRules.sections(items)

        XCTAssertEqual(sections.map(\.severity), [.HIGH, .MEDIUM, .LOW])
        // Within HIGH the dated item comes first (soonest first), the undated last.
        XCTAssertEqual(sections[0].items.map(\.itemKey),
                       ["RETURN_WINDOW_CLOSING:d2", "WARRANTY_EXPIRED:w2"])
        XCTAssertEqual(sections[1].items.map(\.itemKey), ["DEVICE_NO_WARRANTY:d1"])
        XCTAssertEqual(sections[2].items.map(\.itemKey), ["WISHLIST_TARGET_PASSED:w1"])
    }

    // MARK: - Destination

    func testEveryDocumentedKindReachesItsEntityOrRendersAsPlainCard() {
        // The id each kind populates (api/internal/services/actions.go).
        XCTAssertEqual(ActionQueueRules.target(item("WARRANTY_EXPIRED:w1", kind: "WARRANTY_EXPIRED",
                                                    deviceId: "d1", warrantyId: "w1")),
                       .device("d1"))
        XCTAssertEqual(ActionQueueRules.target(item("DEVICE_NO_WARRANTY:d1", kind: "DEVICE_NO_WARRANTY",
                                                    deviceId: "d1")), .device("d1"))
        XCTAssertEqual(ActionQueueRules.target(item("DEVICE_STATUS_STALE:d1", kind: "DEVICE_STATUS_STALE",
                                                    deviceId: "d1")), .device("d1"))
        XCTAssertEqual(ActionQueueRules.target(item("DEVICE_MISSING_SERIAL:d1", kind: "DEVICE_MISSING_SERIAL",
                                                    deviceId: "d1")), .device("d1"))
        XCTAssertEqual(ActionQueueRules.target(item("DEVICE_MISSING_RECEIPT:d1", kind: "DEVICE_MISSING_RECEIPT",
                                                    deviceId: "d1")), .device("d1"))
        XCTAssertEqual(ActionQueueRules.target(item("RETURN_WINDOW_CLOSING:d1", kind: "RETURN_WINDOW_CLOSING",
                                                    deviceId: "d1")), .device("d1"))
        XCTAssertEqual(ActionQueueRules.target(item("RETURN_WINDOW_UNKNOWN:d1", kind: "RETURN_WINDOW_UNKNOWN",
                                                    deviceId: "d1")), .device("d1"))
        XCTAssertEqual(ActionQueueRules.target(item("SUBSCRIPTION_RENEWING_NO_CANCEL_URL:s1",
                                                    kind: "SUBSCRIPTION_RENEWING_NO_CANCEL_URL",
                                                    subscriptionId: "s1")), .subscription("s1"))
        XCTAssertEqual(ActionQueueRules.target(item("SUBSCRIPTION_PAID_NOT_ADVANCED:s1",
                                                    kind: "SUBSCRIPTION_PAID_NOT_ADVANCED",
                                                    subscriptionId: "s1")), .subscription("s1"))
        XCTAssertEqual(ActionQueueRules.target(item("WISHLIST_TARGET_PASSED:wl1",
                                                    kind: "WISHLIST_TARGET_PASSED",
                                                    wishlistItemId: "wl1")), .wishlistItem("wl1"))
    }

    /// A row with no entity is a real case, not dead code: it must render as a
    /// plain non-tappable card rather than a link to nowhere.
    func testARowWithoutAnEntityHasNoTarget() {
        XCTAssertNil(ActionQueueRules.target(item("DEVICE_MISSING_SERIAL:d1")))
        XCTAssertNil(ActionQueueRules.target(item("X:d1", deviceId: "   ")))
    }

    // MARK: - Dates + money

    /// `dueNote` reads the date half of a naive-UTC wire value through
    /// `DeviceReturnWindow.daysLeft`, so it inherits that helper's anchoring rule:
    /// both days are counted on the caller's calendar. This loop is the same
    /// blind-spot fix as in `DeviceReturnWindowTests` — the assertion used to run
    /// only at UTC, where a UTC-pinned parse and the caller's calendar coincide,
    /// so a row that was one day short for anyone west of UTC passed.
    func testDueNoteIsBuiltFromTheDateHalfOnlyInEveryZone() throws {
        for id in ["Pacific/Midway", "America/Los_Angeles", "UTC",
                   "Asia/Ho_Chi_Minh", "Asia/Tokyo", "Pacific/Kiritimati"] {
            let tz = try XCTUnwrap(TimeZone(identifier: id), "unknown zone \(id)")
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = tz
            let today = makeDate("2026-03-15 08:00:00", format: "yyyy-MM-dd HH:mm:ss", timeZone: tz)

            XCTAssertEqual(ActionQueueRules.dueNote("2026-03-18T00:00:00", now: today, calendar: calendar),
                           ActionDueNote(label: "Còn 3 ngày", urgency: .soon),
                           "three days out read wrong for a device in \(id)")
            XCTAssertEqual(ActionQueueRules.dueNote("2026-03-15T00:00:00", now: today, calendar: calendar),
                           ActionDueNote(label: "Hôm nay", urgency: .today),
                           "the due day read wrong for a device in \(id)")
            XCTAssertEqual(ActionQueueRules.dueNote("2026-03-10T00:00:00", now: today, calendar: calendar),
                           ActionDueNote(label: "Quá hạn 5 ngày", urgency: .overdue),
                           "an overdue row read wrong for a device in \(id)")
            XCTAssertEqual(ActionQueueRules.dueNote("2026-04-20T00:00:00", now: today, calendar: calendar),
                           ActionDueNote(label: "Còn 36 ngày", urgency: .later),
                           "a later row read wrong for a device in \(id)")
            XCTAssertNil(ActionQueueRules.dueNote(nil, now: today, calendar: calendar))
            XCTAssertNil(ActionQueueRules.dueNote("không phải ngày", now: today, calendar: calendar))
        }
    }

    func testMoneyIsDecodedAsInt64AndNeverNarrowed() throws {
        // 4,2 tỷ — the class of value an Int32 field would silently break on.
        let amount: Int64 = 4_294_967_296
        let json = """
        {"itemKey": "SUBSCRIPTION_RENEWING_NO_CANCEL_URL:s1",
         "kind": "SUBSCRIPTION_RENEWING_NO_CANCEL_URL", "severity": "MEDIUM",
         "title": "t", "detail": "d", "subscriptionId": "s1", "amountVnd": \(amount)}
        """
        let decoded = try APIClient.decoder.decode(ActionItem.self, from: Data(json.utf8))

        XCTAssertEqual(decoded.amountVnd, amount)
        XCTAssertTrue(ActionQueueRules.hasAmount(decoded))
        XCTAssertEqual(ActionQueueRules.dateLabel("2026-03-20T00:00:00"), "20/03/2026")
        XCTAssertNil(ActionQueueRules.dateLabel("2026-3-2"))
    }

    // MARK: - Snooze choices

    func testEverySnoozeChoiceIsInsideTheServersWindowAndOneIsTheDefault() {
        XCTAssertFalse(ActionQueueRules.snoozeChoices.isEmpty)
        for choice in ActionQueueRules.snoozeChoices {
            XCTAssertTrue(ActionQueueRules.isValidSnoozeDays(choice.days),
                          "\(choice.days) ngày is outside the server's 1–365 window")
            XCTAssertFalse(choice.label.isEmpty)
        }
        XCTAssertTrue(ActionQueueRules.snoozeChoices.contains { $0.days == 90 })
        XCTAssertEqual(ActionQueueRules.snoozeChoices.first { $0.days == 90 }?.label,
                       "3 tháng (mặc định)")
        XCTAssertFalse(ActionQueueRules.isValidSnoozeDays(0))
        XCTAssertFalse(ActionQueueRules.isValidSnoozeDays(366))
        XCTAssertEqual(ActionQueueRules.snoozeDaysDefault, 90)
    }

    // MARK: - Copy

    func testSnoozeConfirmationEchoesTheServersOwnDuration() throws {
        let result = try APIClient.decoder.decode(SnoozeResult.self, from: Data("""
        {"itemKey": "WARRANTY_EXPIRED:w1", "snoozedUntil": "2026-06-13T00:00:00Z", "days": 90}
        """.utf8))

        XCTAssertEqual(ActionQueueRules.snoozeConfirmation(result),
                       "Đã hoãn 90 ngày — việc này hiện lại 13/06/2026")
    }

    func testSubtitleIsBuiltFromCountsNotRows() {
        XCTAssertEqual(ActionQueueRules.subtitle(counts: 3, snoozed: 0), "3 việc cần xử lý")
        XCTAssertEqual(ActionQueueRules.subtitle(counts: 3, snoozed: 2),
                       "3 việc cần xử lý · 2 việc đang hoãn")
        XCTAssertEqual(ActionQueueRules.subtitle(counts: 0, snoozed: 0), "Không còn việc nào")
    }

    /// The dashboard's row makes no claim it cannot support: a failed read shows
    /// no number instead of a confident "0 việc".
    func testEntrySubtitleNeverInventsZeroOnAFailedRead() {
        XCTAssertEqual(ActionQueueRules.entrySubtitle(counts: nil),
                       "Mở hàng đợi việc app tự suy ra từ dữ liệu của bạn")
        XCTAssertEqual(ActionQueueRules.entrySubtitle(counts: ActionCounts(total: 0, high: 0, medium: 0, low: 0)),
                       "Không có việc nào đang chờ xử lý")
        XCTAssertEqual(ActionQueueRules.entrySubtitle(counts: ActionCounts(total: 4, high: 1, medium: 2, low: 1)),
                       "4 việc cần xử lý · 1 mức cao")
    }
}
