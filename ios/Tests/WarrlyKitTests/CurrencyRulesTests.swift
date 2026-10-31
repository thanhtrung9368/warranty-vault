import Foundation
import XCTest
@testable import WarrlyKit

/// Pure multi-currency rules: the rate rule, the totals decision, the locked
/// warranty conversion, and VND-vs-foreign formatting.
final class CurrencyRulesTests: KitTestCase {

    // MARK: - Codes / rate rule

    func testNormalizationTreatsEveryAbsentOrBlankCodeAsVnd() {
        XCTAssertEqual(CurrencyRules.normalized(nil), "VND")
        XCTAssertEqual(CurrencyRules.normalized(""), "VND")
        XCTAssertEqual(CurrencyRules.normalized("   "), "VND")
        XCTAssertEqual(CurrencyRules.normalized("usd"), "USD")
        XCTAssertEqual(CurrencyRules.normalized(" eur "), "EUR")

        XCTAssertTrue(CurrencyRules.isVnd(nil))
        XCTAssertTrue(CurrencyRules.isVnd("vnd"))
        XCTAssertFalse(CurrencyRules.isVnd("USD"))
        XCTAssertTrue(CurrencyRules.requiresRate("USD"))
        XCTAssertFalse(CurrencyRules.requiresRate("VND"))
        XCTAssertFalse(CurrencyRules.requiresRate(nil), "the default currency is VND")
    }

    func testThePickerKeepsACodeThisBuildDoesNotList() {
        let codes = CurrencyRules.pickerCodes(current: "KHR")
        XCTAssertEqual(codes.first, "VND")
        XCTAssertEqual(codes.last, "KHR",
                       "a legacy/imported code stays visible instead of being silently rewritten")

        XCTAssertEqual(CurrencyRules.pickerCodes(current: "usd"),
                       CurrencyRules.pickerCodes,
                       "a known code does not get appended a second time")
    }

    func testRateRuleMatchesTheContract() {
        // VND: null is required, a leftover rate is rejected exactly like the
        // server does ("Thiết bị dùng VND không được có tỷ giá").
        XCTAssertNil(CurrencyRules.rateError(currency: "VND", rate: nil))
        XCTAssertTrue(CurrencyRules.isValidRate(nil, currency: "VND"))
        XCTAssertFalse(CurrencyRules.isValidRate(25_400, currency: "VND"))
        XCTAssertEqual(CurrencyRules.rateError(currency: "VND", rate: 25_400),
                       "Thiết bị dùng VND không được có tỷ giá")

        // Foreign: a positive rate is required.
        XCTAssertNotNil(CurrencyRules.rateError(currency: "USD", rate: nil))
        XCTAssertNotNil(CurrencyRules.rateError(currency: "USD", rate: 0))
        XCTAssertNotNil(CurrencyRules.rateError(currency: "USD", rate: -1))
        XCTAssertNil(CurrencyRules.rateError(currency: "USD", rate: 25_400))
        XCTAssertEqual(Array(CurrencyRules.fieldErrors(currency: "USD", rate: nil).keys),
                       ["fxRate"])
        XCTAssertTrue(CurrencyRules.fieldErrors(currency: "VND", rate: nil).isEmpty)

        L.withLanguage(.en) {
            XCTAssertEqual(CurrencyRules.rateError(currency: "USD", rate: nil),
                           "Enter an exchange rate for USD")
            XCTAssertEqual(CurrencyRules.rateError(currency: "VND", rate: 1),
                           "A VND device cannot have an exchange rate")
        }
        L.withLanguage(.vi) {
            XCTAssertEqual(CurrencyRules.rateError(currency: "USD", rate: nil),
                           "Cần nhập tỷ giá cho USD")
        }
    }

    // MARK: - Totals decision

    func testTotalsPreferTheServerVndValueOverEveryNativeAmount() {
        XCTAssertEqual(CurrencyRules.totalVnd(native: 999,
                                              serverVnd: 25_400_000,
                                              currency: "USD"),
                       25_400_000)
        // Even for VND the server value wins — it is the contract's answer.
        XCTAssertEqual(CurrencyRules.totalVnd(native: 25_000_000,
                                              serverVnd: 25_000_000,
                                              currency: "VND"),
                       25_000_000)
    }

    func testVndFallsBackToTheNativeAmountButForeignDoesNot() {
        XCTAssertEqual(CurrencyRules.totalVnd(native: 25_000_000,
                                              serverVnd: nil,
                                              currency: nil),
                       25_000_000,
                       "nil currency is the contract default VND; the amount is already dong")
        XCTAssertEqual(CurrencyRules.totalVnd(native: 25_000_000,
                                              serverVnd: nil,
                                              currency: "VND"),
                       25_000_000)
        XCTAssertNil(CurrencyRules.totalVnd(native: 999,
                                            serverVnd: nil,
                                            currency: "USD"),
                     "a foreign native amount is never summed as dong")
    }

    func testAbsentNativeAmountsHaveNoContribution() {
        XCTAssertNil(CurrencyRules.totalVnd(native: nil, serverVnd: 5_000, currency: "USD"))
        XCTAssertNil(CurrencyRules.totalVnd(native: nil, serverVnd: nil, currency: "VND"))
    }

    // MARK: - Locked warranty conversion

    func testWarrantyCostUsesTheLockedRateAndNotTheMarket() {
        XCTAssertEqual(CurrencyRules.lockedVnd(99, currency: "USD", fxRate: 25_000),
                       2_475_000)
        XCTAssertEqual(CurrencyRules.lockedVnd(5_000_000, currency: "VND", fxRate: nil),
                       5_000_000)
        XCTAssertNil(CurrencyRules.lockedVnd(99, currency: "USD", fxRate: nil))
        XCTAssertNil(CurrencyRules.lockedVnd(99, currency: "USD", fxRate: 0))
        XCTAssertNil(CurrencyRules.lockedVnd(nil, currency: "USD", fxRate: 25_000))
        XCTAssertNil(CurrencyRules.lockedVnd(Int.max, currency: "USD", fxRate: 2),
                     "overflow is refused rather than wrapped")
    }

    // MARK: - Formatting

    func testVndAndForeignFormattingCannotBeConfused() {
        XCTAssertEqual(VndFormat.string(Int64(25_000_000)), "25.000.000 ₫")
        XCTAssertEqual(VndFormat.string(Int64(25_000_000), currency: nil), "25.000.000 ₫")
        XCTAssertEqual(VndFormat.string(Int64(25_000_000), currency: "VND"), "25.000.000 ₫")

        XCTAssertEqual(VndFormat.string(Int64(999), currency: "USD"), "999 USD")
        XCTAssertEqual(VndFormat.string(Int64(1_299), currency: "usd"), "1,299 USD")
        XCTAssertEqual(VndFormat.string(Int64(-1_299), currency: "EUR"), "-1,299 EUR")
        XCTAssertFalse(VndFormat.string(Int64(999), currency: "USD").contains("₫"),
                       "a dollar amount must never carry the dong sign")
    }

    func testGroupingSeparatorFollowsTheCurrency() {
        XCTAssertEqual(CurrencyRules.groupingSeparator(for: nil), ".")
        XCTAssertEqual(CurrencyRules.groupingSeparator(for: "VND"), ".")
        XCTAssertEqual(CurrencyRules.groupingSeparator(for: "USD"), ",")
        XCTAssertEqual(VndFormat.digits(25_400), "25.400")
    }

    // MARK: - The language decides the dong shape

    func testDongFollowsTheLanguageInsteadOfAlwaysRenderingVietnamese() {
        // Go's `i18n.FormatMoney`, the web and Android emit exactly these two
        // shapes: dot grouping + trailing sign in Vietnamese, comma grouping +
        // leading sign in English. English is the product default, so a
        // hard-coded Vietnamese shape is what an English reader used to get.
        XCTAssertEqual(VndFormat.string(1_200_000, language: .vi), "1.200.000 ₫")
        XCTAssertEqual(VndFormat.string(1_200_000, language: .en), "₫1,200,000")

        XCTAssertEqual(VndFormat.string(0, language: .vi), "0 ₫")
        XCTAssertEqual(VndFormat.string(0, language: .en), "₫0")

        // The minus sign stays in front of the symbol in both languages
        // (`-1.500 ₫` / `-₫1,500`), never after it.
        XCTAssertEqual(VndFormat.string(-1_500, language: .vi), "-1.500 ₫")
        XCTAssertEqual(VndFormat.string(-1_500, language: .en), "-₫1,500")

        // `Int64.min` groups without overflowing.
        XCTAssertEqual(VndFormat.string(Int64.min, language: .en),
                       "-₫9,223,372,036,854,775,808")
    }

    func testTheDongDefaultLanguageIsTheAppsCurrentLanguage() {
        // Every existing call site (`WVFormat.vnd`, the rules above) relies on
        // this: the formatter follows the app switch without a parameter being
        // threaded through the views.
        L.withLanguage(.vi) {
            XCTAssertEqual(VndFormat.string(1_200_000), "1.200.000 ₫")
        }
        L.withLanguage(.en) {
            XCTAssertEqual(VndFormat.string(1_200_000), "₫1,200,000")
        }
        // No language chosen (the library's own tests) is the source language.
        L.withLanguage(nil) {
            XCTAssertEqual(VndFormat.string(1_200_000), "1.200.000 ₫")
        }
    }

    func testForeignAmountsKeepTheirIsoCodeInBothLanguages() {
        // The currency code, not the language, is what keeps a dollar amount
        // unambiguous, so this branch deliberately does not flip.
        XCTAssertEqual(VndFormat.string(1_299, currency: "USD"), "1,299 USD")
        XCTAssertEqual(VndFormat.string(1_299, currency: "USD", language: .vi), "1,299 USD")
        XCTAssertEqual(VndFormat.string(1_299, currency: "USD", language: .en), "1,299 USD")
    }

    // MARK: - FX payload

    func testFxRatesPickTheVndQuoteAndTreatMissingValuesAsTypedByHand() {
        let rates = FxRates(base: "USD",
                            rates: ["VND": 25_437.6, "EUR": 0.92],
                            fetchedAt: "2026-10-19T00:00:00Z",
                            stale: true)
        XCTAssertEqual(rates.vndRate, 25_438, "rounded to the whole dong fxRate stores")
        XCTAssertTrue(rates.isStale)

        let noVnd = FxRates(base: "USD", rates: ["EUR": 0.92])
        XCTAssertNil(noVnd.vndRate)
        XCTAssertFalse(noVnd.isStale, "an absent stale flag is fresh")

        let zero = FxRates(base: "USD", rates: ["VND": 0])
        XCTAssertNil(zero.vndRate)

        let lowercased = FxRates(base: "USD", rates: ["vnd": 25_000])
        XCTAssertEqual(lowercased.vndRate, 25_000)
    }

    // MARK: - Device decode

    func testDeviceDecodesCurrencyFieldsAndDefaultsToVnd() throws {
        let json = #"""
        {"id":"dev_usd","name":"iPhone 16 Pro","category":"PHONE",
         "purchaseDate":"2026-03-01T00:00:00Z","purchasePrice":999,
         "currency":"USD","fxRate":25400,
         "purchasePriceVnd":25374600,"soldPrice":800,"soldPriceVnd":20320000,
         "status":"SOLD"}
        """#
        let device = try APIClient.decoder.decode(Device.self, from: Data(json.utf8))
        XCTAssertEqual(device.currencyCode, "USD")
        XCTAssertEqual(device.fxRate, 25_400)
        XCTAssertEqual(device.purchasePriceVnd, 25_374_600)
        XCTAssertEqual(device.purchasePriceInVnd, 25_374_600)
        XCTAssertEqual(device.soldPriceInVnd, 20_320_000)
        XCTAssertTrue(device.usesForeignCurrency)

        // An older payload has no currency key at all: it means VND, and the
        // native amount is already dong.
        let old = try APIClient.decoder.decode(Device.self, from: Data(#"""
        {"id":"dev_vnd","name":"MacBook","category":"LAPTOP",
         "purchaseDate":"2026-03-01T00:00:00Z","purchasePrice":25000000,"status":"ACTIVE"}
        """#.utf8))
        XCTAssertEqual(old.currencyCode, "VND")
        XCTAssertNil(old.fxRate)
        XCTAssertNil(old.purchasePriceVnd)
        XCTAssertEqual(old.purchasePriceInVnd, 25_000_000)
        XCTAssertFalse(old.usesForeignCurrency)
    }

    func testDeviceDetailBodyDecodesCurrencyFields() throws {
        let json = #"""
        {"device":{"id":"dev_usd","name":"iPhone","category":"PHONE",
          "purchaseDate":"2026-03-01T00:00:00Z","purchasePrice":999,"status":"SOLD",
          "currency":"USD","fxRate":25400,"purchasePriceVnd":25374600,
          "soldPrice":800,"soldPriceVnd":20320000}}
        """#
        let detail = try APIClient.decoder.decode(DeviceDetail.self, from: Data(json.utf8))
        XCTAssertEqual(detail.device.currencyCode, "USD")
        XCTAssertEqual(detail.device.fxRate, 25_400)
        XCTAssertEqual(detail.device.purchasePriceInVnd, 25_374_600)
        XCTAssertEqual(detail.device.soldPriceInVnd, 20_320_000)
    }

    // MARK: - DeviceInput encoding

    func testDeviceInputAlwaysWritesCurrencyAndAnExplicitNullRateForVnd() throws {
        var input = DeviceInput(name: "Cáp sạc", category: "ELECTRONICS",
                                purchaseDate: "2026-03-01")
        input.purchasePrice = 100_000
        input.fxRate = nil

        let data = try APIClient.encoder.encode(input)
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        XCTAssertEqual(body["currency"] as? String, "VND")
        XCTAssertTrue(body.keys.contains("fxRate"), "the VND rate must travel as an explicit null")
        XCTAssertTrue(body["fxRate"] is NSNull)
        XCTAssertNil(body["model"], "other nil optionals stay omitted, as before")
        XCTAssertNil(body["soldAt"])
        XCTAssertNil(body["returnWindowDays"])
    }

    func testDeviceInputWritesAForeignRateAndItsCurrency() throws {
        var input = DeviceInput(name: "iPhone 16 Pro", category: "PHONE",
                                purchaseDate: "2026-03-01")
        input.purchasePrice = 999
        input.soldPrice = 800
        input.soldAt = "2026-06-01"
        input.currency = "usd"
        input.fxRate = 25_400

        let data = try APIClient.encoder.encode(input)
        let body = try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )

        XCTAssertEqual(body["currency"] as? String, "usd")
        XCTAssertEqual(body["fxRate"] as? Int, 25_400)
        XCTAssertEqual(body["soldPrice"] as? Int, 800)
        XCTAssertEqual(body["soldAt"] as? String, "2026-06-01")
    }

    // MARK: - Resale

    func testProfitLossLabelUsesTheDeviceCurrency() {
        L.withLanguage(.vi) {
            XCTAssertEqual(DeviceResale.profitLoss(purchasePrice: 999, soldPrice: 800,
                                                   currency: "USD")?.label,
                           "Lỗ 199 USD")
            XCTAssertEqual(DeviceResale.profitLoss(purchasePrice: 999, soldPrice: 1_100,
                                                   currency: "USD")?.label,
                           "Lãi 101 USD")
            XCTAssertEqual(DeviceResale.profitLoss(purchasePrice: 30_000_000,
                                                   soldPrice: 35_000_000)?.label,
                           "Lãi 5.000.000 ₫",
                           "the default stays the existing VND behaviour")
        }
    }
}
