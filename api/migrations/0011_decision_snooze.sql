-- WarrantyVault — "Việc cần xử lý": hoãn theo từng việc, dùng chung mọi thiết bị
-- (FEATURE_IDEAS #3).
--
-- Why a NEW table and not "Reminder"
--   * "Reminder" has no time field at all. 0001_initial.sql:174-183 gives it
--     "isDismissed" + "createdAt"; 0002 adds "lastNotifiedAt". "Hoãn 90 ngày"
--     cannot be expressed — there is nothing to compare against.
--   * "Reminder"."isDismissed" is an ACCESS CONTROL for warranty push, not a UI
--     flag: both ListWarrantiesInWindow and CountActiveReminders carry
--     `NOT EXISTS (SELECT 1 FROM "Reminder" r WHERE r."warrantyId" = w.id AND
--     r."isDismissed" = true)`. A generic "this item is snoozed" row written with
--     isDismissed = true would silently suppress the real warranty notice for that
--     package. See docs/SPEC-MAINTENANCE-SCHEDULES.md §2.3 and
--     docs/FEATURE_IDEAS.md #3 (the loudest warning in that document).
--   * "Reminder"."warrantyId" is NOT NULL, so it cannot represent a device-level
--     ("thiếu serial"), subscription-level or wishlist-level item either.
--
-- Why the row is keyed by a STRING and not by a foreign key
--   * Action items are DERIVED, not stored: there is no row to point at. The key
--     is the stable identity of a derivation — `<KIND>:<entityId>`, e.g.
--     `WARRANTY_EXPIRED:clx1234…` — built by services.ActionItemKey. Entity ids
--     are immutable, so the key survives any edit to the item's payload.
--   * The snooze must survive across devices, so it is per USER and lives on the
--     server. The unique index (userId, itemKey) makes "hoãn lại" an upsert
--     instead of accumulating rows.
--   * The write path validates the key against the caller's OWN derived items
--     before inserting (services.SnoozeActionItem), so the table can only hold
--     keys that correspond to a real item the user owns. It is therefore bounded
--     by MAX_DEVICES_PER_USER (50) × MAX_WARRANTIES_PER_DEVICE (5) + 50 device
--     items + MAX_SUBS_PER_USER (100) + MAX_WISHLIST_PER_USER (200), and the
--     service additionally refuses past MAX_SNOOZES_PER_USER as a hard stop.
--
-- Deliberately NOT part of the backup payload (versions stay at 5/6)
--   A snooze is transient acknowledgement state with its own expiry (≤ 365 days),
--   and losing it can only make an item REAPPEAR — it can never hide one. That is
--   the opposite direction from "Reminder"."isDismissed" / "lastNotifiedAt", which
--   is why those are carried in the backup (see BackupReminder in
--   services/backup.go). Recorded here so nobody has to rediscover the decision;
--   adding it later is purely additive and needs no format bump.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE public."DecisionSnooze" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "itemKey" text NOT NULL,
    "snoozedUntil" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "DecisionSnooze_pkey" PRIMARY KEY (id),
    CONSTRAINT "DecisionSnooze_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE UNIQUE INDEX "DecisionSnooze_userId_itemKey_key"
    ON public."DecisionSnooze" USING btree ("userId", "itemKey");
CREATE INDEX "DecisionSnooze_snoozedUntil_idx"
    ON public."DecisionSnooze" USING btree ("snoozedUntil");
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS public."DecisionSnooze";
-- +goose StatementEnd
