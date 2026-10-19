package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// MaxWarrantiesPerDevice mirrors website/src/lib/services/warranties.ts.
const MaxWarrantiesPerDevice = 5

// String bounds for the contract terms (migration 0017). These are RUNE counts,
// matching every other user-typed cap in this service (subscription name,
// wishlist note): a Vietnamese character is one character to the user even
// though it is several bytes.
//
//   - component / region are names — "Động cơ", "Việt Nam" — and 200 runes is
//     already far more than a name needs while still bounding a pasted document.
//   - scope / exclusions are the contract's prose. 500 runes is a solid
//     paragraph (roughly 8–12 lines on a phone). The point of the feature is to
//     carry the sentence that decides a claim, NOT to become a document store:
//     a scanned contract belongs in an attachment, and an unbounded text column
//     would make every warranty read carry a document-sized payload.
const (
	MaxWarrantyComponentRunes  = 200
	MaxWarrantyRegionRunes     = 200
	MaxWarrantyScopeRunes      = 500
	MaxWarrantyExclusionsRunes = 500
)

var validWarrantyTypes = map[string]bool{
	"STANDARD":    true,
	"EXTENDED":    true,
	"THIRD_PARTY": true,
}

// WarrantyInput mirrors website/src/lib/services/warranties.ts::warrantyInputSchema.
//
// The nine fields below are the contract terms added by migration 0017. They are
// deliberately independent of Type: a THIRD_PARTY plan can carry a cap and a
// STANDARD plan can carry exclusions. Nothing in this file infers one from the
// other, and there is a test pinning that.
//
// ClaimsUsed is a POINTER only to distinguish "the client sent 0" from "an older
// client does not know this field exists". On create nil means 0 (the column's
// default); on update nil means "keep the stored counter" and an explicit 0
// resets it. Without that, a client that predates this feature would silently
// wipe a claim count a newer client recorded — exactly the kind of data loss the
// additive-field convention elsewhere in this repo exists to prevent. The other
// eight fields follow the existing WarrantyInput convention: omitted/null clears.
type WarrantyInput struct {
	Type      string  `json:"type"`
	Provider  *string `json:"provider,omitempty"`
	StartDate string  `json:"startDate"`
	// EndDate is optional. When sent, the server stores that exact date (after
	// checking it is not before StartDate); when absent/null it derives
	// startDate + months, which is what every pre-existing client gets. The field
	// exists because `Warranty.endDate` is returned on every read, so a client
	// doing a read-modify-write with a full Warranty object would otherwise be
	// rejected by the strict JSON decoder even though the field is part of the
	// documented Warranty shape. See openapi.yaml's WarrantyInput.
	EndDate *string `json:"endDate,omitempty"`
	Months  int32   `json:"months"`
	Cost    *int32  `json:"cost,omitempty"`
	Address *string `json:"address,omitempty"`
	Phone   *string `json:"phone,omitempty"`
	Notes   *string `json:"notes,omitempty"`

	// Contract terms (migration 0017). See the type doc comment and the
	// openapi.yaml descriptions for the exact rules.
	Component     *string `json:"component,omitempty"`
	Scope         *string `json:"scope,omitempty"`
	Cap           *int32  `json:"cap,omitempty"`
	Deductible    *int32  `json:"deductible,omitempty"`
	Exclusions    *string `json:"exclusions,omitempty"`
	Region        *string `json:"region,omitempty"`
	Transferable  *bool   `json:"transferable,omitempty"`
	ClaimsAllowed *int32  `json:"claimsAllowed,omitempty"`
	ClaimsUsed    *int32  `json:"claimsUsed,omitempty"`
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
//
// # Contract terms (migration 0017)
//
// The nine fields are validated here and nowhere else — no DB CHECK, because a
// bad request must be a 400 with the offending field named, not a 500 from a
// constraint. The rules are intentionally narrow:
//
//   - cap / deductible / claimsUsed / claimsAllowed are non-negative;
//   - claimsUsed > claimsAllowed is a field error on claimsUsed, and only when
//     BOTH are set; claimsAllowed == nil means "no allowance recorded", so any
//     claimsUsed is accepted;
//   - component/region ≤ 200 runes and scope/exclusions ≤ 500 runes.
//
// There is NO rule that ties any of them to Type. Do not add one: real plans
// violate the intuition (a THIRD_PARTY plan can have a cap, a STANDARD plan can
// have exclusions), and an inferred value would be shown to a user who is about
// to make a claim.
//
// storedClaimsUsed is the fallback used when in.ClaimsUsed is nil. Create passes
// 0 (the column default); update passes the row's current counter after it has
// been read, so the pair check runs against the state the write will produce.
func ValidateWarrantyInput(ctx context.Context, in *WarrantyInput) error {
	return validateWarrantyInput(ctx, in, 0)
}

func validateWarrantyInput(ctx context.Context, in *WarrantyInput, storedClaimsUsed int32) error {
	in.Type = strings.TrimSpace(in.Type)
	in.StartDate = strings.TrimSpace(in.StartDate)
	trimPtr(&in.EndDate)
	trimPtr(&in.Provider)
	trimPtr(&in.Address)
	trimPtr(&in.Phone)
	trimPtr(&in.Notes)
	trimPtr(&in.Component)
	trimPtr(&in.Scope)
	trimPtr(&in.Exclusions)
	trimPtr(&in.Region)

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

	// Contract terms. Each refusal names its own field; the negative-value
	// sentence is shared because the field key already says which number is
	// wrong.
	if in.Cap != nil && *in.Cap < 0 {
		fieldErrors["cap"] = []string{i18n.Text(ctx, "Giá trị không được âm")}
	}
	if in.Deductible != nil && *in.Deductible < 0 {
		fieldErrors["deductible"] = []string{i18n.Text(ctx, "Giá trị không được âm")}
	}
	if in.ClaimsAllowed != nil && *in.ClaimsAllowed < 0 {
		fieldErrors["claimsAllowed"] = []string{i18n.Text(ctx, "Giá trị không được âm")}
	}
	claimsUsed := storedClaimsUsed
	if in.ClaimsUsed != nil {
		claimsUsed = *in.ClaimsUsed
		if claimsUsed < 0 {
			fieldErrors["claimsUsed"] = []string{i18n.Text(ctx, "Giá trị không được âm")}
		}
	}
	// The cross-field rule. "A contract cannot be over-used" is the whole point
	// of carrying the counter, so it is enforced on the state the row will have,
	// not on what the client happened to include in this request. claimsAllowed
	// nil means no recorded allowance → no ceiling. Both operands must be valid
	// (non-negative) first: comparing against a negative allowance would add a
	// spurious claimsUsed error next to the claimsAllowed one that actually
	// explains the request.
	if in.ClaimsAllowed != nil && *in.ClaimsAllowed >= 0 && claimsUsed >= 0 &&
		claimsUsed > *in.ClaimsAllowed {
		fieldErrors["claimsUsed"] = []string{
			i18n.Text(ctx, "Số lần đã dùng không được vượt quá số lần được phép"),
		}
	}
	if in.Component != nil && len([]rune(*in.Component)) > MaxWarrantyComponentRunes {
		fieldErrors["component"] = []string{i18n.T(ctx,
			"Bộ phận được bảo hành tối đa %d ký tự", MaxWarrantyComponentRunes)}
	}
	if in.Region != nil && len([]rune(*in.Region)) > MaxWarrantyRegionRunes {
		fieldErrors["region"] = []string{i18n.T(ctx,
			"Khu vực áp dụng tối đa %d ký tự", MaxWarrantyRegionRunes)}
	}
	if in.Scope != nil && len([]rune(*in.Scope)) > MaxWarrantyScopeRunes {
		fieldErrors["scope"] = []string{i18n.T(ctx,
			"Phạm vi bảo hành tối đa %d ký tự", MaxWarrantyScopeRunes)}
	}
	if in.Exclusions != nil && len([]rune(*in.Exclusions)) > MaxWarrantyExclusionsRunes {
		fieldErrors["exclusions"] = []string{i18n.T(ctx,
			"Nội dung loại trừ tối đa %d ký tự", MaxWarrantyExclusionsRunes)}
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

// warrantyEndDate resolves the end date a write stores. An explicit in.EndDate
// wins (the contract lets a policy end on a date that is not exactly
// startDate + months); when the client omits it, the historical derivation is
// used unchanged, so every client written before the field existed is
// byte-identical on the wire.
//
// The two failure modes are field errors, not a silent fallback: an unparseable
// date and an end before the start are both about endDate, and a handler that
// swallowed either would store a warranty whose dates contradict the request.
func warrantyEndDate(ctx context.Context, in WarrantyInput, startDate time.Time) (time.Time, error) {
	if in.EndDate == nil {
		return addMonths(startDate, int(in.Months)), nil
	}
	endDate, err := parseDate(*in.EndDate)
	if err != nil {
		return time.Time{}, ErrValidationHeadline(FieldErrors{
			"endDate": {i18n.Text(ctx, "Ngày kết thúc không hợp lệ")},
		})
	}
	if endDate.Before(startDate) {
		return time.Time{}, ErrValidationHeadline(FieldErrors{
			"endDate": {i18n.Text(ctx, "Ngày kết thúc không được trước ngày bắt đầu")},
		})
	}
	return endDate, nil
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
	endDate, err := warrantyEndDate(ctx, in, startDate)
	if err != nil {
		return store.Warranty{}, err
	}

	row, err := q.CreateWarranty(ctx, store.CreateWarrantyParams{
		ID:            auth.NewID(),
		DeviceId:      deviceID,
		Type:          in.Type,
		Provider:      in.Provider,
		StartDate:     pgtype.Timestamp{Time: startDate, Valid: true},
		EndDate:       pgtype.Timestamp{Time: endDate, Valid: true},
		Months:        in.Months,
		Cost:          in.Cost,
		Address:       in.Address,
		Phone:         in.Phone,
		Notes:         in.Notes,
		Component:     in.Component,
		Scope:         in.Scope,
		Cap:           in.Cap,
		Deductible:    in.Deductible,
		Exclusions:    in.Exclusions,
		Region:        in.Region,
		Transferable:  in.Transferable,
		ClaimsAllowed: in.ClaimsAllowed,
		// nil = the column's DEFAULT 0. ValidateWarrantyInput already rejected a
		// negative value; this is the create half of the pointer convention.
		ClaimsUsed: claimsUsedValue(in.ClaimsUsed),
	})
	if err != nil {
		return store.Warranty{}, fmt.Errorf("create warranty: %w", err)
	}
	return row, nil
}

// UpdateWarranty mirrors website/src/lib/services/warranties.ts::updateWarranty.
// Returns the updated warranty + its parent deviceId so callers can revalidate
// the device detail path.
//
// claimsUsed is the one additive field with "omitted means keep" semantics (see
// WarrantyInput). The row is read first so the counter and the cross-field rule
// are evaluated against what the write will actually produce: a client that
// sends only `claimsAllowed: 1` while the stored counter is 2 gets a 400 on
// `claimsUsed`, not a silently impossible contract.
func UpdateWarranty(ctx context.Context, db *pgxpool.Pool, userID, warrantyID string, in WarrantyInput) (store.Warranty, error) {
	if err := ValidateWarrantyInput(ctx, &in); err != nil {
		return store.Warranty{}, err
	}
	q := store.New(db)

	current, err := q.GetWarrantyByID(ctx, store.GetWarrantyByIDParams{
		ID:     warrantyID,
		UserId: userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Warranty{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói bảo hành"))
		}
		return store.Warranty{}, fmt.Errorf("get warranty: %w", err)
	}
	if in.ClaimsUsed == nil {
		// The request omits the counter, so the pair rule must use the stored
		// one. The first validation pass used 0 as the fallback (the create
		// default), which cannot catch "stored 2, requested allowance 1".
		if err := validateWarrantyInput(ctx, &in, current.ClaimsUsed); err != nil {
			return store.Warranty{}, err
		}
		used := current.ClaimsUsed
		in.ClaimsUsed = &used
	}

	startDate, err := parseDate(in.StartDate)
	if err != nil {
		return store.Warranty{}, ErrValidationHeadline(FieldErrors{
			"startDate": {i18n.Text(ctx, "Ngày bắt đầu không hợp lệ")},
		})
	}
	endDate, err := warrantyEndDate(ctx, in, startDate)
	if err != nil {
		return store.Warranty{}, err
	}

	row, err := q.UpdateWarranty(ctx, store.UpdateWarrantyParams{
		ID:            warrantyID,
		UserId:        userID,
		Type:          in.Type,
		Provider:      in.Provider,
		StartDate:     pgtype.Timestamp{Time: startDate, Valid: true},
		EndDate:       pgtype.Timestamp{Time: endDate, Valid: true},
		Months:        in.Months,
		Cost:          in.Cost,
		Address:       in.Address,
		Phone:         in.Phone,
		Notes:         in.Notes,
		Component:     in.Component,
		Scope:         in.Scope,
		Cap:           in.Cap,
		Deductible:    in.Deductible,
		Exclusions:    in.Exclusions,
		Region:        in.Region,
		Transferable:  in.Transferable,
		ClaimsAllowed: in.ClaimsAllowed,
		ClaimsUsed:    claimsUsedValue(in.ClaimsUsed),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Warranty{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy gói bảo hành"))
		}
		return store.Warranty{}, fmt.Errorf("update warranty: %w", err)
	}
	return row, nil
}

// claimsUsedValue turns the optional counter into the column value. nil is 0 by
// the time this is called on the create path (the column default) and has been
// resolved to the stored counter on the update path.
func claimsUsedValue(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
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
