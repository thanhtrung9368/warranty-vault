-- Per-user opt-in for the AI OCR receipt-extraction feature.
--
-- Sending a (decrypted) receipt image to a third-party AI provider is a
-- meaningful change from the app's "everything encrypted at rest, never leaves
-- the box decrypted" posture. We gate it behind an explicit, default-OFF
-- per-user flag: POST /api/v1/ai/extract-receipt refuses with 403 until the
-- user enables it in Settings. See api/internal/services/ai_extract.go.

-- +goose Up
-- +goose StatementBegin

ALTER TABLE public."User"
    ADD COLUMN IF NOT EXISTS "aiOptIn" boolean DEFAULT false NOT NULL;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

ALTER TABLE public."User" DROP COLUMN IF EXISTS "aiOptIn";

-- +goose StatementEnd
