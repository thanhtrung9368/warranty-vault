-- Essentials price history — migration 0034.
--
-- 0028 deliberately gave Staple no price: the first version of the screen was a
-- restock list, not an inventory. This table is the one addition the user asked
-- for — "what did the last bottle cost, and is this cheaper than usual?" —
-- without turning the list into a price-tracking feature:
--
--   * one row per restock, no product catalog, no market-price scraping;
--   * no per-unit math. `Staple.unit` is a label ("chai", "tuýp"), `price` is
--     what the user paid for ONE purchase, and the server never divides;
--   * no DELETE path. A purchase is a receipt: if a row is wrong the user can
--     add a corrected one, and deleting the Staple cascades the whole history
--     away with it.
--
-- `purchasedAt` is a calendar day, not an instant: "I bought this on the 12th"
-- must not move a day under a timezone conversion (same rule as
-- `Staple.lastBoughtAt`, migration 0028). `price` is VND, an integer, and 0 is
-- legal — a free sample or a gift is still a purchase.
--
-- `userId` is stored, not derived through the Staple join. It is the owner the
-- queries filter on (`WHERE "userId" = $1`), so a wrong stapleId cannot read
-- another account's rows even if ownership elsewhere were missed.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS public."StaplePurchase" (
    id            text         NOT NULL PRIMARY KEY,
    "stapleId"    text         NOT NULL REFERENCES public."Staple" ("id") ON DELETE CASCADE,
    "userId"      text         NOT NULL REFERENCES public."User" ("id") ON DELETE CASCADE,
    price         integer      NOT NULL,
    "purchasedAt" timestamp(3) without time zone NOT NULL,
    store         text,
    note          text,
    "createdAt"   timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    CONSTRAINT "StaplePurchase_price_check" CHECK (price >= 0)
);

-- The summary and the history both read one staple newest-first; this index
-- serves the ORDER BY and the "latest price" lookup for a single item.
CREATE INDEX IF NOT EXISTS "StaplePurchase_staple_purchased_idx"
    ON public."StaplePurchase" ("stapleId", "purchasedAt" DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS public."StaplePurchase";
-- +goose StatementEnd
