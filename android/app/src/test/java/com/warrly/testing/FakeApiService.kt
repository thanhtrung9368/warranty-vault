package com.warrly.testing

import com.warrly.network.AIOptInRequest
import com.warrly.network.AIOptInResponse
import com.warrly.network.ActionQueue
import com.warrly.network.ApiService
import com.warrly.network.AssessClaimInput
import com.warrly.network.AttachmentDescriptionInput
import com.warrly.network.AttachmentListResponse
import com.warrly.network.AttachmentResponse
import com.warrly.network.AuthSuccess
import com.warrly.network.Catalog
import com.warrly.network.ChangeEmailRequest
import com.warrly.network.ChangeEmailResult
import com.warrly.network.ChangePasswordRequest
import com.warrly.network.ChangePasswordResponse
import com.warrly.network.ClaimAssessment
import com.warrly.network.ClaimInput
import com.warrly.network.ClaimListResponse
import com.warrly.network.ClaimResponse
import com.warrly.network.ConfirmEmailChangeRequest
import com.warrly.network.ConfirmEmailChangeResult
import com.warrly.network.CreateShareInput
import com.warrly.network.CreateShareResponse
import com.warrly.network.DeleteAccountRequest
import com.warrly.network.DeviceInput
import com.warrly.network.DeviceListResponse
import com.warrly.network.DeviceResponse
import com.warrly.network.DeviceShareListResponse
import com.warrly.network.DraftDeviceResponse
import com.warrly.network.ExtractReceiptInput
import com.warrly.network.FileAttachmentInput
import com.warrly.network.Forecast
import com.warrly.network.ForgotRequest
import com.warrly.network.FxRates
import com.warrly.network.ImportResultResponse
import com.warrly.network.LoginInput
import com.warrly.network.MeResponse
import com.warrly.network.NativePushInput
import com.warrly.network.OkResponse
import com.warrly.network.PaymentInput
import com.warrly.network.PriceLogInput
import com.warrly.network.PushSubscriptionListResponse
import com.warrly.network.RegisterInput
import com.warrly.network.RemindersResponse
import com.warrly.network.SearchResults
import com.warrly.network.ServiceDirectoryResponse
import com.warrly.network.SessionListResponse
import com.warrly.network.SessionRevokeResult
import com.warrly.network.SnoozeInput
import com.warrly.network.SnoozeResult
import com.warrly.network.SubscriptionAudit
import com.warrly.network.SubscriptionInput
import com.warrly.network.SubscriptionListResponse
import com.warrly.network.SubscriptionResponse
import com.warrly.network.TestPushResponse
import com.warrly.network.UpdateLocaleInput
import com.warrly.network.UpdateProfileInput
import com.warrly.network.UpdateProfileResponse
import com.warrly.network.UserStats
import com.warrly.network.WarrantyInput
import com.warrly.network.WarrantyResponse
import com.warrly.network.WishlistDetailResponse
import com.warrly.network.WishlistInput
import com.warrly.network.WishlistListResponse
import com.warrly.network.WishlistResponse
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody

/**
 * Stub `ApiService` for the JVM unit tests: every endpoint throws unless the
 * test overrides it, so an unstubbed call is a loud test bug rather than a
 * silently-empty response. Only endpoints the ViewModels actually touch get
 * overridden (see the per-screen test files).
 *
 * Deliberately NOT a `Mockito` mock — no mocking framework is on the test
 * classpath and hand-written fakes keep the suite dependency-light.
 */
open class FakeApiService : ApiService {

    private fun notStubbed(name: String): Nothing =
        throw AssertionError("FakeApiService.$name() was called but is not stubbed by this test")

    override suspend fun register(body: RegisterInput): AuthSuccess = notStubbed("register")
    override suspend fun login(body: LoginInput): AuthSuccess = notStubbed("login")
    override suspend fun forgotPassword(body: ForgotRequest): OkResponse = notStubbed("forgotPassword")
    override suspend fun logout(): OkResponse = notStubbed("logout")
    override suspend fun changePassword(body: ChangePasswordRequest): ChangePasswordResponse =
        notStubbed("changePassword")

    override suspend fun me(): MeResponse = notStubbed("me")
    override suspend fun updateProfile(body: UpdateProfileInput): UpdateProfileResponse =
        notStubbed("updateProfile")

    // `PATCH /auth/me` with only `locale` — the language switch. Separate from
    // updateProfile so saving a name cannot wipe a stored language.
    override suspend fun updateLocale(body: UpdateLocaleInput): UpdateProfileResponse =
        notStubbed("updateLocale")

    // The two-step email change (the flow Android was missing).
    override suspend fun changeEmail(body: ChangeEmailRequest): ChangeEmailResult =
        notStubbed("changeEmail")

    override suspend fun confirmEmailChange(body: ConfirmEmailChangeRequest): ConfirmEmailChangeResult =
        notStubbed("confirmEmailChange")

    override suspend fun deleteAccount(body: DeleteAccountRequest): OkResponse = notStubbed("deleteAccount")

    override suspend fun listSessions(): SessionListResponse = notStubbed("listSessions")
    override suspend fun revokeSession(id: String): SessionRevokeResult = notStubbed("revokeSession")
    override suspend fun exportBackup(): ResponseBody = notStubbed("exportBackup")
    override suspend fun importBackup(mode: String, body: RequestBody): ImportResultResponse =
        notStubbed("importBackup")

    // Insurance PDF pack — a binary download, not a JSON body. No screen test
    // calls it today (the Settings row is the only caller), but the fake must
    // implement it or the whole test source set stops compiling.
    override suspend fun downloadInsurancePack(
        deviceIds: String?,
        includeSold: Boolean?,
    ): ResponseBody = notStubbed("downloadInsurancePack")

    override suspend fun catalog(): Catalog = notStubbed("catalog")

    override suspend fun listDevices(
        q: String?,
        category: String?,
        status: String?,
        sort: String?,
        dir: String?,
    ): DeviceListResponse = notStubbed("listDevices")

    override suspend fun getDevice(id: String): DeviceResponse = notStubbed("getDevice")
    override suspend fun createDevice(body: DeviceInput): DeviceResponse = notStubbed("createDevice")
    override suspend fun updateDevice(id: String, body: DeviceInput): DeviceResponse =
        notStubbed("updateDevice")

    override suspend fun deleteDevice(id: String): OkResponse = notStubbed("deleteDevice")

    override suspend fun createWarranty(deviceId: String, body: WarrantyInput): WarrantyResponse =
        notStubbed("createWarranty")

    override suspend fun updateWarranty(id: String, body: WarrantyInput): WarrantyResponse =
        notStubbed("updateWarranty")

    override suspend fun deleteWarranty(id: String): OkResponse = notStubbed("deleteWarranty")
    override suspend fun dismissWarrantyReminder(id: String): OkResponse =
        notStubbed("dismissWarrantyReminder")

    override suspend fun restoreWarrantyReminder(id: String): OkResponse =
        notStubbed("restoreWarrantyReminder")

    // Warranty claims (`GET/POST/PATCH/DELETE /api/v1/claims`). A separate
    // entity from the warranty plans above — one live claim per device.
    override suspend fun listClaims(deviceId: String?, status: String?): ClaimListResponse =
        notStubbed("listClaims")

    override suspend fun createClaim(body: ClaimInput): ClaimResponse = notStubbed("createClaim")
    override suspend fun getClaim(id: String): ClaimResponse = notStubbed("getClaim")
    override suspend fun updateClaim(id: String, body: ClaimInput): ClaimResponse =
        notStubbed("updateClaim")

    override suspend fun deleteClaim(id: String): OkResponse = notStubbed("deleteClaim")

    override suspend fun listSubscriptions(): SubscriptionListResponse = notStubbed("listSubscriptions")
    override suspend fun createSubscription(body: SubscriptionInput): SubscriptionResponse =
        notStubbed("createSubscription")

    override suspend fun getSubscription(id: String): SubscriptionResponse = notStubbed("getSubscription")
    override suspend fun updateSubscription(id: String, body: SubscriptionInput): SubscriptionResponse =
        notStubbed("updateSubscription")

    override suspend fun deleteSubscription(id: String): OkResponse = notStubbed("deleteSubscription")
    override suspend fun logSubscriptionPayment(id: String, body: PaymentInput): OkResponse =
        notStubbed("logSubscriptionPayment")

    override suspend fun renewSubscription(id: String): OkResponse = notStubbed("renewSubscription")

    override suspend fun listWishlist(): WishlistListResponse = notStubbed("listWishlist")
    override suspend fun getWishlistItem(id: String): WishlistDetailResponse = notStubbed("getWishlistItem")
    override suspend fun createWishlistItem(body: WishlistInput): WishlistResponse =
        notStubbed("createWishlistItem")

    override suspend fun updateWishlistItem(id: String, body: WishlistInput): WishlistResponse =
        notStubbed("updateWishlistItem")

    override suspend fun deleteWishlistItem(id: String): OkResponse = notStubbed("deleteWishlistItem")
    override suspend fun logWishlistPrice(id: String, body: PriceLogInput): OkResponse =
        notStubbed("logWishlistPrice")

    override suspend fun listPushSubscriptions(): PushSubscriptionListResponse =
        notStubbed("listPushSubscriptions")

    override suspend fun registerPush(body: NativePushInput): OkResponse = notStubbed("registerPush")
    override suspend fun unregisterPush(id: String): OkResponse = notStubbed("unregisterPush")
    override suspend fun sendTestPush(): TestPushResponse = notStubbed("sendTestPush")

    override suspend fun listAttachments(id: String): AttachmentListResponse = notStubbed("listAttachments")
    override suspend fun uploadDeviceAttachment(
        deviceId: String,
        file: MultipartBody.Part,
        description: RequestBody?,
    ): AttachmentResponse = notStubbed("uploadDeviceAttachment")

    override suspend fun getInbox(): AttachmentListResponse = notStubbed("getInbox")

    override suspend fun uploadAttachment(
        file: MultipartBody.Part,
        deviceId: RequestBody?,
        description: RequestBody?,
    ): AttachmentResponse = notStubbed("uploadAttachment")

    override suspend fun fileAttachment(id: String, body: FileAttachmentInput): Unit =
        notStubbed("fileAttachment")

    override suspend fun updateAttachment(id: String, body: AttachmentDescriptionInput): AttachmentResponse =
        notStubbed("updateAttachment")

    override suspend fun deleteAttachment(id: String): OkResponse = notStubbed("deleteAttachment")
    override suspend fun extractReceipt(body: ExtractReceiptInput): DraftDeviceResponse =
        notStubbed("extractReceipt")

    override suspend fun assessClaim(body: AssessClaimInput): ClaimAssessment =
        notStubbed("assessClaim")

    override suspend fun getAIOptIn(): AIOptInResponse = notStubbed("getAIOptIn")
    override suspend fun setAIOptIn(body: AIOptInRequest): AIOptInResponse = notStubbed("setAIOptIn")

    override suspend fun getFxRates(base: String): FxRates = notStubbed("getFxRates")

    override suspend fun getStats(): UserStats = notStubbed("getStats")
    override suspend fun getForecast(months: Int?): Forecast = notStubbed("getForecast")

    override suspend fun search(q: String?, limit: Int?): SearchResults = notStubbed("search")

    override suspend fun listUpcomingReminders(
        withinDays: Int,
        includeDismissed: Boolean?,
    ): RemindersResponse = notStubbed("listUpcomingReminders")

    override suspend fun listActionItems(snoozed: Boolean?): ActionQueue = notStubbed("listActionItems")

    override suspend fun snoozeActionItem(itemKey: String, body: SnoozeInput): SnoozeResult =
        notStubbed("snoozeActionItem")

    override suspend fun unsnoozeActionItem(itemKey: String): OkResponse =
        notStubbed("unsnoozeActionItem")

    override suspend fun getSubscriptionAudit(): SubscriptionAudit = notStubbed("getSubscriptionAudit")

    override suspend fun listShares(deviceId: String): DeviceShareListResponse = notStubbed("listShares")

    override suspend fun createShare(deviceId: String, body: CreateShareInput): CreateShareResponse =
        notStubbed("createShare")

    override suspend fun revokeShare(id: String): OkResponse = notStubbed("revokeShare")

    override suspend fun getServiceDirectory(deviceId: String): ServiceDirectoryResponse =
        notStubbed("getServiceDirectory")
}
