package com.warrantyvault.app.network

import com.warrantyvault.app.i18n.ResCatalog
import com.warrantyvault.app.ui.screens.devices.dialablePhone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wire-contract tests for the two features that shipped without a client:
 * the handover certificate (#2) and the warranty directory (#15).
 *
 * These decode the **literal JSON from `openapi.yaml`** through the production
 * [ApiClient.json], because every claim either feature makes to the user depends
 * on the client reading the server's fields — `phoneSource` above all. A field
 * that silently defaulted would turn the honesty mechanism into decoration.
 */
class SharesAndDirectorySerializationTest {

    private val json = ApiClient.json

    private val createdShareJson = """
        {
          "share": {
            "id": "shr_1",
            "deviceId": "dev_1",
            "expiresAt": "2026-04-02T09:00:00Z",
            "revokedAt": null,
            "includeSerial": false,
            "viewCount": 0,
            "lastViewedAt": null,
            "createdAt": "2026-03-03T09:00:00Z",
            "token": "9f2cQ7xVt0mZqLp1Rk4bYw8nHs6dEu3A",
            "sharePath": "/api/v1/public/shares/9f2cQ7xVt0mZqLp1Rk4bYw8nHs6dEu3A"
          }
        }
    """.trimIndent()

    // ---- The one-time token ----

    @Test
    fun theCreateResponseIsTheOnlyShapeThatCarriesAToken() {
        val res = json.decodeFromString(CreateShareResponse.serializer(), createdShareJson)

        assertEquals("9f2cQ7xVt0mZqLp1Rk4bYw8nHs6dEu3A", res.share.token)
        assertEquals(
            "/api/v1/public/shares/9f2cQ7xVt0mZqLp1Rk4bYw8nHs6dEu3A",
            res.share.sharePath,
        )
        assertEquals("shr_1", res.share.id)

        // The owner-side shape has no `token` property at all: the list endpoint
        // cannot return one and there is no endpoint that could re-issue it, so a
        // payload that *did* carry a token still cannot be read as one here.
        val listed = json.decodeFromString(
            DeviceShareListResponse.serializer(),
            """{"shares":[{"id":"shr_1","deviceId":"dev_1","expiresAt":"2026-04-02T09:00:00Z","includeSerial":false,"viewCount":0,"createdAt":"2026-03-03T09:00:00Z","token":"leaked"}]}""",
        )
        assertEquals("shr_1", listed.shares.single().id)
    }

    @Test
    fun theOneTimeWarningIsSatisfiedByTheWireContractItself() {
        // `token` is a non-null field with no default on the wire but a default in
        // the model, so a server that stopped sending it would yield "" rather than
        // crash — and the UI then has to treat "" as "no link to hand over".
        val noPath = json.decodeFromString(
            CreateShareResponse.serializer(),
            """{"share":{"id":"s","deviceId":"d","expiresAt":"2026-04-02T09:00:00Z","includeSerial":false,"viewCount":0,"createdAt":"2026-03-03T09:00:00Z"}}""",
        )
        assertEquals("", noPath.share.token)
        assertEquals("", noPath.share.sharePath)
    }

    @Test
    fun theShareListIsAlwaysAnArrayAndANullLikeOwnerGetsAnEmptyOne() {
        // A foreign device answers `[]`, not 404 — that row is not an error state.
        assertEquals(
            emptyList<DeviceShare>(),
            json.decodeFromString(DeviceShareListResponse.serializer(), """{"shares":[]}""").shares,
        )
        assertEquals(
            emptyList<DeviceShare>(),
            json.decodeFromString(DeviceShareListResponse.serializer(), """{}""").shares,
        )
    }

    @Test
    fun aRevokedShareDecodesWithItsRevocationAndKeepsItsViewCount() {
        val share = json.decodeFromString(
            DeviceShare.serializer(),
            """{"id":"shr_2","deviceId":"dev_1","expiresAt":"2026-04-02T09:00:00Z","revokedAt":"2026-03-04T08:00:00Z","includeSerial":true,"viewCount":4,"lastViewedAt":"2026-03-03T20:11:00Z","createdAt":"2026-03-03T09:00:00Z"}""",
        )

        assertEquals("2026-03-04T08:00:00Z", share.revokedAt)
        assertTrue(share.includeSerial)
        assertEquals(4, share.viewCount)
        assertEquals("2026-03-03T20:11:00Z", share.lastViewedAt)
    }

    @Test
    fun theCreateRequestAlwaysSpellsOutBothFieldsAndNeverSendsAnUnknownKey() {
        val body = json.encodeToString(CreateShareInput.serializer(), CreateShareInput())

        // The client never leans on the 30-day default: the user's choice is what
        // travels, and openapi rejects unknown fields so a typo cannot silently
        // create a default link.
        assertTrue(body, body.contains("\"expiresInDays\":30"))
        assertTrue(body, body.contains("\"includeSerial\":false"))

        val optedIn = json.encodeToString(
            CreateShareInput.serializer(),
            CreateShareInput(expiresInDays = 7, includeSerial = true),
        )
        assertTrue(optedIn, optedIn.contains("\"expiresInDays\":7"))
        assertTrue(optedIn, optedIn.contains("\"includeSerial\":true"))
        assertTrue("không có khoá lạ", optedIn.contains("expiresInDays") && !optedIn.contains("expiresDay"))
    }

    // ---- Warranty directory ----

    @Test
    fun theDirectoryDecodesBothTiersAndTheServersDisclaimer() {
        val raw = """
            {
              "directory": {
                "deviceId": "dev_1",
                "deviceName": "Galaxy S24",
                "category": "PHONE",
                "brandInput": "Samsung",
                "brand": {
                  "brandId": "samsung",
                  "name": "Samsung",
                  "serviceLocatorUrl": "https://www.samsung.com/vn/support/service-center/",
                  "supportUrl": "https://www.samsung.com/vn/support/",
                  "notes": "Trang tra cứu trung tâm uỷ quyền do hãng tự duy trì."
                },
                "centres": [
                  {
                    "warrantyId": "war_1",
                    "warrantyType": "STANDARD",
                    "endDate": "2026-03-01T00:00:00",
                    "isActive": true,
                    "providerInput": "Samsung",
                    "provider": {"id": "samsung", "name": "Samsung", "phone": null, "address": null, "websiteUrl": null, "notes": null},
                    "address": "12 Lê Lợi, Q.1",
                    "phone": "0912 345 678",
                    "phoneSource": "user"
                  }
                ],
                "disclaimer": "App không lưu hotline hay địa chỉ trung tâm bảo hành."
              }
            }
        """.trimIndent()

        val directory = json.decodeFromString(ServiceDirectoryResponse.serializer(), raw).directory

        assertEquals("Galaxy S24", directory.deviceName)
        assertEquals("samsung", directory.brand?.brandId)
        assertEquals(
            "https://www.samsung.com/vn/support/service-center/",
            directory.brand?.serviceLocatorUrl,
        )

        val centre = directory.centres.single()
        assertEquals(WarrantyType.STANDARD, centre.warrantyType)
        assertTrue(centre.isActive)
        assertEquals("12 Lê Lợi, Q.1", centre.address)
        assertEquals("0912 345 678", centre.phone)

        // The whole point of this test: the lowercase wire value becomes USER, and
        // USER is what makes the number dialable and attributed.
        assertEquals(PhoneSource.USER, centre.phoneSource)
        assertEquals("Số do bạn tự ghi", dialablePhone(centre)?.attribution(ResCatalog.vietnamese()))
        assertEquals("tel:0912345678", dialablePhone(centre)?.dialUri)
    }

    @Test
    fun phoneSourceNoneIsReadAsNoNumberEvenWhenTheWireAlsoCarriesAPhone() {
        val raw = """
            {
              "directory": {
                "deviceId": "dev_1",
                "deviceName": "Galaxy S24",
                "category": "PHONE",
                "brandInput": "Samsung",
                "brand": null,
                "centres": [
                  {
                    "warrantyId": "war_1",
                    "warrantyType": "THIRD_PARTY",
                    "endDate": null,
                    "isActive": false,
                    "providerInput": "Trung tâm bảo hành",
                    "provider": null,
                    "address": null,
                    "phone": null,
                    "phoneSource": "none"
                  }
                ],
                "disclaimer": "App không lưu hotline."
              }
            }
        """.trimIndent()

        val directory = json.decodeFromString(ServiceDirectoryResponse.serializer(), raw).directory

        assertNull("brand null là câu trả lời hợp lệ", directory.brand)
        val centre = directory.centres.single()
        assertEquals(PhoneSource.NONE, centre.phoneSource)
        assertNull(dialablePhone(centre))
        assertNull(centre.endDate)
        // The unmatched provider still travels, which is what the row falls back to.
        assertEquals("Trung tâm bảo hành", centre.providerInput)
        assertNull(centre.provider)
    }

    @Test
    fun anUnknownPhoneSourceDoesNotDecodeToAValueThatWouldLookDialable() {
        // `phoneSource` has no default in openapi; if a future server adds a third
        // value, decoding must fail loudly rather than pick one of the two that
        // mean opposite things about whether a number exists.
        val raw = """
            {"directory":{"deviceId":"d","deviceName":"n","category":"PHONE","brandInput":null,"brand":null,
            "centres":[{"warrantyId":"w","warrantyType":"STANDARD","isActive":true,"phoneSource":"vendor","phone":"1900"}],
            "disclaimer":"x"}}
        """.trimIndent()

        val failure = runCatching {
            json.decodeFromString(ServiceDirectoryResponse.serializer(), raw)
        }.exceptionOrNull()
        assertTrue(
            "phải ném lỗi thay vì đoán nguồn số: $failure",
            failure != null,
        )
    }

    @Test
    fun theCatalogGainsBrandServiceInfoWithoutLosingTheFourExistingLists() {
        val raw = """
            {
              "categories": [{"code": "PHONE", "name": "Điện thoại"}],
              "brands": [{"id": "samsung", "name": "Samsung", "categoryCodes": ["PHONE"]}],
              "stores": [{"id": "s1", "name": "CellphoneS", "type": "RETAIL"}],
              "warrantyProviders": [{"id": "p1", "name": "Apple Care", "phone": null, "address": null}],
              "brandServiceInfo": [
                {"brandId": "samsung", "name": "Samsung", "serviceLocatorUrl": "https://www.samsung.com/vn/support/service-center/", "supportUrl": null, "notes": "ghi chú"}
              ]
            }
        """.trimIndent()

        val catalog = json.decodeFromString(Catalog.serializer(), raw)

        assertEquals("Samsung", catalog.brandServiceInfo.single().name)
        assertNull(catalog.brandServiceInfo.single().supportUrl)
        // Additive: the four existing lists are untouched.
        assertEquals("PHONE", catalog.categories.single().code)
        assertEquals(listOf("PHONE"), catalog.brands.single().categoryCodes)
        assertEquals("RETAIL", catalog.stores.single().type)
        assertEquals("Apple Care", catalog.warrantyProviders.single().name)
    }

    @Test
    fun aCatalogFromAServerWithoutBrandServiceInfoStillDecodesEverythingElse() {
        // Additive means additive: an older server must not blank the device form.
        val catalog = json.decodeFromString(
            Catalog.serializer(),
            """{"categories":[{"code":"PHONE","name":"Điện thoại"}],"brands":[],"stores":[],"warrantyProviders":[]}""",
        )

        assertEquals(1, catalog.categories.size)
        assertTrue(catalog.brandServiceInfo.isEmpty())
    }

    @Test
    fun theProviderRefDecodesItsDeliberatelyNullPhoneAndAddress() {
        val provider = json.decodeFromString(
            WarrantyProviderRef.serializer(),
            """{"id":"p1","name":"Apple Care","phone":null,"address":null,"websiteUrl":"https://apple.com/vn","notes":null}""",
        )

        // Migration 0008 seeded these NULL on purpose: a wrong hotline is worse
        // than an empty one. The directory shows the user's own number instead.
        assertNull(provider.phone)
        assertNull(provider.address)
        assertEquals("https://apple.com/vn", provider.websiteUrl)
    }
}
