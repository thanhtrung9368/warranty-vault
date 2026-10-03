-- WarrantyVault — hạn đổi trả ("1 đổi 1") theo từng thiết bị (FEATURE_IDEAS #1).
--
-- Why this exists
--   Cron only knows two milestones and both are counted BACKWARDS from
--   "Warranty"."endDate" (internal/cron/run.go, buckets 7 and 30 days). For a
--   12-month warranty the only notification the user ever receives lands around
--   month 11 — roughly ten months AFTER a retailer's 30-day one-for-one exchange
--   window has closed. The window that actually decides whether a
--   defective-on-arrival device gets replaced (instead of repaired, at the user's
--   cost) is invisible today, even though the app already holds every input
--   needed to count it down.
--
-- Why two columns on "Device" and NOT a row in "Reminder"
--   * "Reminder"."warrantyId" is NOT NULL with an FK to "Warranty"
--     (0001_initial.sql:174-183), so the table structurally cannot hold a
--     deadline that belongs to no package. The exchange window is a property of
--     the purchase, not of a warranty package.
--   * "Reminder"."isDismissed" is the PUSH GATE for warranty notices, not a UI
--     flag: ListWarrantiesInWindow and CountActiveReminders both carry
--     `NOT EXISTS (... isDismissed = true)`. Putting a second kind of item in
--     that table can therefore silence a real warranty notice — see
--     docs/SPEC-MAINTENANCE-SCHEDULES.md §2.3 and docs/FEATURE_IDEAS.md #3.
--   * The repo's own precedent is a per-subject column on the subject table:
--     "WishlistItem"."reminderIntervalDays"/"lastNotifiedAt" and
--     "Subscription"."lastNotifiedRenewalAt".
--
-- Semantics
--   * "returnWindowDays" is nullable. NULL means "chưa biết" (unknown), which is
--     NOT the same as 0, which means "cửa hàng này không cho đổi trả". Both are
--     skipped by the cron bucket; only > 0 counts down.
--   * The number is USER-SUPPLIED or picked from a preset. It is not a legal
--     requirement and it is not uniform. Verified directly against FPT Shop's
--     published policy (https://fptshop.com.vn/ho-tro/chinh-sach-doi-san-pham,
--     effective 01/7/2024, page fetched and read in full):
--       - ICT (phone / tablet / laptop / desktop PC / AIO / smartwatch / monitor),
--         manufacturer defect: 0–30 days from invoice → "1 ĐỔI 1 sản phẩm chính",
--         0% depreciation fee.
--       - Accessories (network gear, portable drives, USB, memory cards,
--         chargers, cables, mice, headphones, speakers…): 0–365 days.
--       - Screen protectors: no warranty and no exchange at all.
--       - Fridges / freezers / washing machines: 1-for-1 within 30 days for the
--         Casper brand only; every other brand is repair-only.
--     A single hard-coded number would therefore be wrong for whole categories of
--     device, which is why the column is per device.
--   * Vietnamese consumer law does NOT create this window. Điều 30 Luật Bảo vệ
--     quyền lợi người tiêu dùng 19/2023/QH15 requires a replacement or a refund
--     only when (a) the warranty period expired without the fault being fixed, or
--     (b) the goods were repaired 3 or more times inside the warranty period and
--     the fault persists. There is no statutory 30-day exchange right, so nothing
--     in this feature may present a shop's policy as a legal obligation.
--   * "receivedAt" is a separate column from "purchaseDate" because an online
--     order is invoiced before it is delivered, and the deadline should count from
--     the day the user actually has the device. The deadline itself is NEVER
--     stored: it is always
--         COALESCE("receivedAt", "purchaseDate") + "returnWindowDays" days
--     computed in SQL (queries/returnwindow.sql) and in the pure Go helper
--     services.ReturnDeadline, so editing either input immediately moves it and
--     the two can never disagree.
--   * "returnWindowNotifiedAt" is the cron idempotency marker, exactly like
--     "Reminder"."lastNotifiedAt" (migration 0002) and
--     "WishlistItem"."lastNotifiedAt": the sweep skips a device it already pushed
--     about today, so a second run on the same day is a no-op. Kept on "Device"
--     for the same reason as above.
--   * No index. The cron and list predicates are on a computed expression
--     (COALESCE(...) + interval) that no plain btree index can serve, and the
--     per-user set is bounded by MAX_DEVICES_PER_USER = 50.
--
-- Read paths pick the columns up automatically through `SELECT *` / `RETURNING *`
-- in internal/store/queries/devices.sql, and the backup payload carries them
-- additively (services/backup.go BackupDevice + BackupInsertDevice), so a restore
-- does not silently drop the very deadline this feature exists to protect. The
-- payload versions stay at 5/6: the format is additive and a v5 payload without
-- these fields decodes to NULL, which is exactly "unknown window".

-- +goose Up
-- +goose StatementBegin
ALTER TABLE public."Device"
    ADD COLUMN IF NOT EXISTS "returnWindowDays" integer,
    ADD COLUMN IF NOT EXISTS "receivedAt" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "returnWindowNotifiedAt" timestamp(3) without time zone;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE public."Device"
    DROP COLUMN IF EXISTS "returnWindowNotifiedAt",
    DROP COLUMN IF EXISTS "receivedAt",
    DROP COLUMN IF EXISTS "returnWindowDays";
-- +goose StatementEnd
