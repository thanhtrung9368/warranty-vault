-- Essentials / "đồ dùng thiết yếu" — a restock list that is intentionally NOT a
-- WishlistItem.
--
-- The Wishlist is one-off, price-aware, and marking an item PURCHASED creates a
-- Device. Shampoo/toothpaste are the opposite: they repeat, price history is
-- noise, and buying one must never create a device. Keeping them in a separate
-- table means every existing wishlist write path keeps its exact semantics.
--
-- `state` is the user's honest observation (Đủ / Sắp hết / Đã hết); the server
-- never guesses consumption. `cadenceDays` is an optional check-in interval,
-- not a promise that the bottle is empty: the app schedules a reminder and the
-- user answers "Còn đủ" / "Sắp hết". `lastBoughtAt` is the calendar day of the
-- last restock, used to compute the next check-in; it is deliberately a day,
-- not an instant, so a timezone conversion cannot move it.
--
-- No price, no history, no quantity count. That keeps the MVP a list, not an
-- inventory system.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS public."Staple" (
    id              text        NOT NULL PRIMARY KEY,
    "userId"        text        NOT NULL REFERENCES public."User" ("id") ON DELETE CASCADE,
    name            text        NOT NULL,
    category        text,
    unit            text,
    "cadenceDays"   integer,
    "lastBoughtAt"  timestamp(3) without time zone,
    state           text        NOT NULL DEFAULT 'ENOUGH',
    notes           text,
    "createdAt"     timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    "updatedAt"     timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    CONSTRAINT "Staple_state_check"
        CHECK (state IN ('ENOUGH', 'LOW', 'OUT')),
    CONSTRAINT "Staple_cadence_check"
        CHECK ("cadenceDays" IS NULL OR ("cadenceDays" >= 1 AND "cadenceDays" <= 3650))
);

CREATE INDEX IF NOT EXISTS "Staple_user_state_idx"
    ON public."Staple" ("userId", state);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS public."Staple";
-- +goose StatementEnd
