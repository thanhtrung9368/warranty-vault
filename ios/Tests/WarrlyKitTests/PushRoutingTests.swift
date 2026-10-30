import Foundation
import XCTest
@testable import WarrlyKit

/// Push-tap routing and the one-time notification-permission offer.
///
/// The rule this file exists to pin is the negative one: a notification whose
/// `url` is missing, malformed, or names a screen this build does not have must
/// open **nothing**. "Leave the app on whatever tab it was on" is a bug, but
/// "open a device the user did not tap" is a worse one, and the difference
/// between the two is entirely in this parser.
final class PushRoutingTests: XCTestCase {

    // MARK: - The two paths the server actually sends

    func testTheWarrantyURLTheCronSendsOpensTheDevice() {
        // `api/internal/cron/run.go`: URL = fmt.Sprintf("/devices/%s", deviceId)
        XCTAssertEqual(PushDestination.parse("/devices/dev_42"), .device("dev_42"))
    }

    func testTheSubscriptionRenewalURLOpensTheSubscription() {
        // Same file: URL = fmt.Sprintf("/subscriptions/%s", id)
        XCTAssertEqual(PushDestination.parse("/subscriptions/sub_9"), .subscription("sub_9"))
    }

    func testTheWishlistTargetDateURLOpensTheWishlistItem() {
        // `api/internal/cron/run.go` sends the same shape for both wishlist
        // notifications (target date and check-in):
        // URL = fmt.Sprintf("/wishlist/%s", it.ID)
        XCTAssertEqual(PushDestination.parse("/wishlist/w_1"), .wishlist("w_1"))
        XCTAssertEqual(PushDestination.parse("/wishlist/w_1/"), .wishlist("w_1"))
    }

    func testAQueryStringOrFragmentIsNeverPartOfTheID() {
        XCTAssertEqual(PushDestination.parse("/devices/dev_42?utm=push"), .device("dev_42"))
        XCTAssertEqual(PushDestination.parse("/devices/dev_42#top"), .device("dev_42"))
    }

    func testATrailingSlashIsTolerated() {
        // The server builds the path without one, but a proxy rewriting it must
        // not turn a working push into a dead tap.
        XCTAssertEqual(PushDestination.parse("/devices/dev_42/"), .device("dev_42"))
    }

    // MARK: - Unknown, malformed, and deliberately unhandled

    func testAWishlistPathWithoutExactlyOneIDOpensNothing() {
        // The positive route must not be a prefix match: `/wishlist/` has no
        // id, and `/wishlist/a/b` is a different shape that a future route
        // could own. Guessing either into the first id is how the wrong item
        // opens.
        XCTAssertNil(PushDestination.parse("/wishlist/"))
        XCTAssertNil(PushDestination.parse("/wishlist/a/b"))
    }

    func testAnythingThatIsNotTheDocumentedShapeOpensNothing() {
        XCTAssertNil(PushDestination.parse(""))
        XCTAssertNil(PushDestination.parse("   "))
        XCTAssertNil(PushDestination.parse("/devices"))
        XCTAssertNil(PushDestination.parse("/devices/"))
        XCTAssertNil(PushDestination.parse("/devices/dev_42/extra"))
        XCTAssertNil(PushDestination.parse("/settings/dev_42"))
        // Not site-rooted. A bare path is not the contract, and guessing here is
        // how the wrong screen opens.
        XCTAssertNil(PushDestination.parse("devices/dev_42"))
    }

    func testTheAppsOwnDeepLinkSchemeIsNotAPushDestination() {
        // `warrly://device/<id>` is `WarrlyDeepLink`'s shape, handled by
        // `AppRouter.open(_:)`. Its path has one component, so it must not fall
        // through to the device route here.
        XCTAssertNil(PushDestination.parse("warrly://device/dev_42"))
    }

    func testAnAbsoluteURLIsReadByItsPath() {
        XCTAssertEqual(PushDestination.parse("https://api.warrly.com/devices/dev_42"),
                       .device("dev_42"))
        XCTAssertEqual(PushDestination.parse("https://api.warrly.com/wishlist/w_1"),
                       .wishlist("w_1"))
        XCTAssertNil(PushDestination.parse("https://api.warrly.com/wishlist/w_1/extra"))
    }

    // MARK: - userInfo

    func testTheURLIsReadFromTheTopLevelUserInfoKey() {
        XCTAssertEqual(PushDestination.from(userInfo: ["url": "/devices/dev_42"]),
                       .device("dev_42"))
        XCTAssertEqual(PushDestination.from(userInfo: ["url": "/devices/dev_42", "tag": "x"]),
                       .device("dev_42"))
    }

    func testAMissingOrNonStringURLIsNoDestination() {
        XCTAssertNil(PushDestination.from(userInfo: [:]))
        XCTAssertNil(PushDestination.from(userInfo: ["deviceId": "dev_42"]))
        XCTAssertNil(PushDestination.from(userInfo: ["url": 42]))
        XCTAssertNil(PushDestination.from(userInfo: ["url": ["path": "/devices/dev_42"]]))
    }

    // MARK: - Notification permission primer

    func testThePrimerIsOfferedOnlyWhileTheSystemDecisionIsOpen() {
        XCTAssertTrue(NotificationPrimerRules.shouldOffer(permission: .notDetermined,
                                                          alreadyOffered: false))
        XCTAssertFalse(NotificationPrimerRules.shouldOffer(permission: .notDetermined,
                                                           alreadyOffered: true))
        // A granted or refused user is never asked again — the Settings toggle
        // is the only place left to change a refusal.
        XCTAssertFalse(NotificationPrimerRules.shouldOffer(permission: .authorized,
                                                           alreadyOffered: false))
        XCTAssertFalse(NotificationPrimerRules.shouldOffer(permission: .denied,
                                                           alreadyOffered: false))
    }
}
