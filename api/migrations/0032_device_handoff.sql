-- Device handoff — resale handoff (Warrly 2.0).
--
-- The seller hands ONE device record to the buyer: purchase date, serial/model,
-- warranty rows, selected receipts and the condition/repair facts. The buyer
-- opens a 6-character code + link, signs in, and receives a NEW Device row in
-- their own account. The seller keeps a SOLD row ("đã chuyển").
--
-- What this table is NOT, stated once so no later patch has to infer it:
--   * not a title document, an invoice, an escrow or a marketplace — the app
--     only moves data. There is no price column here and the copy that calls
--     DATA nothing but data lives in the API response;
--   * not a second share link. "DeviceShare" (migration 0013) grants read access
--     to a third party; "DeviceHandoff" transfers a COPY of the rows into another
--     account and is single-use. Sharing and transferring need different
--     lifecycles, so they are different tables.
--
-- ── The code ────────────────────────────────────────────────────────────────
--
-- 6 characters from a 32-character alphabet ("23456789" + A–Z minus I/O):
-- 32^6 ≈ 1.07e9, ~30 bits. MISHAEL-THE-CODE-IS-NOT-A-SECRET-ON-ITS-OWN: the
-- security of the handoff comes from the combination of
--
--   * a 14-day lifetime,
--   * ONE claim (status flips PENDING → CLAIMED inside the claiming transaction),
--   * per-IP rate limiting on the public read and per-user limiting on the claim,
--   * the seller being able to cancel at any moment,
--
-- and NOT from the entropy of six characters. That is also why "codeHash" is a
-- sha256 digest rather than a stored code: a leaked database must not hand over
-- live codes in one SELECT, and the digest still cannot be turned back into a
-- code by anything except a 2^30 offline walk, which the TTL above bounds in
-- time. The same "store the hash, show the code once" shape as
-- "PasswordReset"."tokenHash" / "DeviceShare"."tokenHash"; the low entropy is the
-- one deliberate difference from those 256-bit tokens and it is why the extra
-- controls above exist instead.
--
-- ── sharedFields (jsonb) ───────────────────────────────────────────────────
--
-- The AUDIT SNAPSHOT of what the seller offered at mint time: the device's
-- category/brand/model/purchase date, whether it had a serial, and the ids of the
-- warranty rows / selected attachments / claim rows. It never carries
-- "purchasePrice", "soldPrice", "Device"."notes" or "Warranty"."cost" — the
-- column's job is to prove what was shared, so it must not become a second copy
-- of what must not be shared.
--
-- The claim does NOT re-read the device through this blob: it copies the current
-- row (so a typo the seller fixed after minting travels) and uses the attachment
-- ids here as SELECTION (so a receipt the seller added after minting does not
-- silently travel). Both halves of that sentence are deliberate.
--
-- ── Row lifecycle ──────────────────────────────────────────────────────────
--
-- PENDING  → CLAIMED    one claiming transaction, guarded by status = PENDING
-- PENDING  → CANCELLED  the seller's DELETE
-- PENDING  → EXPIRED    lazily, when a read/claim sees "expiresAt" in the past
-- terminal statuses never move again. Nothing is deleted: the seller must keep
-- seeing "đã chuyển" and the buyer's provenance points at a row.
--
-- Unclaimed codes expire and NOTHING moves: the buyer's Device, Warranty,
-- Attachment and Claim rows are only written by the claim transaction, so an
-- expired code has transferred nothing and needs no compensating delete.
--
-- ── Rate limit / abuse guards encoded as columns and indexes ───────────────
--
--   * 1 handoff per device per 30 days is enforced in the service from
--     "deviceId" + "createdAt" (index below); the row is the record of the last
--     mint, so no separate bucket or table is needed.
--   * "requestIpHash" is sha256(IP) only — enough to correlate abuse reports,
--     not enough to store a user's address. No plaintext IP is written here.
--
-- ── Not part of the backup payload ─────────────────────────────────────────
--
-- A handoff row is live credential material ("codeHash" resolves to a transfer
-- offer) and account-to-account history. Exporting it would put a usable code in
-- a file the user mails to themselves, and importing it would resurrect links the
-- seller cancelled on the old account. Same reasoning as "DeviceShare"
-- (migration 0013) and "DecisionSnooze" (migration 0011): losing these rows can
-- only revoke a pending offer, never grant one. So export/import ignore them, and
-- the backup format version does not move.
--
-- ── The three Device columns ───────────────────────────────────────────────
--
-- Additive, nullable, and outside the device PATCH's field list on purpose:
--
--   * "handoffSentAt"      — written on the SELLER's row by the claim, together
--                            with status = 'SOLD'. That pair is what the UI reads
--                            as "đã chuyển" instead of the generic "đã bán".
--   * "handoffReceivedAt"  — written on the BUYER's copied row.
--   * "handoffSellerName"  — the seller's DISPLAY NAME at claim time, so the
--                            buyer's row can say "chuyển từ người bán". Never the
--                            seller's id or email.
--
-- They are not in "UpdateDevice", so a PATCH from a client that has never heard
-- of them (build 23 is in App Review) cannot erase them — the same guarantee
-- "soldAt" does not have and exactly why these are NOT part of the shared
-- "DeviceInput".

-- +goose Up
-- +goose StatementBegin
CREATE TABLE public."DeviceHandoff" (
    id                text NOT NULL,
    "deviceId"        text NOT NULL,
    "fromUserId"      text NOT NULL,
    "codeHash"        text NOT NULL,
    "sharedFields"    jsonb NOT NULL DEFAULT '{}'::jsonb,
    "expiresAt"       timestamp(3) without time zone NOT NULL,
    status            text NOT NULL DEFAULT 'PENDING',
    "claimedByUserId" text,
    "claimedDeviceId" text,
    "claimedAt"       timestamp(3) without time zone,
    "requestIpHash"   text,
    "createdAt"       timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    CONSTRAINT "DeviceHandoff_pkey" PRIMARY KEY (id),
    CONSTRAINT "DeviceHandoff_status_check"
        CHECK (status IN ('PENDING', 'CLAIMED', 'EXPIRED', 'CANCELLED')),
    -- A CLAIMED row always has a claim instant; the BUYER may later delete their
    -- account and the FK sets "claimedByUserId" to NULL, so that column is
    -- deliberately not part of this CHECK (a stricter rule would make
    -- DELETE /api/v1/auth/me fail for anyone who ever claimed a handoff).
    CONSTRAINT "DeviceHandoff_claimed_check"
        CHECK (status <> 'CLAIMED' OR "claimedAt" IS NOT NULL),
    CONSTRAINT "DeviceHandoff_deviceId_fkey" FOREIGN KEY ("deviceId")
        REFERENCES public."Device"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "DeviceHandoff_fromUserId_fkey" FOREIGN KEY ("fromUserId")
        REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "DeviceHandoff_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId")
        REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT "DeviceHandoff_claimedDeviceId_fkey" FOREIGN KEY ("claimedDeviceId")
        REFERENCES public."Device"(id) ON UPDATE CASCADE ON DELETE SET NULL
);
-- A single indexed probe resolves a public code. UNIQUE is the last line of
-- defence against a generator collision: the service retries on SQLSTATE 23505.
CREATE UNIQUE INDEX "DeviceHandoff_codeHash_key"
    ON public."DeviceHandoff" USING btree ("codeHash");
-- "deviceId" + "createdAt": the owner status read (latest row per device) and
-- the 1-per-30-days check are the same index scan.
CREATE INDEX "DeviceHandoff_deviceId_idx"
    ON public."DeviceHandoff" USING btree ("deviceId", "createdAt" DESC);
-- Housekeeping / reporting: "how many codes died this week".
CREATE INDEX "DeviceHandoff_expiresAt_idx"
    ON public."DeviceHandoff" USING btree ("expiresAt");

-- Provenance on the two Device rows the handoff touches. Nullable so every
-- existing row (and every device created any other way) is unchanged.
ALTER TABLE public."Device"
    ADD COLUMN IF NOT EXISTS "handoffSentAt" timestamp(3) without time zone;
ALTER TABLE public."Device"
    ADD COLUMN IF NOT EXISTS "handoffReceivedAt" timestamp(3) without time zone;
ALTER TABLE public."Device"
    ADD COLUMN IF NOT EXISTS "handoffSellerName" text;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE public."Device" DROP COLUMN IF EXISTS "handoffSellerName";
ALTER TABLE public."Device" DROP COLUMN IF EXISTS "handoffReceivedAt";
ALTER TABLE public."Device" DROP COLUMN IF EXISTS "handoffSentAt";
DROP TABLE IF EXISTS public."DeviceHandoff";
-- +goose StatementEnd
