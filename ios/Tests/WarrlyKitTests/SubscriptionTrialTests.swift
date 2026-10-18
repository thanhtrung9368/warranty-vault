import Foundation
import XCTest
@testable import WarrlyKit

/// Subscription trial (Feature B) — the pure half, plus the proof at the wire
/// level.
///
/// The frozen contract has one pair rule: `convertsToPrice` **without**
/// `trialEndsAt` is a 400 with `fieldErrors.convertsToPrice`. The form must never
/// be able to submit that combination, and a status-only PATCH (which replaces the
/// row) must not resurrect it either. `SubscriptionTrialFields` is the single
/// place the pair is enforced, so both paths are covered by one testable rule.
final class SubscriptionTrialTests: KitTestCase {

    private func subscriptionJSON(trialEndsAt: String = "null",
                                  convertsToPrice: String = "null") -> String {
        """
        {
          "id": "sub_1", "name": "iCloud+ 200GB", "category": "CLOUD",
          "billingCycle": "MONTHLY", "price": 59000, "currency": "VND",
          "startedAt": "2026-01-05T00:00:00Z",
          "renewalDate": "2026-11-12T00:00:00Z",
          "autoRenew": true, "status": "ACTIVE", "leadDays": [3, 1, 0],
          "trialEndsAt": \(trialEndsAt),
          "convertsToPrice": \(convertsToPrice)
        }
        """
    }

    private func subscription(_ json: String) throws -> Subscription {
        try APIClient.decoder.decode(Subscription.self, from: Data(json.utf8))
    }

    private func encodedObject<T: Encodable>(_ value: T) throws -> [String: Any] {
        let data = try APIClient.encoder.encode(value)
        let object = try JSONSerialization.jsonObject(with: data)
        return try XCTUnwrap(object as? [String: Any])
    }

    // MARK: - Decoding

    func testSubscriptionDecodesTheTrialPair() throws {
        let stored = try subscription(subscriptionJSON(
            trialEndsAt: #""2026-11-12T00:00:00Z""#,
            convertsToPrice: "260000"
        ))

        XCTAssertEqual(stored.trialEndsAt, "2026-11-12T00:00:00Z")
        XCTAssertEqual(stored.convertsToPrice, 260_000)
        XCTAssertEqual(SubscriptionTrial.phase(trialEndsAt: stored.trialEndsAt),
                       .trial(endsOn: "2026-11-12"))
    }

    /// Older payloads (and a subscription without a trial) still decode.
    func testSubscriptionDecodesMissingTrialFieldsAsNoTrial() throws {
        let json = """
        {"id": "sub_2", "name": "Spotify", "billingCycle": "MONTHLY", "price": 59000,
         "startedAt": "2026-01-05T00:00:00", "renewalDate": "2026-02-05T00:00:00",
         "autoRenew": true, "status": "ACTIVE", "leadDays": [3, 1, 0]}
        """
        let stored = try subscription(json)

        XCTAssertNil(stored.trialEndsAt)
        XCTAssertNil(stored.convertsToPrice)
        XCTAssertEqual(SubscriptionTrial.carried(from: stored), .none)
    }

    // MARK: - The pair rule

    /// The exact rejected combination: a price with no trial date. The helper
    /// drops the price rather than putting it on the wire alone.
    func testPriceWithoutATrialDateIsDropped() {
        XCTAssertEqual(
            SubscriptionTrial.carried(trialEndsAt: nil, convertsToPrice: 260_000),
            .none
        )
        XCTAssertEqual(
            SubscriptionTrial.carried(trialEndsAt: "không phải ngày", convertsToPrice: 260_000),
            .none
        )
    }

    func testTrialDateKeepsThePriceAndAloneStaysValid() {
        XCTAssertEqual(
            SubscriptionTrial.carried(trialEndsAt: "2026-11-12T00:00:00Z",
                                      convertsToPrice: 260_000),
            SubscriptionTrialFields(trialEndsAt: "2026-11-12",
                                    convertsToPrice: 260_000)
        )
        XCTAssertEqual(
            SubscriptionTrial.carried(trialEndsAt: "2026-11-12", convertsToPrice: nil),
            SubscriptionTrialFields(trialEndsAt: "2026-11-12", convertsToPrice: nil)
        )
    }

    func testApplyCannotBuildTheForbiddenPair() {
        var input = SubscriptionInput(name: "ChatGPT Plus", billingCycle: .MONTHLY,
                                      price: 590_000, startedAt: "2026-01-01")
        let fields = SubscriptionTrialFields(trialEndsAt: nil,
                                             convertsToPrice: 260_000)
        SubscriptionTrial.apply(fields, to: &input)

        XCTAssertNil(input.trialEndsAt)
        XCTAssertNil(input.convertsToPrice)
    }

    // MARK: - Derived labels

    func testTrialAndRenewalHeadings() {
        L.withLanguage(.vi) {
            XCTAssertEqual(SubscriptionTrial.termHeading(trialEndsAt: "2026-11-12T00:00:00Z"),
                           "DÙNG THỬ ĐẾN")
            XCTAssertEqual(SubscriptionTrial.termHeading(trialEndsAt: nil), "GIA HẠN TỚI")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(SubscriptionTrial.termHeading(trialEndsAt: "2026-11-12"),
                           "TRIAL ENDS")
            XCTAssertEqual(SubscriptionTrial.termHeading(trialEndsAt: nil), "RENEWS ON")
        }
    }

    func testPriceLabelOnlyExistsInsideATrial() {
        XCTAssertEqual(SubscriptionTrial.priceLabel(
            trialEndsAt: "2026-11-12T00:00:00Z", convertsToPrice: 260_000),
            "260.000 ₫")
        XCTAssertNil(SubscriptionTrial.priceLabel(
            trialEndsAt: nil, convertsToPrice: 260_000),
            "a price outside a trial is the rejected combination")
        XCTAssertNil(SubscriptionTrial.priceLabel(
            trialEndsAt: "2026-11-12", convertsToPrice: nil),
            "a trial with no recorded price has no price row")
    }

    func testDayLabelUsesTheCalendarDayPrefix() {
        XCTAssertEqual(SubscriptionTrial.dayLabel("2026-11-12T23:30:00Z"), "12/11/2026")
        XCTAssertEqual(SubscriptionTrial.dayLabel("2026-11-12"), "12/11/2026")
        XCTAssertNil(SubscriptionTrial.dayLabel(nil))
        XCTAssertNil(SubscriptionTrial.dayLabel("không phải ngày"))
    }

    // MARK: - The proof at the wire level

    func testCreateBodyCarriesTheTrialPair() async throws {
        let json = subscriptionJSON(trialEndsAt: #""2026-11-12T00:00:00Z""#,
                                    convertsToPrice: "260000")
        StubURLProtocol.install(.json("""
        {"subscription": \(json)}
        """))
        let client = makeStubbedClient(token: "tok_abc")
        let stored = try subscription(json)

        var input = SubscriptionInput(name: stored.name,
                                      billingCycle: stored.billingCycle,
                                      price: stored.price,
                                      startedAt: "2026-01-05")
        SubscriptionTrial.apply(SubscriptionTrial.carried(from: stored), to: &input)
        _ = try await client.createSubscription(input)

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        let body = try request.jsonBody()
        XCTAssertEqual(body["trialEndsAt"] as? String, "2026-11-12")
        XCTAssertEqual(body["convertsToPrice"] as? Int, 260_000)
    }

    func testUpdateBodyCarriesTheTrialPair() async throws {
        let json = subscriptionJSON(trialEndsAt: #""2026-11-12T00:00:00Z""#,
                                    convertsToPrice: "260000")
        StubURLProtocol.install(.json("""
        {"subscription": \(json)}
        """))
        let client = makeStubbedClient(token: "tok_abc")
        let stored = try subscription(json)

        var input = SubscriptionInput(name: stored.name,
                                      billingCycle: stored.billingCycle,
                                      price: stored.price,
                                      startedAt: "2026-01-05")
        SubscriptionTrial.apply(SubscriptionTrial.carried(from: stored), to: &input)
        _ = try await client.updateSubscription(id: "sub_1", input)

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(request.httpMethod, "PATCH")
        let body = try request.jsonBody()
        XCTAssertEqual(body["trialEndsAt"] as? String, "2026-11-12")
        XCTAssertEqual(body["convertsToPrice"] as? Int, 260_000)
    }

    func testClearingTheTrialSendsNeitherKeyAndCannotLeaveAStrayPrice() async throws {
        let json = subscriptionJSON()
        StubURLProtocol.install(.json("""
        {"subscription": \(json)}
        """))
        let client = makeStubbedClient(token: "tok_abc")
        let stored = try subscription(json)

        var input = SubscriptionInput(name: stored.name,
                                      billingCycle: stored.billingCycle,
                                      price: stored.price,
                                      startedAt: "2026-01-05")
        // The form's "Có dùng thử" was switched off: a stale price may still be
        // in view state, but the pair rule must drop it.
        SubscriptionTrial.apply(SubscriptionTrialFields(trialEndsAt: nil,
                                                        convertsToPrice: 260_000),
                                to: &input)
        _ = try await client.updateSubscription(id: "sub_1", input)

        let request = try XCTUnwrap(StubURLProtocol.lastRequest)
        let raw = try XCTUnwrap(String(data: request.capturedBody, encoding: .utf8))
        XCTAssertFalse(raw.contains("convertsToPrice"),
                       "a price without a trial date is the 400 the API documents: \(raw)")
        let body = try request.jsonBody()
        XCTAssertNil(body["trialEndsAt"])
        XCTAssertNil(body["convertsToPrice"])
    }

    /// The status-only PATCH replaces the row, so it has to carry the pair back.
    func testCarryBackSaveKeepsTheStoredTrialPair() throws {
        let stored = try subscription(subscriptionJSON(
            trialEndsAt: #""2026-11-12T00:00:00Z""#,
            convertsToPrice: "260000"
        ))

        var input = SubscriptionInput(name: stored.name,
                                      billingCycle: stored.billingCycle,
                                      price: stored.price,
                                      startedAt: "2026-01-05")
        input.status = .PAUSED
        SubscriptionTrial.apply(SubscriptionTrial.carried(from: stored), to: &input)

        let payload = try encodedObject(input)
        XCTAssertEqual(payload["trialEndsAt"] as? String, "2026-11-12")
        XCTAssertEqual(payload["convertsToPrice"] as? Int, 260_000)
    }
}
