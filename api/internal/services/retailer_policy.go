// Package services / retailer_policy.go — the shop's repair promise
// (docs/FEATURE_RESEARCH_2026-11.md §6.1, wave 2; migration 0030).
//
// Wave 1 derived the Vietnamese-law repair extension from CLOSED claims. Wave 2
// answers the other half of the same question while the device is still at the
// counter: how long did the SHOP say the repair would take?
//
// The policy is a property of the retail chain ("RetailerPolicy", keyed by
// Store), and the device carries an OPTIONAL link to it ("Device"."retailerId").
// This file owns the single derivation of the promise from (claim, policy,
// now):
//
//	days     = policy."repairCeilingDays"        (calendar days; NULL = no promise)
//	dueAt    = openedAt's Vietnam calendar day + days
//	daysLeft = dueAt − today (open) / dueAt − closedAt's day (closed)
//	state    = ON_TRACK | DUE_SOON | OVERDUE | MET | MISSED
//
// # Why the Vietnam calendar day
//
// "openedAt" and "closedAt" are instants stored as naive UTC (dbconn pins the
// session to UTC). A promise is a promise on a DAY, so the day must be the one
// the user and the shop share: a repair opened at 00:30 UTC (07:30 ICT) is
// opened "today" in Vietnam, and the same calendar day is what
// ListRepairExtensionsByDeviceIDs already uses for the wave-1 arithmetic. The
// two clocks therefore cannot disagree about which day a claim belongs to.
//
// # What the states mean
//
// The enum is deliberately closed. A policy with no calendar-day ceiling gets
// NULL — there is no "UNKNOWN" state, because the absence of a promise is
// different from a promise that is on track, and a client that printed
// "ON_TRACK" for a policy the app has never verified would be making a claim
// the data does not support.
//
//	ON_TRACK — open, more than PromiseDueSoonDays left.
//	DUE_SOON — open, 0..PromiseDueSoonDays left. The cron's T-2 notice fires
//	           here; the threshold is a constant so the push and the chip
//	           cannot disagree.
//	OVERDUE  — open, the due day has passed.
//	MET      — closed on or before the due day.
//	MISSED   — closed after the due day.
//
// A terminal claim with no "closedAt" (a hand-edited row) has no promise at
// all: the stored data cannot say whether the shop met it, and "MET" would be
// an invention. The wave-1 repair-day query makes the same choice.
//
// # Staleness is the client's call
//
// "checkedAt" travels so every surface can print "theo chính sách của
// <retailer>" + the read date, and can mark a policy older than 180 days as
// possibly stale. The server does not hide an old policy: an old citation is
// still the only evidence the app has, and dropping the promise at 180 days
// would silently remove a deadline the user is tracking.
package services

import (
	"context"
	"time"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// PromiseDueSoonDays is the window in which an open repair reads DUE_SOON and
// the cron sends its T-2 notice. The day-count is inclusive of the due day:
// due in 2 days, due tomorrow and due today are all "sắp tới hạn".
const PromiseDueSoonDays = 2

// Repair promise states. They are the exact strings in openapi.yaml and in the
// three clients; do not translate them on the wire (the clients map them to
// localized copy, like every other enum).
const (
	PromiseStateOnTrack = "ON_TRACK"
	PromiseStateDueSoon = "DUE_SOON"
	PromiseStateOverdue = "OVERDUE"
	PromiseStateMet     = "MET"
	PromiseStateMissed  = "MISSED"
)

// Promise notice kinds. "promiseNotifiedKind" stores one of these so the T-2
// and T+1 passes cannot suppress each other while a same-day repeat is a no-op.
const (
	PromiseNoticeDueSoon  = "DUE_SOON"
	PromiseNoticeOverdue  = "OVERDUE"
	PromiseNoticeStaleDay = 180 // clients use this for "số liệu có thể đã cũ"
)

// ict is Vietnam time. Fixed, not LoadLocation: the country has no daylight
// saving, and a fixed zone cannot fail to load on a machine without tzdata
// (the cron container is minimal). The wave-1 SQL spells the same zone as
// 'Asia/Ho_Chi_Minh'.
var ict = time.FixedZone("ICT", 7*60*60)

// RepairPromise is the derived per-claim object on the wire (openapi
// Claim.repairPromise). It is present only when the device's retailer has an
// active policy with a calendar-day repair ceiling; otherwise the key is null.
type RepairPromise struct {
	// Days is the shop's published ceiling, in calendar days.
	Days int32 `json:"days"`
	// DueAt is Days after the openedAt calendar day, as YYYY-MM-DD.
	DueAt *wire.Day `json:"dueAt"`
	// DaysLeft is signed: positive = days early, negative = days late. For a
	// closed claim it is measured to the close day, so MET is >= 0 and MISSED is
	// < 0; for an open claim it is measured to today.
	DaysLeft int32 `json:"daysLeft"`
	// State is one of the five constants above.
	State string `json:"state"`
	// SourceURL / CheckedAt are the policy's citation. Every surface that shows
	// the promise must print the retailer name and this date beside it.
	SourceURL string    `json:"sourceUrl"`
	CheckedAt *wire.Day `json:"checkedAt"`
	// RetailerID / RetailerName identify whose policy this is. The name is
	// carried here rather than resolved from the catalog by each client, because
	// the legal-risk rule is that the text "theo chính sách của <retailer>"
	// appears wherever the promise does.
	RetailerID   string `json:"retailerId"`
	RetailerName string `json:"retailerName"`
	// Note is the policy's qualifier in the retailer's own words (for example
	// "1 đổi 1 trong 30 ngày"), or null.
	Note *string `json:"note"`
}

// ClaimWithPromise is a stored claim plus its derived promise. Embedding the
// row keeps every existing field (and its JSON shape) byte-for-byte; the
// promise is one additive key, null when there is nothing to promise.
type ClaimWithPromise struct {
	store.Claim
	RepairPromise *RepairPromise `json:"repairPromise"`
}

// RepairPolicy is the narrow policy shape the promise needs. It is built from
// either the catalog row or the per-device join; the two must not disagree, and
// this is the one place they meet.
type RepairPolicy struct {
	StoreID           string
	RetailerName      string
	RepairCeilingDays *int32
	RepairCeilingNote *string
	SourceURL         string
	CheckedAt         wire.Day
}

// buildRepairPromise derives the promise for one claim. `now` is injected so
// the cron and the read path can be tested (and reasoned about) at a fixed
// instant; production callers pass time.Now().
func buildRepairPromise(claim store.Claim, policy RepairPolicy, now time.Time) *RepairPromise {
	if policy.RepairCeilingDays == nil || *policy.RepairCeilingDays <= 0 {
		return nil
	}
	dueDay, daysLeft, state, ok := RepairPromiseClock(
		claim.OpenedAt, claim.ClosedAt, claim.Status, *policy.RepairCeilingDays, now)
	if !ok {
		return nil
	}
	return &RepairPromise{
		Days:         *policy.RepairCeilingDays,
		DueAt:        &dueDay,
		DaysLeft:     daysLeft,
		State:        state,
		SourceURL:    policy.SourceURL,
		CheckedAt:    policy.CheckedAt.Ptr(),
		RetailerID:   policy.StoreID,
		RetailerName: policy.RetailerName,
		Note:         policy.RepairCeilingNote,
	}
}

// RepairPromiseClock is the promise day arithmetic on its own, exported so the
// cron can decide whether today is a T-2 / T+1 day without inventing a second
// definition. It is the ONLY place the due date and the state are computed:
// buildRepairPromise above and the cron pass both go through it.
//
// ok=false means "there is no promise to report": a non-positive ceiling, a
// claim with no open stamp, or a terminal claim with no close stamp (the stored
// data cannot say whether the shop met it). Callers must not substitute a
// default state — NULL is the honest answer.
func RepairPromiseClock(openedAt, closedAt wire.Instant, status string, days int32, now time.Time) (dueAt wire.Day, daysLeft int32, state string, ok bool) {
	if days <= 0 || !openedAt.Valid {
		return wire.Day{}, 0, "", false
	}
	opened := vietnamCalendarDay(openedAt.Time)
	due := opened.AddDate(0, 0, int(days))

	switch {
	case closedAt.Valid:
		closed := vietnamCalendarDay(closedAt.Time)
		daysLeft = wholeDaysBetween(closed, due)
		if closed.After(due) {
			state = PromiseStateMissed
		} else {
			state = PromiseStateMet
		}
	case isOpenClaimStatus(status):
		today := vietnamCalendarDay(now)
		daysLeft = wholeDaysBetween(today, due)
		switch {
		case daysLeft < 0:
			state = PromiseStateOverdue
		case daysLeft <= PromiseDueSoonDays:
			state = PromiseStateDueSoon
		default:
			state = PromiseStateOnTrack
		}
	default:
		// Terminal without a close stamp: no state to report. Not "MET".
		return wire.Day{}, 0, "", false
	}

	// The stored due day is UTC midnight of the Vietnam calendar day, which is
	// exactly what wire.Date serialises as YYYY-MM-DD.
	return wire.Date(due), daysLeft, state, true
}

// repairPolicyFromCatalog maps a generated policy row + store name into the
// narrow shape above.
func repairPolicyFromCatalog(storeID, storeName string, p store.RetailerPolicy) RepairPolicy {
	return RepairPolicy{
		StoreID:           storeID,
		RetailerName:      storeName,
		RepairCeilingDays: p.RepairCeilingDays,
		RepairCeilingNote: p.RepairCeilingNote,
		SourceURL:         p.SourceUrl,
		CheckedAt:         p.CheckedAt,
	}
}

// retailerPoliciesByDevice returns the ACTIVE policy for each of `deviceIDs`
// that has a retailer link. Devices without one are absent, which callers read
// as "no promise" without a second lookup.
//
// Ownership is enforced by the query's join through Device, exactly like every
// other Claim read: an id owned by someone else simply does not appear.
func retailerPoliciesByDevice(ctx context.Context, q *store.Queries, userID string, deviceIDs []string) (map[string]RepairPolicy, error) {
	out := make(map[string]RepairPolicy, len(deviceIDs))
	if len(deviceIDs) == 0 {
		return out, nil
	}
	rows, err := q.ListDeviceRetailerPolicies(ctx, store.ListDeviceRetailerPoliciesParams{
		UserId:    userID,
		DeviceIds: deviceIDs,
	})
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		out[r.DeviceID] = RepairPolicy{
			StoreID:           r.RetailerID,
			RetailerName:      r.RetailerName,
			RepairCeilingDays: r.RepairCeilingDays,
			RepairCeilingNote: r.RepairCeilingNote,
			SourceURL:         r.SourceUrl,
			CheckedAt:         r.CheckedAt,
		}
	}
	return out, nil
}

// claimsWithPromises hydrates a list of stored claims with their (nullable)
// promise. One policy query for the whole list, not one per claim.
func claimsWithPromises(ctx context.Context, q *store.Queries, userID string, claims []store.Claim, now time.Time) ([]ClaimWithPromise, error) {
	out := make([]ClaimWithPromise, 0, len(claims))
	if len(claims) == 0 {
		return out, nil
	}
	deviceIDs := make([]string, 0, len(claims))
	seen := make(map[string]bool, len(claims))
	for _, c := range claims {
		if !seen[c.DeviceId] {
			seen[c.DeviceId] = true
			deviceIDs = append(deviceIDs, c.DeviceId)
		}
	}
	policies, err := retailerPoliciesByDevice(ctx, q, userID, deviceIDs)
	if err != nil {
		return nil, err
	}
	for _, c := range claims {
		cwp := ClaimWithPromise{Claim: c}
		if p, ok := policies[c.DeviceId]; ok {
			cwp.RepairPromise = buildRepairPromise(c, p, now)
		}
		out = append(out, cwp)
	}
	return out, nil
}

// claimWithPromise hydrates ONE claim. Used by the create / update / get
// single-row paths; the device detail uses claimsWithPromises.
func claimWithPromise(ctx context.Context, q *store.Queries, userID string, claim store.Claim, now time.Time) (ClaimWithPromise, error) {
	rows, err := claimsWithPromises(ctx, q, userID, []store.Claim{claim}, now)
	if err != nil {
		return ClaimWithPromise{}, err
	}
	return rows[0], nil
}

// vietnamCalendarDay reduces an instant to its Vietnam calendar day, expressed
// as a UTC midnight. The returned value is only used for whole-day arithmetic;
// it is never serialised (the wire day is built with wire.Date at the end).
func vietnamCalendarDay(t time.Time) time.Time {
	local := t.In(ict)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, time.UTC)
}

// wholeDaysBetween returns to − from in whole days. Both arguments are UTC
// midnights produced by vietnamCalendarDay, so the division cannot lose a day
// to an offset.
func wholeDaysBetween(from, to time.Time) int32 {
	return int32(to.Sub(from) / (24 * time.Hour))
}
