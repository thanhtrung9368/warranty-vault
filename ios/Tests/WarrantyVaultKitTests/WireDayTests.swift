import Foundation
import XCTest
@testable import WarrantyVaultKit

/// `WireDay` — the shared "wire calendar day ⇄ the day on screen" round trip,
/// and the two hardcoded-zone formatters it replaced.
///
/// History, because it is the whole point of this file: `yyyy-MM-dd` was written
/// through a `DateFormatter` pinned to `Asia/Ho_Chi_Minh` (`WVFormat.isoDay` /
/// `parseDay` in the app), and through a second one pinned to `UTC`
/// (`ISO8601DateFormatter.dayOnly`). Neither is the zone the user is looking at,
/// so both moved the calendar day:
///
///   * the Vietnam pin stored the day **before** the one picked, for every device
///     east of UTC+7;
///   * the UTC pin did the same for every device east of UTC — Ho Chi Minh City
///     included, since UTC+7 midnight is 17:00 the previous day in UTC.
///
/// A test that ran only in the machine's own zone would have passed for both.
/// Every assertion below either runs in all six zones or names the zone whose
/// day the old formatter got wrong.
final class WireDayTests: KitTestCase {

    /// The zones that break a hardcoded one: UTC−11, UTC−7, UTC, UTC+7, UTC+9,
    /// UTC+14. Same six `DeviceResaleTests` pins the resale pair across.
    private let extremeZones = ["Pacific/Midway", "America/Los_Angeles", "UTC",
                                "Asia/Ho_Chi_Minh", "Asia/Tokyo", "Pacific/Kiritimati"]

    private func zone(_ id: String) throws -> TimeZone {
        try XCTUnwrap(TimeZone(identifier: id), "unknown zone \(id)")
    }

    /// The `Date` a date picker on a device in `id` holds after the user picks
    /// `day`: midnight *there*. Built by `makeDate` rather than by `WireDay`, so
    /// the fixture does not come from the code under test.
    private func pickerDate(_ day: String, in id: String) throws -> Date {
        makeDate(day, format: "yyyy-MM-dd", timeZone: try zone(id))
    }

    // MARK: - The formatters this pass removed

    /// A `yyyy-MM-dd` formatter pinned to one hardcoded zone — the shape both
    /// `WVFormat.isoFormatter` and `ISO8601DateFormatter.dayOnly` had. Kept here
    /// so the tests can state what those did, in days, rather than in prose.
    private func pinned(_ id: String) -> DateFormatter {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = TimeZone(identifier: id)
        return f
    }

    // MARK: - The round trip, in every zone

    /// The contract: a Z-less wire day becomes the `Date` a picker shows, and
    /// that `Date` goes back to the wire as the very same day — in every zone.
    func testAWireDayRoundTripsExactlyInEveryDeviceZone() throws {
        for id in extremeZones {
            let date = try XCTUnwrap(WireDay.date(from: "2026-03-02T00:00:00", in: try zone(id)),
                                     "no picker date in \(id)")
            XCTAssertEqual(WireDay.string(from: date, in: try zone(id)), "2026-03-02",
                           "the calendar day drifted for a device in \(id)")
        }
    }

    /// …and it is not decoration: the same stored day is a different instant in
    /// each zone, so reading and writing it anywhere but the device's own zone
    /// cannot round trip.
    func testTheWireDayIsReadInTheGivenZoneAndNotInAHardcodedOne() throws {
        let utc = try zone("UTC")
        let la = try zone("America/Los_Angeles")

        let midnightUTC = try XCTUnwrap(WireDay.date(from: "2026-03-02T00:00:00", in: utc))
        let midnightLA = try XCTUnwrap(WireDay.date(from: "2026-03-02T00:00:00", in: la))

        XCTAssertNotEqual(midnightUTC, midnightLA, "the zone argument must be honoured")
        XCTAssertEqual(WireDay.string(from: midnightUTC, in: utc), "2026-03-02")
        XCTAssertEqual(WireDay.string(from: midnightLA, in: la), "2026-03-02")
    }

    // MARK: - Display direction: a stored day → a date picker

    /// The OCR-draft path (`DeviceFormView.applyDraft`) and the resale pair both
    /// put a stored day into a picker. The picker draws its `Date` in the device's
    /// zone, so the day it shows is the day the server holds — everywhere.
    func testAStoredDayIsShownAsTheSameDayInEveryZone() throws {
        for id in extremeZones {
            let date = try XCTUnwrap(WireDay.date(from: "2026-03-02", in: try zone(id)))
            // What the picker renders is that `Date` in its own zone.
            XCTAssertEqual(WireDay.string(from: date, in: try zone(id)), "2026-03-02",
                           "a receipt dated the 2nd showed as another day in \(id)")
        }
    }

    /// The bug this test file exists for, stated as days: the Vietnam-pinned
    /// **parse** put the stored day on the 1st for anyone west of UTC+7 — a Los
    /// Angeles user's picker showed the day before the receipt.
    func testTheVietnamPinnedParseUsedToShowThePreviousDayWestOfUTC7() throws {
        let la = try zone("America/Los_Angeles")
        let legacy = try XCTUnwrap(pinned("Asia/Ho_Chi_Minh").date(from: "2026-03-02"))
        XCTAssertEqual(WireDay.string(from: legacy, in: la), "2026-03-01",
                       "the old formatter is only interesting because it was wrong")

        // The fix: read in the zone the picker draws in.
        let fixed = try XCTUnwrap(WireDay.date(from: "2026-03-02", in: la))
        XCTAssertEqual(WireDay.string(from: fixed, in: la), "2026-03-02")
    }

    /// And the same for the `soldAt`-shaped value, which is what the resale path
    /// and `DeviceReturnWindow` reduce to a day.
    func testAnRFC3339StoredDayIsAlsoShownAsTheSameDay() throws {
        for id in extremeZones {
            let date = try XCTUnwrap(WireDay.date(from: "2026-03-02T23:30:00Z", in: try zone(id)))
            XCTAssertEqual(WireDay.string(from: date, in: try zone(id)), "2026-03-02",
                           "the day prefix, not the instant, is what is shown — \(id)")
        }
    }

    // MARK: - Write direction: a date picker → the wire

    /// The direction that silently stores a wrong day: a picked day re-formatted
    /// through a hardcoded zone.
    ///
    /// Stated first as the two former bugs, in zones where they bite.
    func testTheTwoHardcodedZonesStoredTheDayBeforeTheOnePicked() throws {
        // A Tokyo (UTC+9) user picks the 2nd. The Vietnam pin wrote the 1st:
        // 2026-03-02T00:00+09:00 is 2026-03-01T22:00 in Ho Chi Minh City.
        let tokyo = try pickerDate("2026-03-02", in: "Asia/Tokyo")
        XCTAssertEqual(pinned("Asia/Ho_Chi_Minh").string(from: tokyo), "2026-03-01")

        // And the UTC pin did it to Vietnam itself: a Ho Chi Minh City (UTC+7)
        // user picking the 2nd had 2026-03-01T17:00Z written — the 1st.
        let hcmc = try pickerDate("2026-03-02", in: "Asia/Ho_Chi_Minh")
        XCTAssertEqual(pinned("UTC").string(from: hcmc), "2026-03-01")
    }

    /// The fix, in all six zones: the day picked is the day written.
    func testAPickedDayIsWrittenUnchangedInEveryDeviceZone() throws {
        for id in extremeZones {
            let picked = try pickerDate("2026-03-02", in: id)
            XCTAssertEqual(WireDay.string(from: picked, in: try zone(id)), "2026-03-02",
                           "the day the user picked changed on save in \(id)")
        }
    }

    /// The same rule at the wire level, for every date a picker feeds: the device
    /// form's purchase date, a warranty's start date, a subscription's start and
    /// renewal dates, a logged payment, and a wishlist target. These are the exact
    /// `*Input` structs the screens build, encoded with the app's own encoder —
    /// a mapping helper that is never encoded proves nothing about the body.
    func testEveryPickedDayReachesTheWireUnchangedInEveryDeviceZone() throws {
        for id in extremeZones {
            let z = try zone(id)
            let picked = try pickerDate("2026-03-02", in: id)
            let day = WireDay.string(from: picked, in: z)

            var renewal = SubscriptionInput(name: "iCloud+", billingCycle: .MONTHLY,
                                            price: 59_000, startedAt: day)
            renewal.renewalDate = day
            var target = WishlistInput(name: "AirPods Pro 2")
            target.targetDate = day

            let bodies: [(String, Data)] = [
                ("purchaseDate", try APIClient.encoder.encode(
                    DeviceInput(name: "iPhone 16", category: "PHONE", purchaseDate: day))),
                ("startDate", try APIClient.encoder.encode(
                    WarrantyInput(type: .STANDARD, startDate: day, months: 12))),
                ("startedAt", try APIClient.encoder.encode(
                    SubscriptionInput(name: "iCloud+", billingCycle: .MONTHLY,
                                      price: 59_000, startedAt: day))),
                ("renewalDate", try APIClient.encoder.encode(renewal)),
                ("paidAt", try APIClient.encoder.encode(
                    PaymentInput(amount: 59_000, paidAt: day))),
                ("targetDate", try APIClient.encoder.encode(target)),
            ]

            for (key, body) in bodies {
                let payload = try XCTUnwrap(
                    JSONSerialization.jsonObject(with: body) as? [String: Any])
                XCTAssertEqual(payload[key] as? String, "2026-03-02",
                               "\(key) slipped a day for a device in \(id): \(payload)")
            }
        }
    }

    /// A carry-back save — tapping a status, or re-saving a wishlist row — must
    /// give the server back the day it sent. The shared decoder reads a Z-less
    /// value in the device's zone, so this is where the UTC pin used to edit a
    /// date the user never touched.
    func testACarryBackSaveWritesTheDecodedDayBackUnchanged() throws {
        let json = #"""
        {"id": "dev_1", "name": "iPhone 16", "category": "PHONE",
         "purchaseDate": "2026-03-02T00:00:00", "purchasePrice": 30000000,
         "status": "ACTIVE"}
        """#
        let stored = try APIClient.decoder.decode(Device.self, from: Data(json.utf8))

        // `APIClient.decoder` reads the Z-less value in the device's own zone and
        // `WireDay` writes it back in that same zone — the round trip is exact
        // wherever the device is, so the day cannot drift on a status tap.
        XCTAssertEqual(WireDay.string(from: stored.purchaseDate), "2026-03-02")
        let body = try APIClient.encoder.encode(
            DeviceInput(name: stored.name, category: stored.category,
                        purchaseDate: WireDay.string(from: stored.purchaseDate)))
        let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(payload["purchaseDate"] as? String, "2026-03-02")
    }

    /// The same decode→encode identity for the two other carry-back paths
    /// (`SubscriptionsStore.setStatus`, `WishlistDetailView.wishInputFrom`).
    func testSubscriptionAndWishlistCarryBacksKeepTheirDays() throws {
        let subscription = try APIClient.decoder.decode(
            Subscription.self, from: Data(Fixtures.subscription.utf8))
        // The day written back is the day the row displays — computed here from
        // `Calendar` rather than from `WireDay`, so the two agree only if the
        // formatter really is using the device's zone.
        XCTAssertEqual(WireDay.string(from: subscription.startedAt),
                       deviceZoneDay(subscription.startedAt))
        XCTAssertEqual(WireDay.string(from: subscription.renewalDate),
                       deviceZoneDay(subscription.renewalDate))

        let item = try APIClient.decoder.decode(
            WishlistItem.self, from: Data(Fixtures.wishlistItem.utf8))
        let target = try XCTUnwrap(item.targetDate)
        XCTAssertEqual(WireDay.string(from: target), deviceZoneDay(target))
    }

    /// The day `date` falls on where the device is — computed from `Calendar`
    /// rather than from `WireDay`, so the two agree only if `WireDay` really is
    /// using the device's zone.
    private func deviceZoneDay(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    // MARK: - Degenerate input

    /// An unreadable day is never invented.
    func testUnreadableWireValuesProduceNoDate() {
        XCTAssertNil(WireDay.date(from: nil))
        XCTAssertNil(WireDay.date(from: ""))
        XCTAssertNil(WireDay.date(from: "   "))
        XCTAssertNil(WireDay.date(from: "không phải ngày"))
        XCTAssertNil(WireDay.date(from: "01/03/2026"))
        XCTAssertNil(WireDay.date(from: "2026-3-2"))
        XCTAssertNil(WireDay.date(from: "2026-03"))
    }

    /// `WireDay` is the single implementation: the resale helpers are the same
    /// round trip, not a second one that could drift from it.
    func testTheResaleHelpersAreTheSameRoundTrip() throws {
        let z = try zone("Pacific/Kiritimati")
        let date = try XCTUnwrap(WireDay.date(from: "2026-03-02T00:00:00", in: z))
        XCTAssertEqual(DeviceResale.dayDate("2026-03-02T00:00:00", in: z), date)
        XCTAssertEqual(DeviceResale.dayString(date, in: z), WireDay.string(from: date, in: z))
        XCTAssertEqual(DeviceResale.dayString(date, in: z), "2026-03-02")
    }
}
