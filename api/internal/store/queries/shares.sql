-- DeviceShare queries (FEATURE_IDEAS #2 — phiếu bàn giao bảo hiểm / share link).
--
-- Two kinds of query live in this file and they are NOT interchangeable:
--
--   * OWNER-scoped (`"userId" = $n`): create, list, revoke. Reached only behind
--     auth.RequireUser.
--   * PUBLIC (`GetShareByTokenHash`, `ListWarrantiesForShare`): reached with NO
--     bearer token at all. These take a device id or a token hash and NOTHING
--     else — there is no user to scope by — so their scoping is structural:
--     the share row is resolved first, and the warranty read is keyed on the
--     device id that came out of it. Never pass a client-supplied device id to
--     ListWarrantiesForShare.
--
-- This is also why the public path does NOT reuse GetDeviceByID /
-- ListWarrantiesByDevice: those take a userId and would either have to be called
-- with a fabricated one or would return nothing. The projections below are
-- narrow by construction (no price, no notes, no attachment rows, no storage
-- paths) so redaction is a property of the SQL rather than of a Go filter that a
-- later edit could drop.

-- name: CreateDeviceShare :one
INSERT INTO "DeviceShare" (
    id,
    "deviceId",
    "userId",
    "tokenHash",
    "expiresAt",
    "includeSerial",
    "createdAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, NOW()
)
RETURNING *;

-- name: CountActiveSharesForDevice :one
-- Live shares = not revoked and not yet expired at $2. The caller passes its own
-- `now` (Go wall clock) for the same reason ListActiveSessionsForUser does: every
-- timestamp column here is `timestamp without time zone` written from Go, so
-- comparing against the database clock can be off by the server's UTC offset.
-- A miss costs a token; a stale hit costs nothing (the public read re-checks).
SELECT COUNT(*)::bigint AS count
FROM "DeviceShare"
WHERE "deviceId" = $1
  AND "revokedAt" IS NULL
  AND "expiresAt" > $2;

-- name: ListSharesForDevice :many
-- Owner-facing list. "tokenHash" is deliberately NOT selected: it is credential
-- material and, unlike a session, it can never be re-derived from anything the
-- client holds — once the raw token has been shown at creation it is gone. So
-- the API can only ever list a share, never re-display it.
--
-- Ownership is checked here (`"userId" = $2`), so a device id belonging to
-- somebody else simply returns [] instead of leaking that shares exist.
SELECT
    id,
    "deviceId",
    "expiresAt",
    "revokedAt",
    "includeSerial",
    "viewCount",
    "lastViewedAt",
    "createdAt"
FROM "DeviceShare"
WHERE "deviceId" = $1
  AND "userId" = $2
ORDER BY "createdAt" DESC
LIMIT 50;

-- name: GetShareByIDForUser :one
-- Ownership-scoped lookup used by the revoke path to tell "mine, already
-- revoked" (idempotent success) from "not mine / does not exist" (404). Same
-- contract as GetSessionByIDForUser, including the absence of an expiry filter:
-- an expired-but-owned row is still the caller's row, and the caller decides what
-- to say about it.
SELECT * FROM "DeviceShare" WHERE id = $1 AND "userId" = $2 LIMIT 1;

-- name: RevokeShareByID :execrows
-- Ownership-scoped revoke. `"revokedAt" IS NULL` makes a repeated call a no-op
-- (0 rows, not a second revocation timestamp), which is what makes the endpoint
-- idempotent — same contract as RevokeSessionByID.
UPDATE "DeviceShare"
SET "revokedAt" = NOW()
WHERE id = $1
  AND "userId" = $2
  AND "revokedAt" IS NULL;

-- name: GetShareByTokenHash :one
-- THE public read (no bearer token). One indexed probe on "tokenHash", and the
-- three failure modes are folded into a single "no rows":
--
--   * unknown token      → no row
--   * expired token      → no row (compared against the caller's `now`, $2)
--   * revoked token      → no row
--
-- The handler answers all three with a byte-identical 404, so the endpoint is
-- not an enumeration oracle. JOIN "Device" is what makes ownership structural:
-- the share has no way to describe a device it does not point at, and a deleted
-- device cannot be described even if the FK cascade were ever dropped.
--
-- Projection: only fields the certificate needs. NO "userId" (the recipient has
-- no business knowing it), NO notes, NO prices, NO createdAt/updatedAt.
SELECT
    s.id                              AS share_id,
    s."expiresAt"                     AS share_expires_at,
    s."createdAt"                     AS share_created_at,
    s."includeSerial"                 AS share_include_serial,
    d.id                              AS device_id,
    d.name                            AS device_name,
    d.category                        AS device_category,
    d.brand                           AS device_brand,
    d.model                           AS device_model,
    d."serialNumber"                  AS device_serial_number,
    d."purchaseDate"                  AS device_purchase_date,
    d."purchasePlace"                 AS device_purchase_place,
    d.status                          AS device_status,
    d."soldAt"                        AS device_sold_at
FROM "DeviceShare" s
JOIN "Device" d ON d.id = s."deviceId"
WHERE s."tokenHash" = $1
  AND s."revokedAt" IS NULL
  AND s."expiresAt" > $2
LIMIT 1;

-- name: ListWarrantiesForShare :many
-- PUBLIC read, device-scoped. `cost` and `notes` are absent from the SELECT list
-- on purpose (see the file header): the recipient needs the coverage window and
-- the place to claim it, not what the seller paid or wrote.
SELECT
    id,
    type,
    provider,
    "startDate",
    "endDate",
    months,
    address,
    phone
FROM "Warranty"
WHERE "deviceId" = $1
ORDER BY "endDate" DESC, id ASC;

-- name: TouchShareView :exec
-- View telemetry for the OWNER ("link này đã được mở mấy lần"), never exposed to
-- the recipient. Best-effort: the handler ignores the error so a failed counter
-- bump can never turn a valid certificate into a 500.
UPDATE "DeviceShare"
SET "viewCount" = "viewCount" + 1,
    "lastViewedAt" = $2
WHERE id = $1;

-- name: PruneExpiredShares :execrows
-- Housekeeping, called from the same cron step as PruneExpiredSessions.
--
-- Deletes rows that died more than 30 days ago ($1 is the caller's clock, passed
-- as a parameter for the same reason the other queries in this file take `now`).
-- Expiry alone is the predicate, with no "AND revokedAt IS NOT NULL": a revoked
-- share is already dead to the public read, and an EXPIRED-but-never-revoked one
-- is equally dead — requiring revocation too would keep those rows forever.
-- 30 days of grace is what lets an owner still see "link đã hết hạn" in the list
-- for a month instead of watching it vanish.
DELETE FROM "DeviceShare"
WHERE "expiresAt" < $1::timestamp - INTERVAL '30 days';
