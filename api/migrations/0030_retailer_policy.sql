-- Retailer policy + the repair promise (FEATURE_RESEARCH_2026-11 §6.1 wave 2).
--
-- Wave 1 (migration-free, commit 64dae5a) made every device read carry
-- "repairExtensionDays" / "entitledWarrantyEnd" — the Vietnamese-law extension
-- derived from CLOSED claims. This migration adds the second clock: what the
-- SHOP promised. A claim is a device at a counter; whether the shop is still
-- inside its own repair window is a fact about the shop, not about the device.
--
-- ── RetailerPolicy, keyed by Store ────────────────────────────────────────
--
-- A policy belongs to a retail chain, not to a device and not to a user: every
-- CellphoneS purchase shares the same published window. So the primary key is
-- "storeId" with an FK to the existing "Store" catalog (0008/0001) rather than a
-- new retailer table. Reusing "Store" also means the device form's existing
-- store picker and this table cannot disagree about what a shop is called.
--
-- Every numeric column is NULLABLE and NULL MEANS "NOT VERIFIED", never zero:
--
--   * "returnWindowDays" — the shop's exchange/return window in days, the same
--     meaning as "Device"."returnWindowDays" (0010) so the form can offer to
--     copy it onto the device ("Dùng 30 ngày").
--   * "repairCeilingDays" — the shop's published ceiling for a repair, in
--     CALENDAR days. It is the only input to the promise clock. NULL = the app
--     will not show a countdown for this retailer; it must not guess one. A
--     policy phrased in WORKING days is deliberately stored as NULL rather than
--     converted: 14 working days is not 14 calendar days, and a promise that
--     fires early is a false accusation against the shop.
--   * "repairCeilingNote" / "exchangeNote" — the human-readable qualifier
--     ("24 giờ – tối đa 14 ngày làm việc", "1 đổi 1 trong 30 ngày"). Free text,
--     shown verbatim beside the number; never parsed.
--
-- "sourceUrl" is NOT NULL and "checkedAt" is NOT NULL by design. The research
-- document's evidence rule (§2, §6.1 risk 3) is that a retailer claim without a
-- URL and a read date is a legal assertion, not data. A row that cannot carry
-- both does not get seeded, and every UI surface must print "theo chính sách
-- của <retailer>" + the date. "isActive" lets an operator retire a policy
-- without deleting the row (and therefore without losing the citation).
--
-- ── The seed: 2–3 retailers, nothing invented ─────────────────────────────
--
-- Only three rows, and only the values that have a citation:
--
--   * the-gioi-di-dong — repairCeilingDays 15. The figure is the one recorded
--     in docs/FEATURE_RESEARCH_2026-11.md (backlog #1 / §5 / §6.1) with the
--     URL below. TGDD renders its policy pages with JavaScript, so this build
--     records the research document's checked figure and the URL rather than
--     pretending it re-read the page; the UI always prints the retailer and
--     the date so the number is presented as "theo chính sách", never as a
--     contract term Warrly guarantees.
--   * fpt-shop — returnWindowDays 30. Verified on FPT Shop's own return-policy
--     page on 2026-11-16: a new ICT product with a manufacturer fault is
--     1-đổi-1 within 0–30 days from the invoice. No repair ceiling is
--     published there, so "repairCeilingDays" stays NULL.
--   * cellphones — both numbers NULL. The cited page publishes a 24-hour to
--     14-WORKING-day turnaround for the extended-warranty (1 đổi 1 VIP)
--     package, not a calendar-day promise for every repair. The quote is kept
--     in "repairCeilingNote" so the user can read what the shop actually says;
--     the countdown stays absent. This is the "NULL when unverified" case the
--     feature is built around.
--
-- ON CONFLICT DO NOTHING: an operator who corrected a row in production keeps
-- their correction when this migration is re-applied to a database that already
-- ran it (goose will not, but a restored dump might).
--
-- ── Device.retailerId ─────────────────────────────────────────────────────
--
-- "Device.purchasePlace" is free text (0001) and stays free text: not every
-- shop in the catalog has a policy row, and users type branches/aliases the
-- catalog has never heard of. "retailerId" is the OPTIONAL link to a known
-- chain, used only to resolve a policy. It is nullable, with an index because
-- the read joins on it, and ON DELETE SET NULL because retiring a Store row
-- must not delete devices.
--
-- The backfill is an EXACT match, not a fuzzy guess: after lower-casing and
-- "public.wv_unaccent" (the IMMUTABLE wrapper from 0005/0007) the stored
-- "purchasePlace" must equal the Store's name exactly. "CellphoneS" and
-- "cellphones" match; "CellphoneS Q7" does not. A name shared by two active
-- stores is skipped rather than resolved arbitrarily — a wrong link would show
-- another shop's promise on the device. Devices whose place does not match keep
-- NULL, which is the honest answer, and the user can pick the retailer in the
-- form (or leave it empty).
--
-- ── DeviceInput.retailerId is TRI-STATE ───────────────────────────────────
--
-- Like "warrantyMonths" (0012-era fix), the PATCH field is a pointer:
--   * absent  — the request says nothing about the retailer: keep the stored
--               value. This is what keeps every build-23 client (which has
--               never heard of the field) from wiping the link on an unrelated
--               edit.
--   * ""      — an explicit clear.
--   * "<id>"  — set, after the service proves the Store exists and is active.
--
-- ── Claim.promiseNotifiedAt / promiseNotifiedKind ─────────────────────────
--
-- The cron's send-once guard for the two promise notices (T-2 "sắp tới hạn",
-- T+1 "đã quá hạn"). Stored on the Claim, not in "Reminder": a promise is not a
-- warranty end date, "Reminder"."warrantyId" is NOT NULL, and "isDismissed"
-- there gates real warranty push. A single stamp pair is enough because the two
-- notices have different kinds; the pass compares the kind (not just the day)
-- so T-2 does not suppress T+1, and a second run on the same day does nothing.
-- Both columns are operational: they are not in "ClaimInput".
--
-- ── Backup ────────────────────────────────────────────────────────────────
--
-- "retailerId" joins the device block of the export/import payload as an
-- additive optional field (unknown id → NULL, never a failed import). The
-- payload version does not move: an older file decodes the key away, which
-- means "no retailer link", the same state every pre-0030 device is in.
--
-- ── Rollback ──────────────────────────────────────────────────────────────
--
-- Down drops the two Claim columns, the Device column (and its index/FK) and
-- the policy table. The promises disappear with them; the seed has no older
-- shape to live in. As every goose down here, it is destructive and requires
-- WV_ALLOW_DESTRUCTIVE=1.

-- +goose Up
-- +goose StatementBegin

CREATE TABLE IF NOT EXISTS public."RetailerPolicy" (
    "storeId"           text        NOT NULL,
    "returnWindowDays"  integer,
    "repairCeilingDays" integer,
    "repairCeilingNote" text,
    "exchangeNote"      text,
    "sourceUrl"         text        NOT NULL,
    "checkedAt"         timestamp(3) without time zone NOT NULL,
    "isActive"          boolean     NOT NULL DEFAULT true,
    CONSTRAINT "RetailerPolicy_pkey" PRIMARY KEY ("storeId"),
    CONSTRAINT "RetailerPolicy_storeId_fkey" FOREIGN KEY ("storeId")
        REFERENCES public."Store" (id) ON UPDATE CASCADE ON DELETE CASCADE
);

-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE public."Device"
    ADD COLUMN IF NOT EXISTS "retailerId" text;

ALTER TABLE public."Device"
    DROP CONSTRAINT IF EXISTS "Device_retailerId_fkey";
ALTER TABLE public."Device"
    ADD CONSTRAINT "Device_retailerId_fkey" FOREIGN KEY ("retailerId")
        REFERENCES public."Store" (id) ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "Device_retailerId_idx"
    ON public."Device" ("retailerId");
-- +goose StatementEnd

-- The three seeded policies. Values and their provenance are in the header;
-- every row carries sourceUrl + checkedAt because a policy without a citation
-- is exactly the legal risk this feature must not take.
-- +goose StatementBegin
INSERT INTO public."RetailerPolicy" (
    "storeId", "returnWindowDays", "repairCeilingDays", "repairCeilingNote",
    "exchangeNote", "sourceUrl", "checkedAt", "isActive"
) VALUES
    (
        'the-gioi-di-dong',
        NULL,
        15,
        'Thời gian sửa chữa tối đa 15 ngày (theo chính sách của Thế Giới Di Động)',
        NULL,
        'https://www.thegioididong.com/bao-hanh/obaku',
        '2026-11-16',
        true
    ),
    (
        'fpt-shop',
        30,
        NULL,
        NULL,
        'Sản phẩm mới lỗi nhà sản xuất: 1 đổi 1 trong 30 ngày (tính từ ngày xuất hoá đơn)',
        'https://fptshop.com.vn/ho-tro/chinh-sach-doi-san-pham',
        '2026-11-16',
        true
    ),
    (
        'cellphones',
        NULL,
        NULL,
        'Xử lý trong 24 giờ, tối đa 14 ngày làm việc (gói bảo hành mở rộng 1 đổi 1 VIP)',
        NULL,
        'https://cellphones.com.vn/bieu-phi-bao-hanh-mo-rong',
        '2026-11-16',
        true
    )
ON CONFLICT ("storeId") DO NOTHING;
-- +goose StatementEnd

-- Exact-match backfill through wv_unaccent. The NOT EXISTS clause refuses a
-- purchasePlace that normalises to two active store names: an arbitrary pick
-- would attach the wrong shop's policy, so the device keeps NULL instead.
-- +goose StatementBegin
UPDATE public."Device" AS d
SET "retailerId" = s.id
FROM public."Store" AS s
WHERE d."retailerId" IS NULL
  AND d."purchasePlace" IS NOT NULL
  AND btrim(d."purchasePlace") <> ''
  AND s."isActive" = true
  AND lower(public.wv_unaccent(btrim(d."purchasePlace")))
      = lower(public.wv_unaccent(s.name))
  AND NOT EXISTS (
      SELECT 1
      FROM public."Store" AS s2
      WHERE s2."isActive" = true
        AND s2.id <> s.id
        AND lower(public.wv_unaccent(s2.name))
            = lower(public.wv_unaccent(s.name))
  );
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE public."Claim"
    ADD COLUMN IF NOT EXISTS "promiseNotifiedAt" timestamp(3) without time zone;
ALTER TABLE public."Claim"
    ADD COLUMN IF NOT EXISTS "promiseNotifiedKind" text;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE public."Claim" DROP COLUMN IF EXISTS "promiseNotifiedKind";
ALTER TABLE public."Claim" DROP COLUMN IF EXISTS "promiseNotifiedAt";

DROP INDEX IF EXISTS public."Device_retailerId_idx";
ALTER TABLE public."Device" DROP CONSTRAINT IF EXISTS "Device_retailerId_fkey";
ALTER TABLE public."Device" DROP COLUMN IF EXISTS "retailerId";

DROP TABLE IF EXISTS public."RetailerPolicy";
-- +goose StatementEnd
