package app.warrly.testing

import app.warrly.network.AIOptInRequest
import app.warrly.network.AIOptInResponse
import app.warrly.network.ActionQueue
import app.warrly.network.ApiService
import app.warrly.network.AttachmentDescriptionInput
import app.warrly.network.AttachmentListResponse
import app.warrly.network.AttachmentResponse
import app.warrly.network.AuthSuccess
import app.warrly.network.Catalog
import app.warrly.network.ChangeEmailRequest
import app.warrly.network.ChangeEmailResult
import app.warrly.network.ChangePasswordRequest
import app.warrly.network.ChangePasswordResponse
import app.warrly.network.ConfirmEmailChangeRequest
import app.warrly.network.ConfirmEmailChangeResult
import app.warrly.network.CreateShareInput
import app.warrly.network.CreateShareResponse
import app.warrly.network.DeleteAccountRequest
import app.warrly.network.DeviceInput
import app.warrly.network.DeviceListResponse
import app.warrly.network.DeviceResponse
import app.warrly.network.DeviceShareListResponse
import app.warrly.network.DraftDeviceResponse
import app.warrly.network.Forecast
import app.warrly.network.ForgotRequest
import app.warrly.network.ImportResultResponse
import app.warrly.network.LoginInput
import app.warrly.network.MeResponse
import app.warrly.network.NativePushInput
import app.warrly.network.OkResponse
import app.warrly.network.PaymentInput
import app.warrly.network.PriceLogInput
import app.warrly.network.PushSubscriptionListResponse
import app.warrly.network.RegisterInput
import app.warrly.network.RemindersResponse
import app.warrly.network.SearchResults
import app.warrly.network.ServiceDirectoryResponse
import app.warrly.network.SessionListResponse
import app.warrly.network.SessionRevokeResult
import app.warrly.network.SnoozeInput
import app.warrly.network.SnoozeResult
import app.warrly.network.SubscriptionAudit
import app.warrly.network.SubscriptionInput
import app.warrly.network.SubscriptionListResponse
import app.warrly.network.SubscriptionResponse
import app.warrly.network.TestPushResponse
import app.warrly.network.UpdateLocaleInput
import app.warrly.network.UpdateProfileInput
import app.warrly.network.UpdateProfileResponse
import app.warrly.network.UserStats
import app.warrly.network.WarrantyInput
import app.warrly.network.WarrantyResponse
import app.warrly.network.WishlistDetailResponse
import app.warrly.network.WishlistInput
import app.warrly.network.WishlistListResponse
import app.warrly.network.WishlistResponse
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
