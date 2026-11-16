-- Installment plan ("trả góp") — FEATURE_RESEARCH_2026-11 §6.5.
--
-- The problem this table exists for: `Device.purchasePrice` is used as if the
-- user paid that much in cash. It feeds cost-per-day, resale profit and /stats.
-- Roughly half of new iPhone buyers in Vietnam choose instalments, so for those
-- devices every one of those numbers is wrong: the cash out is the down payment
-- plus N monthly payments plus fees, and part of it is still owed.
--
-- ── Why a separate table and not Device columns ────────────────────────────
--
-- Two reasons, both load-bearing:
--
--  1. It must be invisible to `PATCH /api/v1/devices/{id}`. That endpoint
--     REPLACES the whole device, and a client that does not know the field
--     erases it — the exact bug that made `warrantyMonths` tri-state and put
--     `soldAt`/`soldPrice` in every client's save round trip. Build 23 in App
--     Review has no notion of instalments, so columns on `Device` would mean
--     the plan silently vanished every time an old client edited the device.
--     A separate table with its own write endpoint cannot be reached by a
--     device PATCH at all.
--  2. One plan per device, and most devices have none. A 1:1 table keeps the
--     `Device` row (and every existing query on it, including `SELECT *`)
--     unchanged.
--
-- ── What is stored, and what is NOT ───────────────────────────────────────
--
-- Stored: only the user's own declarations. `downPayment`, `months`,
-- `monthlyAmount`, `firstDueAt` (a CALENDAR DAY — the day the first payment is
-- due; see the sqlc override to wire.Day), the optional `fileFee` /
-- `monthlyFee` (NULL = the user did not say, NOT zero), `paidCount` (how many
-- monthly payments the user says they have made), and `lender`.
--
-- NOT stored: totals, remaining, next due date, or an "overdue" flag. Those are
-- derived on read (`services/installment.go`), so a value in the database can
-- never disagree with the plan it came from. `paidCount` is self-reported: the
-- app cannot see the bank's transaction, so a stored "overdue" would be a claim
-- the data does not support. Wave 1 therefore has no reminder and no push —
-- `notifiedDueAt` / `notifiedLeadDay` exist so a later wave can add one WITHOUT
-- a new migration, and they stay NULL until then.
--
-- `paidCount <= months` and `months` 1..60 are the contract's rules; the CHECK
-- constraints here are the last line of defence, not the user-facing validation
-- (the service returns `fieldErrors` in the request's language).
--
-- Amounts are in the DEVICE's currency (`Device.currency`), the same unit as
-- `purchasePrice` — which is also why the device's currency may not change
-- while a plan exists (the service refuses it with a 400). `ownershipCostVnd`
-- is derived from these amounts through the device's LOCKED `fxRate`.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE IF NOT EXISTS public."InstallmentPlan" (
    "deviceId"        text        NOT NULL,
    "downPayment"     integer     NOT NULL DEFAULT 0,
    months            integer     NOT NULL,
    "monthlyAmount"   integer     NOT NULL,
    "firstDueAt"      timestamp(3) without time zone NOT NULL,
    "fileFee"         integer,
    "monthlyFee"      integer,
    "paidCount"       integer     NOT NULL DEFAULT 0,
    lender            text,
    "notifiedDueAt"   timestamp(3) without time zone,
    "notifiedLeadDay" integer,
    "createdAt"       timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    "updatedAt"       timestamp(3) without time zone NOT NULL DEFAULT (now() AT TIME ZONE 'UTC'),
    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("deviceId"),
    CONSTRAINT "InstallmentPlan_deviceId_fkey"
        FOREIGN KEY ("deviceId") REFERENCES public."Device" (id) ON DELETE CASCADE,
    CONSTRAINT "InstallmentPlan_months_check"
        CHECK (months >= 1 AND months <= 60),
    CONSTRAINT "InstallmentPlan_monthlyAmount_check"
        CHECK ("monthlyAmount" > 0),
    CONSTRAINT "InstallmentPlan_paidCount_check"
        CHECK ("paidCount" >= 0 AND "paidCount" <= months),
    CONSTRAINT "InstallmentPlan_downPayment_check"
        CHECK ("downPayment" >= 0),
    CONSTRAINT "InstallmentPlan_fileFee_check"
        CHECK ("fileFee" IS NULL OR "fileFee" >= 0),
    CONSTRAINT "InstallmentPlan_monthlyFee_check"
        CHECK ("monthlyFee" IS NULL OR "monthlyFee" >= 0)
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS public."InstallmentPlan";
-- +goose StatementEnd
