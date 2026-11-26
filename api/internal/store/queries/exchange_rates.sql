-- ExchangeRate queries (migration 0035) — the DB-backed FX snapshot cache.
--
-- Not user data: each row is the last SUCCESSFUL upstream table for one base on
-- one UTC day, shared by every instance so the 24h TTL is deployment-wide
-- instead of per process. Two queries are all this cache needs: read the newest
-- snapshot for a base (fresh or expired — the caller decides), and record one
-- successful fetch. There is deliberately no DELETE: the newest row is the
-- stale-on-failure fallback and a failure is never written here at all.

-- name: GetLatestExchangeRate :one
-- The newest successful snapshot for base, ACROSS days on purpose: an expired
-- row is exactly what the stale-on-failure path serves when the refresh fails,
-- with its original "fetchedAt". No row for a base is the honest 503 case (ask
-- the user for the rate), never a reason to invent one.
SELECT base, rates, "fetchedAt", source
FROM "ExchangeRate"
WHERE base = $1
ORDER BY day DESC
LIMIT 1;

-- name: UpsertExchangeRate :exec
-- Records one successful fetch. The (base, day) primary key makes this an
-- upsert, so retries and concurrent instances share one row per base per day
-- instead of accumulating snapshots. The WHERE clause refuses to replace a
-- NEWER snapshot with an older one: two instances may race at TTL expiry, and
-- the newest successful fetch is the one that must win.
INSERT INTO "ExchangeRate" (base, day, rates, "fetchedAt", source, "createdAt", "updatedAt")
VALUES (
    $1, $2, $3, $4, $5, NOW(), NOW()
)
ON CONFLICT (base, day) DO UPDATE
SET rates = EXCLUDED.rates,
    "fetchedAt" = EXCLUDED."fetchedAt",
    source = EXCLUDED.source,
    "updatedAt" = NOW()
WHERE EXCLUDED."fetchedAt" >= "ExchangeRate"."fetchedAt";
