-- Warrly — the shop is searchable: Device."purchasePlace" joins name/brand/
-- model/"serialNumber" in device search.
--
-- Problem (docs/handoff/ux-friction-receipt.md, route C): the device form asks
-- for the shop the device was bought from — placeholder "CellphoneS,
-- TopZone..." (DeviceFormView.swift) — and stores it on the device, but neither
-- `GET /api/v1/devices?q=` nor `GET /api/v1/search?q=` looked at the column. So
-- "I only remember the shop" returned zero results with no recovery path except
-- scrolling a 50-device list: the app held the answer and would not use it.
--
-- The fix is the same one migration 0005/0007 applied to the other four columns:
-- an expression + a GIN trigram index on `lower(public.wv_unaccent(x))`, with
-- `unaccent` FIRST so the expression is collation-independent (see 0007 for the
-- C-locale bug that ordering avoids). `purchasePlace` is user-typed free text —
-- shop names are Vietnamese ("Điện Máy Xanh", "FPT Shop") — so it needs the
-- accent folding exactly as much as `brand` does.
--
-- The index expression and the query predicate must stay byte-for-byte
-- identical or the planner silently stops using the index (PostgreSQL matches
-- functional indexes on the parsed expression; a mismatch is not an error, just
-- a sequential scan). The matching predicates are in
-- internal/store/queries/devices.sql and internal/store/queries/search.sql.
--
-- This migration only ADDS one index. The four indexes from 0007 are untouched,
-- so their definitions and this one stay one-per-column and the planner can
-- still BitmapOr the query's independent OR branches.
--
-- Why not a backfill / NOT NULL: "purchasePlace" is nullable and stays that way
-- — a device whose shop was never recorded has nothing to search, and NULL rows
-- simply fall out of the LIKE. No data change, no rewrite.
--
-- Up builds the index with a plain CREATE INDEX inside goose's transaction (the
-- same choice 0005/0007/0019 made). That is fine at this app's scale (50 active
-- devices per user); on a very large table, build it CONCURRENTLY first.

-- +goose Up
-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS "Device_purchasePlace_trgm_idx"
    ON public."Device" USING gin (lower(public.wv_unaccent("purchasePlace")) gin_trgm_ops);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS public."Device_purchasePlace_trgm_idx";
-- +goose StatementEnd
