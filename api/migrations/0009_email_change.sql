-- WarrantyVault — email change verification (roadmap #10, second half).
--
-- Why this migration exists
-- -------------------------
-- Changing the account email was impossible: `PATCH /api/v1/auth/me` accepts only
-- `displayName` and rejects an email field, because a naive UPDATE would move the
-- account to an address the user may not control and would leave no way back.
--
-- The verification flow reuses the existing `PasswordReset` infrastructure
-- (token hash + expiry + single use + consume-all-on-confirm) instead of adding a
-- parallel table: the lifecycle is identical — a random single-use token stored as
-- a sha256 hash, a TTL, a transactional consume, and "burn every outstanding token
-- for this user" on success. The only extra thing an email change needs to
-- remember is *which* address the token authorises.
--
-- `pendingEmail`
-- --------------
-- NULL  → the row is an ordinary password-reset token (all pre-existing rows).
-- set   → the row authorises moving the account to this address.
--
-- The two are kept strictly disjoint in the queries:
--   * `GetPasswordResetByTokenHash` requires `"pendingEmail" IS NULL`, so an
--     email-change token can never be spent to set a new password (the token is
--     delivered to the *new* address, which may be an attacker's, so it must not
--     be a password credential), and
--   * `GetEmailChangeByTokenHash` requires `"pendingEmail" IS NOT NULL`, so a
--     password-reset token can never move the account.
--
-- No backfill is needed: NULL is exactly the old meaning. `User.email` is not
-- touched here — the old address keeps working until the confirm step.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE public."PasswordReset"
    ADD COLUMN IF NOT EXISTS "pendingEmail" text;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE public."PasswordReset"
    DROP COLUMN IF EXISTS "pendingEmail";
-- +goose StatementEnd
