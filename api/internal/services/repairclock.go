package services

import (
	"context"
	"os"
	"strings"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// The warranty repair clock (docs/FEATURE_RESEARCH_2026-11.md §6.1, wave 1).
//
// Vietnamese consumer law (Luật 19/2023, Điều 30 khoản 2 điểm c) says repair time
// is not counted against the warranty period: a device whose recorded
// `Warranty.endDate` is X is entitled to X + (whole days it spent in a closed
// repair). Wave 1 derives that on every read, with NO migration and NO stored
// column:
//
//   - repairExtensionDays — the per-device total from claims.sql
//     ListRepairExtensionsByDeviceIDs, clamped 0..3650 there.
//   - entitledWarrantyEnd — the device's `effectiveWarrantyEnd` (or, on a
//     reminder row, that warranty's `endDate`) shifted by those days.
//
// `effectiveWarrantyEnd` itself keeps its old meaning (the paper date) so a
// client comparing the two sees both numbers, and so build 23's clients — which
// never decode the new fields — keep the payload they always had.
//
// The env flag below gates ONLY the notification windows (cron T-30/T-7 and the
// reminders feed's `withinDays`), never the read fields: clients ship before the
// server flips the schedule, and the rollout order is "field visible everywhere"
// then "flag on in staging for one cron cycle, then production".

// MaxRepairExtensionDays is the hard clamp on the summed repair days (ten
// years). It is applied in SQL as well; the constant documents the same bound
// for the Go callers and is the number the OpenAPI/README copy names.
const MaxRepairExtensionDays = 3650

// RepairExtensionEnabled reports whether WV_REPAIR_EXTENSION is on.
//
// Default OFF, so a deployment that has not opted in keeps the 1.0.0 build 23
// schedule exactly: cron buckets and the reminders feed window measure the paper
// `Warranty.endDate`. Accepts "1"/"true"/"on" (case-insensitive) because the
// flag may be set by compose, systemd or a shell; anything else is off. The
// value is read per call — the cron pass and a request each take one snapshot,
// and an operator can toggle it without a rebuild.
func RepairExtensionEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("WV_REPAIR_EXTENSION"))) {
	case "1", "true", "on":
		return true
	default:
		return false
	}
}

// repairExtensionsByDevice returns the per-device closed-repair day totals for
// `deviceIDs`. Devices with no qualifying claim are absent from the map, which
// callers read as 0 — the same answer the query gives, without a second lookup.
//
// Ownership is enforced by the query's join through Device: an id owned by
// someone else simply does not appear, exactly like the other Claim reads.
func repairExtensionsByDevice(ctx context.Context, q *store.Queries, userID string, deviceIDs []string) (map[string]int32, error) {
	out := make(map[string]int32, len(deviceIDs))
	if len(deviceIDs) == 0 {
		return out, nil
	}
	rows, err := q.ListRepairExtensionsByDeviceIDs(ctx, store.ListRepairExtensionsByDeviceIDsParams{
		DeviceIds: deviceIDs,
		UserId:    userID,
	})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.DeviceID] = r.RepairExtensionDays
	}
	return out, nil
}

// repairEntitledDay shifts a calendar day by `days` repair days.
//
// The base day is a `Warranty.endDate` (the paper date) or an
// `effectiveWarrantyEnd` (the max of them), and the shift is whole calendar
// days, so the result is still a calendar day — never an instant. `nil` base
// means "no date recorded", which stays nil: there is nothing to extend.
//
// A non-positive `days` returns the base unchanged. The SQL already floors at 0
// and clamps at 3650; the guard here is for the reminder row projection, which
// adds the per-device total to one warranty's end and must not produce an
// earlier date if a hand-edited row ever carried a negative number.
func repairEntitledDay(base *wire.Day, days int32) *wire.Day {
	if base == nil {
		return nil
	}
	if days <= 0 {
		return base
	}
	if days > MaxRepairExtensionDays {
		days = MaxRepairExtensionDays
	}
	day := wire.Date(base.Time.AddDate(0, 0, int(days)))
	return &day
}
