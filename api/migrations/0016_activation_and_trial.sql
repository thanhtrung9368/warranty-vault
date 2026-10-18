-- Warrly — e-warranty activation and the extended-cover purchase deadline
-- (Device), plus the subscription trial (Subscription).
--
-- ── Why these live on the subject row (Device / Subscription) ───────────────
--
-- Neither reminder can be a row in "Reminder":
--
--   * "Reminder"."warrantyId" is NOT NULL with an FK to "Warranty"
--     (0001_initial.sql), so the table structurally cannot hold a deadline that
--     belongs to no warranty package. Precisely the reason migration 0010 put the
--     retailer exchange window on "Device".
--   * "Reminder"."isDismissed" is the PUSH GATE for warranty notices, not a UI
--     flag: ListWarrantiesInWindow and CountActiveReminders both carry
--     `NOT EXISTS (... isDismissed = true)`. Putting a second kind of item in
--     that table could silence a real warranty notice. Same argument as 0010
--     and docs/SPEC-MAINTENANCE-SCHEDULES.md §2.3.
--
-- The repo's own precedent is a per-subject column on the subject table:
-- "WishlistItem"."lastNotifiedAt", "Subscription"."lastNotifiedRenewalAt",
-- "Device"."returnWindowNotifiedAt".
--
-- ── Feature A: activation + extended cover ──────────────────────────────────
--
--   * "activationRequired" boolean NOT NULL DEFAULT false. In Vietnam the
--     warranty frequently starts with a retailer/manufacturer activation action
--     rather than the invoice, and an unactivated device can be refused at the
--     counter even with a valid receipt. Default false means every existing row
--     keeps its current behaviour: no activation reminder, no change to the
--     effective warranty start.
--   * "activatedAt" nullable. It is the real warranty start when it is LATER
--     than "purchaseDate". Deliberately NOT constrained against "purchaseDate":
--     an activation timestamp BEFORE the invoice is a legitimate data-entry state
--     (a shop can pre-activate stock before selling it), and this API does not
--     get to call that nonsense. There is no CHECK, no cross-field rule.
--   * "extendedCoverBuyBy" nullable. AppleCare+ / Samsung Care+ style cover must
--     be bought inside a window that closes forever. The value is USER-ENTERED:
--     the API does not derive it, does not assert a day count for any brand, and
--     has no server default. The report behind this feature could not verify the
--     window for every brand, and inventing one would be worse than asking.
--   * "activationNotifiedAt" is the once-only idempotency marker for the
--     "warranty is not activated" reminder. Unlike the expiry sweeps this one has
--     no deadline to count down from, so it is not per-lead-day: the sweep sends
--     it once and stamps. A user who dismisses it (or simply ignores it) is never
--     sent it again, and setting "activatedAt" stops it by definition.
--   * "extendedCoverNotifiedAt" + "extendedCoverNotifiedLeadDay" are the
--     per-lead-day idempotency pair, exactly the shape migration 0015 established
--     for "Reminder"."lastNotifiedAt"/"lastNotifiedLeadDay" and
--     "Subscription"."lastNotifiedRenewalAt"/"lastNotifiedRenewalLeadDay":
--     (deviceId, leadDay, calendar day). Reusing the shape rather than inventing
--     a second mechanism is what lets one device receive a 30-day push and a
--     7-day push on the same (compressed) day without the first suppressing the
--     second. "extendedCoverNotifiedLeadDay" IS NULL means the stamp came from a
--     hand-edited row or a future single-marker path; the query treats it as
--     "handled for every lead day today", the conservative direction.
--
-- ── Feature B: subscription trial ────────────────────────────────────────────
--
--   * "trialEndsAt" nullable — when the free period ends and billing starts.
--     A renewal date alone cannot express "free until 12 Nov, then 260k/month".
--   * "convertsToPrice" nullable, integer VND — the price after conversion.
--     "convertsToPrice" without "trialEndsAt" is meaningless and is rejected by
--     the SERVICE with `fieldErrors.convertsToPrice` (not a DB CHECK, because a
--     bad request body must be a 400 with a field error, not a 500 from the
--     constraint). The reverse is allowed: a user may know the date without
--     knowing the future price.
--   * "trialNotifiedAt" + "trialNotifiedLeadDay" — the same per-lead-day key
--     shape as the renewal marker above, reused deliberately. The trial reminder
--     uses the subscription's existing "leadDays" column instead of a second
--     schedule, and its wording is different from the renewal reminder because
--     the action is different: decide whether to keep the plan, not renew it.
--
-- ── No index, no backfill ───────────────────────────────────────────────────
--
--   * No backfill: NULL / false IS the old state for every existing row, so a
--     user who never sets these fields sees no behavioural change at all.
--   * No index. The cron predicates read the per-user/per-subject set:
--     MAX_DEVICES_PER_USER = 50 active devices, MAX_SUBS_PER_USER = 100. The
--     existing crons already full-scan candidate sets of that size, and the new
--     columns are only ever filtered AFTER a per-user row is found (or as a
--     nullable predicate over a bounded set). A partial index on
--     `"activationRequired" = true AND "activatedAt" IS NULL` would be very
--     selective but also almost empty, and Postgres would not prefer it over the
--     tiny sequential scan it already performs. Adding one would be cargo cult.
--
-- Read paths pick the new columns up automatically through `SELECT *` /
-- `RETURNING *` in queries/devices.sql and queries/subscriptions.sql. The backup
-- payload carries them additively (services/backup.go), so a restore does not
-- silently drop the activation state, the extended-cover deadline, or the trial
-- that this migration exists to protect. Payload versions stay 5/6: the format is
-- additive and an older payload decodes to false/NULL, which is exactly the old
-- meaning ("not required", "unknown", "no trial").

-- +goose Up
-- +goose StatementBegin
ALTER TABLE public."Device"
    ADD COLUMN IF NOT EXISTS "activationRequired" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "activatedAt" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "extendedCoverBuyBy" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "activationNotifiedAt" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "extendedCoverNotifiedAt" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "extendedCoverNotifiedLeadDay" integer;

ALTER TABLE public."Subscription"
    ADD COLUMN IF NOT EXISTS "trialEndsAt" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "convertsToPrice" integer,
    ADD COLUMN IF NOT EXISTS "trialNotifiedAt" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "trialNotifiedLeadDay" integer;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE public."Subscription"
    DROP COLUMN IF EXISTS "trialNotifiedLeadDay",
    DROP COLUMN IF EXISTS "trialNotifiedAt",
    DROP COLUMN IF EXISTS "convertsToPrice",
    DROP COLUMN IF EXISTS "trialEndsAt";

ALTER TABLE public."Device"
    DROP COLUMN IF EXISTS "extendedCoverNotifiedLeadDay",
    DROP COLUMN IF EXISTS "extendedCoverNotifiedAt",
    DROP COLUMN IF EXISTS "activationNotifiedAt",
    DROP COLUMN IF EXISTS "extendedCoverBuyBy",
    DROP COLUMN IF EXISTS "activatedAt",
    DROP COLUMN IF EXISTS "activationRequired";
-- +goose StatementEnd
