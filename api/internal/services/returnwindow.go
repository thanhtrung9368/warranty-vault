package services

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Return / exchange window ("1 đổi 1") — FEATURE_IDEAS #1.
//
// The problem this closes: cron only knows two milestones and both count
// BACKWARDS from "Warranty"."endDate" (internal/cron/run.go, 7 and 30 days). For
// a 12-month warranty the only notification a user ever gets lands around month
// 11 — roughly ten months after the retailer's 30-day one-for-one exchange window
// has already closed. The deadline that decides whether a defective-on-arrival
// device gets REPLACED rather than repaired was invisible.
//
// Two rules are worth stating up front, because both were verified rather than
// assumed:
//
//  1. The window length is PER DEVICE and user-supplied. It has no server-side
//     default — `returnWindowDays` NULL means "chưa biết", which is not the same
//     as 0 ("cửa hàng không cho đổi trả"). The number genuinely varies: the FPT
//     Shop policy (effective 01/7/2024) gives ICT products 0–30 days,
//     accessories 0–365 days, screen protectors none at all, and fridges /
//     washing machines 30 days for the Casper brand only. A hard-coded single
//     number would be wrong for whole categories, so none is hard-coded.
//  2. Vietnamese law does NOT require this window. Điều 30 Luật Bảo vệ quyền lợi
//     người tiêu dùng 19/2023/QH15 requires replacement or refund only when the
//     warranty period expired unfixed, or after 3+ failed repairs inside the
//     warranty period. Every number here is therefore presented as a SHOP POLICY
//     the user records, never as a legal right.
const (
	// ReturnWindowDaysMax bounds `returnWindowDays`. 3650 covers a decade, which
	// is already absurd for an exchange window, and it exists only so a typo
	// cannot store a date in the year 9999. ReturnWindowDaysMin is 0: zero is a
	// meaningful value ("no exchange window"), distinct from NULL ("unknown").
	ReturnWindowDaysMax = 3650
	ReturnWindowDaysMin = 0
)

// ReturnDeadline computes the last day the exchange window is open:
//
//	COALESCE(receivedAt, purchaseDate) + windowDays days
//
// It is the exact Go twin of the SQL expression in
// queries/returnwindow.sql — deliberately not stored anywhere, so editing
// either input moves the deadline immediately and the two can never disagree.
//
// `receivedAt` takes precedence over `purchaseDate` because an online order is
// invoiced before it is delivered, and the count should start from the day the
// user actually has the device. Returns ok=false when the window is unknown
// (windowDays nil) or absent (windowDays <= 0): there is nothing to count down to.
func ReturnDeadline(purchaseDate time.Time, receivedAt *time.Time, windowDays *int32) (time.Time, bool) {
	if windowDays == nil || *windowDays < 1 || *windowDays > ReturnWindowDaysMax {
		return time.Time{}, false
	}
	base := purchaseDate
	if receivedAt != nil && !receivedAt.IsZero() {
		base = *receivedAt
	}
	if base.IsZero() {
		return time.Time{}, false
	}
	return base.AddDate(0, 0, int(*windowDays)), true
}

// DaysUntil returns the number of whole calendar days from `now`'s date to
// `deadline`'s date. 0 means "today is the last day"; negative means the window
// has already closed.
//
// The comparison is on calendar dates, not instants: the stored deadlines are
// wall-clock midnight-of-day timestamps, so subtracting instants would report 0
// days left for most of the final day and then jump to -1 after local midnight.
// Both sides are rebuilt in `now`'s location, mirroring cron's dayWindow().
func DaysUntil(deadline, now time.Time) int {
	loc := now.Location()
	d := time.Date(deadline.Year(), deadline.Month(), deadline.Day(), 0, 0, 0, 0, loc)
	t := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	return int(d.Sub(t).Hours() / 24)
}

// ReturnWindowRow is one device whose exchange window is still open.
//
// It is a projection of the stored Device plus two derived fields, so a client
// never has to re-implement the `COALESCE(receivedAt, purchaseDate) + days` rule.
// That matters more than it looks: the repo has already been burned by money math
// implemented independently on three clients, and this is the same class of rule.
type ReturnWindowRow struct {
	DeviceID         string  `json:"deviceId"`
	Name             string  `json:"name"`
	Category         string  `json:"category"`
	Brand            *string `json:"brand"`
	Model            *string `json:"model"`
	SerialNumber     *string `json:"serialNumber"`
	Status           string  `json:"status"`
	PurchaseDate     string  `json:"purchaseDate"`
	ReceivedAt       *string `json:"receivedAt"`
	ReturnWindowDays int32   `json:"returnWindowDays"`
	ReturnDeadline   string  `json:"returnDeadline"`
	// DaysLeft is 0 on the final day and grows as the window closes in. Never
	// negative here: the list only contains windows that are still open.
	DaysLeft int `json:"daysLeft"`
}

// ListReturnWindows returns the user's ACTIVE devices whose exchange window is
// still open, most urgent first. `now` is passed in rather than read from the
// clock so the caller (and the tests) control the instant.
func ListReturnWindows(ctx context.Context, db *pgxpool.Pool, userID string, now time.Time) ([]ReturnWindowRow, error) {
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())

	rows, err := store.New(db).ListOpenReturnWindows(ctx, store.ListOpenReturnWindowsParams{
		UserId:       userID,
		StartOfToday: pgtype.Timestamp{Time: startOfToday.UTC(), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("list open return windows: %w", err)
	}

	out := make([]ReturnWindowRow, 0, len(rows))
	for _, r := range rows {
		if !r.ReturnDeadline.Valid || r.ReturnWindowDays == nil {
			// Unreachable through the SQL predicate (it requires both), but a
			// projection that silently emits a zero deadline would render as
			// 01/01/0001 in every client. Skip instead.
			continue
		}
		row := ReturnWindowRow{
			DeviceID:         r.ID,
			Name:             r.Name,
			Category:         r.Category,
			Brand:            r.Brand,
			Model:            r.Model,
			SerialNumber:     r.SerialNumber,
			Status:           r.Status,
			ReceivedAt:       tsPtrUTC(r.ReceivedAt),
			ReturnWindowDays: *r.ReturnWindowDays,
			ReturnDeadline:   r.ReturnDeadline.Time.UTC().Format(time.RFC3339Nano),
			DaysLeft:         DaysUntil(r.ReturnDeadline.Time, now),
		}
		if r.PurchaseDate.Valid {
			row.PurchaseDate = r.PurchaseDate.Time.UTC().Format(time.RFC3339Nano)
		}
		out = append(out, row)
	}
	return out, nil
}

// deviceReturnDeadline is the hydration helper for the device read paths
// (DeviceListItem / DeviceDetail). Returns nil when the window is unknown, absent
// or the purchase date is missing — a genuinely nullable projection, matching the
// existing `effectiveWarrantyEnd` treatment.
func deviceReturnDeadline(d store.Device) *time.Time {
	if !d.PurchaseDate.Valid {
		return nil
	}
	var received *time.Time
	if d.ReceivedAt.Valid {
		t := d.ReceivedAt.Time
		received = &t
	}
	deadline, ok := ReturnDeadline(d.PurchaseDate.Time, received, d.ReturnWindowDays)
	if !ok {
		return nil
	}
	return &deadline
}

// tsPtrUTC formats an optional timestamp as RFC3339Nano UTC, or nil when absent.
// Mirrors the convention used by ForecastWarranty.EndDate and
// AttachmentMeta.UploadedAt.
func tsPtrUTC(t pgtype.Timestamp) *string {
	if !t.Valid {
		return nil
	}
	s := t.Time.UTC().Format(time.RFC3339Nano)
	return &s
}
