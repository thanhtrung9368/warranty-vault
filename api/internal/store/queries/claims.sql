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
