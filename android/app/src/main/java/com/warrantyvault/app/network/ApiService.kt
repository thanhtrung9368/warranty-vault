package com.warrantyvault.app.network

import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.ResponseBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Multipart
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

interface ApiService {

    // ---- Auth ----
    @POST("api/v1/auth/register")
    suspend fun register(@Body body: RegisterInput): AuthSuccess

    @POST("api/v1/auth/login")
    suspend fun login(@Body body: LoginInput): AuthSuccess

    @POST("api/v1/auth/forgot")
    suspend fun forgotPassword(@Body body: ForgotRequest): OkResponse

    @POST("api/v1/auth/logout")
    suspend fun logout(): OkResponse

    @POST("api/v1/auth/change-password")
    suspend fun changePassword(@Body body: ChangePasswordRequest): ChangePasswordResponse

    @GET("api/v1/auth/me")
    suspend fun me(): MeResponse

    // Partial profile update. `displayName` and `locale` are two INDEPENDENT
    // tri-state fields (absent = unchanged, ""/null = clear, value = set), and a
    // body must carry at least one of them. Changing the email is a SEPARATE
    // two-step flow — see `changeEmail` / `confirmEmailChange` below, which are
    // part of the contract.
    @PATCH("api/v1/auth/me")
    suspend fun updateProfile(@Body body: UpdateProfileInput): UpdateProfileResponse

    // Same endpoint, body carrying ONLY `locale`. Split from `updateProfile` so
    // saving a name can never clear a stored language (or the reverse): the
    // server treats the two keys independently, and so does this client.
    @PATCH("api/v1/auth/me")
    suspend fun updateLocale(@Body body: UpdateLocaleInput): UpdateProfileResponse

    // ---- Email change (two steps) ----
    // Step 1 requires the current password and mails a single-use, 30-minute
    // token to the NEW address; `User.email` is unchanged until step 2. The
    // answer is deliberately NEUTRAL — the same message whether the token was
    // mailed or the address already belongs to another account — and carries no
    // token. Step 2 takes the raw token (or the whole mailed link) and needs NO
    // bearer token: the token itself is the credential.
    @POST("api/v1/auth/change-email")
    suspend fun changeEmail(@Body body: ChangeEmailRequest): ChangeEmailResult

    @POST("api/v1/auth/confirm-email-change")
    suspend fun confirmEmailChange(@Body body: ConfirmEmailChangeRequest): ConfirmEmailChangeResult

    // DELETE with a body — Retrofit's @DELETE forbids @Body, so use @HTTP.
    // The server requires the current password to confirm the deletion.
    @HTTP(method = "DELETE", path = "api/v1/auth/me", hasBody = true)
    suspend fun deleteAccount(@Body body: DeleteAccountRequest): OkResponse

    // ---- Device sessions ----
    // Active (not revoked, not expired) sessions only, most recently used first,
    // at most 100 rows; `sessions` is always `[]`, never null. The id here is the
    // Session row key — NOT the bearer token.
    @GET("api/v1/auth/sessions")
    suspend fun listSessions(): SessionListResponse

    // Revoking the CURRENT session is allowed and is what "đăng xuất khỏi thiết
    // bị này" means: the answer carries `current = true` plus a Vietnamese
    // message, and the holding client must drop its token (the next request is a
    // 401). A second call on the same id is still 200 with `alreadyRevoked`.
    @DELETE("api/v1/auth/sessions/{id}")
    suspend fun revokeSession(@Path("id") id: String): SessionRevokeResult

    // ---- Backup ----
    @Streaming
    @GET("api/v1/backup/export")
    suspend fun exportBackup(): ResponseBody

    @POST("api/v1/backup/import")
    suspend fun importBackup(
        @Query("mode") mode: String,
        @Body body: RequestBody,
    ): ImportResultResponse

    // ---- Catalog ----
    @GET("api/v1/catalog")
    suspend fun catalog(): Catalog

    // ---- Devices ----
    @GET("api/v1/devices")
    suspend fun listDevices(
        @Query("q") q: String? = null,
        @Query("category") category: String? = null,
        @Query("status") status: String? = null,
        @Query("sort") sort: String? = null,
        @Query("dir") dir: String? = null,
    ): DeviceListResponse

    @GET("api/v1/devices/{id}")
    suspend fun getDevice(@Path("id") id: String): DeviceResponse

    @POST("api/v1/devices")
    suspend fun createDevice(@Body body: DeviceInput): DeviceResponse

    @PATCH("api/v1/devices/{id}")
    suspend fun updateDevice(@Path("id") id: String, @Body body: DeviceInput): DeviceResponse

    @DELETE("api/v1/devices/{id}")
    suspend fun deleteDevice(@Path("id") id: String): OkResponse

    // ---- Warranties ----
    @POST("api/v1/devices/{id}/warranties")
    suspend fun createWarranty(
        @Path("id") deviceId: String,
        @Body body: WarrantyInput,
    ): WarrantyResponse

    @PATCH("api/v1/warranties/{id}")
    suspend fun updateWarranty(
        @Path("id") id: String,
        @Body body: WarrantyInput,
    ): WarrantyResponse

    @DELETE("api/v1/warranties/{id}")
    suspend fun deleteWarranty(@Path("id") id: String): OkResponse

    @POST("api/v1/warranties/{id}/reminder")
    suspend fun dismissWarrantyReminder(@Path("id") id: String): OkResponse

    @DELETE("api/v1/warranties/{id}/reminder")
    suspend fun restoreWarrantyReminder(@Path("id") id: String): OkResponse

    // ---- Subscriptions ----
    @GET("api/v1/subscriptions")
    suspend fun listSubscriptions(): SubscriptionListResponse

    @POST("api/v1/subscriptions")
    suspend fun createSubscription(@Body body: SubscriptionInput): SubscriptionResponse

    @GET("api/v1/subscriptions/{id}")
    suspend fun getSubscription(@Path("id") id: String): SubscriptionResponse

    @PATCH("api/v1/subscriptions/{id}")
    suspend fun updateSubscription(
        @Path("id") id: String,
        @Body body: SubscriptionInput,
    ): SubscriptionResponse

    @DELETE("api/v1/subscriptions/{id}")
    suspend fun deleteSubscription(@Path("id") id: String): OkResponse

    @POST("api/v1/subscriptions/{id}/payments")
    suspend fun logSubscriptionPayment(
        @Path("id") id: String,
        @Body body: PaymentInput,
    ): OkResponse

    @POST("api/v1/subscriptions/{id}/renew")
    suspend fun renewSubscription(@Path("id") id: String): OkResponse

    // ---- Wishlist ----
    @GET("api/v1/wishlist")
    suspend fun listWishlist(): WishlistListResponse

    @GET("api/v1/wishlist/{id}")
    suspend fun getWishlistItem(@Path("id") id: String): WishlistDetailResponse

    @POST("api/v1/wishlist")
    suspend fun createWishlistItem(@Body body: WishlistInput): WishlistResponse

    @PATCH("api/v1/wishlist/{id}")
    suspend fun updateWishlistItem(
        @Path("id") id: String,
        @Body body: WishlistInput,
    ): WishlistResponse

    @DELETE("api/v1/wishlist/{id}")
    suspend fun deleteWishlistItem(@Path("id") id: String): OkResponse

    @POST("api/v1/wishlist/{id}/prices")
    suspend fun logWishlistPrice(
        @Path("id") id: String,
        @Body body: PriceLogInput,
    ): OkResponse

    // ---- Push ----
    @GET("api/v1/push")
    suspend fun listPushSubscriptions(): PushSubscriptionListResponse

    @POST("api/v1/push/register")
    suspend fun registerPush(@Body body: NativePushInput): OkResponse

    @DELETE("api/v1/push/{id}")
    suspend fun unregisterPush(@Path("id") id: String): OkResponse

    @POST("api/v1/push/test")
    suspend fun sendTestPush(): TestPushResponse

    // ---- Attachments ----
    @GET("api/v1/devices/{id}/attachments")
    suspend fun listAttachments(@Path("id") id: String): AttachmentListResponse

    @Multipart
    @POST("api/v1/devices/{id}/attachments")
    suspend fun uploadAttachment(
        @Path("id") deviceId: String,
        @Part file: MultipartBody.Part,
        @Part("description") description: RequestBody? = null,
    ): AttachmentResponse

    // Only the description is mutable; the file bytes need delete + re-upload.
    // Someone else's id answers 404 (not 403) — the server joins through the
    // owning device and confirms nothing.
    @PATCH("api/v1/attachments/{id}")
    suspend fun updateAttachment(
        @Path("id") id: String,
        @Body body: AttachmentDescriptionInput,
    ): AttachmentResponse

    @DELETE("api/v1/attachments/{id}")
    suspend fun deleteAttachment(@Path("id") id: String): OkResponse

    // ---- AI receipt OCR ----
    // Returns a DRAFT only — the caller pre-fills the device form and the user
    // confirms before saving. Decryption/validation/catalog-mapping is server-side.
    @Multipart
    @POST("api/v1/ai/extract-receipt")
    suspend fun extractReceipt(
        @Part file: MultipartBody.Part,
    ): DraftDeviceResponse

    // ---- Handover certificate / share links (FEATURE_IDEAS #2) ----
    //
    // Owner-side list. Never carries `token` — the server keeps only its sha256,
    // so a previously created link is unrecoverable by design. A device that
    // belongs to someone else answers `[]`, not 404.
    @GET("api/v1/devices/{id}/shares")
    suspend fun listShares(@Path("id") deviceId: String): DeviceShareListResponse

    // The ONLY response in the whole API that carries a share token, and the
    // only chance to hand it to the user. Max 10 live links per device (409 on
    // the 11th). An unknown body field is a 400 rather than a silent default, so
    // CreateShareInput spells every field it sends.
    @POST("api/v1/devices/{id}/shares")
    suspend fun createShare(
        @Path("id") deviceId: String,
        @Body body: CreateShareInput,
    ): CreateShareResponse

    // Idempotent: revoking an already-revoked link is still 200. A link that
    // belongs to someone else is a 404 — indistinguishable from a missing id,
    // which is the point.
    @DELETE("api/v1/shares/{id}")
    suspend fun revokeShare(@Path("id") id: String): OkResponse

    // ---- Warranty directory (#15) ----
    // One device's answer to "mang máy đi bảo hành ở đâu". `brand` and each
    // `centres[].provider` are nullable ON PURPOSE: null means the app does not
    // know (nothing seeded, or an ambiguous free-text match) — never a guess.
    @GET("api/v1/devices/{id}/service-directory")
    suspend fun getServiceDirectory(@Path("id") deviceId: String): ServiceDirectoryResponse

    @GET("api/v1/ai/opt-in")
    suspend fun getAIOptIn(): AIOptInResponse

    @PUT("api/v1/ai/opt-in")
    suspend fun setAIOptIn(@Body body: AIOptInRequest): AIOptInResponse

    // ---- Cross-entity search ----
    // One grouped lookup over devices + subscriptions + wishlist (openapi
    // `GET /api/v1/search`). `limit` is PER GROUP (default 20, max 50) and a
    // blank `q` is a 200 with empty groups — never a 400.
    @GET("api/v1/search")
    suspend fun search(
        @Query("q") q: String? = null,
        @Query("limit") limit: Int? = null,
    ): SearchResults

    // ---- Stats ----
    @GET("api/v1/stats")
    suspend fun getStats(): UserStats

    // Forward-looking half of the stats screen. Separate endpoint on purpose:
    // `/stats` is a round trip all three clients already make and its shape must
    // not change. `months` is 1–24 (server default 12) and a non-numeric /
    // out-of-range value is a 400 — never a silent default.
    @GET("api/v1/forecast")
    suspend fun getForecast(@Query("months") months: Int? = null): Forecast

    // ---- Reminders ----
    @GET("api/v1/reminders")
    suspend fun listUpcomingReminders(@Query("withinDays") withinDays: Int = 30): RemindersResponse

    // ---- "Việc cần xử lý" (action queue) ----
    // `snoozed = true` only ADDS the rows a snooze is currently hiding; `counts`
    // in the response keeps counting the actionable subset either way. Omitting
    // the parameter is the default queue, so it is nullable and sent only when
    // true — never `?snoozed=false`.
    @GET("api/v1/actions")
    suspend fun listActionItems(@Query("snoozed") snoozed: Boolean? = null): ActionQueue

    // `itemKey` is `<KIND>:<entityId>`. OkHttp's path-segment encode set leaves
    // ':' alone (it is not one of ` " <>^`{}|/\?#`), so the key reaches the
    // server verbatim — which is what the server documents. The body always
    // carries an explicit `days`; the client never leans on the 90-day default.
    @POST("api/v1/actions/{itemKey}/snooze")
    suspend fun snoozeActionItem(
        @Path("itemKey") itemKey: String,
        @Body body: SnoozeInput,
    ): SnoozeResult

    // Un-snooze is a DELETE on the same path. The server answers 404 when the
    // item was not actually snoozed (never a silent 200), so the UI can say the
    // state had drifted instead of pretending it worked.
    @DELETE("api/v1/actions/{itemKey}/snooze")
    suspend fun unsnoozeActionItem(@Path("itemKey") itemKey: String): OkResponse

    // ---- Subscription self-audit ----
    // Read-only by construction: the endpoint has no write path, cancels nothing
    // and edits no price (`advisory` is always true). It reads PAYMENT HISTORY,
    // never usage — the app has no usage telemetry, which is why the copy says
    // "lâu rồi không thấy ghi nhận gì" and never "không dùng".
    @GET("api/v1/subscriptions/audit")
    suspend fun getSubscriptionAudit(): SubscriptionAudit
}
