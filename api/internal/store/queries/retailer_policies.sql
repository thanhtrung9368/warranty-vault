-- Retailer policies + the repair promise (migration 0030,
-- docs/FEATURE_RESEARCH_2026-11.md §6.1 wave 2).
--
-- A policy belongs to a Store (the retail chain), not to a device. The Device
-- link is optional ("Device"."retailerId"); a NULL link means "the app does not
-- know which chain this was bought from", and the promise stays NULL — the
-- feature never guesses a shop from free-text "purchasePlace".
--
-- "repairCeilingDays" is NULL when the shop publishes no calendar-day repair
-- ceiling (or publishes one in working days, which must not be treated as
-- calendar days). Every read path below preserves that NULL; the service turns
-- it into "no promise" rather than a made-up deadline.

-- name: ListRetailerPolicies :many
-- The policy side of GET /api/v1/catalog's additive "retailers[]" array. The
-- loader joins this against ListStores in Go, so a store without a policy row
-- still appears in the picker with NULL policy fields. Loaded once through the
-- same 60 s catalog cache as the other five sections.
SELECT *
FROM "RetailerPolicy"
WHERE "isActive" = true
ORDER BY "storeId" ASC;

-- name: ListDeviceRetailerPolicies :many
-- Per-device policy lookup for the claim reads. The device id set is
-- caller-supplied (bounded by the 500-row device ceiling) and ownership is
-- joined through "Device"."userId" exactly like every other Claim query, so a
-- device owned by someone else simply does not appear.
--
-- A device with no retailerId, or a retailer with no active policy, is absent
-- from the result; callers read that as "no promise". The Store name travels
-- because every promise surface must print "theo chính sách của <retailer>".
SELECT
    d.id                        AS device_id,
    s.id                        AS retailer_id,
    s.name                      AS retailer_name,
    rp."returnWindowDays"       AS return_window_days,
    rp."repairCeilingDays"      AS repair_ceiling_days,
    rp."repairCeilingNote"      AS repair_ceiling_note,
    rp."exchangeNote"           AS exchange_note,
    rp."sourceUrl"              AS source_url,
    rp."checkedAt"              AS checked_at,
    rp."isActive"               AS is_active
FROM "Device" d
JOIN "RetailerPolicy" rp ON rp."storeId" = d."retailerId" AND rp."isActive" = true
JOIN "Store" s ON s.id = rp."storeId"
WHERE d."userId" = sqlc.arg('userId')::text
  AND d.id = ANY(sqlc.arg('deviceIds')::text[]);

-- name: ListOpenClaimsWithRetailerPolicy :many
-- Cron support for the two promise notices (T-2 and T+1). Only OPEN/IN_REPAIR
-- claims whose device has an ACTIVE retailer link and a calendar-day repair
-- ceiling can produce a promise; a terminal claim is history and is handled by
-- the derived state on the read side, not by a push.
--
-- The reminder columns ride along because the send-once guard is per KIND, not
-- per day: the T-2 pass must stamp "DUE_SOON" without suppressing the T+1
-- "OVERDUE" pass, while a second run on the same day must send nothing.
SELECT
    c.id                    AS claim_id,
    c."deviceId"            AS device_id,
    c.status                AS status,
    c."openedAt"            AS opened_at,
    c."closedAt"            AS closed_at,
    c."promiseNotifiedAt"   AS promise_notified_at,
    c."promiseNotifiedKind" AS promise_notified_kind,
    d."userId"              AS user_id,
    d.name                  AS device_name,
    s.id                    AS retailer_id,
    s.name                  AS retailer_name,
    rp."repairCeilingDays"  AS repair_ceiling_days,
    rp."repairCeilingNote"  AS repair_ceiling_note,
    rp."sourceUrl"          AS source_url,
    rp."checkedAt"          AS checked_at
FROM "Claim" c
JOIN "Device" d ON d.id = c."deviceId"
JOIN "RetailerPolicy" rp ON rp."storeId" = d."retailerId" AND rp."isActive" = true
JOIN "Store" s ON s.id = rp."storeId"
WHERE c.status IN ('OPEN', 'IN_REPAIR')
  AND rp."repairCeilingDays" IS NOT NULL
ORDER BY c."openedAt" ASC, c.id ASC;

-- name: StampClaimPromiseNotified :exec
-- The cron's send-once marker. "promiseNotifiedKind" is written together with
-- the stamp so the next pass can tell "already sent T-2" from "already sent
-- T+1". The WHERE is deliberately unconditional on the old value: the caller
-- decided which kind it is sending, and a same-day second run sees its own
-- kind in the read above and never calls this.
UPDATE "Claim"
SET "promiseNotifiedAt" = NOW(),
    "promiseNotifiedKind" = $2
WHERE id = $1;
