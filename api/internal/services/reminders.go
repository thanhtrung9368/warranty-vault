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
type ReminderRow struct {
	store.Warranty
	Device ReminderDeviceRef `json:"device"`
}

// ReminderDeviceRef is the small device projection embedded in each reminder
// row — enough for mobile clients to render the card without a second
// round-trip.
type ReminderDeviceRef struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Category string `json:"category"`
}

// ListUpcomingReminders mirrors listUpcomingReminders from the TS service.
// Returns warranties whose endDate falls within [today00:00, today+N 23:59:59.999]
// for ACTIVE devices, excluding warranties with a dismissed Reminder row.
func ListUpcomingReminders(ctx context.Context, db *pgxpool.Pool, userID string, withinDays int) ([]ReminderRow, error) {
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
		UserId:    userID,
		EndDate:   pgtype.Timestamp{Time: startOfToday.UTC(), Valid: true},
		EndDate_2: pgtype.Timestamp{Time: horizon.UTC(), Valid: true},
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
			Device: ReminderDeviceRef{
				ID:       r.DeviceID,
				Name:     r.DeviceName,
				Category: r.DeviceCategory,
			},
		})
	}
	return out, nil
}
