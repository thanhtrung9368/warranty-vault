package com.warrantyvault.app.testing

import com.warrantyvault.app.network.AIOptInRequest
import com.warrantyvault.app.network.AIOptInResponse
import com.warrantyvault.app.network.ActionQueue
import com.warrantyvault.app.network.ApiService
import com.warrantyvault.app.network.AttachmentDescriptionInput
import com.warrantyvault.app.network.AttachmentListResponse
import com.warrantyvault.app.network.AttachmentResponse
import com.warrantyvault.app.network.AuthSuccess
import com.warrantyvault.app.network.Catalog
import com.warrantyvault.app.network.ChangePasswordRequest
import com.warrantyvault.app.network.ChangePasswordResponse
import com.warrantyvault.app.network.CreateShareInput
import com.warrantyvault.app.network.CreateShareResponse
import com.warrantyvault.app.network.DeleteAccountRequest
import com.warrantyvault.app.network.DeviceInput
import com.warrantyvault.app.network.DeviceListResponse
import com.warrantyvault.app.network.DeviceResponse
import com.warrantyvault.app.network.DeviceShareListResponse
import com.warrantyvault.app.network.DraftDeviceResponse
import com.warrantyvault.app.network.Forecast
import com.warrantyvault.app.network.ForgotRequest
import com.warrantyvault.app.network.ImportResultResponse
import com.warrantyvault.app.network.LoginInput
import com.warrantyvault.app.network.MeResponse
import com.warrantyvault.app.network.NativePushInput
import com.warrantyvault.app.network.OkResponse
import com.warrantyvault.app.network.PaymentInput
import com.warrantyvault.app.network.PriceLogInput
import com.warrantyvault.app.network.PushSubscriptionListResponse
import com.warrantyvault.app.network.RegisterInput
import com.warrantyvault.app.network.RemindersResponse
import com.warrantyvault.app.network.SearchResults
import com.warrantyvault.app.network.ServiceDirectoryResponse
import com.warrantyvault.app.network.SessionListResponse
import com.warrantyvault.app.network.SessionRevokeResult
import com.warrantyvault.app.network.SnoozeInput
import com.warrantyvault.app.network.SnoozeResult
import com.warrantyvault.app.network.SubscriptionAudit
import com.warrantyvault.app.network.SubscriptionInput
import com.warrantyvault.app.network.SubscriptionListResponse
import com.warrantyvault.app.network.SubscriptionResponse
import com.warrantyvault.app.network.TestPushResponse
import com.warrantyvault.app.network.UpdateProfileInput
import com.warrantyvault.app.network.UpdateProfileResponse
import com.warrantyvault.app.network.UserStats
import com.warrantyvault.app.network.WarrantyInput
import com.warrantyvault.app.network.WarrantyResponse
import com.warrantyvault.app.network.WishlistDetailResponse
import com.warrantyvault.app.network.WishlistInput
import com.warrantyvault.app.network.WishlistListResponse
import com.warrantyvault.app.network.WishlistResponse
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

    override suspend fun deleteAccount(body: DeleteAccountRequest): OkResponse = notStubbed("deleteAccount")

    override suspend fun listSessions(): SessionListResponse = notStubbed("listSessions")
    override suspend fun revokeSession(id: String): SessionRevokeResult = notStubbed("revokeSession")
    override suspend fun exportBackup(): ResponseBody = notStubbed("exportBackup")
    override suspend fun importBackup(mode: String, body: RequestBody): ImportResultResponse =
        notStubbed("importBackup")

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
    override suspend fun uploadAttachment(
        deviceId: String,
        file: MultipartBody.Part,
        description: RequestBody?,
    ): AttachmentResponse = notStubbed("uploadAttachment")

    override suspend fun updateAttachment(id: String, body: AttachmentDescriptionInput): AttachmentResponse =
        notStubbed("updateAttachment")

    override suspend fun deleteAttachment(id: String): OkResponse = notStubbed("deleteAttachment")
    override suspend fun extractReceipt(file: MultipartBody.Part): DraftDeviceResponse =
        notStubbed("extractReceipt")

    override suspend fun getAIOptIn(): AIOptInResponse = notStubbed("getAIOptIn")
    override suspend fun setAIOptIn(body: AIOptInRequest): AIOptInResponse = notStubbed("setAIOptIn")

    override suspend fun getStats(): UserStats = notStubbed("getStats")
    override suspend fun getForecast(months: Int?): Forecast = notStubbed("getForecast")

    override suspend fun search(q: String?, limit: Int?): SearchResults = notStubbed("search")

    override suspend fun listUpcomingReminders(withinDays: Int): RemindersResponse =
        notStubbed("listUpcomingReminders")

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
