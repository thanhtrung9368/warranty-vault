-- WarrantyVault — the user's language preference.
--
-- This is i18n INFRASTRUCTURE, not a translation (docs/I18N_PLAN.md §2.3). It is
-- the one piece of the bilingual feature that needs a schema change, because the
-- cron push fan-out builds notification text in Go with no request attached: no
-- `Accept-Language`, no caller to ask. The stored preference is the only signal
-- available there, so it has to live on the row.
--
-- ── Why nullable, and what NULL means ────────────────────────────────────────
--
-- NULL = "no explicit preference" — which is what every existing row is, and it
-- is NOT the same as 'en'. NULL lets the request still decide:
--
--     1. ?lang=vi|en      (query param, wins over everything)
--     2. Accept-Language  (HTTP header)
--     3. "User".locale    ← this column
--     4. 'en'             (default)
--
-- A NOT NULL DEFAULT 'en' would have pinned step 3 for the entire existing user
-- base and made steps 1-2 unreachable for anyone who ever loaded a page — i.e. it
-- would have silently overridden a Vietnamese phone's `Accept-Language: vi` with
-- the server's default. NULL is the only shape that keeps the precedence order
-- meaningful. There is deliberately no backfill: NULL is exactly the old meaning.
--
-- ── Why a two-letter code and not a BCP-47 tag or an enum ────────────────────
--
-- The column stores the SAME two-letter ISO 639-1 code that `?lang=` accepts and
-- that `internal/i18n.Tag` carries (`'en'`, `'vi'`). Three shapes were considered:
--
--   * BCP-47 tag (`'vi-VN'`, `'en-US'`, `'zh-Hans-CN'`) — rejected as a storage
--     format. It encodes a REGION and a SCRIPT, and this column expresses neither:
--     nothing in the service branches on region-specific spelling, date format or
--     currency. Storing 'vi-VN' would invite later code to depend on a distinction
--     the product does not make, and it creates two spellings of one preference
--     ('vi' from `?lang=vi`, 'vi-VN' from a client that sends the raw header) that
--     every comparison would then have to normalise. Region stays where it belongs:
--     in `Accept-Language`, which is parsed per request by x/text and reduced to a
--     base language. `internal/i18n.Normalize` accepts a full tag from a client and
--     stores the base code, so nothing is lost.
--   * PostgreSQL ENUM type — rejected on migration ergonomics. Adding a third
--     language would need `ALTER TYPE ... ADD VALUE`, which historically could not
--     run inside a transaction block, and goose wraps each migration in one. A
--     2-value enum also buys nothing that the CHECK below does not.
--   * Free text — rejected: a typo like 'vn' would turn "Vietnamese" into
--     "no preference" with no error anywhere.
--
-- So: two lowercase letters, enforced twice.
--
--   * The CHECK is the STRUCTURAL guard and is deliberately language-agnostic:
--     it stops a malformed value ('vn', 'vi-VN', 'english', '') from ever being
--     stored, without hard-coding the supported set into the schema. That matters
--     because the set of supported languages is an APPLICATION concern that
--     changes with the catalog, not with the schema.
--   * Membership in {en, vi} is enforced by the API (`i18n.IsSupported`, used by
--     PATCH /api/v1/auth/me). Adding a third language therefore needs a new
--     catalog column and a new `language.Tag` — NOT a migration, which is what
--     the plan asks for ("kiến trúc phải cho phép, nhưng đừng làm bây giờ",
--     I18N_PLAN.md §6). The CHECK would already accept 'ja'.
--
-- `char_length`, not `length` or a regex: `length()` is a byte count, which would
-- happily accept two bytes of a three-byte character, and `char_length` is
-- IMMUTABLE so it is legal in a CHECK constraint.
--
-- NOT part of the backup payload: the locale is a display preference, and the
-- backup importer (services/backup.go) has no locale field. Losing it on a
-- restore falls back to the Accept-Language path, which is a safe direction — same
-- reasoning as migration 0011's DecisionSnooze.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE public."User"
    ADD COLUMN IF NOT EXISTS locale text;

ALTER TABLE public."User"
    ADD CONSTRAINT "User_locale_check"
    CHECK (locale IS NULL OR (char_length(locale) = 2 AND locale = lower(locale)));
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE public."User" DROP CONSTRAINT IF EXISTS "User_locale_check";
ALTER TABLE public."User" DROP COLUMN IF EXISTS locale;
-- +goose StatementEnd
