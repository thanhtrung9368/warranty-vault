import Foundation
import XCTest
@testable import WarrlyKit

/// Warranty contract terms — the pure rules, plus the wire round trip.
///
/// The contract this is built against (frozen; the Go API is being implemented
/// in parallel):
///
///  * nine optional fields on `Warranty`: `component`, `scope`, `cap`,
///    `deductible`, `exclusions`, `region`, `transferable`, `claimsAllowed`,
///    `claimsUsed`;
///  * `claimsUsed` is the only non-nullable one, default `0`;
///  * all integers are non-negative VND / counts, and
///    `claimsUsed > claimsAllowed` is a 400 on `fieldErrors.claimsUsed`.
///
/// The presentation rules live in `WarrantyTerms`; this file pins them so the
/// form's collapsed default and the detail rows cannot drift.
final class WarrantyTermsTests: KitTestCase {

    // MARK: - Fixtures

    private func decodeWarranty(_ json: String) throws -> Warranty {
        try APIClient.decoder.decode(Warranty.self, from: Data(json.utf8))
    }

    private func encodeObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try APIClient.encoder.encode(value)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any])
    }

    /// A stored warranty with every contract field set. Reused by the decoding,
    /// presentation and full-replacement tests.
    private let fullWarrantyJSON = #"""
    {
      "id": "war_terms",
      "deviceId": "dev_1",
      "type": "EXTENDED",
      "provider": "Apple",
      "startDate": "2025-03-12T00:00:00Z",
      "endDate": "2027-03-12T00:00:00Z",
      "months": 24,
      "cost": 5000000,
      "component": "Pin",
      "scope": "Chai pin và hỏng do pin",
      "cap": 5000000,
      "deductible": 500000,
      "exclusions": "Rơi vỡ, vào nước",
      "region": "Toàn quốc",
      "transferable": false,
      "claimsAllowed": 3,
      "claimsUsed": 2
    }
    """#

    // MARK: - Wire: decoding

    func testWarrantyDecodesAllNineContractFields() throws {
        let warranty = try decodeWarranty(fullWarrantyJSON)

        XCTAssertEqual(warranty.component, "Pin")
        XCTAssertEqual(warranty.scope, "Chai pin và hỏng do pin")
        XCTAssertEqual(warranty.cap, 5_000_000)
        XCTAssertEqual(warranty.deductible, 500_000)
        XCTAssertEqual(warranty.exclusions, "Rơi vỡ, vào nước")
        XCTAssertEqual(warranty.region, "Toàn quốc")
        XCTAssertEqual(warranty.transferable, false)
        XCTAssertEqual(warranty.claimsAllowed, 3)
        XCTAssertEqual(warranty.claimsUsed, 2)

        // The whole row still round-trips; the new fields are ordinary Codable
        // properties, not a hand-written coder that could drop one.
        let redecoded = try APIClient.decoder.decode(
            Warranty.self, from: try APIClient.encoder.encode(warranty))
        XCTAssertEqual(redecoded, warranty)
    }

    /// Every field is optional, so a pre-contract payload (and the server's
    /// plain rows) still decodes and reads as "no terms".
    func testWarrantyWithoutContractFieldsDecodesAsNoTerms() throws {
        let warranty = try decodeWarranty(#"""
        {
          "id": "war_plain", "deviceId": "dev_1", "type": "STANDARD",
          "startDate": "2025-01-01T00:00:00Z", "endDate": "2026-01-01T00:00:00Z",
          "months": 12
        }
        """#)

        XCTAssertNil(warranty.component)
        XCTAssertNil(warranty.scope)
        XCTAssertNil(warranty.cap)
        XCTAssertNil(warranty.deductible)
        XCTAssertNil(warranty.exclusions)
        XCTAssertNil(warranty.region)
        XCTAssertNil(warranty.transferable)
        XCTAssertNil(warranty.claimsAllowed)
        XCTAssertNil(warranty.claimsUsed)
        XCTAssertFalse(warranty.terms.hasAnyTerms,
                       "an old/plain payload must not look like a contract")
    }

    // MARK: - Wire: encoding (create / update)

    func testWarrantyInputEncodesAllNineContractFields() throws {
        var input = WarrantyInput(type: .EXTENDED, startDate: "2025-03-12", months: 24)
        input.component = "Pin"
        input.scope = "Chai pin"
        input.cap = 5_000_000
        input.deductible = 500_000
        input.exclusions = "Rơi vỡ"
        input.region = "Toàn quốc"
        input.transferable = false
        input.claimsAllowed = 3
        input.claimsUsed = 2

        let body = try encodeObject(input)

        XCTAssertEqual(body["component"] as? String, "Pin")
        XCTAssertEqual(body["scope"] as? String, "Chai pin")
        XCTAssertEqual(body["cap"] as? Int, 5_000_000)
        XCTAssertEqual(body["deductible"] as? Int, 500_000)
        XCTAssertEqual(body["exclusions"] as? String, "Rơi vỡ")
        XCTAssertEqual(body["region"] as? String, "Toàn quốc")
        XCTAssertEqual(body["transferable"] as? Bool, false)
        XCTAssertEqual(body["claimsAllowed"] as? Int, 3)
        XCTAssertEqual(body["claimsUsed"] as? Int, 2)
    }

    /// `claimsUsed` is the one term whose absent-key meaning differs between
    /// create and update: create defaults it to `0`, update keeps the stored
    /// counter. A hand-built payload therefore leaves it out rather than
    /// silently resetting a counter; the form always states a value (see
    /// `testApplyWritesClaimsUsedZeroWhenTheFieldIsEmpty`).
    func testWarrantyInputOmitsAnAbsentClaimsUsed() throws {
        let body = try encodeObject(
            WarrantyInput(type: .STANDARD, startDate: "2025-01-01", months: 12))

        XCTAssertNil(body["claimsUsed"], "absent means 'keep' on update and 0 on create")
        XCTAssertNil(body["component"])
        XCTAssertNil(body["cap"])
        XCTAssertNil(body["transferable"])
    }

    // MARK: - hasAnyTerms (the collapsed default)

    func testNoRecordedTermMeansNoTerms() {
        XCTAssertFalse(WarrantyTerms().hasAnyTerms)
    }

    /// The trap this rule exists for: the server emits `claimsUsed: 0` on every
    /// warranty, so counting a non-nil value as a term would expand the form
    /// and add a terms line to every row in the app.
    func testZeroClaimsUsedIsNotATerm() {
        XCTAssertFalse(WarrantyTerms(claimsUsed: 0).hasAnyTerms)
        XCTAssertFalse(WarrantyTerms(claimsUsed: nil).hasAnyTerms)
        XCTAssertTrue(WarrantyTerms(claimsUsed: 1).hasAnyTerms)
    }

    func testEachRecordedFieldAloneCountsAsTerms() {
        XCTAssertTrue(WarrantyTerms(component: "Pin").hasAnyTerms)
        XCTAssertTrue(WarrantyTerms(scope: "Lỗi kỹ thuật").hasAnyTerms)
        XCTAssertTrue(WarrantyTerms(cap: 0).hasAnyTerms, "cap 0 is a real answer")
        XCTAssertTrue(WarrantyTerms(deductible: 0).hasAnyTerms)
        XCTAssertTrue(WarrantyTerms(exclusions: "Rơi vỡ").hasAnyTerms)
        XCTAssertTrue(WarrantyTerms(region: "Toàn quốc").hasAnyTerms)
        XCTAssertTrue(WarrantyTerms(transferable: false).hasAnyTerms,
                      "false is 'không chuyển nhượng được', not 'unset'")
        XCTAssertTrue(WarrantyTerms(claimsAllowed: 0).hasAnyTerms,
                      "0 allowed claims is a real contract")
    }

    func testBlankTextIsNormalisedToNotRecorded() {
        let blank = WarrantyTerms(component: "   ", scope: "\n",
                                  exclusions: " ", region: "")
        XCTAssertNil(blank.component)
        XCTAssertNil(blank.scope)
        XCTAssertNil(blank.exclusions)
        XCTAssertNil(blank.region)
        XCTAssertFalse(blank.hasAnyTerms, "an empty text field is not a term")
    }

    // MARK: - Claims label

    func testBoundedClaimsLabelIsUsedOutOfAllowed() {
        XCTAssertEqual(WarrantyTerms(claimsAllowed: 3, claimsUsed: 2).claimsLabel, "2/3")
        XCTAssertEqual(WarrantyTerms(claimsAllowed: 3, claimsUsed: nil).claimsLabel, "0/3",
                       "missing used count reads as the documented default 0")
        XCTAssertEqual(WarrantyTerms(claimsAllowed: 0, claimsUsed: 0).claimsLabel, "0/0",
                       "a plan allowing zero claims is explicit, not unbounded")
    }

    func testUnboundedClaimsLabelHasNoDenominator() {
        let unbounded = WarrantyTerms(claimsAllowed: nil, claimsUsed: 2)
        XCTAssertEqual(unbounded.claimsLabel, "2")
        XCTAssertTrue(unbounded.hasUnboundedClaims,
                      "the row needs to append '(không giới hạn)' so '2' is not read as '2/3'")
    }

    func testNoClaimInformationMeansNoLabel() {
        XCTAssertNil(WarrantyTerms().claimsLabel)
        XCTAssertNil(WarrantyTerms(claimsUsed: 0).claimsLabel,
                     "0 used and no cap recorded is the server default, not a claim count")
        XCTAssertFalse(WarrantyTerms(claimsUsed: 0).hasUnboundedClaims)
    }

    func testClaimsConflictFollowsTheServerRule() {
        XCTAssertTrue(WarrantyTerms(claimsAllowed: 3, claimsUsed: 4).hasClaimsConflict)
        XCTAssertFalse(WarrantyTerms(claimsAllowed: 3, claimsUsed: 3).hasClaimsConflict)
        XCTAssertFalse(WarrantyTerms(claimsAllowed: 3, claimsUsed: nil).hasClaimsConflict)
        XCTAssertFalse(WarrantyTerms(claimsAllowed: nil, claimsUsed: 99).hasClaimsConflict,
                       "no allowance means unbounded, not a conflict")
    }

    // MARK: - Component vs whole-unit title

    func testComponentTitleUsesTheRecordedComponent() {
        XCTAssertEqual(WarrantyTerms(component: "Pin").componentTitle, "Pin")
        XCTAssertFalse(WarrantyTerms(component: "Pin").coversWholeUnit)
        XCTAssertEqual(WarrantyTerms(component: "  Pin  ").componentTitle, "Pin",
                       "the trim is what the row shows")
    }

    func testMissingComponentFallsBackToTheWholeUnitTitle() {
        let terms = WarrantyTerms(cap: 5_000_000)
        XCTAssertTrue(terms.coversWholeUnit)
        L.withLanguage(.vi) { XCTAssertEqual(terms.componentTitle, "Toàn bộ máy") }
        L.withLanguage(.en) { XCTAssertEqual(terms.componentTitle, "Whole unit") }
    }

    // MARK: - Money + transferable

    func testCapAndDeductibleRenderAsVnd() {
        let terms = WarrantyTerms(cap: 5_000_000, deductible: 500_000)
        XCTAssertEqual(terms.capLabel, "5.000.000 ₫")
        XCTAssertEqual(terms.deductibleLabel, "500.000 ₫")

        XCTAssertEqual(WarrantyTerms(cap: 0).capLabel, "0 ₫",
                       "zero is a real payout ceiling, not 'unrecorded'")
        XCTAssertNil(WarrantyTerms().capLabel)
        XCTAssertNil(WarrantyTerms().deductibleLabel)
    }

    func testTransferableIsThreeState() {
        L.withLanguage(.en) {
            XCTAssertEqual(WarrantyTerms(transferable: true).transferableLabel, "Yes")
            XCTAssertEqual(WarrantyTerms(transferable: false).transferableLabel, "No")
            XCTAssertNil(WarrantyTerms(transferable: nil).transferableLabel,
                         "nil is 'the contract does not say', not 'No'")
        }
    }

    // MARK: - Full replacement on every save path

    /// The form loads an existing contract and sends all nine fields back. This
    /// mirrors that round trip: wire → `WarrantyTerms` → `WarrantyInput` →
    /// wire, with nothing dropped.
    func testCarriedTermsLandOnTheWarrantyInputUnchanged() throws {
        let warranty = try decodeWarranty(fullWarrantyJSON)
        var input = WarrantyInput(type: warranty.type,
                                  startDate: "2025-03-12",
                                  months: warranty.months)

        WarrantyTerms.carried(from: warranty).apply(to: &input)

        XCTAssertEqual(input.component, "Pin")
        XCTAssertEqual(input.scope, "Chai pin và hỏng do pin")
        XCTAssertEqual(input.cap, 5_000_000)
        XCTAssertEqual(input.deductible, 500_000)
        XCTAssertEqual(input.exclusions, "Rơi vỡ, vào nước")
        XCTAssertEqual(input.region, "Toàn quốc")
        XCTAssertEqual(input.transferable, false)
        XCTAssertEqual(input.claimsAllowed, 3)
        XCTAssertEqual(input.claimsUsed, 2)

        let body = try encodeObject(input)
        XCTAssertEqual(body["component"] as? String, "Pin")
        XCTAssertEqual(body["transferable"] as? Bool, false)
        XCTAssertEqual(body["claimsUsed"] as? Int, 2)
    }

    /// An empty form field for `claimsUsed` still writes the contract default,
    /// so an update means the same thing whether the server replaces or merges.
    func testApplyWritesClaimsUsedZeroWhenTheFieldIsEmpty() {
        var input = WarrantyInput(type: .STANDARD, startDate: "2025-01-01", months: 12)
        WarrantyTerms(component: "Pin", claimsUsed: nil).apply(to: &input)

        XCTAssertEqual(input.claimsUsed, 0)
        XCTAssertEqual(input.component, "Pin")
        XCTAssertNil(input.cap)
    }
}
