-- Hạn đổi trả / "1 đổi 1" (FEATURE_IDEAS #1).
--
-- The deadline is NEVER stored. It is always
--     COALESCE("receivedAt", "purchaseDate") + "returnWindowDays" * INTERVAL '1 day'
-- so editing either input moves it immediately and the two can never disagree.
-- `integer * INTERVAL '1 day'` is the plain interval_mul operator: it keeps
-- sqlc's type inference happy and avoids make_interval(days => $n) named-argument
-- parsing.
--
-- Every query skips the two states that have no countdown:
--   * "returnWindowDays" IS NULL → unknown (the user never said)
--   * "returnWindowDays" <= 0    → the shop offers no exchange window at all
--     (screen protectors, and the appliance brands FPT sells repair-only).

-- name: ListOpenReturnWindows :many
-- Backs GET /api/v1/return-windows: the user's ACTIVE devices whose exchange
-- window is STILL OPEN, i.e. deadline >= $2 (the caller's start-of-today).
-- Ordered by deadline ASC so the most urgent device is first.
--
-- No lookahead horizon is applied on purpose: an open window is actionable by
-- definition, and the per-user set is bounded by MAX_DEVICES_PER_USER (50). The
-- caller derives `daysLeft` from the returned deadline.
SELECT
    d.*,
    (COALESCE(d."receivedAt", d."purchaseDate")
        + (d."returnWindowDays" * INTERVAL '1 day'))::timestamp AS "returnDeadline"
FROM "Device" d
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND d."returnWindowDays" IS NOT NULL
  AND d."returnWindowDays" > 0
  AND (COALESCE(d."receivedAt", d."purchaseDate")
        + (d."returnWindowDays" * INTERVAL '1 day')) >= sqlc.arg('startOfToday')::timestamp
ORDER BY "returnDeadline" ASC;

-- name: ListReturnWindowsInWindow :many
-- Cron bucket (T-3 / T-1). Same shape as ListWarrantiesInWindow: the caller
-- passes the [start, end) calendar-day window, the query skips devices already
-- stamped today (same-day idempotency, the migration 0002 pattern), and it
-- returns user_id so the caller can fan out push notifications.
--
-- Only ACTIVE devices: once a device is SOLD / BROKEN / LOST the exchange window
-- is moot, and the same filter is what ListWarrantiesInWindow does.
SELECT
    d.id             AS id,
    d."userId"       AS user_id,
    d.name           AS device_name,
    d."purchaseDate" AS purchase_date,
    d."receivedAt"   AS received_at,
    d."returnWindowDays" AS return_window_days,
    (COALESCE(d."receivedAt", d."purchaseDate")
        + (d."returnWindowDays" * INTERVAL '1 day'))::timestamp AS "returnDeadline"
FROM "Device" d
WHERE d.status = 'ACTIVE'
  AND d."returnWindowDays" IS NOT NULL
  AND d."returnWindowDays" > 0
  AND (COALESCE(d."receivedAt", d."purchaseDate")
        + (d."returnWindowDays" * INTERVAL '1 day')) >= sqlc.arg('windowStart')::timestamp
  AND (COALESCE(d."receivedAt", d."purchaseDate")
        + (d."returnWindowDays" * INTERVAL '1 day')) <  sqlc.arg('windowEnd')::timestamp
  AND (d."returnWindowNotifiedAt" IS NULL
       OR d."returnWindowNotifiedAt"::date < CURRENT_DATE);

-- name: StampDeviceReturnWindowNotified :exec
-- Cron stamps this after a successful fan-out so a second run on the same day is
-- filtered out by ListReturnWindowsInWindow. Bumps "updatedAt" like the other two
-- subject-table stamps (StampWishlistNotified, StampSubscriptionRenewalNotified).
UPDATE "Device"
SET "returnWindowNotifiedAt" = NOW(),
    "updatedAt" = NOW()
WHERE id = $1;
