-- Claim CRUD + list queries (migration 0021).
--
-- Ownership is DERIVED, like Warranty / Reminder / pre-0018 Attachment: Claim
-- has no "userId" column, so every query joins "Device" and filters on its
-- owner. An id that belongs to someone else therefore matches no row and the
-- service answers 404 — never 403, never a leak of existence.
--
-- The single-open-claim rule is a partial unique INDEX
-- ("Claim_one_open_per_device_idx", WHERE status IN ('OPEN','IN_REPAIR')), not a
-- query. services.CreateClaim pre-checks with CountOpenClaimsByDevice for a
-- friendly translated 409 and translates SQLSTATE 23505 from the index as the
-- race backstop.

-- name: ListClaimsByUser :many
-- GET /api/v1/claims. Filters behave like the device list: empty string means
-- "no filter"; handlers pass the `ALL` sentinel through the service, which
-- normalises it to empty. An unknown status simply matches nothing — the same
-- pass-through policy as GET /api/v1/devices?status=.
--
-- Newest openedAt first (the contract). createdAt is the tie-breaker so two
-- claims opened on the same day have a stable order on every read.
SELECT c.*
FROM "Claim" c
JOIN "Device" d ON d.id = c."deviceId"
WHERE d."userId" = sqlc.arg('userId')::text
  AND (NULLIF(sqlc.arg('deviceId')::text, '') IS NULL
       OR c."deviceId" = sqlc.arg('deviceId')::text)
  AND (NULLIF(sqlc.arg('status')::text, '') IS NULL
       OR c.status = sqlc.arg('status')::text)
ORDER BY c."openedAt" DESC, c."createdAt" DESC;

-- name: ListClaimsByDevice :many
-- Device detail (`GET /api/v1/devices/{id}`) always emits `claims`, never null.
-- Same newest-first order as the top-level list.
SELECT c.*
FROM "Claim" c
JOIN "Device" d ON d.id = c."deviceId"
WHERE c."deviceId" = $1 AND d."userId" = $2
ORDER BY c."openedAt" DESC, c."createdAt" DESC;

-- name: GetClaimByID :one
SELECT c.*
FROM "Claim" c
JOIN "Device" d ON d.id = c."deviceId"
WHERE c.id = $1 AND d."userId" = $2
LIMIT 1;

-- name: ListRepairExtensionsByDeviceIDs :many
-- The warranty repair clock (docs/FEATURE_RESEARCH_2026-11.md §6.1, wave 1).
--
-- Vietnamese consumer law (Luật 19/2023, Điều 30 khoản 2 điểm c) says the time a
-- product spends being repaired is NOT counted against its warranty period, so a
-- device whose warranty ends on the paper date X is entitled to X + (closed
-- repair days). This query is the ONE server derivation of those days; the
-- device / search / reminder reads use it, and the cron/reminder windows use the
-- same arithmetic behind the WV_REPAIR_EXTENSION flag (services.RepairExtensionEnabled).
--
-- Row selection:
--   * terminal status only (RESOLVED / REJECTED / CANCELLED) AND closedAt set.
--     An OPEN / IN_REPAIR claim has not consumed any whole day yet, and a
--     terminal row with no close stamp is an incomplete record, not a finished
--     repair. This is the same partition the iOS `ClaimRules.isClosed` owns.
--   * GREATEST(0, …) per claim: a same-day repair adds 0 (not "+0 days" as a
--     weird positive), and a negative interval from bad historical data never
--     shrinks the warranty.
--   * LEAST(3650, …) on the summed total: ten years is far beyond any real
--     warranty; a corrupt row must not push an end date into the next century.
--
-- ── The two AT TIME ZONE clauses are NOT redundant ─────────────────────────
--
-- "openedAt"/"closedAt" are `timestamp(3) without time zone` holding UTC
-- instants (migration 0021; dbconn pins the session to UTC), so:
--   1. `AT TIME ZONE 'UTC'` interprets the naive value as an instant, and
--   2. `AT TIME ZONE 'Asia/Ho_Chi_Minh'` converts that instant to the Vietnam
--      calendar day before `::date` truncates it.
-- A bare `::date` would use the UTC session day: a claim closed at 05:30 ICT is
-- stored 22:30Z the previous day and would lose a whole day. A single
-- `AT TIME ZONE 'Asia/Ho_Chi_Minh'` is the mirror-image bug — it reads the UTC
-- wall clock as Ho Chi Minh time, then truncates back in UTC, so a claim opened
-- at 00:30 UTC (07:30 ICT) lands on the previous day. Both errors are one day,
-- which is exactly what iOS `WarrantyRepairAdjustment` was written to avoid.
--
-- Ownership is joined through Device like every other Claim query. The device id
-- set is caller-supplied and bounded by MAX_DEVICES_TOTAL_PER_USER (500).
SELECT
    c."deviceId" AS device_id,
    LEAST(3650, GREATEST(0, SUM(
        GREATEST(0,
            ((c."closedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
            - ((c."openedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Ho_Chi_Minh')::date
        )
    )))::int AS repair_extension_days
FROM "Claim" c
JOIN "Device" d ON d.id = c."deviceId"
WHERE c."deviceId" = ANY(sqlc.arg('deviceIds')::text[])
  AND d."userId" = sqlc.arg('userId')::text
  AND c."closedAt" IS NOT NULL
  AND c.status IN ('RESOLVED', 'REJECTED', 'CANCELLED')
GROUP BY c."deviceId";

-- name: CountClaimsByUser :one
-- Per-user ceiling (MAX_CLAIMS_PER_USER = 1000). A claim lives under a device,
-- so this is bounded structurally by the 500-row device ceiling, but a device
-- can be repaired repeatedly over its life — the cap is the backstop, not the
-- primary bound.
SELECT COUNT(*)::bigint AS count
FROM "Claim" c
JOIN "Device" d ON d.id = c."deviceId"
WHERE d."userId" = $1;

-- name: CountOtherOpenClaimsByDevice :one
-- Friendly pre-check for the single-open rule. NOT the authority — the partial
-- unique index is (see the header). Counts both non-terminal statuses because a
-- phone at the shop is either OPEN or IN_REPAIR.
--
-- excludeId is the claim being updated: it must not count as a conflict with
-- itself when the status stays open or changes between OPEN and IN_REPAIR. The
-- create path passes '' (no row has an empty id), so the same query serves both
-- paths.
SELECT COUNT(*)::bigint AS count
FROM "Claim"
WHERE "deviceId" = $1
  AND id <> $2
  AND status IN ('OPEN', 'IN_REPAIR');

-- name: CreateClaim :one
-- All user-editable fields plus the server-resolved closedAt. status is written
-- explicitly (the column has no default): the service defaults it to OPEN on
-- create, so the stored value and the API answer cannot disagree.
INSERT INTO "Claim" (
    id,
    "deviceId",
    "warrantyId",
    status,
    "openedAt",
    "expectedReturnAt",
    "closedAt",
    "ticketNumber",
    "serviceCenter",
    issue,
    diagnosis,
    outcome,
    cost,
    "coveredByWarranty",
    "createdAt",
    "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
    NOW(), NOW()
)
RETURNING *;

-- name: UpdateClaim :one
-- Full replacement of the editable fields (the same convention as warranties).
-- The FROM clause proves the OLD device is owned by the caller; the service
-- separately proves the NEW "deviceId" is, before this runs. "closedAt" is
-- server-resolved by services.UpdateClaim, never taken from the client.
UPDATE "Claim" c SET
    "deviceId" = $3,
    "warrantyId" = $4,
    status = $5,
    "openedAt" = $6,
    "expectedReturnAt" = $7,
    "closedAt" = $8,
    "ticketNumber" = $9,
    "serviceCenter" = $10,
    issue = $11,
    diagnosis = $12,
    outcome = $13,
    cost = $14,
    "coveredByWarranty" = $15,
    "updatedAt" = NOW()
FROM "Device" d
WHERE c.id = $1
  AND c."deviceId" = d.id
  AND d."userId" = $2
RETURNING c.*;

-- name: DeleteClaim :execrows
DELETE FROM "Claim" c
USING "Device" d
WHERE c.id = $1 AND c."deviceId" = d.id AND d."userId" = $2;
