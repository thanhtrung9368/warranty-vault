package com.warrly.ui.screens.devices

import com.warrly.ui.screens.todayDayIso
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.warrly.network.ApiClient
import com.warrly.network.ApiService
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * `BulkAddDevicesScreen`'s state and the two calls it makes.
 *
 * The interesting logic lives in `BulkAddRules.kt`; this class only sequences it
 * and owns the editable list. Four behaviours are deliberate and pinned by
 * `BulkAddViewModelTest`:
 *
 *  1. **Partial success replaces the form with the failed rows.** The created
 *     rows are already on the server, so keeping them editable would invite a
 *     duplicate submit; the failed rows keep their stable row numbers and their
 *     server field errors, and the next submit sends only those.
 *  2. **The 409 keeps every row.** `LIMIT_REACHED` created nothing, so the draft
 *     the user typed is still exactly what they need to trim or retry. The
 *     quota is re-read after the refusal so "how many can I still add?" is
 *     answered from the current account, not a stale count.
 *  3. **A cumulative [State.addedCount] survives retries.** After "3 added, 2
 *     failed", fixing one row and retrying must still say 4 were added
 *     altogether, not just the second call's 1.
 *  4. **Blank rows are not submitted.** A row the user added but never filled
 *     would otherwise manufacture a server error for a device they never meant
 *     to add. See [isBlankForSubmit].
 */
class BulkAddViewModel(
    private val api: ApiService,
    /**
     * Injected so the tests are deterministic. The production default is the
     * same UTC `yyyy-MM-dd` the single-device form uses.
     */
    private val today: () -> String = ::utcTodayIso,
) : ViewModel() {

    /**
     * The 409 copy's inputs. [slots] is `null` when the device list could not be
     * loaded, which makes the screen say "the limit was hit" instead of
     * inventing a remaining count.
     */
    data class LimitReached(
        val serverMessage: String?,
        val slots: Int?,
    )

    data class State(
        val rows: List<BulkDeviceDraft>,
        val quota: BulkQuota? = null,
        val submitting: Boolean = false,
        /** Devices created by every successful submit in this screen session. */
        val addedCount: Int = 0,
        /**
         * The last submit's shape: rows sent, devices created, rows failed. The
         * success banner says "Added X of Y" from these, not from the current
         * form — the user may have edited or added rows since, and the sentence
         * is about the batch the server answered.
         */
        val lastBatchSize: Int = 0,
        val lastCreated: Int? = null,
        val lastFailed: Int = 0,
        /** Rows the server's reply neither created nor failed (contract violation). */
        val unaccountedCount: Int = 0,
        /** Set by 409 `limit_reached`; cleared by an edit or the next submit. */
        val limitReached: LimitReached? = null,
        /** Set by any other batch-level failure; the screen shows its message. */
        val error: BulkRequestFailure? = null,
    )

    /** Row numbers start at 1 and are never reused, including across retries. */
    private var nextKey: Int = 1

    private val _state = MutableStateFlow(
        State(rows = listOf(newBulkDraft(nextKey++, today()))),
    )
    val state: StateFlow<State> = _state.asStateFlow()

    /**
     * Load the account's remaining slots. Failure is deliberately silent: this
     * is only used for the 409 explanation, and the device form must remain
     * usable offline.
     */
    fun loadQuota() {
        viewModelScope.launch {
            try {
                val devices = api.listDevices().devices
                _state.update { it.copy(quota = bulkQuota(devices)) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Best effort only; the form still works with quota == null.
            }
        }
    }

    /** Append an empty row unless the contract's 50-row cap is already reached. */
    fun addRow() {
        val current = _state.value
        if (!canAddBulkRow(current.rows)) return
        val key = nextKey++
        _state.update {
            it.copy(
                rows = it.rows + newBulkDraft(key, today()),
                limitReached = null,
                error = null,
            )
        }
    }

    /**
     * Remove one row. The form always keeps at least one row: deleting the last
     * input would leave a screen with no way back except Back, and an empty
     * batch is not a thing the API can accept.
     */
    fun removeRow(key: Int) {
        _state.update {
            if (it.rows.size <= 1) return@update it
            it.copy(
                rows = it.rows.filterNot { row -> row.key == key },
                limitReached = null,
                error = null,
            )
        }
    }

    /** Set one field on one row, clearing that field's stale server error. */
    fun editRow(key: Int, field: BulkDeviceField, value: String) {
        _state.update { current ->
            current.copy(
                rows = current.rows.map { row ->
                    if (row.key == key) row.withField(field, value) else row
                },
                limitReached = null,
                error = null,
            )
        }
    }

    fun dismissLimitReached() {
        _state.update { it.copy(limitReached = null) }
    }

    fun dismissError() {
        _state.update { it.copy(error = null) }
    }

    /**
     * `POST /api/v1/devices/bulk` with the rows that carry any content.
     *
     * A 200 is reconciled by request index. A 409 `limit_reached` is the
     * all-or-nothing branch: rows are untouched and the remaining capacity is
     * refreshed from `GET /api/v1/devices` before the banner is shown. Any other
     * failure leaves the rows untouched and exposes the envelope's message and
     * `fieldErrors.devices`.
     */
    fun submit() {
        val current = _state.value
        if (current.submitting) return
        val toSend = bulkDraftsToSubmit(current.rows)
        if (toSend.isEmpty()) return

        _state.update {
            it.copy(
                submitting = true,
                limitReached = null,
                error = null,
                unaccountedCount = 0,
            )
        }

        viewModelScope.launch {
            try {
                val response = api.bulkCreateDevices(bulkDeviceRequest(toSend))
                val result = reconcileBulkSubmit(toSend, response)
                // Only allocate a fresh row number when the batch is fully
                // successful; a partial failure keeps the failed drafts and
                // their original numbers.
                val freshKey = if (result.failed.isEmpty()) nextKey++ else nextKey
                _state.update {
                    it.copy(
                        submitting = false,
                        rows = if (result.failed.isEmpty()) {
                            listOf(newBulkDraft(freshKey, today()))
                        } else {
                            result.failedDrafts
                        },
                        addedCount = it.addedCount + result.created.size,
                        lastBatchSize = toSend.size,
                        lastCreated = result.created.size,
                        lastFailed = result.failed.size,
                        unaccountedCount = result.unaccountedCount,
                        limitReached = null,
                        error = null,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val failure = bulkRequestError(e, ApiClient.json)
                if (failure.kind == BulkFailureKind.LIMIT_REACHED) {
                    // Nothing was created. Re-read the account so the number in
                    // the banner is current; if that read fails, keep whatever
                    // quota the screen already had (possibly null).
                    val freshQuota = try {
                        bulkQuota(api.listDevices().devices)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        null
                    }
                    val effectiveQuota = freshQuota ?: _state.value.quota
                    _state.update {
                        it.copy(
                            submitting = false,
                            quota = effectiveQuota,
                            limitReached = LimitReached(
                                serverMessage = failure.serverMessage,
                                slots = effectiveQuota?.newDeviceRemaining,
                            ),
                            error = null,
                        )
                    }
                } else {
                    _state.update {
                        it.copy(
                            submitting = false,
                            error = failure,
                            limitReached = null,
                        )
                    }
                }
            }
        }
    }
}

/**
 * `yyyy-MM-dd` in UTC, matching `AddDeviceSheet.today()` and the server's
 * date-only contract. Kept here (rather than in the pure rules file) so the
 * clock is an explicit dependency of the ViewModel.
 */
private fun utcTodayIso(): String = todayDayIso()
