-- 0024_utc_timestamp_baseline — correct historical wall-clock timestamps.
--
-- Why this migration exists
-- -------------------------
-- Every instant column in this schema is `timestamp(3) without time zone` and
-- the application contract says the value is UTC (0001_initial.sql:11). Nothing
-- forced the PostgreSQL session timezone to UTC, so on this host
-- (Asia/Ho_Chi_Minh, UTC+7, no DST) DEFAULT CURRENT_TIMESTAMP / now() stored the
-- local wall clock. pgx reads a `timestamp` back with a UTC location, so Go and
-- JSON faithfully printed a local time with a `Z` suffix.
--
-- The current writes are fixed in code (dbconn pins `timezone=UTC` on every
-- pooled connection and every entrypoint asserts it). This migration deals with
-- the rows that already exist.
--
-- Why it is not a blanket `UPDATE ... - interval '7 hours'`
-- ---------------------------------------------------------
-- A single offset does NOT explain every row on every database. On the dev
-- database the embedded clock in cuid ids shows a UTC-writing regime in April
-- 2026 and a +07-writing regime from May 2026 onward; other rows were written
-- by the Go UTC paths even while SQL NOW() was local. A blanket shift would
-- corrupt the already-correct rows.
--
-- Instead, each row is classified from evidence that is independent of the
-- column being corrected: a cuid id (`c` + 8 base36 chars + ...) embeds the
-- millisecond Unix timestamp at which the id was minted, and these rows' insert
-- timestamps are written in the same request. If `createdAt - idMillis` is ~0,
-- the writer was already UTC; if it is ~+25200s, the writer was on the +07 wall
-- clock. Anything else aborts the migration before a single row is touched.
--
-- Rows with no cuid id (hand-written fixtures, imported data with a semantic
-- id) are NOT guessed at: they are recorded in "WVUTCTimezoneSkipped" and left
-- exactly as they are. The migration is therefore conservative by construction:
-- it cannot silently rewrite a timestamp it has no evidence for.
--
-- Every corrected row id is recorded in "WVUTCTimezoneCorrected", which makes
-- the Down migration exact: it reverses precisely those rows, not whatever
-- happens to be in the table later.
--
-- The guard table also makes a second application impossible: if the baseline
-- row exists, Up raises instead of shifting twice.
--
-- Columns deliberately excluded (they are calendar dates or already-UTC
-- instants written by Go, not SQL now()):
--   Device.purchaseDate, soldAt, receivedAt, activatedAt, extendedCoverBuyBy,
--     brandWarrantyStart, brandWarrantyEnd, brandCheckedAt
--   Warranty.startDate, endDate
--   Subscription.startedAt, renewalDate, trialEndsAt
--   SubscriptionPayment.paidAt
--   WishlistItem.targetDate
--   Claim.openedAt, expectedReturnAt, closedAt
--   DecisionSnooze.snoozedUntil
-- `goose_db_version.tstamp` belongs to the migration tool, not application data.

-- +goose Up
-- +goose StatementBegin
SET LOCAL TIME ZONE 'UTC';

-- A second Up (manual SQL replay, lost goose state) must not shift twice. The
-- check uses to_regclass so a guard abort leaves no half-created bookkeeping
-- tables behind: this migration validates every row before it creates them.
DO $$
DECLARE
    applied boolean := false;
BEGIN
    IF to_regclass('public."WVUTCTimezoneBaseline"') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM "WVUTCTimezoneBaseline" WHERE "id" = ''utc-cutover-0024'')'
        INTO applied;
        IF applied THEN
            RAISE EXCEPTION 'WV UTC baseline already applied; refusing to shift timestamps a second time';
        END IF;
    END IF;
END $$;

-- Decode the 8 base36 characters after the leading `c` into Unix milliseconds.
-- Kept as a temp table so every probe below joins one cheap, indexed lookup.
CREATE TEMP TABLE wv_cuid_clock AS
SELECT DISTINCT candidate.id,
       (
           SELECT SUM((strpos('0123456789abcdefghijklmnopqrstuvwxyz', ch) - 1)
                      * power(36, 8 - ord))::bigint
           FROM unnest(string_to_array(substr(candidate.id, 2, 8), NULL))
                WITH ORDINALITY AS t(ch, ord)
       ) AS millis
FROM (
    SELECT id FROM "User"
    UNION SELECT id FROM "Session"
    UNION SELECT id FROM "PasswordReset"
    UNION SELECT id FROM "Attachment"
    UNION SELECT id FROM "Device"
    UNION SELECT id FROM "Warranty"
    UNION SELECT id FROM "Subscription"
    UNION SELECT id FROM "SubscriptionPayment"
    UNION SELECT id FROM "WishlistItem"
    UNION SELECT id FROM "WishlistPrice"
    UNION SELECT id FROM "Reminder"
    UNION SELECT id FROM "PushSubscription"
    UNION SELECT id FROM "DecisionSnooze"
    UNION SELECT id FROM "DeviceShare"
    UNION SELECT id FROM "Claim"
) AS candidate
WHERE candidate.id ~ '^c[0-9a-z]{24}$';

-- One row per table probe. `probe` is the column the application wrote at insert
-- time; `millis` is the absolute instant encoded in the row id.
CREATE TEMP TABLE wv_clock_probe AS
SELECT 'User'::text AS table_name, u.id AS row_id, u."createdAt" AS probe, c.millis
FROM "User" u JOIN wv_cuid_clock c ON c.id = u.id
UNION ALL
SELECT 'Session', s.id, s."createdAt", c.millis
FROM "Session" s JOIN wv_cuid_clock c ON c.id = s.id
UNION ALL
SELECT 'PasswordReset', p.id, p."createdAt", c.millis
FROM "PasswordReset" p JOIN wv_cuid_clock c ON c.id = p.id
UNION ALL
SELECT 'Attachment', a.id, a."uploadedAt", c.millis
FROM "Attachment" a JOIN wv_cuid_clock c ON c.id = a.id
UNION ALL
SELECT 'Device', d.id, d."createdAt", c.millis
FROM "Device" d JOIN wv_cuid_clock c ON c.id = d.id
UNION ALL
SELECT 'Warranty', w.id, w."createdAt", c.millis
FROM "Warranty" w JOIN wv_cuid_clock c ON c.id = w.id
UNION ALL
SELECT 'Subscription', s.id, s."createdAt", c.millis
FROM "Subscription" s JOIN wv_cuid_clock c ON c.id = s.id
UNION ALL
SELECT 'SubscriptionPayment', p.id, p."createdAt", c.millis
FROM "SubscriptionPayment" p JOIN wv_cuid_clock c ON c.id = p.id
UNION ALL
SELECT 'WishlistItem', w.id, w."createdAt", c.millis
FROM "WishlistItem" w JOIN wv_cuid_clock c ON c.id = w.id
UNION ALL
SELECT 'WishlistPrice', p.id, p."recordedAt", c.millis
FROM "WishlistPrice" p JOIN wv_cuid_clock c ON c.id = p.id
UNION ALL
SELECT 'Reminder', r.id, r."createdAt", c.millis
FROM "Reminder" r JOIN wv_cuid_clock c ON c.id = r.id
UNION ALL
SELECT 'PushSubscription', p.id, p."createdAt", c.millis
FROM "PushSubscription" p JOIN wv_cuid_clock c ON c.id = p.id
UNION ALL
SELECT 'DecisionSnooze', s.id, s."createdAt", c.millis
FROM "DecisionSnooze" s JOIN wv_cuid_clock c ON c.id = s.id
UNION ALL
SELECT 'DeviceShare', s.id, s."createdAt", c.millis
FROM "DeviceShare" s JOIN wv_cuid_clock c ON c.id = s.id
UNION ALL
SELECT 'Claim', cl.id, cl."createdAt", cc.millis
FROM "Claim" cl JOIN wv_cuid_clock cc ON cc.id = cl.id;

-- Refuse any row whose clock is not one of the two known regimes. This runs
-- before the first UPDATE, so an unexpected database is left untouched.
DO $$
DECLARE
    bad record;
BEGIN
    SELECT table_name, row_id, probe,
           extract(epoch FROM (probe - (to_timestamp(millis / 1000.0) AT TIME ZONE 'UTC'))) AS off
    INTO bad
    FROM wv_clock_probe
    WHERE abs(extract(epoch FROM (probe - (to_timestamp(millis / 1000.0) AT TIME ZONE 'UTC')))) > 300
      AND abs(extract(epoch FROM (probe - (to_timestamp(millis / 1000.0) AT TIME ZONE 'UTC'))) - 25200) > 300
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'unexpected clock offset % seconds for % row % (probe %); refusing to shift timestamps',
            round(bad.off::numeric, 3), bad.table_name, bad.row_id, bad.probe;
    END IF;
END $$;

CREATE TEMP TABLE wv_local_rows AS
SELECT table_name, row_id
FROM wv_clock_probe
WHERE abs(extract(epoch FROM (probe - (to_timestamp(millis / 1000.0) AT TIME ZONE 'UTC'))) - 25200) <= 300;

-- The migration must not "succeed" by refusing to classify a database full of
-- data. An empty database has nothing to correct; a non-empty one with no cuid
-- evidence is exactly the "data it does not understand" case.
DO $$
DECLARE
    evidence bigint;
    total_rows bigint;
BEGIN
    SELECT count(*) INTO evidence FROM wv_clock_probe;
    IF evidence = 0 THEN
        SELECT count(*) INTO total_rows FROM (
            SELECT id FROM "User" UNION ALL SELECT id FROM "Session"
            UNION ALL SELECT id FROM "PasswordReset" UNION ALL SELECT id FROM "Attachment"
            UNION ALL SELECT id FROM "Device" UNION ALL SELECT id FROM "Warranty"
            UNION ALL SELECT id FROM "Subscription" UNION ALL SELECT id FROM "SubscriptionPayment"
            UNION ALL SELECT id FROM "WishlistItem" UNION ALL SELECT id FROM "WishlistPrice"
            UNION ALL SELECT id FROM "Reminder" UNION ALL SELECT id FROM "PushSubscription"
            UNION ALL SELECT id FROM "DecisionSnooze" UNION ALL SELECT id FROM "DeviceShare"
            UNION ALL SELECT id FROM "Claim"
        ) AS all_rows;
        IF total_rows > 0 THEN
            RAISE EXCEPTION 'no embedded-id clock evidence in a non-empty database; refusing to guess the offset';
        END IF;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "WVUTCTimezoneBaseline" (
    "id" text NOT NULL,
    "appliedAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offsetSeconds" integer NOT NULL,
    "note" text NOT NULL,
    CONSTRAINT "WVUTCTimezoneBaseline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WVUTCTimezoneCorrected" (
    "tableName" text NOT NULL,
    "rowId" text NOT NULL,
    CONSTRAINT "WVUTCTimezoneCorrected_pkey" PRIMARY KEY ("tableName", "rowId")
);

CREATE TABLE IF NOT EXISTS "WVUTCTimezoneSkipped" (
    "tableName" text NOT NULL,
    "rowId" text NOT NULL,
    "reason" text NOT NULL,
    CONSTRAINT "WVUTCTimezoneSkipped_pkey" PRIMARY KEY ("tableName", "rowId")
);

INSERT INTO "WVUTCTimezoneBaseline" ("id", "offsetSeconds", "note")
SELECT 'utc-cutover-0024',
       CASE WHEN EXISTS (SELECT 1 FROM wv_local_rows) THEN 25200 ELSE 0 END,
       CASE WHEN EXISTS (SELECT 1 FROM wv_local_rows)
            THEN 'Legacy rows written on a +07 wall clock were shifted to UTC; already-UTC rows were left untouched.'
            ELSE 'No legacy +07 rows found; database already stores UTC.'
       END;

INSERT INTO "WVUTCTimezoneCorrected" ("tableName", "rowId")
SELECT table_name, row_id FROM wv_local_rows
ON CONFLICT DO NOTHING;

-- Shift only the instant columns. The column lists are the columns the
-- application wrote through SQL now() / time.Now() on the local clock. Calendar
-- dates and Go-UTC instants are deliberately absent (see the header).
DO $$
DECLARE
    rec record;
    sets text;
    v_offset integer := 25200;
BEGIN
    FOR rec IN
        SELECT * FROM (VALUES
            ('User', ARRAY['passwordChangedAt', 'createdAt', 'updatedAt']),
            ('Session', ARRAY['lastSeenAt', 'expiresAt', 'revokedAt', 'createdAt']),
            ('PasswordReset', ARRAY['expiresAt', 'usedAt', 'createdAt']),
            ('Attachment', ARRAY['uploadedAt']),
            ('Device', ARRAY['createdAt', 'updatedAt', 'returnWindowNotifiedAt',
                             'activationNotifiedAt', 'extendedCoverNotifiedAt']),
            ('Warranty', ARRAY['createdAt', 'updatedAt']),
            ('Subscription', ARRAY['createdAt', 'updatedAt',
                                   'lastNotifiedRenewalAt', 'trialNotifiedAt']),
            ('SubscriptionPayment', ARRAY['createdAt']),
            ('WishlistItem', ARRAY['createdAt', 'updatedAt', 'lastNotifiedAt']),
            ('WishlistPrice', ARRAY['recordedAt']),
            ('Reminder', ARRAY['createdAt', 'lastNotifiedAt']),
            ('PushSubscription', ARRAY['createdAt']),
            ('DecisionSnooze', ARRAY['createdAt']),
            ('DeviceShare', ARRAY['expiresAt', 'revokedAt', 'lastViewedAt', 'createdAt']),
            ('Claim', ARRAY['createdAt', 'updatedAt'])
        ) AS t(tbl, cols)
    LOOP
        SELECT string_agg(format('%I = %I - make_interval(secs => %s)', col, col, v_offset), ', ')
        INTO sets
        FROM unnest(rec.cols) AS col;

        EXECUTE format(
            'UPDATE %I SET %s WHERE id IN (SELECT row_id FROM wv_local_rows WHERE table_name = %L)',
            rec.tbl, sets, rec.tbl);
    END LOOP;
END $$;

-- Record, do not touch, every row the evidence cannot classify. These are
-- typically hand-seeded fixtures; a production row with a semantic id would
-- land here too, visibly, instead of being shifted on a guess.
DO $$
DECLARE
    rec record;
BEGIN
    FOR rec IN
        SELECT * FROM (VALUES
            ('User'), ('Session'), ('PasswordReset'), ('Attachment'), ('Device'),
            ('Warranty'), ('Subscription'), ('SubscriptionPayment'), ('WishlistItem'),
            ('WishlistPrice'), ('Reminder'), ('PushSubscription'), ('DecisionSnooze'),
            ('DeviceShare'), ('Claim')
        ) AS t(tbl)
    LOOP
        EXECUTE format(
            'INSERT INTO "WVUTCTimezoneSkipped" ("tableName", "rowId", "reason")
             SELECT %L, t.id, %L FROM %I t
             WHERE NOT EXISTS (
                 SELECT 1 FROM wv_clock_probe p
                 WHERE p.table_name = %L AND p.row_id = t.id
             )
             ON CONFLICT DO NOTHING',
            rec.tbl,
            'no cuid clock evidence; left untouched for manual review',
            rec.tbl, rec.tbl);
    END LOOP;
END $$;

DROP TABLE wv_clock_probe;
DROP TABLE wv_local_rows;
DROP TABLE wv_cuid_clock;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
SET LOCAL TIME ZONE 'UTC';

DO $$
DECLARE
    rec record;
    sets text;
    v_offset integer;
BEGIN
    SELECT "offsetSeconds" INTO v_offset
    FROM "WVUTCTimezoneBaseline"
    WHERE "id" = 'utc-cutover-0024';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'WV UTC baseline is not recorded; refusing to reverse an unknown correction';
    END IF;

    IF v_offset <> 0 THEN
        FOR rec IN
            SELECT * FROM (VALUES
                ('User', ARRAY['passwordChangedAt', 'createdAt', 'updatedAt']),
                ('Session', ARRAY['lastSeenAt', 'expiresAt', 'revokedAt', 'createdAt']),
                ('PasswordReset', ARRAY['expiresAt', 'usedAt', 'createdAt']),
                ('Attachment', ARRAY['uploadedAt']),
                ('Device', ARRAY['createdAt', 'updatedAt', 'returnWindowNotifiedAt',
                                 'activationNotifiedAt', 'extendedCoverNotifiedAt']),
                ('Warranty', ARRAY['createdAt', 'updatedAt']),
                ('Subscription', ARRAY['createdAt', 'updatedAt',
                                       'lastNotifiedRenewalAt', 'trialNotifiedAt']),
                ('SubscriptionPayment', ARRAY['createdAt']),
                ('WishlistItem', ARRAY['createdAt', 'updatedAt', 'lastNotifiedAt']),
                ('WishlistPrice', ARRAY['recordedAt']),
                ('Reminder', ARRAY['createdAt', 'lastNotifiedAt']),
                ('PushSubscription', ARRAY['createdAt']),
                ('DecisionSnooze', ARRAY['createdAt']),
                ('DeviceShare', ARRAY['expiresAt', 'revokedAt', 'lastViewedAt', 'createdAt']),
                ('Claim', ARRAY['createdAt', 'updatedAt'])
            ) AS t(tbl, cols)
        LOOP
            SELECT string_agg(format('%I = %I + make_interval(secs => %s)', col, col, v_offset), ', ')
            INTO sets
            FROM unnest(rec.cols) AS col;

            EXECUTE format(
                'UPDATE %I SET %s WHERE id IN (SELECT "rowId" FROM "WVUTCTimezoneCorrected" WHERE "tableName" = %L)',
                rec.tbl, sets, rec.tbl);
        END LOOP;
    END IF;
END $$;

DROP TABLE IF EXISTS "WVUTCTimezoneCorrected";
DROP TABLE IF EXISTS "WVUTCTimezoneSkipped";
DROP TABLE IF EXISTS "WVUTCTimezoneBaseline";
-- +goose StatementEnd
