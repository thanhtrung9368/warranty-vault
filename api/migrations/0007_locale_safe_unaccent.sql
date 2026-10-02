-- WarrantyVault — locale-independent Vietnamese search: swap the unaccent/lower order.
--
-- Bug (reproduced on PostgreSQL 17.11 against a cluster created with
-- LC_ALL=C, and fixed/verified against both C and en_US.UTF-8 clusters):
--
--   Migration 0005 built the search expression as `public.wv_unaccent(lower(x))`,
--   i.e. lower() runs FIRST. In a database whose locale is C/POSIX, lower() is
--   ASCII-only: 'Đ' (U+0110) is left untouched, and unaccent then maps it to an
--   UPPERCASE 'D'. Both the indexed values and the query pattern keep a leading
--   capital, and LIKE (bytewise under the C locale) compares 'Dien...' against
--   'dien...' and matches nothing.
--
--     SELECT public.wv_unaccent(lower('Điện thoại / Tủ lạnh'));
--       C locale -> 'Dien thoai / tu lanh'   <-- wrong; breaks search
--       UTF-8    -> 'dien thoai / tu lanh'
--
--   Consequence: on a C-locale database the app's Vietnamese search fails
--   *silently and completely* — an accented device name can never be found from
--   an unaccented query. Nothing errors and nothing is logged; the user just
--   sees an empty list.
--
-- Fix: unaccent FIRST (locale-independent — its rule file maps đ→d and Đ→D
-- itself), then lower(), which now only ever has to fold ASCII, so the result is
-- identical under every collation/ctype:
--
--     SELECT lower(public.wv_unaccent('Điện thoại / Tủ lạnh'));
--       C locale -> 'dien thoai / tu lanh'
--       UTF-8    -> 'dien thoai / tu lanh'
--
-- Why a new migration instead of amending 0005: goose records applied versions
-- by number, so a database that already ran 0005 (any dev/test cluster, CI
-- cache) would keep the old expression and the old indexes while the file
-- claimed otherwise. Dropping and rebuilding the indexes here makes the fix
-- apply everywhere, and keeps `down` able to restore the previous schema.
--
-- The index expression and the query predicate must stay byte-for-byte
-- equivalent (PostgreSQL matches functional indexes on the parsed expression),
-- so `internal/store/queries/devices.sql` uses `lower(public.wv_unaccent(x))`
-- for both the four columns and the search parameter. Changing the expression
-- again later requires another DROP/CREATE INDEX pair.
--
-- Note on encoding: this ordering is collation-independent, but the database
-- must still be created with a UTF-8 *encoding* (server_encoding = UTF8) for
-- the unaccent extension to see Vietnamese characters at all — `LC_COLLATE=C`
-- with `ENCODING=UTF8` is fine and is covered by
-- TestVietnameseSearchAgainstCLocaleDatabase.

-- +goose Up
-- +goose StatementBegin
DROP INDEX IF EXISTS public."Device_name_trgm_idx";
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS public."Device_brand_trgm_idx";
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS public."Device_model_trgm_idx";
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS public."Device_serialNumber_trgm_idx";
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS "Device_name_trgm_idx"
    ON public."Device" USING gin (lower(public.wv_unaccent(name)) gin_trgm_ops);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS "Device_brand_trgm_idx"
    ON public."Device" USING gin (lower(public.wv_unaccent(brand)) gin_trgm_ops);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS "Device_model_trgm_idx"
    ON public."Device" USING gin (lower(public.wv_unaccent(model)) gin_trgm_ops);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS "Device_serialNumber_trgm_idx"
    ON public."Device" USING gin (lower(public.wv_unaccent("serialNumber")) gin_trgm_ops);
-- +goose StatementEnd

-- +goose Down
-- Restores the 0005 definition verbatim — locale-dependent, but that is what the
-- previous schema version was.
-- +goose StatementBegin
DROP INDEX IF EXISTS public."Device_serialNumber_trgm_idx";
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS public."Device_model_trgm_idx";
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS public."Device_brand_trgm_idx";
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS public."Device_name_trgm_idx";
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS "Device_name_trgm_idx"
    ON public."Device" USING gin (public.wv_unaccent(lower(name)) gin_trgm_ops);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS "Device_brand_trgm_idx"
    ON public."Device" USING gin (public.wv_unaccent(lower(brand)) gin_trgm_ops);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS "Device_model_trgm_idx"
    ON public."Device" USING gin (public.wv_unaccent(lower(model)) gin_trgm_ops);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS "Device_serialNumber_trgm_idx"
    ON public."Device" USING gin (public.wv_unaccent(lower("serialNumber")) gin_trgm_ops);
-- +goose StatementEnd
