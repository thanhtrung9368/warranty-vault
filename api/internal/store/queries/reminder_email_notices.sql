-- ReminderEmailNotice — the send-once key for the email fallback
-- (FEATURE_RESEARCH_2026-11 §5 #8, migration 0033).
--
-- No user-facing read path exists, and none is planned: the row is a claim, not a
-- mailbox. The cron inserts it BEFORE calling Resend (at-most-once even if two
-- passes overlap) and deletes it again when the provider refuses the message, so a
-- later pass may retry. See the migration header for the full reasoning.

-- name: ClaimReminderEmailNotice :one
-- Returns the new row's id, or pgx.ErrNoRows when (userId, kind, entityId,
-- leadDay) was already used — i.e. this notice has already been emailed, and the
-- caller must skip. The insert IS the lock: ON CONFLICT DO NOTHING never blocks,
-- so a concurrent pass simply loses the race and sends nothing.
INSERT INTO "ReminderEmailNotice" (id, "userId", kind, "entityId", "leadDay")
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT ("userId", kind, "entityId", "leadDay") DO NOTHING
RETURNING id;

-- name: DeleteReminderEmailNotice :exec
-- Releases a claim whose send failed. The unique key is free again, so a later
-- pass that still selects this notice (an overlapping run, or a crash before the
-- sweep stamps its push marker) may try again. That is not a guaranteed retry —
-- the push marker normally bounds a notice to the day — but leaving the row
-- behind would record a send that never happened.
DELETE FROM "ReminderEmailNotice"
WHERE id = $1;
