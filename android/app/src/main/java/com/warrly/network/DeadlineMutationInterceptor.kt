package com.warrly.network

import okhttp3.Interceptor
import okhttp3.Response

/**
 * Notifies the widget cache that a write succeeded.
 *
 * This is the central seam for "after any mutation that changes deadlines": every
 * screen goes through the one `ApiService`, so hooking OkHttp catches device,
 * warranty, reminder, backup-import and wishlist-purchase writes without adding
 * a callback to a dozen ViewModels (and without one of them being forgotten
 * later). The predicate is [affectsDeadlineSnapshot], so reads and irrelevant
 * writes — attachments, shares, subscriptions — stay silent.
 *
 * *After* the response, not before: a 4xx/5xx mutation changed nothing, and
 * refreshing then would only hide the previous snapshot behind a failed
 * request.
 *
 * The callback must be cheap and non-suspending. `App` wires it to a debounced
 * coroutine on `ioScope`; the widget is never refreshed on the network thread.
 */
class DeadlineMutationInterceptor(
    private val onDeadlineMutation: () -> Unit,
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val response = chain.proceed(request)
        if (response.isSuccessful &&
            affectsDeadlineSnapshot(request.method, request.url.encodedPath)
        ) {
            onDeadlineMutation()
        }
        return response
    }
}
