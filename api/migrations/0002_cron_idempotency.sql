-- Cron idempotency: prevent duplicate push notifications when the cron runs
-- more than once in the same day. Adds per-row "last notified" timestamps
-- the cron filters by ::date < CURRENT_DATE.
--
-- Background (see api/internal/cron/run.go):
--   * Warranty 7d/30d notice — Reminder previously had no lastNotifiedAt; a
--     second cron run on the same day re-pushed the same payload. We add the
--     column here and the cron upserts a Reminder row stamped with NOW()
--     after a successful fan-out.
--   * Wishlist target-date day-of — WishlistItem.lastNotifiedAt already
--     existed (migration 0001) but ListWishlistTargetDateDue didn't filter on
--     it. The query is updated in queries/wishlist.sql; no schema change here.
--   * Subscription renewal 3/1/0-day warning — Subscription.lastNotifiedRenewalAt
--     already existed (migration 0001) but the renewal-warning query didn't
--     filter on it and the cron never stamped it for the warning buckets.
--     The query is updated in queries/subscriptions.sql; no schema change here.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE public."Reminder"
    ADD COLUMN IF NOT EXISTS "lastNotifiedAt" timestamp(3) without time zone;

CREATE INDEX IF NOT EXISTS "Reminder_lastNotifiedAt_idx"
    ON public."Reminder" USING btree ("lastNotifiedAt");

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS public."Reminder_lastNotifiedAt_idx";
ALTER TABLE public."Reminder" DROP COLUMN IF EXISTS "lastNotifiedAt";

-- +goose StatementEnd
