-- WarrantyVault — device resale: nullable "soldAt" / "soldPrice" on "Device".
--
-- Why: Device.status already carries a 'SOLD' value (see
-- internal/services/devices.go::validStatuses and stats.go's status taxonomy),
-- but the table had nowhere to record *when* the device was sold or *for how
-- much* — so the app knew a device was sold yet could not compute profit/loss.
--
-- Semantics
--   * Both columns are nullable and stay NULL for every device that has not been
--     sold, so all existing rows keep working unchanged. `status = 'SOLD'` alone
--     remains valid and simply means "sold, details not recorded".
--   * soldPrice is plain integer VND, mirroring "purchasePrice" and Warranty.cost.
--   * The pairing rule (sold price and sold date must be supplied together or not
--     at all) is enforced in the write path — services.ValidateDeviceInput in
--     internal/services/devices.go — not by a DB constraint, so a NULL/NULL row
--     from a legacy import can never be rejected by the schema. Sending both as
--     null clears a previously recorded sale.
--   * No index: nothing filters or sorts by "soldAt"; profit/loss (when it lands)
--     rolls up per user over an already-small per-user set (max 50 devices).
--
-- Read paths pick the columns up automatically through `SELECT *` / `RETURNING *`
-- in internal/store/queries/devices.sql and backup.sql.

-- +goose Up
-- +goose StatementBegin
ALTER TABLE public."Device"
    ADD COLUMN IF NOT EXISTS "soldAt" timestamp(3) without time zone,
    ADD COLUMN IF NOT EXISTS "soldPrice" integer;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE public."Device"
    DROP COLUMN IF EXISTS "soldPrice",
    DROP COLUMN IF EXISTS "soldAt";
-- +goose StatementEnd
