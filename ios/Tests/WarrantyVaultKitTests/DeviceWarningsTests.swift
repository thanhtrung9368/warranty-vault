import Foundation
import XCTest
@testable import WarrantyVaultKit

/// `warnings` on `POST`/`PATCH /api/v1/devices` and inside the AI receipt draft.
///
/// The contract is "saved, but this looks wrong": the device exists, the value
/// was kept, and the only correct client behaviour is a yellow advisory.
final class DeviceWarningsTests: KitTestCase {

    // MARK: - Decoding the save envelope

    func testCreateResponseKeepsTheDeviceAndItsWarnings() async throws {
        StubURLProtocol.install(.json(#"""
        {"device": {"id": "dev_1", "name": "iPhone 16", "category": "phone",
                    "purchaseDate": "2026-03-01T00:00:00Z", "purchasePrice": 22990000,
                    "status": "ACTIVE", "serialNumber": "356938035643809"},
         "warnings": [{"code": "IMEI_CHECKSUM", "field": "serialNumber",
                       "message": "IMEI đủ 15 chữ số nhưng sai số kiểm tra — có thể gõ nhầm một chữ số."}]}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        var input = DeviceInput(name: "iPhone 16", category: "phone", purchaseDate: "2026-03-01")
        input.serialNumber = "356938035643809"
        let result = try await client.createDevice(input)

        XCTAssertEqual(result.device.id, "dev_1", "the device was created — this is not a failure")
        XCTAssertEqual(result.device.serialNumber, "356938035643809",
                       "the warned-about value is kept, never dropped")
        XCTAssertEqual(result.warningsOrEmpty.count, 1)
        XCTAssertEqual(result.warningsOrEmpty[0].code, "IMEI_CHECKSUM")
        XCTAssertEqual(result.warningsOrEmpty[0].field, "serialNumber")
        XCTAssertEqual(result.warningsOrEmpty[0].codeKind, .IMEI_CHECKSUM)
        XCTAssertEqual(result.warningsOrEmpty[0].fieldLabel, "Serial / IMEI")

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/v1/devices")
    }

    func testUpdateResponseCarriesWarningsForTheEditedDevice() async throws {
        StubURLProtocol.install(.json(#"""
        {"device": {"id": "dev_9", "name": "Máy lọc nước", "category": "appliance",
                    "purchaseDate": "2026-01-02T00:00:00Z", "purchasePrice": 8000000,
                    "status": "ACTIVE", "serialNumber": "SN-12345"},
         "warnings": [{"code": "SERIAL_DUPLICATE", "field": "serialNumber",
                       "message": "Serial này đã có ở một thiết bị khác của bạn."}]}
        """#))
        let client = makeStubbedClient(token: "tok_abc")

        let result = try await client.updateDevice(id: "dev_9", DeviceInput(
            name: "Máy lọc nước", category: "appliance", purchaseDate: "2026-01-02"
        ))

        XCTAssertEqual(result.device.id, "dev_9")
        XCTAssertEqual(result.warningsOrEmpty.map(\.code), ["SERIAL_DUPLICATE"])

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PATCH")
        XCTAssertEqual(request.url?.path, "/api/v1/devices/dev_9")
    }

    func testEmptyAndAbsentWarningArraysBothReadAsNothingToShow() async throws {
        let client = makeStubbedClient(token: "tok_abc")
        let input = DeviceInput(name: "iPad", category: "tablet", purchaseDate: "2026-03-01")

        StubURLProtocol.install(.json(#"""
        {"device": {"id": "dev_1", "name": "iPad", "category": "tablet",
                    "purchaseDate": "2026-03-01T00:00:00Z", "purchasePrice": 0,
                    "status": "ACTIVE"},
         "warnings": []}
        """#))
        let empty = try await client.createDevice(input)
        XCTAssertTrue(empty.warningsOrEmpty.isEmpty)

        StubURLProtocol.install(.json(#"""
        {"device": {"id": "dev_1", "name": "iPad", "category": "tablet",
                    "purchaseDate": "2026-03-01T00:00:00Z", "purchasePrice": 0,
                    "status": "ACTIVE"}}
        """#))
        let absent = try await client.createDevice(input)
        XCTAssertTrue(absent.warningsOrEmpty.isEmpty,
                      "an omitted array can't fail the save response")
    }

    // MARK: - Message + field rendering

    func testDisplayMessagePrefersTheServersOwnVietnameseSentence() {
        let warning = DeviceWarning(
            code: "IMEI_LENGTH", field: "serialNumber",
            message: "Chuỗi 16 chữ số không phải IMEI 15 chữ số — kiểm tra lại giúp mình nhé."
        )
        XCTAssertEqual(warning.displayMessage,
                       "Chuỗi 16 chữ số không phải IMEI 15 chữ số — kiểm tra lại giúp mình nhé.")
    }

    func testDisplayMessageFallsBackOnlyWhenTheServerSentNothing() {
        XCTAssertEqual(
            DeviceWarning(code: "IMEI_LENGTH", field: "serialNumber", message: "").displayMessage,
            DeviceWarningCode.IMEI_LENGTH.fallbackMessage
        )
        XCTAssertEqual(
            DeviceWarning(code: "IMEI_CHECKSUM", field: "serialNumber", message: "   ").displayMessage,
            DeviceWarningCode.IMEI_CHECKSUM.fallbackMessage
        )
        // An unknown code with no message still says something.
        XCTAssertEqual(
            DeviceWarning(code: "SERIAL_WEIRD", field: "serialNumber", message: "").displayMessage,
            "SERIAL_WEIRD"
        )
    }

    func testEveryDocumentedCodeHasAVietnameseLabelAndFallback() {
        XCTAssertEqual(DeviceWarningCode.allCases.count, 3)
        for code in DeviceWarningCode.allCases {
            XCTAssertFalse(code.label.isEmpty)
            XCTAssertFalse(code.fallbackMessage.isEmpty,
                           "\(code.rawValue) needs copy for an empty server message")
            XCTAssertEqual(code, DeviceWarningCode(rawValue: code.rawValue))
        }
        XCTAssertNil(DeviceWarning(code: "SOMETHING_NEW", field: "serialNumber", message: "x").codeKind,
                     "an unknown code must not crash the banner")
    }

    func testFieldLabelIsReadableEvenForAnUnexpectedField() {
        XCTAssertEqual(DeviceWarningRules.fieldLabel("serialNumber"), "Serial / IMEI")
        XCTAssertEqual(DeviceWarningRules.fieldLabel(""), "Thiết bị")
        XCTAssertEqual(DeviceWarningRules.fieldLabel("imei"), "imei",
                       "an unknown field prints as-is rather than being invented")
    }

    // MARK: - AI draft

    func testDraftCarriesItsOwnWarningsAlongsideUnmatched() throws {
        let draft = try APIClient.decoder.decode(DraftDevice.self, from: Data(#"""
        {"name": "iPhone 16", "category": "phone", "brand": "Apple", "brandId": null,
         "model": "16 Pro", "serialNumber": "356938035643809", "purchaseDate": "2026-03-01",
         "purchasePrice": 22990000, "purchasePlace": "CellphoneS", "storeId": null,
         "warrantyMonths": 12, "warrantyProviderId": null,
         "confidence": "high", "unmatched": ["purchasePlace"],
         "warnings": [{"code": "IMEI_CHECKSUM", "field": "serialNumber",
                       "message": "IMEI đủ 15 chữ số nhưng sai số kiểm tra."}]}
        """#.utf8))

        XCTAssertEqual(draft.unmatched, ["purchasePlace"],
                       "unmatched = fields the extractor could not use")
        XCTAssertEqual(draft.warningsOrEmpty.map(\.code), ["IMEI_CHECKSUM"],
                       "warnings = fields that WERE used and look wrong")
        XCTAssertEqual(draft.serialNumber, "356938035643809",
                       "a warned serial is still filled into the form")
    }

    func testDraftWithoutAWarningsKeyStillDecodes() throws {
        let draft = try APIClient.decoder.decode(DraftDevice.self, from: Data(#"""
        {"name": null, "category": null, "brand": null, "brandId": null, "model": null,
         "serialNumber": null, "purchaseDate": null, "purchasePrice": null,
         "purchasePlace": null, "storeId": null, "warrantyMonths": null,
         "warrantyProviderId": null, "confidence": "low", "unmatched": []}
        """#.utf8))

        XCTAssertTrue(draft.warningsOrEmpty.isEmpty)
    }

    // MARK: - Copy

    func testAdvisoryCopySaysTheSaveSucceededAndIsNotAnError() {
        XCTAssertTrue(DeviceWarningCopy.savedNote.contains("đã được lưu"))
        XCTAssertTrue(DeviceWarningCopy.savedNote.lowercased().contains("không phải lỗi"))
        XCTAssertNotEqual(DeviceWarningCopy.draftWarningsNote, DeviceWarningCopy.draftUnmatchedNote,
                          "used-but-suspect and could-not-use must not read the same")
    }
}
