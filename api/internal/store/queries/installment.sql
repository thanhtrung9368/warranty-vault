-- Installment plan queries (migration 0031, FEATURE_RESEARCH_2026-11 §6.5).
--
-- One plan per device (PK "deviceId"), owned through the Device row: there is no
-- "userId" column here on purpose, so every query reaches ownership by joining
-- Device. That is the same shape DeviceShare / Warranty use, and it means a
-- deleted device takes its plan with it (ON DELETE CASCADE).
--
-- The row is the user's SELF-REPORTED schedule. Totals, remaining and next due
-- are derived in Go (`services/installment.go`), never stored — see the
-- migration header for why an "overdue" flag is deliberately absent.

-- name: GetInstallmentPlanByDevice :one
SELECT p.*
FROM "InstallmentPlan" p
JOIN "Device" d ON d.id = p."deviceId"
WHERE p."deviceId" = $1 AND d."userId" = $2
LIMIT 1;

-- name: ListInstallmentPlansByDeviceIDs :many
-- Batch fan-out for the device list and search: one round-trip for the whole
-- page, indexed by "deviceId" in Go. Ownership is joined through Device, the
-- same predicate `ListWarrantiesByDeviceIDs` uses, so a forged id cannot leak
-- another user's plan.
SELECT p.*
FROM "InstallmentPlan" p
JOIN "Device" d ON d.id = p."deviceId"
WHERE p."deviceId" = ANY($1::text[]) AND d."userId" = $2;

-- name: ListInstallmentPlansForUser :many
-- Backup export. Every plan the user owns, so a restore does not lose a
-- schedule the way it would lose a lead-time array.
SELECT p.*
FROM "InstallmentPlan" p
JOIN "Device" d ON d.id = p."deviceId"
WHERE d."userId" = $1;

-- name: UpsertInstallmentPlan :one
-- Idempotent PUT: the second identical request writes the same row.
--
-- Ownership is checked by the caller (`services.SetInstallmentPlan` reads the
-- device first, the same pattern CreateClaim uses), because a guarded
-- INSERT ... SELECT would lose the column's Day/nullable typing in sqlc and
-- silently change the wire shape of `firstDueAt`. A device id the caller does
-- not own is therefore a NOT_FOUND before this runs, never a silent no-op.
--
-- "notifiedDueAt"/"notifiedLeadDay" are deliberately untouched by the update
-- branch: they are wave-2 reminder dedup markers, and editing a plan is not a
-- notification. They stay NULL in wave 1 because nothing writes them yet.
--
-- "createdAt" survives because the update branch does not set it.
INSERT INTO "InstallmentPlan" (
    "deviceId",
    "downPayment",
    months,
    "monthlyAmount",
    "firstDueAt",
    "fileFee",
    "monthlyFee",
    "paidCount",
    lender,
    "createdAt",
    "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
)
ON CONFLICT ("deviceId") DO UPDATE SET
    "downPayment" = EXCLUDED."downPayment",
    months = EXCLUDED.months,
    "monthlyAmount" = EXCLUDED."monthlyAmount",
    "firstDueAt" = EXCLUDED."firstDueAt",
    "fileFee" = EXCLUDED."fileFee",
    "monthlyFee" = EXCLUDED."monthlyFee",
    "paidCount" = EXCLUDED."paidCount",
    lender = EXCLUDED.lender,
    "updatedAt" = NOW()
RETURNING *;

-- name: DeleteInstallmentPlan :execrows
-- Idempotent DELETE; the service checks ownership of the DEVICE first so a
-- foreign id answers 404 instead of silently doing nothing.
DELETE FROM "InstallmentPlan"
WHERE "deviceId" = $1;

-- name: BackupInsertInstallmentPlan :exec
-- Restore path. Unlike the live upsert this keeps the payload's own timestamps,
-- like every other child row in the importer, so a restored account does not
-- look freshly edited.
INSERT INTO "InstallmentPlan" (
    "deviceId",
    "downPayment",
    months,
    "monthlyAmount",
    "firstDueAt",
    "fileFee",
    "monthlyFee",
    "paidCount",
    lender,
    "notifiedDueAt",
    "notifiedLeadDay",
    "createdAt",
    "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
);
