-- Warranty CRUD + Reminder dismiss/restore.
--
-- Ownership: Warranty itself doesn't have a userId column; ownership is
-- enforced by joining through Device. Every list/mutate query joins
-- "Device" and filters by "Device"."userId".

-- name: ListWarrantiesByDevice :many
-- Caller must have already verified device ownership; this query also
-- joins through Device to defend against bugs.
SELECT w.*
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE w."deviceId" = $1 AND d."userId" = $2
ORDER BY w.type ASC, w."endDate" DESC;

-- name: GetWarrantyByID :one
SELECT w.*
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE w.id = $1 AND d."userId" = $2
LIMIT 1;

-- name: GetWarrantyForCron :one
-- No user scoping — used by cron/dispatch where userId is read off the joined
-- Device row. Prefer GetWarrantyByID in handlers.
SELECT *
FROM "Warranty"
WHERE id = $1
LIMIT 1;

-- name: CreateWarranty :one
INSERT INTO "Warranty" (
    id,
    "deviceId",
    type,
    provider,
    "startDate",
    "endDate",
    months,
    cost,
    address,
    phone,
    notes,
    "createdAt",
    "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()
)
RETURNING *;

-- name: UpdateWarranty :one
UPDATE "Warranty" w SET
    type = $3,
    provider = $4,
    "startDate" = $5,
    "endDate" = $6,
    months = $7,
    cost = $8,
    address = $9,
    phone = $10,
    notes = $11,
    "updatedAt" = NOW()
FROM "Device" d
WHERE w.id = $1 AND w."deviceId" = d.id AND d."userId" = $2
RETURNING w.*;

-- name: DeleteWarranty :execrows
DELETE FROM "Warranty" w
USING "Device" d
WHERE w.id = $1 AND w."deviceId" = d.id AND d."userId" = $2;

-- name: GetStandardWarrantyForDevice :one
-- The inline device form manages a single STANDARD warranty (auto-created on
-- device create). Used by `updateDevice` to find / update / delete that row.
SELECT *
FROM "Warranty"
WHERE "deviceId" = $1 AND type = 'STANDARD'
ORDER BY "createdAt" ASC
LIMIT 1;

-- name: CountWarrantiesByDevice :one
SELECT COUNT(*)::bigint AS count
FROM "Warranty"
WHERE "deviceId" = $1;

-- name: ListWarrantiesByDeviceIDs :many
-- Batch fan-out for ListDevices: returns every warranty across a set of
-- devices in one round-trip, joined through Device for ownership. Caller
-- indexes the rows by "deviceId" in Go (see services/devices.go).
SELECT w.*
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE w."deviceId" = ANY($1::text[]) AND d."userId" = $2
ORDER BY w.type ASC, w."endDate" DESC;

-- ─── Reminders ────────────────────────────────────────────────────────────

-- name: GetActiveReminderForWarranty :one
-- Returns the latest non-dismissed reminder for a warranty (if any).
SELECT *
FROM "Reminder"
WHERE "warrantyId" = $1 AND "isDismissed" = false
ORDER BY "createdAt" DESC
LIMIT 1;

-- name: CreateDismissedReminder :one
-- Used when the warranty has no Reminder row yet and the user dismisses it.
INSERT INTO "Reminder" (id, "warrantyId", "isDismissed", "createdAt")
VALUES ($1, $2, true, NOW())
RETURNING *;

-- name: DismissReminderByID :exec
UPDATE "Reminder"
SET "isDismissed" = true
WHERE id = $1;

-- name: RestoreRemindersForWarranty :execrows
UPDATE "Reminder"
SET "isDismissed" = false
WHERE "warrantyId" = $1 AND "isDismissed" = true;

-- ─── Reminders list (GET /v1/reminders) ───────────────────────────────────

-- name: ListUpcomingReminders :many
-- Mirrors `website/src/lib/services/reminders.ts::listUpcomingReminders`.
-- Returns warranties whose endDate falls within [today, today + N days],
-- for ACTIVE devices, that have NO `Reminder.isDismissed = true` row.
-- Joins Device for the small projection mobile clients render.
SELECT
    w.*,
    d.id            AS device_id,
    d.name          AS device_name,
    d.category      AS device_category
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND w."endDate" >= $2
  AND w."endDate" <= $3
  AND NOT EXISTS (
      SELECT 1 FROM "Reminder" r
      WHERE r."warrantyId" = w.id AND r."isDismissed" = true
  )
ORDER BY w."endDate" ASC;

-- name: CountActiveReminders :one
-- Used by dashboard badge — same predicate as ListUpcomingReminders but with
-- a fixed [now, now+30d] window.
SELECT COUNT(*)::bigint AS count
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE d."userId" = $1
  AND d.status = 'ACTIVE'
  AND w."endDate" >= $2
  AND w."endDate" <= $3
  AND NOT EXISTS (
      SELECT 1 FROM "Reminder" r
      WHERE r."warrantyId" = w.id AND r."isDismissed" = true
  );

-- ─── Cron: warranty bucket fan-out ────────────────────────────────────────

-- name: ListWarrantiesInWindow :many
-- For cron: every ACTIVE-device warranty whose endDate is in [start, end),
-- skipping warranties with a dismissed Reminder row OR a Reminder already
-- stamped lastNotifiedAt today (idempotency — prevents a same-day re-run
-- from firing the push again). Returns userId so the caller can fan out
-- push notifications.
SELECT
    w.*,
    d."userId"  AS user_id,
    d.name      AS device_name
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE d.status = 'ACTIVE'
  AND w."endDate" >= $1
  AND w."endDate" <  $2
  AND NOT EXISTS (
      SELECT 1 FROM "Reminder" r
      WHERE r."warrantyId" = w.id AND r."isDismissed" = true
  )
  AND NOT EXISTS (
      SELECT 1 FROM "Reminder" r
      WHERE r."warrantyId" = w.id
        AND r."lastNotifiedAt" IS NOT NULL
        AND r."lastNotifiedAt"::date >= CURRENT_DATE
  );

-- name: StampWarrantyNotified :exec
-- Called by cron after a successful warranty fan-out. If a Reminder row
-- already exists for the warranty (any row, including a non-dismissed one),
-- bumps its lastNotifiedAt to NOW(). Otherwise inserts a new non-dismissed
-- Reminder stamped with NOW(). This keeps the same-day idempotency check
-- in ListWarrantiesInWindow working even when the user has never dismissed
-- a reminder for this warranty.
WITH updated AS (
    UPDATE "Reminder"
    SET "lastNotifiedAt" = NOW()
    WHERE "warrantyId" = $1
    RETURNING id
)
INSERT INTO "Reminder" (id, "warrantyId", "isDismissed", "lastNotifiedAt", "createdAt")
SELECT $2, $1, false, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM updated);
