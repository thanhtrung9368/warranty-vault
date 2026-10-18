-- Warrly — warranty contract terms on "Warranty".
--
-- The app could already answer WHEN cover ends (startDate / endDate / months)
-- but never WHAT it covers, what a claim costs, or whether it survives a resale.
-- The Vietnamese plans are contracts with real economics: TGDD caps the payout
-- at the original retail price and charges a 25% deductible on a total-loss
-- replacement; CellphoneS pays up to 90% of a repair with a 10% replacement
-- fee; AppleCare+ charges 799,000 VND for screen damage but 2,649,000 VND for
-- other damage; Xiaomi excludes cosmetic damage entirely. None of that fits in
-- `notes`, which is why these are typed columns rather than prose.
--
-- ── The nine fields ─────────────────────────────────────────────────────────
--
--   * "component"     nullable text. The part this row covers; NULL = the whole
--                     unit. This is the field that makes multi-clock warranties
--                     legible: a 24-month whole-device plan plus a 10-year motor
--                     plan are two rows with two clocks, not one inflated date.
--                     "Reminder" is per-warranty ("warrantyId" NOT NULL), so
--                     each row already gets its own reminder — that was correct
--                     and is unchanged. The share certificate reads this column
--                     so a component clock cannot be presented as whole-unit
--                     cover (see services/shares.go::SharedWarranty.Component).
--   * "scope"         nullable text. What is covered, free text.
--   * "cap"           nullable integer VND. Maximum payout.
--   * "deductible"    nullable integer VND. What the user pays per claim.
--   * "exclusions"    nullable text. What is excluded, free text.
--   * "region"        nullable text. Where the cover applies.
--   * "transferable"  nullable boolean. Whether it survives a resale. Three
--                     states on purpose: NULL = unknown / not recorded,
--                     false = explicitly not transferable, true = transferable.
--                     Collapsing NULL into false would assert something the
--                     user never said.
--   * "claimsAllowed" nullable integer. The contract's claim allowance.
--   * "claimsUsed"    integer NOT NULL DEFAULT 0. How many claims have been
--                     used. NOT NULL because "zero used" is the only sensible
--                     default and every existing row means exactly that; a
--                     nullable counter would force every reader to handle two
--                     spellings of zero.
--
-- ── Validation lives in the service, deliberately ───────────────────────────
--
-- No CHECK constraints. A negative "cap", a negative "deductible", or
-- "claimsUsed" > "claimsAllowed" must be a 400 with `fieldErrors.<field>`, the
-- same shape every other bad request in this API uses. A CHECK would turn a
-- client mistake into a 500 from the driver and lose the field name. The
-- service validator (services/warranties.go::ValidateWarrantyInput) enforces:
--
--   * cap, deductible, claimsUsed, claimsAllowed are non-negative integers;
--   * claimsAllowed is nullable, so any claimsUsed is allowed when it is NULL;
--   * when both are set, claimsUsed > claimsAllowed is a 400 on
--     `fieldErrors.claimsUsed`;
--   * component/region are bounded to 200 runes and scope/exclusions to 500 —
--     a paragraph of contract text, not a scanned document.
--
-- There is NO cross-field rule tying any of these to "type". A THIRD_PARTY plan
-- may have a cap, and a STANDARD plan may have exclusions: real contracts do
-- not follow the enum, and inferring terms from it would put invented numbers
-- in front of a user who is about to make a claim.
--
-- ── No backfill, no index ───────────────────────────────────────────────────
--
--   * No backfill. NULL / 0 is the old state for every existing row, so a user
--     who never sets these fields sees no change: the column is simply absent
--     from the contract they never wrote.
--   * No index. Nothing filters or sorts on these columns. They are read as part
--     of a "Warranty" row that was already found by primary key or by
--     "deviceId" (an existing index), and the per-user ceiling bounds the row
--     count (MAX_DEVICES_TOTAL_PER_USER = 500 × MAX_WARRANTIES_PER_DEVICE = 5).
--     A separate index would add write cost to every warranty edit and never be
--     chosen by the planner.
--
-- Read paths pick the columns up through `SELECT *` / `RETURNING *` in
-- queries/warranties.sql. The public share projection names its columns
-- explicitly (queries/shares.sql::ListWarrantiesForShare) because that is the
-- one unauthenticated read, so "component" is added there on purpose and the
-- price/notes columns stay excluded.
--
-- The backup payload carries all nine fields additively (services/backup.go).
-- Payload versions stay 5/6: an older file decodes the new keys to NULL/0,
-- which is exactly the pre-0017 meaning ("not recorded", "never used").

-- +goose Up
-- +goose StatementBegin
ALTER TABLE public."Warranty"
    ADD COLUMN IF NOT EXISTS component text,
    ADD COLUMN IF NOT EXISTS scope text,
    ADD COLUMN IF NOT EXISTS cap integer,
    ADD COLUMN IF NOT EXISTS deductible integer,
    ADD COLUMN IF NOT EXISTS exclusions text,
    ADD COLUMN IF NOT EXISTS region text,
    ADD COLUMN IF NOT EXISTS transferable boolean,
    ADD COLUMN IF NOT EXISTS "claimsAllowed" integer,
    ADD COLUMN IF NOT EXISTS "claimsUsed" integer NOT NULL DEFAULT 0;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE public."Warranty"
    DROP COLUMN IF EXISTS "claimsUsed",
    DROP COLUMN IF EXISTS "claimsAllowed",
    DROP COLUMN IF EXISTS transferable,
    DROP COLUMN IF EXISTS region,
    DROP COLUMN IF EXISTS exclusions,
    DROP COLUMN IF EXISTS deductible,
    DROP COLUMN IF EXISTS cap,
    DROP COLUMN IF EXISTS scope,
    DROP COLUMN IF EXISTS component;
-- +goose StatementEnd
