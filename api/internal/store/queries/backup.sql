-- Backup export/import queries.
--
-- The export path issues several plain SELECTs (no cross-row JOINs) so the Go
-- service can serialize each section independently. The import path uses
-- INSERTs that preserve client-supplied ids/timestamps — mirroring the
-- Prisma v5 backup format produced by the legacy `exportAllJson()` server
-- action.
--
-- Ownership for every query is enforced through "userId" or a join to a
-- userId-scoped parent. The service additionally pre-validates payload ids
-- with a `^[a-z0-9_-]+$` regex before invoking these.

-- ─── Export ───────────────────────────────────────────────────────────────

-- name: BackupListDevices :many
SELECT *
FROM "Device"
WHERE "userId" = $1
ORDER BY "createdAt" ASC;

-- name: BackupListWarrantiesForUser :many
SELECT w.*
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE d."userId" = $1
ORDER BY w."createdAt" ASC;

-- name: BackupListRemindersForUser :many
SELECT r.*
FROM "Reminder" r
JOIN "Warranty" w ON w.id = r."warrantyId"
JOIN "Device"   d ON d.id = w."deviceId"
WHERE d."userId" = $1
ORDER BY r."createdAt" ASC;

-- name: BackupListAttachmentsForUser :many
SELECT a.*
FROM "Attachment" a
JOIN "Device" d ON d.id = a."deviceId"
WHERE d."userId" = $1
ORDER BY a."uploadedAt" ASC;

-- name: BackupListWishlistForUser :many
SELECT *
FROM "WishlistItem"
WHERE "userId" = $1
ORDER BY "createdAt" ASC;

-- name: BackupListWishlistPricesForUser :many
SELECT p.*
FROM "WishlistPrice" p
JOIN "WishlistItem" i ON i.id = p."itemId"
WHERE i."userId" = $1
ORDER BY p."recordedAt" ASC;

-- name: BackupListSubscriptionsForUser :many
SELECT *
FROM "Subscription"
WHERE "userId" = $1
ORDER BY "createdAt" ASC;

-- name: BackupListPaymentsForUser :many
SELECT p.*
FROM "SubscriptionPayment" p
JOIN "Subscription" s ON s.id = p."subscriptionId"
WHERE s."userId" = $1
ORDER BY p."paidAt" ASC;

-- ─── Import wipe (mode=replace) ───────────────────────────────────────────

-- name: BackupDeleteAttachmentsForUser :exec
DELETE FROM "Attachment" a
USING "Device" d
WHERE a."deviceId" = d.id AND d."userId" = $1;

-- name: BackupDeleteRemindersForUser :exec
DELETE FROM "Reminder" r
USING "Warranty" w, "Device" d
WHERE r."warrantyId" = w.id
  AND w."deviceId" = d.id
  AND d."userId" = $1;

-- name: BackupDeleteWarrantiesForUser :exec
DELETE FROM "Warranty" w
USING "Device" d
WHERE w."deviceId" = d.id AND d."userId" = $1;

-- name: BackupDeleteWishlistPricesForUser :exec
DELETE FROM "WishlistPrice" p
USING "WishlistItem" i
WHERE p."itemId" = i.id AND i."userId" = $1;

-- name: BackupDeleteWishlistForUser :exec
DELETE FROM "WishlistItem"
WHERE "userId" = $1;

-- name: BackupDeletePaymentsForUser :exec
DELETE FROM "SubscriptionPayment" p
USING "Subscription" s
WHERE p."subscriptionId" = s.id AND s."userId" = $1;

-- name: BackupDeleteSubscriptionsForUser :exec
DELETE FROM "Subscription"
WHERE "userId" = $1;

-- name: BackupDeleteDevicesForUser :exec
DELETE FROM "Device"
WHERE "userId" = $1;

-- ─── Import inserts (preserve ids + timestamps) ──────────────────────────

-- name: BackupInsertDevice :exec
-- soldAt/soldPrice are optional in the payload (older v5 exports predate them);
-- a missing value decodes to NULL, which is exactly the "not sold / unknown" state.
INSERT INTO "Device" (
    id, "userId", name, category, brand, model, "serialNumber",
    "purchaseDate", "purchasePrice", "purchasePlace", status, notes,
    "soldAt", "soldPrice", "createdAt", "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
);

-- name: BackupInsertWarranty :exec
INSERT INTO "Warranty" (
    id, "deviceId", type, provider, "startDate", "endDate", months, cost,
    address, phone, notes, "createdAt", "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
);

-- name: BackupInsertReminder :exec
-- "lastNotifiedAt" is the cron dedup marker (migration 0002): dropping it on
-- restore makes the next cron run re-notify warranties the user already saw.
INSERT INTO "Reminder" (
    id, "warrantyId", "isDismissed", "lastNotifiedAt", "createdAt"
) VALUES (
    $1, $2, $3, $4, $5
);

-- name: BackupInsertAttachment :exec
INSERT INTO "Attachment" (
    id, "deviceId", "fileName", "storagePath", "fileType", "fileSize",
    iv, "wrappedKey", description, "uploadedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
);

-- name: BackupInsertWishlistItem :exec
INSERT INTO "WishlistItem" (
    id, "userId", name, category, brand, "initialPrice", "currentPrice",
    "buyUrl", "imageUrl", "targetDate", priority, status, notes,
    "reminderIntervalDays", "lastNotifiedAt", "purchasedDeviceId",
    "createdAt", "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
    $17, $18
);

-- name: BackupInsertWishlistPrice :exec
INSERT INTO "WishlistPrice" (
    id, "itemId", price, note, "recordedAt"
) VALUES (
    $1, $2, $3, $4, $5
);

-- name: BackupInsertSubscription :exec
-- "lastNotifiedRenewalAt" is the cron renewal-warning dedup marker; like the
-- reminder marker it must survive a restore or the user gets re-notified.
INSERT INTO "Subscription" (
    id, "userId", name, category, brand, plan, "billingCycle",
    "intervalDays", price, currency, "startedAt", "renewalDate",
    "autoRenew", status, "accountEmail", "paymentMethod", "manageUrl",
    "cancelUrl", notes, "lastNotifiedRenewalAt", "createdAt", "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
    $17, $18, $19, $20, $21, $22
);

-- name: BackupInsertPayment :exec
INSERT INTO "SubscriptionPayment" (
    id, "subscriptionId", amount, "paidAt", note, "createdAt"
) VALUES (
    $1, $2, $3, $4, $5, NOW()
);

-- ─── Import: foreign-id detection ────────────────────────────────────────
--
-- Every entity table has a *global* text primary key (not scoped per user), so a
-- payload built by another account can collide with rows this user does not own.
-- In merge mode the importer skips ids owned by the importing user; these queries
-- find the remaining case — an id that already exists under a DIFFERENT account —
-- so ImportBackup can answer 400 with a clear Vietnamese message instead of
-- letting the insert fail on the primary key and surface as a 500.
--
-- Ownership for child tables is resolved through their parent join (Device or
-- WishlistItem / Subscription), matching every other query in this file.

-- name: BackupFindForeignDeviceIDs :many
SELECT id FROM "Device"
WHERE id = ANY(sqlc.arg('ids')::text[])
  AND "userId" <> sqlc.arg('userId')::text;

-- name: BackupFindForeignWarrantyIDs :many
SELECT w.id
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE w.id = ANY(sqlc.arg('ids')::text[])
  AND d."userId" <> sqlc.arg('userId')::text;

-- name: BackupFindForeignReminderIDs :many
SELECT r.id
FROM "Reminder" r
JOIN "Warranty" w ON w.id = r."warrantyId"
JOIN "Device"   d ON d.id = w."deviceId"
WHERE r.id = ANY(sqlc.arg('ids')::text[])
  AND d."userId" <> sqlc.arg('userId')::text;

-- name: BackupFindForeignAttachmentIDs :many
SELECT a.id
FROM "Attachment" a
JOIN "Device" d ON d.id = a."deviceId"
WHERE a.id = ANY(sqlc.arg('ids')::text[])
  AND d."userId" <> sqlc.arg('userId')::text;

-- name: BackupFindForeignWishlistIDs :many
SELECT id FROM "WishlistItem"
WHERE id = ANY(sqlc.arg('ids')::text[])
  AND "userId" <> sqlc.arg('userId')::text;

-- name: BackupFindForeignWishlistPriceIDs :many
SELECT p.id
FROM "WishlistPrice" p
JOIN "WishlistItem" i ON i.id = p."itemId"
WHERE p.id = ANY(sqlc.arg('ids')::text[])
  AND i."userId" <> sqlc.arg('userId')::text;

-- name: BackupFindForeignSubscriptionIDs :many
SELECT id FROM "Subscription"
WHERE id = ANY(sqlc.arg('ids')::text[])
  AND "userId" <> sqlc.arg('userId')::text;

-- name: BackupFindForeignPaymentIDs :many
SELECT p.id
FROM "SubscriptionPayment" p
JOIN "Subscription" s ON s.id = p."subscriptionId"
WHERE p.id = ANY(sqlc.arg('ids')::text[])
  AND s."userId" <> sqlc.arg('userId')::text;
