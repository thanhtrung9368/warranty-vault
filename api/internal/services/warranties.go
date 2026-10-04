package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// MaxWarrantiesPerDevice mirrors website/src/lib/services/warranties.ts.
const MaxWarrantiesPerDevice = 5

var validWarrantyTypes = map[string]bool{
	"STANDARD":    true,
	"EXTENDED":    true,
	"THIRD_PARTY": true,
}

// WarrantyInput mirrors website/src/lib/services/warranties.ts::warrantyInputSchema.
type WarrantyInput struct {
	Type      string  `json:"type"`
	Provider  *string `json:"provider,omitempty"`
	StartDate string  `json:"startDate"`
	Months    int32   `json:"months"`
	Cost      *int32  `json:"cost,omitempty"`
	Address   *string `json:"address,omitempty"`
	Phone     *string `json:"phone,omitempty"`
	Notes     *string `json:"notes,omitempty"`
}

// ValidateWarrantyInput mirrors warrantyInputSchema.
//
// # i18n
//
// Converted with the devices slice (docs/I18N_PLAN.md §3, Phase 1): every message
// is the existing Vietnamese literal wrapped in `i18n.Text(ctx, …)`, with the
// English column added in internal/i18n/catalog.go. The envelope headline is the
// generic "Dữ liệu không hợp lệ", rendered through ErrValidationHeadline so it
// follows the same language as the field messages under it.
func ValidateWarrantyInput(ctx context.Context, in *WarrantyInput) error {
	in.Type = strings.TrimSpace(in.Type)
	in.StartDate = strings.TrimSpace(in.StartDate)
	trimPtr(&in.Provider)
	trimPtr(&in.Address)
	trimPtr(&in.Phone)
	trimPtr(&in.Notes)

	fieldErrors := FieldErrors{}
	if !validWarrantyTypes[in.Type] {
		fieldErrors["type"] = []string{i18n.Text(ctx, "Loại bảo hành không hợp lệ")}
	}
	if in.StartDate == "" {
		fieldErrors["startDate"] = []string{i18n.Text(ctx, "Ngày bắt đầu bắt buộc")}
	}
	if in.Months < 1 {
		fieldErrors["months"] = []string{i18n.Text(ctx, "Số tháng bảo hành >= 1")}
	}
	if in.Cost != nil && *in.Cost < 0 {
		fieldErrors["cost"] = []string{i18n.Text(ctx, "Chi phí không hợp lệ")}
	}
	if len(fieldErrors) > 0 {
		// ErrValidationHeadline, not ErrValidation: this validator has translated
		// its fieldErrors, so the envelope headline has to move with them or the
		// response is half English and half Vietnamese (see the doc comments in
		// services/errors.go).
		return ErrValidationHeadline(fieldErrors)
	}
	return nil
}

// ListWarrantiesByDevice fetches warranties for a device after verifying
// device ownership. Mirrors the TS detail page side-fetch.
func ListWarrantiesByDevice(ctx context.Context, db *pgxpool.Pool, userID, deviceID string) ([]store.Warranty, error) {
	q := store.New(db)
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: deviceID, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return nil, fmt.Errorf("get device: %w", err)
	}
	rows, err := q.ListWarrantiesByDevice(ctx, store.ListWarrantiesByDeviceParams{
		DeviceId: deviceID,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	if rows == nil {
		rows = []store.Warranty{}
	}
	return rows, nil
}

// GetWarranty fetches a single warranty with the ownership chain.
func GetWarranty(ctx context.Context, db *pgxpool.Pool, userID, warrantyID string) (store.Warranty, error) {
	q := store.New(db)
	row, err := q.GetWarrantyByID(ctx, store.GetWarrantyByIDParams{
		ID:     warrantyID,
		UserId: userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Warranty{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói bảo hành"))
		}
		return store.Warranty{}, fmt.Errorf("get warranty: %w", err)
	}
	return row, nil
}

// CreateWarranty mirrors website/src/lib/services/warranties.ts::createWarranty.
func CreateWarranty(ctx context.Context, db *pgxpool.Pool, userID, deviceID string, in WarrantyInput) (store.Warranty, error) {
	if err := ValidateWarrantyInput(ctx, &in); err != nil {
		return store.Warranty{}, err
	}
	q := store.New(db)
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: deviceID, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Warranty{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy thiết bị"))
		}
		return store.Warranty{}, fmt.Errorf("get device: %w", err)
	}
	count, err := q.CountWarrantiesByDevice(ctx, deviceID)
	if err != nil {
		return store.Warranty{}, fmt.Errorf("count warranties: %w", err)
	}
	if count >= MaxWarrantiesPerDevice {
		return store.Warranty{}, ErrLimit(i18n.T(ctx,
			"Mỗi thiết bị tối đa %d gói bảo hành.", MaxWarrantiesPerDevice))
	}

	startDate, err := parseDate(in.StartDate)
	if err != nil {
		return store.Warranty{}, ErrValidationHeadline(FieldErrors{
			"startDate": {i18n.Text(ctx, "Ngày bắt đầu không hợp lệ")},
		})
	}
	endDate := addMonths(startDate, int(in.Months))

	row, err := q.CreateWarranty(ctx, store.CreateWarrantyParams{
		ID:        auth.NewID(),
		DeviceId:  deviceID,
		Type:      in.Type,
		Provider:  in.Provider,
		StartDate: pgtype.Timestamp{Time: startDate, Valid: true},
		EndDate:   pgtype.Timestamp{Time: endDate, Valid: true},
		Months:    in.Months,
		Cost:      in.Cost,
		Address:   in.Address,
		Phone:     in.Phone,
		Notes:     in.Notes,
	})
	if err != nil {
		return store.Warranty{}, fmt.Errorf("create warranty: %w", err)
	}
	return row, nil
}

// UpdateWarranty mirrors website/src/lib/services/warranties.ts::updateWarranty.
// Returns the updated warranty + its parent deviceId so callers can revalidate
// the device detail path.
func UpdateWarranty(ctx context.Context, db *pgxpool.Pool, userID, warrantyID string, in WarrantyInput) (store.Warranty, error) {
	if err := ValidateWarrantyInput(ctx, &in); err != nil {
		return store.Warranty{}, err
	}
	q := store.New(db)

	startDate, err := parseDate(in.StartDate)
	if err != nil {
		return store.Warranty{}, ErrValidationHeadline(FieldErrors{
			"startDate": {i18n.Text(ctx, "Ngày bắt đầu không hợp lệ")},
		})
	}
	endDate := addMonths(startDate, int(in.Months))

	row, err := q.UpdateWarranty(ctx, store.UpdateWarrantyParams{
		ID:        warrantyID,
		UserId:    userID,
		Type:      in.Type,
		Provider:  in.Provider,
		StartDate: pgtype.Timestamp{Time: startDate, Valid: true},
		EndDate:   pgtype.Timestamp{Time: endDate, Valid: true},
		Months:    in.Months,
		Cost:      in.Cost,
		Address:   in.Address,
		Phone:     in.Phone,
		Notes:     in.Notes,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Warranty{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói bảo hành"))
		}
		return store.Warranty{}, fmt.Errorf("update warranty: %w", err)
	}
	return row, nil
}

// DeleteWarranty removes a warranty after enforcing the ownership chain.
func DeleteWarranty(ctx context.Context, db *pgxpool.Pool, userID, warrantyID string) error {
	q := store.New(db)
	rows, err := q.DeleteWarranty(ctx, store.DeleteWarrantyParams{
		ID:     warrantyID,
		UserId: userID,
	})
	if err != nil {
		return fmt.Errorf("delete warranty: %w", err)
	}
	if rows == 0 {
		return ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói bảo hành"))
	}
	return nil
}

// DismissReminder mirrors website/src/lib/services/reminders.ts::dismissWarrantyReminder.
// Either flips an existing non-dismissed Reminder row to dismissed, or inserts
// a fresh dismissed row.
func DismissReminder(ctx context.Context, db *pgxpool.Pool, userID, warrantyID string) error {
	q := store.New(db)
	if _, err := q.GetWarrantyByID(ctx, store.GetWarrantyByIDParams{
		ID:     warrantyID,
		UserId: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói bảo hành"))
		}
		return fmt.Errorf("get warranty: %w", err)
	}
	existing, err := q.GetActiveReminderForWarranty(ctx, warrantyID)
	if err == nil {
		if derr := q.DismissReminderByID(ctx, existing.ID); derr != nil {
			return fmt.Errorf("dismiss reminder: %w", derr)
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("get active reminder: %w", err)
	}
	if _, err := q.CreateDismissedReminder(ctx, store.CreateDismissedReminderParams{
		ID:         auth.NewID(),
		WarrantyId: warrantyID,
	}); err != nil {
		return fmt.Errorf("create dismissed reminder: %w", err)
	}
	return nil
}

// RestoreReminder mirrors website/src/lib/services/reminders.ts::restoreWarrantyReminder.
func RestoreReminder(ctx context.Context, db *pgxpool.Pool, userID, warrantyID string) error {
	q := store.New(db)
	if _, err := q.GetWarrantyByID(ctx, store.GetWarrantyByIDParams{
		ID:     warrantyID,
		UserId: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói bảo hành"))
		}
		return fmt.Errorf("get warranty: %w", err)
	}
	if _, err := q.RestoreRemindersForWarranty(ctx, warrantyID); err != nil {
		return fmt.Errorf("restore reminders: %w", err)
	}
	return nil
}
