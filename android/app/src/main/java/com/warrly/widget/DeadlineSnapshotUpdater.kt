package com.warrly.widget

import android.content.Context
import com.warrly.auth.TokenStore
import com.warrly.network.ApiService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicLong

/**
 * Keeps the widget snapshot in step with the account.
 *
 * ## When a capture happens
 *
 *  1. **App foreground** — `MainActivity` calls [refresh] on `ON_START` and when
 *     a cold launch finishes authenticating. This is the "the app is open"
 *     moment the report asks for: the widget is guaranteed to be no older than
 *     the last time the user actually looked.
 *  2. **After any deadline-changing write** — [onDeadlineMutation] is wired to
 *     the OkHttp interceptor (`DeadlineMutationInterceptor`), so it fires after
 *     device/warranty/reminder/backup-import/wishlist-purchase writes without
 *     every ViewModel remembering to call it. A short debounce collapses the
 *     create-then-navigate-then-load burst that follows a form save into one
 *     `GET /api/v1/reminders`.
 *  3. **Sign-out** — [clear] drops the capture. A widget must never keep showing
 *     the previous account's device names after the session ends.
 *
 * ## Why the network call is safe here
 *
 * The widget itself never calls the API (an `onUpdate` broadcast has a tight
 * budget and no guaranteed network). This class runs on `App.ioScope`, the same
 * process-scoped IO the share-copy uses, and only while the app is alive. It
 * fetches the exact endpoint the Reminders screen already uses, with the widest
 * horizon the contract allows (365 days), and writes only local data.
 *
 * ## Failure is not destructive
 *
 * A failed refresh leaves the previous snapshot untouched. The widget always
 * shows its capture time, so the user sees old data as old instead of being
 * handed an empty widget (which would read as "nothing is due") on a bad
 * connection.
 */
class DeadlineSnapshotUpdater(
    context: Context,
    private val scope: CoroutineScope,
    private val tokenStore: TokenStore,
) {

    private val appContext: Context = context.applicationContext

    @Volatile
    private var api: ApiService? = null

    /**
     * Monotonic fetch token. A fetch that started before a newer fetch or a
     * sign-out must not overwrite the newer result/cleared store when it finally
     * returns; comparing its generation after the call is what enforces that.
     */
    private val generation = AtomicLong(0)

    /** Serializes the actual store write/clear so login/logout cannot interleave. */
    private val storeMutex = Mutex()

    private var mutationJob: Job? = null

    /**
     * Last time a foreground refresh *started*, for a tiny duplicate guard.
     * `ON_START` and the auth collector both fire on a cold launch; an activity
     * recreation fires `ON_START` again. Five seconds collapses those bursts
     * without hiding real user-visible changes (a mutation bypasses it).
     */
    @Volatile
    private var lastForegroundFetchAt: Long = 0L

    /** Called once by `App` after the Retrofit service exists. */
    fun attach(api: ApiService) {
        this.api = api
    }

    /**
     * Captures a fresh snapshot on the process-scoped IO scope.
     *
     * Non-suspending on purpose: it is called from lifecycle callbacks and must
     * not block a frame. Duplicate foreground calls within
     * [FOREGROUND_DEDUPE_MS] are dropped.
     */
    fun refresh() {
        val now = System.currentTimeMillis()
        if (now - lastForegroundFetchAt < FOREGROUND_DEDUPE_MS) return
        lastForegroundFetchAt = now
        scope.launch { fetchAndStore() }
    }

    /**
     * Debounced refresh after a successful deadline-changing write.
     *
     * The debounce exists because one user action is often several requests
     * (create device → create warranty → reload list); refreshing after each
     * would be three `GET /api/v1/reminders` for one screen save.
     */
    fun onMutation() {
        mutationJob?.cancel()
        mutationJob = scope.launch {
            delay(MUTATION_DEBOUNCE_MS)
            // A mutation is user-visible; it must not be swallowed by the
            // foreground dedupe window.
            lastForegroundFetchAt = 0L
            fetchAndStore()
        }
    }

    /**
     * Drops the snapshot and repaints every widget into the no-data state.
     *
     * Called when the session becomes unauthenticated (logout, account deletion,
     * a token that no longer validates on bootstrap). Bumping [generation] also
     * invalidates any fetch already in flight, so a slow response cannot write
     * the signed-out user's data back after the clear is applied.
     */
    fun clear() {
        mutationJob?.cancel()
        val clearGeneration = generation.incrementAndGet()
        scope.launch {
            storeMutex.withLock {
                // A sign-in/refresh that started after this clear superseded
                // it; deleting the new session's snapshot would leave an empty
                // widget until the next foreground.
                if (generation.get() != clearGeneration) return@withLock
                DeadlineSnapshotStore.clear(appContext)
                DeadlineWidgetPublisher.updateAll(appContext)
            }
        }
    }

    private suspend fun fetchAndStore() {
        val service = api ?: return
        // An unauthenticated widget has no data to show; do not fire a request
        // that can only 401 after logout.
        if (tokenStore.read().isNullOrBlank()) return

        val fetchGeneration = generation.incrementAndGet()
        val reminders = try {
            service.listUpcomingReminders(withinDays = WIDGET_HORIZON_DAYS).reminders
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            // Keep the last snapshot: a stale widget with an honest "as of" is
            // better than an empty one that claims nothing is due.
            return
        }

        storeMutex.withLock {
            // A newer fetch or a sign-out superseded this one while it was on
            // the wire; its data is no longer the newest truth.
            if (generation.get() != fetchGeneration) return
            DeadlineSnapshotStore.write(
                appContext,
                deadlineSnapshot(reminders, System.currentTimeMillis()),
            )
            DeadlineWidgetPublisher.updateAll(appContext)
        }
    }

    companion object {
        /** Collapses a form save's burst of writes into one refresh. */
        const val MUTATION_DEBOUNCE_MS: Long = 1_500L

        /** Duplicate guard for ON_START + auth-transition + recreation. */
        const val FOREGROUND_DEDUPE_MS: Long = 5_000L
    }
}
