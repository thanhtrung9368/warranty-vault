import Foundation
import XCTest
@testable import WarrlyKit

/// The extract-request shape: the contract accepts a multipart `file` or a JSON
/// `attachmentId`, and only the latter can persist the OCR transcript. The scan
/// flow uploads first, so this suite pins the branch it relies on.
final class ReceiptExtractTests: XCTestCase {

    func testAttachmentInputTrimsTheIdAndBuildsTheJSONBody() {
        let input = ReceiptExtractInput(attachmentId: "  att_1\n")

        XCTAssertEqual(input, .attachment(id: "att_1"))
        XCTAssertEqual(input.attachmentId, "att_1")
        XCTAssertEqual(input.attachmentBody, ReceiptExtractAttachmentBody(attachmentId: "att_1"))
        XCTAssertTrue(input.storesExtractedText,
                      "the attachmentId branch is the only one that persists the transcript")
        XCTAssertTrue(input.isReadyToSend)
    }

    func testBlankAttachmentIdIsNotSendable() {
        let input = ReceiptExtractInput(attachmentId: "   \n\t ")

        XCTAssertEqual(input.attachmentId, "")
        XCTAssertFalse(input.isReadyToSend,
                       "a blank id would become {\"attachmentId\":\"\"} and spend a round trip on a 404")
    }

    func testFileInputDoesNotPretendToStoreExtractedText() {
        let input = ReceiptExtractInput.file(
            fileName: "receipt.jpg", fileType: "image/jpeg", data: Data([0xFF, 0xD8, 0xFF])
        )

        XCTAssertNil(input.attachmentId)
        XCTAssertNil(input.attachmentBody)
        XCTAssertFalse(input.storesExtractedText,
                       "multipart has no Attachment row, so the server cannot persist the text")
        XCTAssertTrue(input.isReadyToSend)
    }

    func testIncompleteFileInputIsNotSendable() {
        XCTAssertFalse(ReceiptExtractInput.file(
            fileName: "", fileType: "image/jpeg", data: Data([1])
        ).isReadyToSend)
        XCTAssertFalse(ReceiptExtractInput.file(
            fileName: "receipt.jpg", fileType: "", data: Data([1])
        ).isReadyToSend)
        XCTAssertFalse(ReceiptExtractInput.file(
            fileName: "receipt.jpg", fileType: "image/jpeg", data: Data()
        ).isReadyToSend)
    }

    func testTheJSONBodyContainsOnlyTheAttachmentId() throws {
        let body = ReceiptExtractAttachmentBody(attachmentId: "att_1")
        let data = try APIClient.encoder.encode(body)
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        XCTAssertEqual(object.keys.sorted(), ["attachmentId"])
        XCTAssertEqual(object["attachmentId"] as? String, "att_1")
    }
}
