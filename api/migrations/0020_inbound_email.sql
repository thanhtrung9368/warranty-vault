-- Warrly — provider-agnostic inbound email: a per-user address that drops
-- attachments straight into the capture-first inbox (migration 0018).
--
-- The owner has not chosen an inbound-email provider yet, so nothing here knows
-- what a vendor's webhook looks like. This migration only adds the one thing
-- every provider needs: a recipient address that identifies a user without being
-- guessable from their email/name/id.
--
-- ── Why the local part is a secret, and why it is STORED ─────────────────────
--
-- `POST /api/v1/inbox/email` is unauthenticated at the JWT layer (the mail
-- provider has no Warrly session). It is authenticated by a shared secret, but
-- that secret is global: it says "this request came from our mail provider", not
-- "this message is for user X". Routing must therefore be carried by the
-- recipient address itself:
--
--     <inboxToken>@<INBOX_EMAIL_DOMAIN>
--
-- The local part is 122 random bits (a v4 UUID with the hyphens removed → 32
-- lowercase hex characters). It is NOT derived from the user's id, email or
-- name: a guessable local part would let anyone who learned the domain inject
-- receipts into other people's inboxes by sending them an email.
--
-- Unlike `DeviceShare.tokenHash` / `PasswordReset.tokenHash`, this value is
-- stored in PLAINTEXT. That is a deliberate difference, not an oversight:
--
--   * a share token is shown once and then only its hash is needed to verify it;
--   * the inbound address is part of the user's persistent profile. Clients must
--     be able to DISPLAY it in Settings (`User.inboxAddress`) on every login and
--     every GET /auth/me, and it has to keep working for as long as the account
--     does. A hash cannot be displayed, and re-deriving the raw value is
--     impossible by construction.
--
-- The exposure is bounded by what the credential can do: it is an APPEND-ONLY
-- capability. Holding the address lets you add attachment rows to one user's
-- inbox; it cannot read, list, download, file or delete anything without the
-- user's bearer token. It also cannot be used to send mail. A database leak that
-- exposes this column therefore does not expose a single existing attachment or
-- any session.
--
-- ── Generation / backfill ───────────────────────────────────────────────────
--
-- The column is `NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', '')`.
-- Postgres' gen_random_uuid() is a v4 UUID seeded from the platform CSPRNG
-- (pg_strong_random), so 122 bits are random; 32 lowercase hex characters fit
-- comfortably inside the 64-octet local-part limit and cannot be mangled by mail
-- systems that lowercase the local part (the app lowercases before comparing).
--
-- The DEFAULT is what backfills existing accounts: ALTER TABLE evaluates it once
-- per existing row while adding the NOT NULL column, and every future INSERT that
-- does not name the column (including test fixtures and psql scripts) gets a
-- fresh value without the Go code having to remember to generate one. A single
-- UPDATE after the fact would have left a window in which the column was NULL.
--
-- The unique index is both the routing lookup (one indexed probe per message) and
-- the collision guard. A collision is a 2^-122 event, but if it ever happened the
-- INSERT/ALTER would fail loudly instead of silently routing two users' mail to
-- the same inbox.
--
-- No expiry, no rotation endpoint, and no "revoked" flag in this migration: the
-- address is meant to be stable like the account's own email. Rotating it is a
-- future endpoint, and dropping the column is the rollback.
--
-- ── Backup ──────────────────────────────────────────────────────────────────
--
-- The token deliberately does NOT travel in the backup export. `BackupV1` has no
-- User object at all, and this column must not become one: a backup file is
-- copied to drives and cloud folders, and carrying the capability there would
-- mean anyone holding a backup could post attachments into the live account's
-- inbox (and, after a restore to another account, into that one). The user can
-- still read the address from GET /auth/me at any time.
--
-- ── Rollback ────────────────────────────────────────────────────────────────
--
-- Down drops the index and the column. Every inbound address stops resolving and
-- the endpoint answers 404 for all mail until a future migration re-adds it; no
-- attachment rows are touched.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE public."User"
    ADD COLUMN IF NOT EXISTS "inboxToken" text NOT NULL
    DEFAULT replace(gen_random_uuid()::text, '-', '');

CREATE UNIQUE INDEX IF NOT EXISTS "User_inboxToken_key"
    ON public."User" USING btree ("inboxToken");

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS public."User_inboxToken_key";

ALTER TABLE public."User"
    DROP COLUMN IF EXISTS "inboxToken";

-- +goose StatementEnd
