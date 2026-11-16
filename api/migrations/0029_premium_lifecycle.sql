-- Warrly Premium lifecycle (FEATURE_RESEARCH_2026-11 §6.4 Phase 0).
--
-- Additive only. Nothing here changes what an existing entitlement means: a row
-- written by migration 0027 has "gracePeriodExpiresAt" NULL and
-- "inBillingRetryPeriod" false, so it is active exactly when it was before.
--
-- ── Why the extra columns ────────────────────────────────────────────────
--
-- The v1 app verifies StoreKit transactions on launch/foreground. That is enough
-- to decide "is this account premium right now", but it cannot represent the
-- lifecycle Apple actually has:
--
--   * Billing Grace Period — Apple keeps the subscription entitled for a short
--     window after a failed renewal. Without "gracePeriodExpiresAt" a paying user
--     loses the higher limits the moment "expiresAt" passes, while Apple still
--     considers them subscribed.
--   * Billing retry — the renewal failed and Apple is retrying. This is not the
--     same story as "the user cancelled", and the app must not claim it is.
--   * Refund / revocation reason and the last event that touched the row.
--
-- The values mirror App Store Server Notifications V2 / the App Store Server API
-- so the notification endpoint (a later phase) can write them without a second
-- migration. Until then only "gracePeriodExpiresAt" and "inBillingRetryPeriod"
-- are read, by the active predicate and GET /api/v1/billing/status.
--
-- ── EntitlementEvent ──────────────────────────────────────────────────────
--
-- An append-only ledger of what the server was told and what it did with it, so
-- an out-of-order or replayed notification can be evidenced instead of guessed.
-- The id encodes the source and the natural key:
--
--   "asn:<notificationUUID>"  one App Store notification
--   "verify:<transactionId>"  one POST /api/v1/billing/verify call
--   "cron:<...>"              one scheduled reconciliation pass
--
-- The PRIMARY KEY is the idempotency key: a retried delivery inserts nothing.
-- "payloadHash" is a SHA-256 of the signed payload; the raw JWS is deliberately
-- never stored (it is a receipt, and this table is not a second copy of Apple's
-- data). No application path deletes or rewrites an event; the only exception is
-- the account-deletion cascade every owned row in this schema has, and
-- "applied"/"applyNote" are the one pair updated when a stored event is replayed.
--
-- "userId" is nullable on purpose: a notification can arrive for an account the
-- server has not linked to that purchase yet, and it must be kept for replay
-- rather than dropped.
--
-- ── PremiumNotice ─────────────────────────────────────────────────────────
--
-- The "sắp hết hạn" / "đã hết hạn" emails and pushes are a later phase; this
-- table is their send-once key, (userId, periodEnd, kind). It lives in the same
-- migration because 0029 ships before the binary that reads it, and adding a
-- table later would mean a second schema step for the same feature.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE public."PremiumEntitlement"
    ADD COLUMN IF NOT EXISTS "autoRenewStatus" text;
ALTER TABLE public."PremiumEntitlement"
    ADD COLUMN IF NOT EXISTS "expirationIntent" integer;
ALTER TABLE public."PremiumEntitlement"
    ADD COLUMN IF NOT EXISTS "inBillingRetryPeriod" boolean NOT NULL DEFAULT false;
ALTER TABLE public."PremiumEntitlement"
    ADD COLUMN IF NOT EXISTS "gracePeriodExpiresAt" timestamp(3) without time zone;
ALTER TABLE public."PremiumEntitlement"
    ADD COLUMN IF NOT EXISTS "revocationReason" integer;
ALTER TABLE public."PremiumEntitlement"
    ADD COLUMN IF NOT EXISTS "lastEventType" text;
ALTER TABLE public."PremiumEntitlement"
    ADD COLUMN IF NOT EXISTS "lastEventAt" timestamp(3) without time zone;

CREATE TABLE IF NOT EXISTS public."EntitlementEvent" (
    id                      text        NOT NULL PRIMARY KEY,
    "originalTransactionId" text        NOT NULL,
    "userId"                text        REFERENCES public."User" ("id") ON DELETE CASCADE,
    source                  text        NOT NULL,
    "eventType"             text        NOT NULL,
    "effectiveAt"           timestamp(3) without time zone NOT NULL,
    applied                 boolean     NOT NULL DEFAULT false,
    "applyNote"             text,
    "payloadHash"           text,
    "receivedAt"            timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    CONSTRAINT "EntitlementEvent_source_check"
        CHECK (source IN ('asn', 'verify', 'cron'))
);

CREATE INDEX IF NOT EXISTS "EntitlementEvent_original_effective_idx"
    ON public."EntitlementEvent" ("originalTransactionId", "effectiveAt");

-- The replay lookup: events that arrived before the account was known.
CREATE INDEX IF NOT EXISTS "EntitlementEvent_unassigned_idx"
    ON public."EntitlementEvent" ("originalTransactionId")
    WHERE "userId" IS NULL;

CREATE TABLE IF NOT EXISTS public."PremiumNotice" (
    "userId"    text        NOT NULL REFERENCES public."User" ("id") ON DELETE CASCADE,
    "periodEnd" timestamp(3) without time zone NOT NULL,
    kind        text        NOT NULL,
    "sentAt"    timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    PRIMARY KEY ("userId", "periodEnd", kind),
    CONSTRAINT "PremiumNotice_kind_check"
        CHECK (kind IN ('EXPIRING', 'EXPIRED'))
);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS public."PremiumNotice";
DROP TABLE IF EXISTS public."EntitlementEvent";

ALTER TABLE public."PremiumEntitlement" DROP COLUMN IF EXISTS "lastEventAt";
ALTER TABLE public."PremiumEntitlement" DROP COLUMN IF EXISTS "lastEventType";
ALTER TABLE public."PremiumEntitlement" DROP COLUMN IF EXISTS "revocationReason";
ALTER TABLE public."PremiumEntitlement" DROP COLUMN IF EXISTS "gracePeriodExpiresAt";
ALTER TABLE public."PremiumEntitlement" DROP COLUMN IF EXISTS "inBillingRetryPeriod";
ALTER TABLE public."PremiumEntitlement" DROP COLUMN IF EXISTS "expirationIntent";
ALTER TABLE public."PremiumEntitlement" DROP COLUMN IF EXISTS "autoRenewStatus";
-- +goose StatementEnd
