-- Warrly — find a receipt by its file name or its description, not only by the
-- text an AI scan happened to read off it.
--
-- Problem (docs/handoff/ux-friction-receipt.md §3): the `attachments` group of
-- `GET /api/v1/search` matched `extractedText` only. That column is written by
-- exactly one path — the opt-in OCR call (`services/ai_extract.go`) — and
-- `User.aiOptIn` defaults to false, so on a default account the "hoá đơn" group
-- is structurally always empty. Meanwhile every attachment already carries a
-- `fileName` ("hoa-don-cellphones.png") and an optional `description`
-- ("Ảnh hộp máy chụp lúc mở seal") that the app shows on the device screen and
-- lets the user edit — two plaintext columns search never looked at.
--
-- No join is needed: `Attachment."userId"` became a stored, NOT NULL column in
-- migration 0018 precisely so an attachment can be owned without a device (the
-- inbox). SearchAttachments already filters on it; this migration only adds the
-- indexes for the two new predicates.
--
-- ── The indexes ────────────────────────────────────────────────────────────
--
-- Same technique as 0019 (itself 0005/0007): one GIN trigram index per searched
-- column, on `lower(public.wv_unaccent(x))` — unaccent FIRST so the expression
-- is collation-independent. The predicates in
-- internal/store/queries/search.sql must use that exact expression, byte for
-- byte; PostgreSQL matches functional indexes on the parsed expression and
-- silently falls back to a sequential scan if the two drift.
--
-- Two indexes rather than one composite: the query ORs the columns, and single
-- column indexes let the planner BitmapOr them — the same reason 0005/0007 used
-- four single-column indexes for Device.
--
-- "fileName" is NOT NULL (every attachment has one); "description" is nullable
-- and rows without one simply fall out of the LIKE. No column change, no
-- backfill, and nothing about the existing `extractedText` index (0019) moves.
--
-- ── Privacy note ───────────────────────────────────────────────────────────
--
-- This does not widen what is exposed. `fileName` and `description` are already
-- returned in every `AttachmentMeta` payload (device detail, inbox, backup
-- metadata) in plaintext; 0019's trade-off — the OCR text is plaintext in
-- Postgres so the trigram index can read it — is unchanged, and no new field is
-- introduced by searching them.
--
-- Up builds both indexes with a plain CREATE INDEX inside goose's transaction,
-- the same choice 0005/0007/0019 made. Fine at this app's scale (5 attachments
-- per device, 100 MB per user); on a very large table, build them CONCURRENTLY.

-- +goose Up
-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS "Attachment_fileName_trgm_idx"
    ON public."Attachment" USING gin (lower(public.wv_unaccent("fileName")) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Attachment_description_trgm_idx"
    ON public."Attachment" USING gin (lower(public.wv_unaccent(description)) gin_trgm_ops);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS public."Attachment_description_trgm_idx";
DROP INDEX IF EXISTS public."Attachment_fileName_trgm_idx";
-- +goose StatementEnd
