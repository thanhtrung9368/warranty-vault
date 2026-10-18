import Foundation
import XCTest
@testable import WarrlyKit

/// The pure inbox rules: the nav badge, what "unfiled" means, and how a failed
/// `POST /api/v1/attachments/{id}/file` is turned into copy the screen can show.
///
/// The 409 case is the reason this file exists at all: reporting it as a generic
/// error sends the user back to the same full device, which can never work.
final class InboxRulesTests: XCTestCase {

    override func tearDown() {
        L.language = nil
        super.tearDown()
    }

    private func attachment(id: String = "att_1", deviceId: String?) -> AttachmentMeta {
        AttachmentMeta(
            id: id,
            fileName: "hoa-don-\(id).jpg",
            fileType: "image/jpeg",
            fileSize: 1024,
            description: nil,
            uploadedAt: Date(timeIntervalSince1970: 0),
            deviceId: deviceId
        )
    }

    private func envelope(_ json: String) throws -> APIErrorEnvelope {
        try APIClient.decoder.decode(APIErrorEnvelope.self, from: Data(json.utf8))
    }

    // MARK: - Count badge

    func testBadgeIsHiddenWhenNothingIsWaiting() {
        XCTAssertNil(InboxRules.badgeText(for: 0))
        XCTAssertNil(InboxRules.badgeText(for: -3))
    }

    func testBadgeShowsSmallCountsVerbatimAndCapsAt99Plus() {
        XCTAssertEqual(InboxRules.badgeText(for: 1), "1")
        XCTAssertEqual(InboxRules.badgeText(for: 9), "9")
        XCTAssertEqual(InboxRules.badgeText(for: 99), "99")
        XCTAssertEqual(InboxRules.badgeText(for: 100), "99+")
        XCTAssertEqual(InboxRules.badgeText(for: 5_000), "99+")
    }

    func testBadgeCountsOnlyUnfiledRows() {
        let rows = [
            attachment(id: "a1", deviceId: nil),
            attachment(id: "a2", deviceId: ""),
            attachment(id: "a3", deviceId: "   "),
            attachment(id: "a4", deviceId: "dev_1"),
        ]

        XCTAssertEqual(InboxRules.unfiledCount(rows), 3)
        XCTAssertEqual(InboxRules.badgeText(for: rows), "3")
    }

    // MARK: - Unfiled determination

    func testNilBlankAndWhitespaceAreUnfiledWhileARealDeviceIsNot() {
        XCTAssertTrue(InboxRules.isUnfiled(attachment(deviceId: nil)))
        XCTAssertTrue(InboxRules.isUnfiled(attachment(deviceId: "")))
        XCTAssertTrue(InboxRules.isUnfiled(attachment(deviceId: " \n\t ")))
        XCTAssertFalse(InboxRules.isUnfiled(attachment(deviceId: "dev_1")))

        XCTAssertFalse(InboxRules.isFiled(attachment(deviceId: nil)))
        XCTAssertTrue(InboxRules.isFiled(attachment(deviceId: "dev_1")))
    }

    // MARK: - Filed vs inbox value

    /// The search group and the inbox must answer "where is this file?" the same
    /// way. This is the single rule both use, so a hit with `deviceId: null`
    /// renders as an inbox row instead of as a file with an empty device name.
    func testFilingResolvesNilAndBlankToInboxAndTrimsARealDevice() {
        XCTAssertEqual(InboxRules.filing(deviceId: nil), .inbox)
        XCTAssertEqual(InboxRules.filing(deviceId: ""), .inbox)
        XCTAssertEqual(InboxRules.filing(deviceId: " \n "), .inbox)
        XCTAssertEqual(InboxRules.filing(deviceId: " dev_1\t"), .filed(deviceId: "dev_1"))

        XCTAssertTrue(AttachmentFiling.inbox.isInbox)
        XCTAssertNil(AttachmentFiling.inbox.deviceId)
        XCTAssertEqual(AttachmentFiling.filed(deviceId: "dev_1").deviceId, "dev_1")
        XCTAssertFalse(AttachmentFiling.filed(deviceId: "dev_1").isInbox)

        // The row convenience is exactly the same decision.
        XCTAssertEqual(InboxRules.filing(attachment(deviceId: nil)), .inbox)
        XCTAssertEqual(InboxRules.filing(attachment(deviceId: "dev_1")),
                       .filed(deviceId: "dev_1"))
    }

    func testFilingLabelsFollowTheSelectedLanguage() {
        L.withLanguage(.vi) {
            XCTAssertEqual(AttachmentFiling.inbox.label, "Trong hộp thư")
            XCTAssertEqual(AttachmentFiling.filed(deviceId: "dev_1").label, "Đã gắn thiết bị")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(AttachmentFiling.inbox.label, "In inbox")
            XCTAssertEqual(AttachmentFiling.filed(deviceId: "dev_1").label, "Filed to a device")
        }
    }

    // MARK: - 409 → user-facing message

    func testLimitReachedMapsToDeviceFullWithBothWaysOut() throws {
        // The REAL wire value is lowercase: the Go handler lowercases the
        // service code before writing the envelope (`{"error":"limit_reached"}`),
        // and openapi documents that lowercase form. Pinning it here is what
        // makes the "device is full" way out reachable against the real server.
        let error = APIError.server(status: 409, envelope: try envelope(#"""
        {"error": "limit_reached", "message": "Thiết bị đã có 5 tệp đính kèm"}
        """#))

        let failure = InboxRules.fileFailure(error)

        XCTAssertEqual(failure, .deviceFull)
        XCTAssertTrue(failure.isDeviceFull)
        XCTAssertFalse(failure.isAttachmentNotFound)

        L.withLanguage(.en) {
            XCTAssertEqual(failure.title, "Device is full")
            // The server's own message is deliberately NOT reused here: it says
            // what happened but not what the user can do about it.
            XCTAssertNotEqual(failure.message, "Thiết bị đã có 5 tệp đính kèm")
            XCTAssertTrue(failure.message.contains("5 attachments"))
            XCTAssertTrue(failure.message.contains("Pick another device"))
            XCTAssertTrue(failure.message.contains("delete"))
        }

        L.withLanguage(.vi) {
            XCTAssertEqual(failure.title, "Thiết bị đã đầy")
            XCTAssertTrue(failure.message.contains("Chọn thiết bị khác"))
            XCTAssertTrue(failure.message.contains("xoá tệp này"))
        }
    }

    func testA409WithAnotherCodeKeepsTheServerMessage() throws {
        let error = APIError.server(status: 409, envelope: try envelope(#"""
        {"error": "CONFLICT", "message": "Tệp đang được xử lý ở nơi khác"}
        """#))

        let failure = InboxRules.fileFailure(error)

        XCTAssertEqual(failure, .other("Tệp đang được xử lý ở nơi khác"))
        XCTAssertFalse(failure.isDeviceFull)
        XCTAssertEqual(failure.message, "Tệp đang được xử lý ở nơi khác")
    }

    func testTheUppercaseDocumentedSpellingIsAlsoAccepted() throws {
        // `openapi.yaml`'s endpoint description says `LIMIT_REACHED` while the
        // shared error schema (and the actual handler) emit lowercase. Accept
        // both so a future server that stops lowercasing cannot silently turn
        // the device-full state back into a generic conflict.
        let error = APIError.server(status: 409, envelope: try envelope(#"""
        {"error": "LIMIT_REACHED", "message": "Thiết bị đã có 5 tệp đính kèm"}
        """#))

        XCTAssertEqual(InboxRules.fileFailure(error), .deviceFull)
    }

    func testNotFoundMeansTheRowIsGoneRatherThanFull() throws {
        let error = APIError.server(status: 404, envelope: try envelope(#"""
        {"error": "not_found", "message": "Không tìm thấy"}
        """#))

        let failure = InboxRules.fileFailure(error)

        XCTAssertEqual(failure, .attachmentNotFound)
        XCTAssertTrue(failure.isAttachmentNotFound)
        XCTAssertFalse(failure.isDeviceFull)
        L.withLanguage(.en) {
            XCTAssertEqual(failure.title, "File not found")
            XCTAssertTrue(failure.message.contains("deleted"))
        }
    }

    func testTransportFailureKeepsTheLocalizedDescription() {
        let failure = InboxRules.fileFailure(APIError.transport("Mất kết nối"))

        XCTAssertEqual(failure, .other("Mất kết nối"))
        XCTAssertFalse(failure.isDeviceFull)
        XCTAssertEqual(failure.message, "Mất kết nối")
    }
}
