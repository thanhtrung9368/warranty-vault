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

    // DELETE with a body — Retrofit's @DELETE forbids @Body, so use @HTTP.
    // The server requires the current password to confirm the deletion.
    @HTTP(method = "DELETE", path = "api/v1/auth/me", hasBody = true)
    suspend fun deleteAccount(@Body body: DeleteAccountRequest): OkResponse

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
    ): AttachmentUploadResponse

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

    @GET("api/v1/ai/opt-in")
    suspend fun getAIOptIn(): AIOptInResponse

    @PUT("api/v1/ai/opt-in")
    suspend fun setAIOptIn(@Body body: AIOptInRequest): AIOptInResponse

    // ---- Stats ----
    @GET("api/v1/stats")
    suspend fun getStats(): UserStats

    // ---- Reminders ----
    @GET("api/v1/reminders")
    suspend fun listUpcomingReminders(@Query("withinDays") withinDays: Int = 30): RemindersResponse
}
