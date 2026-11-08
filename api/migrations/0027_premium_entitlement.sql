-- Warrly Premium — the first thing in this schema that is about paying for the
-- app rather than about the devices it tracks.
--
-- ── One row per transaction, not one row per user ─────────────────────────
--
-- A renewal is a NEW transaction with the same originalTransactionId. Storing
-- only "the user's latest entitlement" would overwrite the previous transaction
-- and lose the only record that proves who claimed it — which is exactly how a
-- purchase gets handed to a second account on the same Apple ID. Rows are kept:
--
--   * transactionId is the primary key (Apple's id is unique per purchase);
--   * originalTransactionId is indexed but NOT unique, because renewals share
--     it;
--   * the service refuses a transaction/original id that already belongs to a
--     different user, so a receipt cannot be replayed onto another account.
--
-- Premium is derived, never stored as a mutable "plan" flag:
--
--   EXISTS (SELECT 1 FROM "PremiumEntitlement"
--           WHERE "userId" = $1 AND "revokedAt" IS NULL AND "expiresAt" > now())
--
-- That means an expired subscription loses premium with no cron, and a refund
-- (revokedAt) loses it as soon as the server sees the revocation. The v1 app
-- syncs current entitlements on launch/foreground; App Store Server
-- Notifications V2 (renewals/refunds while the app is closed) are a later
-- addition, documented in docs/SPEC-PREMIUM.md.
--
-- ── Timestamps ────────────────────────────────────────────────────────────
--
-- timestamp(3) without time zone, matching every other date in this schema
-- (UTC semantics, normalised by migration 0024). expiresAt/revokedAt come from
-- Apple's epoch-millisecond payload and are converted to UTC in Go.
--
-- No price, currency or receipt payload is stored. The server only needs to
-- answer "is this account premium, until when, on which product"; keeping the
-- signed JWS would turn this table into a second copy of Apple's receipt with
-- no use. environment is kept because Sandbox purchases are accepted for App
-- Review and must be distinguishable in support/debugging.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS public."PremiumEntitlement" (
    "transactionId"         text        NOT NULL PRIMARY KEY,
    "originalTransactionId" text        NOT NULL,
    "userId"                text        NOT NULL REFERENCES public."User" ("id") ON DELETE CASCADE,
    "productId"             text        NOT NULL,
    "expiresAt"             timestamp(3) without time zone NOT NULL,
    "revokedAt"             timestamp(3) without time zone,
    "environment"           text        NOT NULL,
    "createdAt"             timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    "updatedAt"             timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')
);

-- The entitlement lookup: one user, newest active first.
CREATE INDEX IF NOT EXISTS "PremiumEntitlement_user_expiry_idx"
    ON public."PremiumEntitlement" ("userId", "expiresAt" DESC);

-- The ownership lookup when a transaction is verified: find the row (if any)
-- that already claimed this purchase chain.
CREATE INDEX IF NOT EXISTS "PremiumEntitlement_original_idx"
    ON public."PremiumEntitlement" ("originalTransactionId");
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS public."PremiumEntitlement";
-- +goose StatementEnd
