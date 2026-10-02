package services

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// ReminderRow is the hydrated row returned to clients for the reminders feed.
// Mirrors website/src/lib/services/reminders.ts::listUpcomingReminders shape:
// warranty + minimal device projection.
//
// IsDismissed is emitted ONLY when true (`omitempty`). That is a deliberate
// compatibility choice: with the default includeDismissed=false the dismissed
// rows are filtered out in SQL, so every returned row has false and the field
// disappears entirely — the response stays byte-identical to the pre-flag shape —
// while a client reading `includeDismissed=true` can still tell a hidden row
// (field present, true) from an active one (field absent). Clients must treat
// "absent" as false.
type ReminderRow struct {
	store.Warranty
	IsDismissed bool              `json:"isDismissed,omitempty"`
	Device      ReminderDeviceRef `json:"device"`
}

// ReminderDeviceRef is the small device projection embedded in each reminder
// row — enough for mobile clients to render the card without a second
// round-trip.
//
// Status is included because hidden reminders are returned for devices of ANY
// status (see ListUpcomingReminders): the UI renders a "Đã bán" / "Hỏng" / "Mất"
// badge when status != ACTIVE, and the backup-derived read this replaces carried
// it.
type ReminderDeviceRef struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"`
	Status   string `json:"status"`
}

// ListUpcomingReminders mirrors listUpcomingReminders from the TS service.
//
// includeDismissed=false (unchanged behaviour): warranties whose endDate falls
// within [today00:00, today+withinDays 23:59:59.999] for ACTIVE devices,
// excluding warranties with a dismissed Reminder row.
//
// includeDismissed=true adds the user's dismissed reminders. For those two
// filters do not apply — no endDate window, no ACTIVE-device requirement — so a
// reminder hidden long ago, or hidden on a device that was later sold, stays
// visible instead of silently disappearing. The extra rows are bounded by the
// write-path caps (50 devices × 5 warranties = at most 250 warranties per user).
func ListUpcomingReminders(ctx context.Context, db *pgxpool.Pool, userID string, withinDays int, includeDismissed bool) ([]ReminderRow, error) {
	if withinDays <= 0 {
		withinDays = 30
	}

	now := time.Now()
	startOfToday := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	horizon := startOfToday.AddDate(0, 0, withinDays)
	// Include the entire `endDate + withinDays` calendar day.
	horizon = time.Date(horizon.Year(), horizon.Month(), horizon.Day(), 23, 59, 59, int(time.Millisecond)*999, horizon.Location())

	q := store.New(db)
	rows, err := q.ListUpcomingReminders(ctx, store.ListUpcomingRemindersParams{
		UserId:           userID,
		IncludeDismissed: includeDismissed,
		EndDateFrom:      pgtype.Timestamp{Time: startOfToday.UTC(), Valid: true},
		EndDateTo:        pgtype.Timestamp{Time: horizon.UTC(), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("list upcoming reminders: %w", err)
	}

	out := make([]ReminderRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, ReminderRow{
			Warranty: store.Warranty{
				ID:        r.ID,
				DeviceId:  r.DeviceId,
				Type:      r.Type,
				Provider:  r.Provider,
				StartDate: r.StartDate,
				EndDate:   r.EndDate,
				Months:    r.Months,
				Cost:      r.Cost,
				Address:   r.Address,
				Phone:     r.Phone,
				Notes:     r.Notes,
				CreatedAt: r.CreatedAt,
				UpdatedAt: r.UpdatedAt,
			},
			IsDismissed: r.IsDismissed,
			Device: ReminderDeviceRef{
				ID:       r.DeviceID,
				Name:     r.DeviceName,
				Category: r.DeviceCategory,
				Status:   r.DeviceStatus,
			},
		})
	}
	return out, nil
}
