-- ExchangeRate — the DB-backed snapshot cache behind GET /api/v1/fx/rates.
--
-- ── Why a table at all ──────────────────────────────────────────────────────
--
-- 0022 introduced the FX prefill helper, whose client cached the upstream table
-- in process memory for 12 hours per base. That cache died on every restart and
-- was per instance: each process (and each deployment replica) paid for its own
-- upstream call, so "one call per currency per day" was really "one call per
-- currency per day per process". The snapshot is the same for every user of the
-- deployment, so it belongs in the one place every instance already shares.
--
-- This table is a CACHE, not history and not user data. It exists so a version
-- of today's free-market rate is available to the whole deployment for 24 hours,
-- and so the last successful value survives a restart.
--
-- ── What one row means ─────────────────────────────────────────────────────
--
--   * "base" — ISO 4217 code, upper case, from fx.SupportedCurrencies. The
--     handler validates it before the service ever runs, so this table never
--     holds a typo; it is not a CHECK constraint for the same reason 0022 gave
--     (a bad request is a 400 with fieldErrors, not a driver 500).
--   * "day" — the UTC calendar day of "fetchedAt". The primary key
--     (base, day) is the "unique per base/day" rule: one snapshot per base per
--     day, so a retry or a second instance replaces the same row instead of
--     piling up duplicates. Ordering by "day" is also how the read finds the
--     newest snapshot — no extra index is needed.
--   * "rates" — the upstream's full table for "base", as JSONB. rates.VND is
--     how many VND one unit of "base" is worth and may be fractional; the
--     endpoint deliberately does not round it. Nothing in the device read path
--     touches this column: Device.fxRate is locked at entry (0022), and this
--     cache is only the "today's number, for reference" helper.
--   * "fetchedAt" — when the upstream call SUCCEEDED. The 24h TTL is measured
--     from this instant, and a stale response reports it unchanged rather than
--     "now".
--   * "source" — the upstream the table came from (the host of the configured
--     endpoint, normally open.er-api.com). Kept so the client can label where
--     the reference number came from, and so a future source change is visible
--     in the data instead of being guessed from a deployment date.
--   * "createdAt" / "updatedAt" — row bookkeeping only; never serialised.
--
-- ── What is deliberately NOT stored ────────────────────────────────────────
--
-- A FAILED refresh writes no row. "Upstream said no" is not a rate, and caching
-- the failure would turn a transient outage into a 24h lie. When a refresh
-- fails, the service serves the newest existing row with stale:true (or answers
-- 503 if there is none), and the next request tries again. Rows are therefore
-- never deleted by the service: the newest row is the fallback, however old.
--
-- ── Rollback ───────────────────────────────────────────────────────────────
--
-- Down drops the table. It holds nothing that cannot be rebuilt by one upstream
-- call, so the rollback loses only the current reference snapshot (the device
-- columns from 0022 are untouched).

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS public."ExchangeRate" (
    base        text         NOT NULL,
    day         date         NOT NULL,
    rates       jsonb        NOT NULL,
    "fetchedAt" timestamp(3) without time zone NOT NULL,
    source      text         NOT NULL,
    "createdAt" timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    "updatedAt" timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY (base, day)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS public."ExchangeRate";
-- +goose StatementEnd
