import CoreGraphics
import XCTest
@testable import WarrlyKit

// The tab shell's bottom clearance. It is a layout value, but a load-bearing
// one: it is what stops the last row of a screen from sitting against the
// floating tab bar, and it replaced a per-screen trailing spacer that a new
// screen could forget. Pinning it here makes a change to that margin a
// deliberate edit with a failing test behind it, not a drive-by tweak.
final class ScreenMetricsTests: XCTestCase {

    func testTabBarContentInsetIsTheDesignedClearance() {
        XCTAssertEqual(ScreenMetrics.tabBarContentInset, 24)
    }

    func testTabBarContentInsetLeavesRoomForTheBar() {
        // Anything at or below zero means the shell stopped reserving space and
        // screens are back to ending flush against the bar.
        XCTAssertGreaterThan(ScreenMetrics.tabBarContentInset, 0)
    }
}
