-- "Việc cần xử lý" — hàng đợi việc cần người dùng quyết định (FEATURE_IDEAS #3).
--
-- Every item kind below is DERIVED from rows that already exist. Nothing here
-- writes to a new state machine; the queries answer "what does the data already
-- say that nobody is looking at?". In particular "bảo hành hết hạn hôm qua" is a
-- separate query (ListActionWarrantiesJustExpired, endDate < start-of-today)
-- because the existing reminders feed only looks FORWARD
-- (warranties.sql ListUpcomingReminders: `w."endDate" >= endDateFrom`) and its
-- response shape is frozen for three clients.
--
-- The `$2` / `$3` timestamp parameters are the caller's calendar boundaries
-- (start of today, and a horizon). They are passed in rather than computed with
-- NOW() so the whole surface is one consistent instant per request and the
-- behaviour is testable without freezing the database clock.

-- name: ListActionWarrantiesJustExpired :many
-- Warranty that expired within the lookback horizon and whose device is still
-- ACTIVE — i.e. exactly the rows that fell off every screen when endDate passed.
-- Ordered newest-expiry-first: the freshest loss is the one still recoverable
-- (an extended package can usually be bought right after expiry).
SELECT
    w.id         AS warranty_id,
    w."deviceId" AS device_id,
    d.name       AS device_name,
    w.type       AS warranty_type,
    w.provider   AS provider,
    w."endDate"  AS end_date
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND w."endDate" <  sqlc.arg('expiredBefore')::timestamp
  AND w."endDate" >= sqlc.arg('expiredAfter')::timestamp
ORDER BY w."endDate" DESC;

-- name: ListActionDevicesWithoutWarranty :many
-- An ACTIVE device the app knows nothing about, protection-wise: zero Warranty
-- rows. The user may still be inside the shop's exchange window and cannot be
-- told, because there is no package to hang a date on.
SELECT
    d.id             AS device_id,
    d.name           AS device_name,
    d."purchaseDate" AS purchase_date
FROM "Device" d
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM "Warranty" w WHERE w."deviceId" = d.id)
ORDER BY d."purchaseDate" ASC;

-- name: ListActionDevicesStatusStale :many
-- `status = 'ACTIVE'` while the newest warranty ended before the lookback
-- horizon. Nothing in the app ever writes 'EXPIRED' (services/devices.go only
-- validates the enum), so a `status=EXPIRED` filter returns a different set from
-- "bảo hành đã hết" — this is that discrepancy, made visible.
--
-- Deliberately disjoint from ListActionWarrantiesJustExpired: this one requires
-- the LAST endDate to be OLDER than the horizon, that one requires an endDate
-- INSIDE it. A device can therefore appear in at most one of the two.
SELECT
    d.id            AS device_id,
    d.name          AS device_name,
    MAX(w."endDate")::timestamp AS last_end_date
FROM "Device" d
JOIN "Warranty" w ON w."deviceId" = d.id
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
GROUP BY d.id, d.name
HAVING MAX(w."endDate") < sqlc.arg('olderThan')::timestamp
ORDER BY MAX(w."endDate") ASC;

-- name: ListActionDevicesMissingSerial :many
-- VN warranty is keyed to the IMEI / serial number: the repair centre looks the
-- device up by it, and a wrong or absent one is the difference between an
-- accepted and a refused claim. Only devices that plausibly have one are asked
-- about by the client; the query itself does not guess at categories.
SELECT
    d.id   AS device_id,
    d.name AS device_name
FROM "Device" d
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND (d."serialNumber" IS NULL OR btrim(d."serialNumber") = '')
ORDER BY d."purchaseDate" ASC;

-- name: ListActionDevicesMissingReceipt :many
-- ACTIVE device with no Attachment row at all: no invoice image, no PDF. When
-- the counter asks "hoá đơn đâu", there is nothing to show.
SELECT
    d.id   AS device_id,
    d.name AS device_name
FROM "Device" d
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM "Attachment" a WHERE a."deviceId" = d.id)
ORDER BY d."purchaseDate" ASC;

-- name: ListActionReturnWindowsClosing :many
-- The exchange window is closing inside [startOfToday, horizon] (the service
-- passes ACTION_RETURN_WINDOW_DAYS = 7). This is the same derived deadline as
-- queries/returnwindow.sql, reused so the queue and the dedicated endpoint can
-- never disagree about which day it is.
SELECT
    d.id   AS device_id,
    d.name AS device_name,
    (COALESCE(d."receivedAt", d."purchaseDate")
        + (d."returnWindowDays" * INTERVAL '1 day'))::timestamp AS "returnDeadline"
FROM "Device" d
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND d."returnWindowDays" IS NOT NULL
  AND d."returnWindowDays" > 0
  AND (COALESCE(d."receivedAt", d."purchaseDate")
        + (d."returnWindowDays" * INTERVAL '1 day')) >= sqlc.arg('windowStart')::timestamp
  AND (COALESCE(d."receivedAt", d."purchaseDate")
        + (d."returnWindowDays" * INTERVAL '1 day')) <= sqlc.arg('windowEnd')::timestamp
ORDER BY "returnDeadline" ASC;

-- name: ListActionReturnWindowUnknown :many
-- A device bought inside the cold-start horizon (the service passes
-- ACTION_RETURN_WINDOW_UNKNOWN_DAYS = 30) whose exchange window the app does not
-- know, so it cannot warn about it at all. This is the entry point for feature #1:
-- it is the only moment at which the user still remembers the number.
SELECT
    d.id             AS device_id,
    d.name           AS device_name,
    d."purchaseDate" AS purchase_date
FROM "Device" d
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND d."returnWindowDays" IS NULL
  AND d."purchaseDate" >= sqlc.arg('purchaseFrom')::timestamp
  AND d."purchaseDate" <  sqlc.arg('purchaseTo')::timestamp
ORDER BY d."purchaseDate" DESC;

-- name: ListActionSubscriptionsRenewingNoCancelUrl :many
-- autoRenew = true and the next charge is inside the horizon, but there is no
-- cancelUrl to act on. The renewal push already fires (cron bucket 4); what is
-- missing is the link the user needs to stop it.
SELECT
    s.id,
    s.name,
    s.price,
    s."billingCycle" AS billing_cycle,
    s."renewalDate"  AS renewal_date
FROM "Subscription" s
WHERE s."userId" = $1
  AND s.status = 'ACTIVE'
  AND s."autoRenew" = true
  AND s."billingCycle" <> 'LIFETIME'
  AND s."renewalDate" >= sqlc.arg('renewalFrom')::timestamp
  AND s."renewalDate" <  sqlc.arg('renewalTo')::timestamp
  AND (s."cancelUrl" IS NULL OR btrim(s."cancelUrl") = '')
ORDER BY s."renewalDate" ASC;

-- name: ListActionSubscriptionsPaidNotAdvanced :many
-- The newest recorded payment already covers (or postdates) a renewalDate that is
-- now in the past — so the renewal date the app displays is stale: the user paid,
-- but nothing advanced the cycle.
--
-- Honest scope note: this is the only "charged but not recorded" discrepancy the
-- data can support, and it is the INVERSE of that phrasing. The app cannot see a
-- charge it did not make; when the cron auto-bills it writes both the
-- SubscriptionPayment row and the advanced renewalDate inside one transaction, so
-- that path never produces this state. What does produce it is a payment logged
-- by hand through POST /api/v1/subscriptions/{id}/payments without renewing.
SELECT
    s.id            AS id,
    s.name          AS name,
    s.price         AS price,
    s."renewalDate" AS renewal_date,
    p."paidAt"      AS last_paid_at,
    p.amount        AS last_paid_amount
FROM "Subscription" s
JOIN LATERAL (
    SELECT pp."paidAt", pp.amount
    FROM "SubscriptionPayment" pp
    WHERE pp."subscriptionId" = s.id
    ORDER BY pp."paidAt" DESC, pp.id DESC
    LIMIT 1
) p ON true
WHERE s."userId" = $1
  AND s.status = 'ACTIVE'
  AND s."billingCycle" <> 'LIFETIME'
  AND s."renewalDate" < sqlc.arg('renewalBefore')::timestamp
  AND p."paidAt" >= s."renewalDate"
ORDER BY s."renewalDate" ASC;

-- name: ListActionWishlistTargetPassed :many
-- The date the user themselves set has gone by while the item is still being
-- watched. Cron fires ON the target day (bucket "0 ngày"); nothing ever follows
-- up afterwards, so the item silently parks.
SELECT
    i.id             AS id,
    i.name           AS name,
    i."targetDate"   AS target_date,
    i.priority       AS priority,
    i.status         AS status,
    i."currentPrice" AS current_price
FROM "WishlistItem" i
WHERE i."userId" = $1
  AND i.status IN ('WATCHING', 'DECIDED')
  AND i."targetDate" IS NOT NULL
  AND i."targetDate" < sqlc.arg('targetBefore')::timestamp
ORDER BY i."targetDate" ASC;

-- ─── Snooze ("hoãn") ──────────────────────────────────────────────────────

-- name: ListActiveSnoozesByUser :many
-- Snoozes that have not expired yet. Used both to filter the default queue and to
-- serve GET /api/v1/actions?snoozed=true (the "đang hoãn" list a user un-snoozes
-- from). Expired rows are ignored rather than deleted: they are inert, and a
-- background prune is not worth a cron bucket.
SELECT *
FROM "DecisionSnooze"
WHERE "userId" = $1
  AND "snoozedUntil" >= $2
ORDER BY "snoozedUntil" ASC;

-- name: GetDecisionSnooze :one
-- Single-row lookup for the re-snooze / un-snooze paths.
SELECT *
FROM "DecisionSnooze"
WHERE "userId" = $1 AND "itemKey" = $2;

-- name: UpsertDecisionSnooze :one
-- One row per (user, item) — re-snoozing overwrites the previous deadline instead
-- of stacking rows. The unique index on ("userId", "itemKey") is what makes this
-- an upsert; that index is also why a snooze survives across devices: it is keyed
-- by the user, not by a session or a push endpoint.
INSERT INTO "DecisionSnooze" (id, "userId", "itemKey", "snoozedUntil", "createdAt")
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT ("userId", "itemKey") DO UPDATE
SET "snoozedUntil" = EXCLUDED."snoozedUntil"
RETURNING *;

-- name: DeleteDecisionSnooze :execrows
DELETE FROM "DecisionSnooze"
WHERE "userId" = $1 AND "itemKey" = $2;

-- name: CountSnoozesByUser :one
SELECT COUNT(*)::bigint AS count
FROM "DecisionSnooze"
WHERE "userId" = $1;
