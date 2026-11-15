package services

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// Staple is an essential/consumable the user restocks. It deliberately does
// not share the WishlistItem table: buying a shampoo must not create a Device,
// and price history is not the point of a restock list.
//
// `state` is the user's observation. `cadenceDays` is an optional reminder
// interval; it is not derived from stock and the server never flips it on its
// own. The app schedules a local check-in from lastBoughtAt + cadenceDays and
// the user answers "còn đủ" or "sắp hết".
type StapleInput struct {
	Name         string  `json:"name"`
	Category     *string `json:"category,omitempty"`
	Unit         *string `json:"unit,omitempty"`
	CadenceDays  *int32  `json:"cadenceDays,omitempty"`
	LastBoughtAt *string `json:"lastBoughtAt,omitempty"` // YYYY-MM-DD
	State        string  `json:"state,omitempty"`        // default ENOUGH
	Notes        *string `json:"notes,omitempty"`
}

var validStapleStates = map[string]bool{
	"ENOUGH": true,
	"LOW":    true,
	"OUT":    true,
}

// ValidateStapleInput trims and validates the user-editable fields. The
// messages are Vietnamese catalog keys wrapped with i18n.Text so the HTTP edge
// can render them in the request's language, matching the Wishlist validator.
func ValidateStapleInput(ctx context.Context, in *StapleInput) error {
	in.Name = strings.TrimSpace(in.Name)
	trimPtr(&in.Category)
	trimPtr(&in.Unit)
	trimPtr(&in.Notes)
	trimPtr(&in.LastBoughtAt)
	in.State = strings.TrimSpace(in.State)

	fieldErrors := FieldErrors{}
	if in.Name == "" {
		fieldErrors["name"] = []string{i18n.Text(ctx, "Tên đồ dùng bắt buộc")}
	} else if len([]rune(in.Name)) > 200 {
		fieldErrors["name"] = []string{i18n.Text(ctx, "Tên đồ dùng tối đa 200 ký tự")}
	}
	if in.Category != nil && len([]rune(*in.Category)) > 100 {
		fieldErrors["category"] = []string{i18n.Text(ctx, "Nhóm đồ dùng tối đa 100 ký tự")}
	}
	if in.Unit != nil && len([]rune(*in.Unit)) > 30 {
		fieldErrors["unit"] = []string{i18n.Text(ctx, "Đơn vị tối đa 30 ký tự")}
	}
	if in.Notes != nil && len([]rune(*in.Notes)) > 2000 {
		fieldErrors["notes"] = []string{i18n.Text(ctx, "Ghi chú tối đa 2.000 ký tự")}
	}
	if in.CadenceDays != nil {
		if *in.CadenceDays < 1 || *in.CadenceDays > 3650 {
			fieldErrors["cadenceDays"] = []string{i18n.Text(ctx, "Số ngày nhắc không hợp lệ")}
		}
	}
	if in.LastBoughtAt != nil && *in.LastBoughtAt != "" {
		if _, err := parseDate(*in.LastBoughtAt); err != nil {
			fieldErrors["lastBoughtAt"] = []string{i18n.Text(ctx, "Ngày không hợp lệ")}
		}
	}
	if in.State == "" {
		in.State = "ENOUGH"
	} else if !validStapleStates[in.State] {
		fieldErrors["state"] = []string{i18n.Text(ctx, "Trạng thái không hợp lệ")}
	}
	if len(fieldErrors) > 0 {
		return ErrValidationHeadline(fieldErrors)
	}
	return nil
}

// parseStapleDay converts the optional YYYY-MM-DD input to wire.Day. An absent
// or blank value is a NULL day, not "today": a manual item may legitimately
// never have recorded a purchase.
func parseStapleDay(raw *string) (wire.Day, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return wire.Day{}, nil
	}
	t, err := parseDate(*raw)
	if err != nil {
		return wire.Day{}, err
	}
	return wire.Date(t), nil
}

// ListStaples returns the user's essentials, optionally filtered by state.
// The store query already puts OUT before LOW before ENOUGH.
func ListStaples(ctx context.Context, db *pgxpool.Pool, userID string, state *string) ([]store.Staple, error) {
	q := store.New(db)
	filter := ""
	if state != nil {
		filter = strings.TrimSpace(*state)
		if filter != "" && !validStapleStates[filter] {
			return nil, ErrValidationKeyed(
				"Trạng thái không hợp lệ",
				FieldErrors{"state": {i18n.Text(ctx, "Trạng thái không hợp lệ")}},
			)
		}
	}
	rows, err := q.ListStaplesByUser(ctx, store.ListStaplesByUserParams{
		UserId:  userID,
		Column2: filter,
	})
	if err != nil {
		return nil, fmt.Errorf("list staples: %w", err)
	}
	if rows == nil {
		rows = []store.Staple{}
	}
	return rows, nil
}

// GetStaple returns one essential owned by the user.
func GetStaple(ctx context.Context, db *pgxpool.Pool, userID, id string) (store.Staple, error) {
	q := store.New(db)
	row, err := q.GetStapleByID(ctx, store.GetStapleByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Staple{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy đồ dùng"))
		}
		return store.Staple{}, fmt.Errorf("get staple: %w", err)
	}
	return row, nil
}

// CreateStaple creates one essential. State defaults to ENOUGH; the optional
// cadence is a reminder interval only.
func CreateStaple(ctx context.Context, db *pgxpool.Pool, userID string, in StapleInput) (store.Staple, error) {
	if err := ValidateStapleInput(ctx, &in); err != nil {
		return store.Staple{}, err
	}
	last, err := parseStapleDay(in.LastBoughtAt)
	if err != nil {
		return store.Staple{}, ErrValidationKeyed(
			"Ngày không hợp lệ",
			FieldErrors{"lastBoughtAt": {i18n.Text(ctx, "Ngày không hợp lệ")}},
		)
	}
	q := store.New(db)
	row, err := q.CreateStaple(ctx, store.CreateStapleParams{
		ID:           auth.NewID(),
		UserId:       userID,
		Name:         in.Name,
		Category:     in.Category,
		Unit:         in.Unit,
		CadenceDays:  in.CadenceDays,
		LastBoughtAt: last,
		State:        in.State,
		Notes:        in.Notes,
	})
	if err != nil {
		return store.Staple{}, fmt.Errorf("create staple: %w", err)
	}
	return row, nil
}

// UpdateStaple replaces the user-editable fields. The app uses the same call
// for ordinary edits and for the two quick transitions:
//   - "sắp hết"  → state=LOW (or OUT)
//   - "đã mua lại" → state=ENOUGH, lastBoughtAt=today
func UpdateStaple(ctx context.Context, db *pgxpool.Pool, userID, id string, in StapleInput) (store.Staple, error) {
	if err := ValidateStapleInput(ctx, &in); err != nil {
		return store.Staple{}, err
	}
	last, err := parseStapleDay(in.LastBoughtAt)
	if err != nil {
		return store.Staple{}, ErrValidationKeyed(
			"Ngày không hợp lệ",
			FieldErrors{"lastBoughtAt": {i18n.Text(ctx, "Ngày không hợp lệ")}},
		)
	}
	q := store.New(db)
	row, err := q.UpdateStaple(ctx, store.UpdateStapleParams{
		ID:           id,
		UserId:       userID,
		Name:         in.Name,
		Category:     in.Category,
		Unit:         in.Unit,
		CadenceDays:  in.CadenceDays,
		LastBoughtAt: last,
		State:        in.State,
		Notes:        in.Notes,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Staple{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy đồ dùng"))
		}
		return store.Staple{}, fmt.Errorf("update staple: %w", err)
	}
	return row, nil
}

// DeleteStaple removes one essential owned by the user.
func DeleteStaple(ctx context.Context, db *pgxpool.Pool, userID, id string) error {
	q := store.New(db)
	n, err := q.DeleteStaple(ctx, store.DeleteStapleParams{ID: id, UserId: userID})
	if err != nil {
		return fmt.Errorf("delete staple: %w", err)
	}
	if n == 0 {
		return ErrNotFound(i18n.Text(ctx, "Không tìm thấy đồ dùng"))
	}
	return nil
}
