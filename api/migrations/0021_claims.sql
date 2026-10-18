-- Warrly — warranty claims: the thing that happens after a device breaks.
--
-- "Device".status has carried BROKEN since 0001, but there was nowhere to record
-- the next step: the ticket number, the service centre, what they found, whether
-- the warranty paid. A broken device was a dead end. This table is the repair
-- record, and it is what lets the app answer "is my phone still at the shop".
--
-- ── Ownership ──────────────────────────────────────────────────────────────
--
-- "Claim" has no "userId" column. Ownership is derived through "deviceId" →
-- "Device"."userId", exactly like "Warranty" / "Reminder" / "Attachment" (before
-- 0018). Every query that reaches a Claim joins Device and filters on the
-- owner, so a claim cannot outlive or jump devices:
--
--   * "deviceId" NOT NULL, FK ON DELETE CASCADE — deleting a device deletes its
--     claims, matching every other child of Device.
--   * "warrantyId" nullable, FK ON DELETE SET NULL — a claim is a record of what
--     happened at the shop, not a property of the warranty row. Deleting a
--     warranty (or a plan that was recorded by mistake) must not delete the
--     repair history; the claim survives and keeps its other fields.
--
-- The service additionally rejects a "warrantyId" that belongs to a different
-- device with 400 fieldErrors.warrantyId; the FK alone cannot express that rule
-- because it only knows the Warranty is in the same database.
--
-- ── One open claim per device ──────────────────────────────────────────────
--
-- A phone cannot be at two shops. Enforced HERE, in SQL, with a PARTIAL UNIQUE
-- INDEX rather than in the service:
--
--   CREATE UNIQUE INDEX ... ON "Claim" ("deviceId")
--     WHERE status IN ('OPEN', 'IN_REPAIR');
--
-- Why SQL and not just a SELECT-then-INSERT in services.CreateClaim:
--
--   * A service check is a TOCTOU race. Two concurrent POSTs (two browser tabs,
--     a retry after a timeout) can both read "no open claim" and both insert.
--     The partial index makes the second INSERT fail regardless of timing, and
--     that is the only place the invariant is actually guaranteed.
--   * It covers EVERY write path into the table, including the backup importer
--     and anything added later. A service-only rule would have to be remembered
--     in each one; the index cannot be forgotten.
--   * The service keeps a friendly pre-check (CountOpenClaimsByDevice) so the
--     normal case answers a translated 409 without a PG error round-trip, and
--     translates SQLSTATE 23505 on the index into the SAME 409 LIMIT_REACHED.
--     The pre-check is UX; the index is correctness.
--
-- The predicate is status-based, not "closedAt IS NULL": a row is open iff it is
-- OPEN or IN_REPAIR. RESOLVED / REJECTED / CANCELLED are terminal. The service
-- owns the closedAt↔status mapping (set when entering a terminal status, cleared
-- when moving back); a stale closedAt on an open row does not block a new claim,
-- because this index does not read that column.
--
-- ── Timestamps ─────────────────────────────────────────────────────────────
--
-- All timestamp columns are `timestamp(3) without time zone`, matching every
-- other date in this schema (UTC semantics). "openedAt" is required and cannot
-- be NULL; it defaults in Go (now) when the client omits it. "expectedReturnAt"
-- is the user's estimate, not a promise. "closedAt" is SERVER-MANAGED by the
-- API write paths and is still exported/imported so a restore preserves the
-- resolution date; the column is nullable because OPEN / IN_REPAIR claims have
-- not closed.
--
-- ── Validation lives in the service, deliberately ──────────────────────────
--
-- No CHECK constraints on status / cost / lengths. A bad request must be a 400
-- with `fieldErrors.<field>`, not a 500 from the driver, and the enum plus the
-- rune caps are enforced in services/claims.go. The one rule that cannot be a
-- service check (single-open) is the partial unique index above; any other
-- structural rule that needs to survive concurrent writes belongs here too.
--
-- The per-user cap (MAX_CLAIMS_PER_USER = 1000) is a service rule like the
-- device / subscription / wishlist ceilings: a count-then-insert check on the
-- create path (and on the backup import), not a constraint.
--
-- ── Backup ─────────────────────────────────────────────────────────────────
--
-- Claims travel in the export/import payload as a new TOP-LEVEL `claims[]`
-- array (like `inboxAttachments[]`, migration 0018), because a claim points at
-- either a device or a device's warranty (or neither) and nesting it under a
-- device would duplicate the deviceId it already carries. The array is
-- `omitempty`, so a payload for a user with no claims is byte-identical to the
-- pre-0021 format, old payloads without the key still import, and the payload
-- version does NOT move (still 5 for JSON, 6 for the ZIP): the format is
-- additive and an older payload decodes the missing key to an empty list.
--
-- ── Rollback ───────────────────────────────────────────────────────────────
--
-- Down drops the table (and therefore the indexes). Claims are new, so no older
-- schema can represent them; the rollback is destructive, as every goose down
-- in this directory is, and goose refuses it without WV_ALLOW_DESTRUCTIVE=1.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE public."Claim" (
    id text NOT NULL,
    "deviceId" text NOT NULL,
    "warrantyId" text,
    status text NOT NULL,
    "openedAt" timestamp(3) without time zone NOT NULL,
    "expectedReturnAt" timestamp(3) without time zone,
    "closedAt" timestamp(3) without time zone,
    "ticketNumber" text,
    "serviceCenter" text,
    issue text NOT NULL,
    diagnosis text,
    outcome text,
    cost integer,
    "coveredByWarranty" boolean,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    CONSTRAINT "Claim_pkey" PRIMARY KEY (id),
    CONSTRAINT "Claim_deviceId_fkey" FOREIGN KEY ("deviceId")
        REFERENCES public."Device"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "Claim_warrantyId_fkey" FOREIGN KEY ("warrantyId")
        REFERENCES public."Warranty"(id) ON UPDATE CASCADE ON DELETE SET NULL
);

-- The list / device-detail read is `WHERE "deviceId" = $1 ORDER BY "openedAt"
-- DESC`; the ownership join rides the existing "Device" primary key.
CREATE INDEX "Claim_deviceId_idx"
    ON public."Claim" USING btree ("deviceId", "openedAt" DESC);

-- Required for the FK: deleting a Warranty (including through Device cascade)
-- must find its claims to SET NULL without a sequential scan.
CREATE INDEX "Claim_warrantyId_idx"
    ON public."Claim" USING btree ("warrantyId");

-- The rule the whole feature hangs on. See the header for why this is an index
-- and not a service check.
CREATE UNIQUE INDEX "Claim_one_open_per_device_idx"
    ON public."Claim" USING btree ("deviceId")
    WHERE status IN ('OPEN', 'IN_REPAIR');

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP TABLE IF EXISTS public."Claim";

-- +goose StatementEnd
