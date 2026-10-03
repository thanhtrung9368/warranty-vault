-- WarrantyVault — phiếu bàn giao bảo hành: link chia sẻ có token, chỉ-đọc
-- (FEATURE_IDEAS #2).
--
-- This is the first row in the schema that grants READ access to a party who is
-- not the account owner, so the shape below is a security decision, not a
-- convenience one. Each clause is deliberate:
--
-- Why its own table
--   * "Warranty" / "Attachment" / "Reminder" have no "userId" column — ownership
--     is only reachable by joining through "Device". A share is not a property of
--     a warranty; it is a capability granted BY an owner FOR one device, so it
--     belongs in a row that carries the owner explicitly.
--   * It must be revocable and expiring, which no existing table can express.
--   * Nothing else in the app grows a "public read" concept by accident: the
--     only unauthenticated read path in the whole service is keyed on
--     "tokenHash" of THIS table.
--
-- "userId" is denormalised on purpose
--   The owner column makes the owner-facing queries (list / revoke) scoped by
--   `AND "userId" = $n` with no join, and it is cross-checked against "Device" at
--   creation time. Device ownership never changes in this app (there is no
--   transfer feature), so the two can never disagree. The PUBLIC read does not
--   use it at all: that query joins "Device" and therefore cannot return a row
--   whose device is gone, even if a cascade were ever disabled.
--
-- "tokenHash", not the token
--   Mirrors "PasswordReset"."tokenHash" / "Session"."tokenHash": auth.NewTokenAndHash
--   produces a 32-byte random token (base64url, 256 bits) and only the sha256 hex
--   digest is stored. The raw token leaves the server exactly once, in the POST
--   response, and is never recoverable from the database, from the log or from a
--   later read. Unique index → a lookup is a single index probe.
--
-- Expiry is NOT NULL
--   There is no "never expires" share. The column is NOT NULL so that no future
--   code path can create one by forgetting a default. 30 days is the default
--   (services.ShareTTLDefault), 90 the ceiling.
--
-- Revocation is a timestamp, not a delete
--   Same shape as "Session"."revokedAt": keeping the row lets the owner see that
--   the link existed and was cut, and lets the server answer "hết hạn / đã thu
--   hồi / không tồn tại" with ONE indistinguishable 404 (see handlers/shares.go).
--   ON DELETE CASCADE from "Device" means deleting the device kills its links
--   too — the one automatic revocation that is unambiguously correct.
--
-- What is deliberately NOT modelled
--   * No attachment/blob access. A receipt photo carries the seller's name,
--     address, phone and often other purchases; the certificate's job is proof of
--     remaining warranty, and a public file route would be a second
--     unauthenticated surface guarding far more sensitive data than the JSON it
--     sits next to. If images are ever added, they need their own design (scope
--     to one attachment id, verify `attachment."deviceId" = share."deviceId"`).
--   * No price fields. The buyer is not entitled to what the seller paid or
--     received; `purchasePrice`/`soldPrice`/`Warranty"."cost"` are excluded at the
--     query level, not filtered out afterwards.
--   * No `includeAttachments`-style flag: a boolean that does not exist cannot be
--     set to true by a client that misreads the spec.
--
-- NOT part of the backup payload (versions stay at 5/6)
--   A share row is live CREDENTIAL material — its "tokenHash" grants read access
--   without a login. Exporting it would put a usable capability inside a file the
--   user forwards to themselves by email, and importing it would resurrect links
--   the owner revoked on the old account. Same reasoning as "DecisionSnooze"
--   (migration 0011): losing the rows can only REVOKE access, never grant it, so
--   the safe direction is to drop them. Adding them later would need a format
--   bump and an explicit "these tokens are dead, re-issue them" story.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE public."DeviceShare" (
    id text NOT NULL,
    "deviceId" text NOT NULL,
    "userId" text NOT NULL,
    "tokenHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "revokedAt" timestamp(3) without time zone,
    "includeSerial" boolean DEFAULT false NOT NULL,
    "viewCount" integer DEFAULT 0 NOT NULL,
    "lastViewedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "DeviceShare_pkey" PRIMARY KEY (id),
    CONSTRAINT "DeviceShare_deviceId_fkey" FOREIGN KEY ("deviceId")
        REFERENCES public."Device"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "DeviceShare_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE UNIQUE INDEX "DeviceShare_tokenHash_key" ON public."DeviceShare" USING btree ("tokenHash");
CREATE INDEX "DeviceShare_userId_idx" ON public."DeviceShare" USING btree ("userId");
CREATE INDEX "DeviceShare_deviceId_idx" ON public."DeviceShare" USING btree ("deviceId");
CREATE INDEX "DeviceShare_expiresAt_idx" ON public."DeviceShare" USING btree ("expiresAt");
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS public."DeviceShare";
-- +goose StatementEnd
