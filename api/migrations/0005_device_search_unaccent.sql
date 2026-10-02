-- WarrantyVault — diacritic-insensitive device search (unaccent + pg_trgm).
--
-- Problem: ListDevicesByUser searched with a raw `ILIKE '%' || $4 || '%'`, so a
-- Vietnamese user typing "dien thoai" never matched "Điện thoại". The app is
-- Vietnamese-only, so this affected essentially every search.
--
-- This migration does three things:
--   1. installs the `unaccent` + `pg_trgm` extensions,
--   2. creates public.wv_unaccent(text) — an IMMUTABLE wrapper (see below),
--   3. creates one GIN trigram functional index per searched Device column.
--
-- Why the wrapper is needed (the IMMUTABLE problem)
--   PostgreSQL 17 declares BOTH unaccent overloads as STABLE, not IMMUTABLE
--   (contrib/unaccent/unaccent--1.1.sql: `LANGUAGE C STABLE STRICT PARALLEL SAFE`)
--   because the dictionary is resolved through search_path at run time. Postgres
--   refuses to build an index on a non-immutable expression, so
--   `CREATE INDEX ... (unaccent(lower(name)))` fails with
--   "functions in index expression must be marked IMMUTABLE".
--   The standard fix: wrap the call in an SQL function declared IMMUTABLE and
--   pass the dictionary explicitly (`'public.unaccent'::regdictionary`) so the
--   result no longer depends on search_path. The wrapper is only sound while that
--   dictionary's rule file stays fixed — it is a static file under
--   $SHAREDIR/tsearch_data, and a DBA changing it is exactly the trade-off
--   PostgreSQL documents for this pattern.
--
--   Vietnamese note: PG's shipped unaccent.rules already maps đ→d and Đ→D
--   (lines 92-93 of the PG 17 rules file), so no extra translate() shim is needed.
--
-- About the indexes
--   Four single-column GIN trigram indexes, one per column the search looks at
--   (name, brand, model, "serialNumber"), each on the exact expression the query
--   uses — matching the expression is what lets the planner use them. Single
--   column rather than one composite GIN index so the planner can BitmapOr the
--   query's independent OR branches.
--   These indexes only help when the LIKE pattern is known at plan time; see the
--   note in internal/store/queries/devices.sql.
--
-- Privileges: unaccent and pg_trgm are *trusted* extensions since PG 13 (their
-- control files say `trusted = true`), so the database owner can install them —
-- no superuser required. A non-owner role would need CREATE on the database.
--
-- Caveats worth knowing before deploying this:
--   * If `unaccent` is already installed in a schema other than public,
--     `CREATE EXTENSION IF NOT EXISTS` is a silent no-op and the CREATE FUNCTION
--     below fails loudly on the missing dictionary — point the regdictionary
--     literal at that schema instead of public.
--   * goose runs each migration in a transaction, so the indexes are built with a
--     plain (non-CONCURRENTLY) CREATE INDEX and take a write lock on "Device" for
--     the duration. That is fine at this app's scale (max ~50 devices per user);
--     on a very large table, build them manually with CONCURRENTLY first.
--   * The predicate is used for both the index and the query, so changing the
--     wrapper's definition later requires REINDEXing these indexes.
--
-- +goose Up
-- +goose StatementBegin
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.wv_unaccent(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
    SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;
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

-- +goose Down
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
-- The function must go last: the indexes above depend on it.
DROP FUNCTION IF EXISTS public.wv_unaccent(text);
-- +goose StatementEnd

-- The two extensions are intentionally left installed: `CREATE EXTENSION IF NOT
-- EXISTS` is additive and they may well have existed before this migration (other
-- apps, or a DBA pre-installing them), so dropping them here could break objects
-- this migration never created.
