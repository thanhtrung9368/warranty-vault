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
-- Filed attachments only: the export nests these under their device. Inbox items
-- travel in their own top-level array (BackupListInboxAttachmentsForUser), which
-- is a purely additive field in the otherwise-unchanged v5/v6 envelope.
SELECT a.*
FROM "Attachment" a
WHERE a."userId" = $1 AND a."deviceId" IS NOT NULL
ORDER BY a."uploadedAt" ASC;

-- name: BackupListInboxAttachmentsForUser :many
-- Unassigned attachments (migration 0018). Exported as `inboxAttachments[]` and
-- restored as inbox rows, so a restore does not silently drop receipts the user
-- captured but has not filed yet.
SELECT a.*
FROM "Attachment" a
WHERE a."userId" = $1 AND a."deviceId" IS NULL
ORDER BY a."uploadedAt" ASC;

-- name: BackupListClaimsForUser :many
-- Warranty claims (migration 0021). Exported as the TOP-LEVEL `claims[]` array,
-- not nested under a device: a claim carries its own "deviceId" and may or may
-- not reference a warranty, so nesting it would duplicate that id and make the
-- shape depend on whether the device was exported.
--
-- Ownership is joined through Device (a claim has no userId column of its own).
-- Ordered oldest-first like the other child arrays so the payload is stable.
SELECT c.*
FROM "Claim" c
JOIN "Device" d ON d.id = c."deviceId"
WHERE d."userId" = $1
ORDER BY c."openedAt" ASC, c."createdAt" ASC;

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
-- Direct ownership since 0018, so replace-mode also wipes the user's inbox rows
-- (they belong to no device and the old join could not see them).
DELETE FROM "Attachment"
WHERE "userId" = $1;

-- name: BackupDeleteClaimsForUser :exec
-- Replace-mode wipe (migration 0021). Claims are deleted FIRST, before
-- warranties and devices: their "warrantyId" FK is ON DELETE SET NULL and their
-- "deviceId" FK is ON DELETE CASCADE, so deleting them explicitly keeps the
-- wipe order obvious instead of relying on cascade side effects.
DELETE FROM "Claim" c
USING "Device" d
WHERE c."deviceId" = d.id AND d."userId" = $1;

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
--
-- returnWindowDays / receivedAt / returnWindowNotifiedAt are optional in the same
-- way (migration 0010). Carrying them stops a restore from silently dropping the
-- exchange deadline — the one date this feature exists to protect — and carrying
-- returnWindowNotifiedAt stops the cron re-pushing a window the user was already
-- told about, for the same reason BackupInsertReminder carries lastNotifiedAt. A
-- payload that predates them decodes to NULL = "unknown window", which is the
-- correct reading, so the payload version stays at 5/6 (the format is additive).
--
-- leadDays (migration 0015) is optional for the same reason and defaults exactly
-- like the column: an older payload has no value, and [30, 7] is the behaviour
-- that payload was written under. Carrying it stops a restore from silently
-- resetting every device's reminder schedule to the default.
--
-- Activation / extended cover (migration 0016) adds six optional columns. They
-- are carried for the same two reasons as the exchange window above: dropping
-- activatedAt/extendedCoverBuyBy on a restore would delete user-entered deadlines,
-- and dropping the notified markers would make the next cron re-push a reminder
-- the user already saw. An older payload decodes to false/NULL, which is exactly
-- the old meaning ("not required", "no deadline", "never notified").
--
-- currency/fxRate (migration 0022) are optional in exactly the same way: an
-- older payload has neither key, decodes to ""/NULL and imports as VND — which
-- is what that payload meant, since every device was VND when it was written.
-- The export omits both for a VND device, so a VND-only backup stays
-- byte-identical to the pre-0022 format. The locked rate must travel or a
-- restore would silently turn a USD 999 phone into a VND 999 phone.
INSERT INTO "Device" (
    id, "userId", name, category, brand, model, "serialNumber",
    "purchaseDate", "purchasePrice", "purchasePlace", status, notes,
    "soldAt", "soldPrice", "returnWindowDays", "receivedAt",
    "returnWindowNotifiedAt", "createdAt", "updatedAt",
    "activationRequired", "activatedAt", "extendedCoverBuyBy",
    "activationNotifiedAt", "extendedCoverNotifiedAt",
    "extendedCoverNotifiedLeadDay", "leadDays", currency, "fxRate"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
    $17, $18, $19, $20, $21, $22, $23, $24, $25,
    COALESCE(sqlc.narg('leadDays')::int[], ARRAY[30, 7]),
    $26, $27
);

-- name: BackupInsertWarranty :exec
-- The nine contract terms (migration 0017) ride along additively. A payload
-- exported before 0017 has no such keys, decodes them to NULL/0, and inserts
-- exactly the pre-0017 state — the import must not require a newer format.
INSERT INTO "Warranty" (
    id, "deviceId", type, provider, "startDate", "endDate", months, cost,
    address, phone, notes, component, scope, cap, deductible, exclusions,
    region, transferable, "claimsAllowed", "claimsUsed", "createdAt", "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
    $17, $18, $19, $20, $21, $22
);

-- name: BackupInsertReminder :exec
-- "lastNotifiedAt" is the cron dedup marker (migration 0002): dropping it on
-- restore makes the next cron run re-notify warranties the user already saw.
-- "lastNotifiedLeadDay" is the other half of the per-lead-day key (migration
-- 0015); carrying it keeps a restore from re-firing the SAME lead day on a
-- same-day restore. A payload that predates it decodes to NULL, which the query
-- treats as "handled that day" rather than "never notified".
INSERT INTO "Reminder" (
    id, "warrantyId", "isDismissed", "lastNotifiedAt", "createdAt",
    "lastNotifiedLeadDay"
) VALUES (
    $1, $2, $3, $4, $5, $6
);

-- name: BackupInsertAttachment :exec
-- One insert for device-filed and inbox rows: a NULL "deviceId" ($3) creates an
-- inbox item. "userId" ($2) is the importing account, which owns both.
INSERT INTO "Attachment" (
    id, "userId", "deviceId", "fileName", "storagePath", "fileType", "fileSize",
    iv, "wrappedKey", description, "uploadedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
);

-- name: BackupInsertClaim :exec
-- Claims (migration 0021) preserve their ids, both timestamps and the
-- server-managed closedAt so a restore does not rewrite the repair history.
-- The service resolves a "warrantyId" that does not belong to the claim's
-- device to NULL before this runs (the FK alone cannot express that rule), and
-- pre-validates the single-open rule because the partial unique index would
-- otherwise abort the whole import with a 23505.
INSERT INTO "Claim" (
    id, "deviceId", "warrantyId", status, "openedAt", "expectedReturnAt",
    "closedAt", "ticketNumber", "serviceCenter", issue, diagnosis, outcome,
    cost, "coveredByWarranty", "createdAt", "updatedAt"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
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
-- "lastNotifiedRenewalLeadDay" and "leadDays" are the migration-0015 pair:
-- carrying the lead day keeps a same-day restore from re-firing the reminder the
-- user already saw, and carrying leadDays keeps the user's chosen schedule.
-- Older payloads decode to NULL; leadDays then falls back to [3, 1, 0] — the
-- schedule that payload was written under, because the pre-0015 renewal cron
-- fired at 3, 1 and 0 days. (Device falls back to [30, 7] for the same reason.)
--
-- Trial fields (migration 0016) are optional in the same additive way. Two
-- distinct classes of data are carried: the user's own trialEndsAt/convertsToPrice
-- (a restore that dropped them would silently delete the trial the user is
-- tracking) and the trial reminder's (date, leadDay) idempotency pair (a same-day
-- restore must not re-fire the reminder). An older payload decodes to NULL, i.e.
-- "no trial" — the old behaviour.
INSERT INTO "Subscription" (
    id, "userId", name, category, brand, plan, "billingCycle",
    "intervalDays", price, currency, "startedAt", "renewalDate",
    "autoRenew", status, "accountEmail", "paymentMethod", "manageUrl",
    "cancelUrl", notes, "lastNotifiedRenewalAt", "createdAt", "updatedAt",
    "lastNotifiedRenewalLeadDay", "trialEndsAt", "convertsToPrice",
    "trialNotifiedAt", "trialNotifiedLeadDay", "leadDays"
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
    $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27,
    COALESCE(sqlc.narg('leadDays')::int[], ARRAY[3, 1, 0])
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
-- Direct ownership since 0018; an inbox attachment has no device to join, so the
-- old query would have missed it and the insert would fail on the primary key.
SELECT a.id
FROM "Attachment" a
WHERE a.id = ANY(sqlc.arg('ids')::text[])
  AND a."userId" <> sqlc.arg('userId')::text;

-- name: BackupFindForeignClaimIDs :many
-- Claims (migration 0021) have global ids too; ownership is joined through
-- Device. Without this probe a claim from another account's backup would fail
-- the insert on the primary key and surface as a 500.
SELECT c.id
FROM "Claim" c
JOIN "Device" d ON d.id = c."deviceId"
WHERE c.id = ANY(sqlc.arg('ids')::text[])
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
