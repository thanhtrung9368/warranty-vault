-- Warrly — persist the text OCR read off a receipt (roadmap #13, full-text OCR
-- search) so a receipt can be found by what is printed on it instead of only by
-- the fields the user happened to type.
--
-- ── Where the text lives ───────────────────────────────────────────────────
--
-- On the "Attachment" row it was extracted from (`"extractedText"`), NOT on a
-- separate OCR table:
--
--   * the attachment is the document the user can open, search, file to a device
--     or delete, so the text has the same lifetime and the same owner;
--   * deleting the attachment (or its device, via the existing FK cascade)
--     removes the text with it — no orphan index entries;
--   * `GET /api/v1/search` can return the hit as a normal attachment, and the
--     "capture-first inbox" (migration 0018) gives a receipt somewhere to live
--     before it has a device.
--
-- The column is nullable and additive. A user who never runs OCR gets NULL on
-- every row, the column is absent from every JSON response (`omitempty` on the
-- public DTOs), and the existing backup payload is byte-for-byte unchanged.
--
-- ── PLAINTEXT TRADE-OFF — read this before changing the design ─────────────
--
-- The attached blobs stay AES-256-GCM encrypted on disk (each file has its own
-- data key wrapped with FILE_MASTER_KEY; see api/internal/files/encrypt.go), so
-- the image bytes are not readable from either the DB or a disk copy alone. This
-- column deliberately does NOT extend that protection: it is a plain `text`
-- column, readable by anyone who can read the database.
--
-- That is the price of the search the feature exists for. The query predicate
-- (and the GIN trigram index below) is a substring match over the
-- `lower(public.wv_unaccent(...))` value; an encrypted column cannot be indexed
-- or substring-searched without decrypting every row at query time or inventing a
-- searchable-encryption scheme, and neither is in this service. The trade-off is
-- documented explicitly in openapi.yaml (the `/api/v1/search`, `AttachmentMeta`
-- and `/api/v1/ai/extract-receipt` descriptions) rather than left implicit:
--
--   attachments: AES-256-GCM encrypted at rest
--   extracted text: plaintext in Postgres
--
-- Mitigations that already exist: the write only happens after the user opts in
-- to the AI feature (which already sends the decrypted document to Anthropic),
-- every read is owner-scoped (`"userId" = $1`), and the text is never exported in
-- the user's backup (it is a derived search projection; see the backup decision
-- in openapi.yaml). Database-at-rest encryption, if required, is an operator
-- concern (volume encryption / managed Postgres), not something this column can
-- provide.
--
-- ── The index ─────────────────────────────────────────────────────────────
--
-- Same technique as migrations 0005/0007: a GIN trigram index over
-- `lower(public.wv_unaccent(x))` — unaccent FIRST so the expression is
-- collation-independent (see 0007 for the C-locale bug). The query in
-- internal/store/queries/search.sql must use this exact expression, byte for
-- byte; PostgreSQL matches functional indexes on the parsed expression and
-- silently falls back to a sequential scan if the two drift.
--
-- No partial index (`WHERE "extractedText" IS NOT NULL`): a partial index would
-- require the query predicate to imply that clause, and the LIKE expression does
-- not do that to the planner. Rows with NULL text are not candidates for this
-- predicate anyway, so the full index is the right shape.
--
-- Up builds the index with a plain CREATE INDEX inside goose's transaction, the
-- same choice 0005/0007 made. That is fine at this app's scale (5 attachments per
-- device, 100 MB per user); on a very large table, build it CONCURRENTLY first.
--
-- Rollback drops the index and the column. Existing attachments are unaffected.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE public."Attachment"
    ADD COLUMN IF NOT EXISTS "extractedText" text;

CREATE INDEX IF NOT EXISTS "Attachment_extractedText_trgm_idx"
    ON public."Attachment" USING gin (lower(public.wv_unaccent("extractedText")) gin_trgm_ops);

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP INDEX IF EXISTS public."Attachment_extractedText_trgm_idx";

ALTER TABLE public."Attachment"
    DROP COLUMN IF EXISTS "extractedText";

-- +goose StatementEnd
