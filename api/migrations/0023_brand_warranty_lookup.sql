-- Warrly — the brand's own warranty answer, and the mismatch it can create
-- (gap #11).
--
-- ── The problem ────────────────────────────────────────────────────────────
--
-- "Device"."purchaseDate" is the date on the invoice, and every warranty start
-- in this app has been derived from it. The brand's own system often holds a
-- different date: a grey-market import activated months before the invoice, a
-- shop that pre-activated a unit to start the clock later, a repaired device
-- re-registered under a new serial. The user reads "còn 8 tháng" in the app and
-- the service centre reads "hết hạn tuần trước" — or the reverse. The app cannot
-- know the brand's answer unless the user records what the brand's lookup page
-- said, so that is what these five columns are: a USER-ENTERED record of the
-- brand's answer, not a second warranty calculation.
--
-- ── The five columns on "Device" ───────────────────────────────────────────
--
--   * "brandWarrantyStatus" text NULL — one of ACTIVE / EXPIRED /
--     NOT_REGISTERED / PRE_ACTIVATED / UNKNOWN. Validated in
--     services.ValidateDeviceInput, NOT by a CHECK constraint: this schema's
--     rule is that a bad request is a 400 with fieldErrors.<field>, never a raw
--     500 from the driver (the same reason migration 0022 has no CHECK).
--   * "brandWarrantyStart" timestamp(3) NULL — the start date THE BRAND reports.
--   * "brandWarrantyEnd"   timestamp(3) NULL — the end date THE BRAND reports.
--   * "brandCheckedAt"     timestamp(3) NULL — when the user last checked.
--   * "brandLookupUrl"     text NULL — the exact URL the user opened. It is kept
--     so the record is auditable: six months later, "where did this date come
--     from" has an answer. The server NEVER fetches this URL; it is a record,
--     not a request. An absolute http/https URL is the only accepted shape.
--
-- Why nullable and no backfill: a user who never records a brand lookup must see
-- no behavioural change. Every existing row gets NULL in all five columns, which
-- is exactly "the brand has not been checked" — the same state a brand-new row
-- starts in. The five fields are copied verbatim by the backup export/import
-- (services/backup.go), so a restore does not lose them, and an older payload
-- without them imports as NULL (the additive-payload rule the format already
-- follows).
--
-- "warrantyMismatch" is NOT a column here, and must never become one: it is
-- computed on every read from these five fields plus "purchaseDate" and the
-- whole-unit warranty rows (services.BrandWarrantyMismatch). Storing it would
-- let it disagree with the data it is derived from.
--
-- ── "BrandServiceInfo"."warrantyLookupUrl" ────────────────────────────────
--
-- Migration 0012 seeded the directory of "where do I take this" pages and
-- deliberately refused to invent contact data. This migration adds the one
-- additional URL that belongs next to it: the brand's own WARRANTY-STATUS lookup
-- (the page that answers "what dates does the brand think I have"), which is a
-- different question from "where is the nearest service centre".
--
-- The honesty rule from 0012 is unchanged: a URL is seeded ONLY when it can be
-- sourced. No pattern is guessed (`https://<brand>.com/warranty` is exactly the
-- kind of fabrication 0012's header rejects). The four URLs below were verified
-- as live official pages on 2026-10-19:
--
--   * apple    https://checkcoverage.apple.com/
--       Apple's own "AppleCare & Warranty" coverage checker. The page resolves
--       to a country selector that lists Việt Nam, and is the same tool Apple
--       support links for "check your warranty or AppleCare contract".
--   * samsung  https://www.samsung.com/vn/support/warrantycheck/
--       "Kiểm tra thời hạn bảo hành điện tử | Samsung Việt Nam".
--   * asus     https://www.asus.com/vn/support/warranty-status-inquiry/
--       "Kiểm tra tình trạng bảo hành | Hỗ trợ của | ASUS Việt Nam".
--   * lenovo   https://pcsupport.lenovo.com/vn/vi/warranty-lookup
--       "Lenovo Warranty Check | Device Warranty Lookup | Lenovo Support VN".
--
-- Every other brand in migration 0012 is left NULL on purpose. Where a brand
-- publishes only a warranty POLICY (Xiaomi, OPPO, realme, vivo, Sony, LG,
-- Panasonic, Daikin, Electrolux), only a how-to article, or a page that could
-- not be verified (Dell, HP, Acer), the column stays NULL and the API reports
-- "no lookup URL" — a missing URL is honest; a guessed one sends the user to the
-- wrong place. internal/services/warranty_lookup_seed_test.go pins this list and
-- fails if a URL is added here without updating the allowlist and its source.
--
-- The column is NULLable and the seed only fills rows that are still NULL, so
-- re-running against an operator-edited database never overwrites a correction.
--
-- ── Rollback ───────────────────────────────────────────────────────────────
--
-- Down drops the five device columns and the directory column. The brand data
-- they carry has nowhere to go in the older schema; as every goose down in this
-- directory, it is destructive and goose refuses it without
-- WV_ALLOW_DESTRUCTIVE=1.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE public."Device"
    ADD COLUMN IF NOT EXISTS "brandWarrantyStatus" text,
    ADD COLUMN IF NOT EXISTS "brandWarrantyStart" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "brandWarrantyEnd" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "brandCheckedAt" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "brandLookupUrl" text;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE public."BrandServiceInfo"
    ADD COLUMN IF NOT EXISTS "warrantyLookupUrl" text;
-- +goose StatementEnd

-- Only the four verifiable pages above. Anything not listed keeps NULL.
-- +goose StatementBegin
UPDATE public."BrandServiceInfo" AS b
SET "warrantyLookupUrl" = v.url
FROM (VALUES
    ('apple',   'https://checkcoverage.apple.com/'),
    ('samsung', 'https://www.samsung.com/vn/support/warrantycheck/'),
    ('asus',    'https://www.asus.com/vn/support/warranty-status-inquiry/'),
    ('lenovo',  'https://pcsupport.lenovo.com/vn/vi/warranty-lookup')
) AS v("brandId", url)
WHERE b."brandId" = v."brandId"
  AND b."warrantyLookupUrl" IS NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE public."BrandServiceInfo"
    DROP COLUMN IF EXISTS "warrantyLookupUrl";
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE public."Device"
    DROP COLUMN IF EXISTS "brandLookupUrl",
    DROP COLUMN IF EXISTS "brandCheckedAt",
    DROP COLUMN IF EXISTS "brandWarrantyEnd",
    DROP COLUMN IF EXISTS "brandWarrantyStart",
    DROP COLUMN IF EXISTS "brandWarrantyStatus";
-- +goose StatementEnd
