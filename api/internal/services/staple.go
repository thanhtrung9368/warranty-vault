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

// StapleView is one essential plus its purchase-price summary (migration 0034).
//
// The embedded row is the exact shape the list endpoint returned before the
// summary existed — the four added fields are additive, so an older client that
// ignores them keeps working. The three money fields are pointers because
// "never bought" is JSON null, not 0: a free sample is a legal price, and the
// list must be able to tell the two apart. PurchaseCount is always present and
// 0 when there is no purchase row.
type StapleView struct {
	store.Staple
	LastPrice     *int32 `json:"lastPrice"`
	LowestPrice   *int32 `json:"lowestPrice"`
	AveragePrice  *int32 `json:"averagePrice"`
	PurchaseCount int32  `json:"purchaseCount"`
}

// StaplePurchaseInput is the POST /api/v1/staples/{id}/purchases body.
//
// Price is VND as a whole number (>= 0; a gift is a valid purchase).
// PurchasedAt is a calendar day — the day the user bought it, not the instant
// they typed it — so it can never be moved by a timezone conversion.
type StaplePurchaseInput struct {
	Price       int32   `json:"price"`
	PurchasedAt string  `json:"purchasedAt"` // YYYY-MM-DD
	Store       *string `json:"store,omitempty"`
	Note        *string `json:"note,omitempty"`
}

// StaplePurchaseResult is the POST response: the receipt row plus the staple it
// changed, summary included, so the client does not have to re-read the list.
type StaplePurchaseResult struct {
	Purchase store.CreateStaplePurchaseRow `json:"purchase"`
	Item     StapleView                    `json:"item"`
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

// ValidateStaplePurchaseInput trims and validates the restock receipt. The
// rules are deliberately small: a price in whole đồng (>= 0) and a calendar day.
// Everything else is free text, same as the staple itself.
//
// `price` is an int32, so an absent field reads as 0 and is accepted as a valid
// "free" price — the same shape PriceLogInput has always had. The openapi
// request schema still marks it required, and a client that sends the documented
// body always carries it.
func ValidateStaplePurchaseInput(ctx context.Context, in *StaplePurchaseInput) error {
	in.PurchasedAt = strings.TrimSpace(in.PurchasedAt)
	trimPtr(&in.Store)
	trimPtr(&in.Note)

	fieldErrors := FieldErrors{}
	if in.Price < 0 {
		fieldErrors["price"] = []string{i18n.Text(ctx, "Giá phải ≥ 0")}
	}
	if in.Store != nil && len([]rune(*in.Store)) > 200 {
		fieldErrors["store"] = []string{i18n.Text(ctx, "Cửa hàng tối đa 200 ký tự")}
	}
	if in.Note != nil && len([]rune(*in.Note)) > 500 {
		fieldErrors["note"] = []string{i18n.Text(ctx, "Ghi chú tối đa 500 ký tự")}
	}
	if _, err := parseDate(in.PurchasedAt); err != nil {
		fieldErrors["purchasedAt"] = []string{i18n.Text(ctx, "Ngày không hợp lệ")}
	}
	if len(fieldErrors) > 0 {
		return ErrValidationHeadline(fieldErrors)
	}
	return nil
}

// staplePurchaseSummary reads the four derived numbers for one staple, or nil
// when the item has never been restocked. The grouped query needs a staple that
// the user owns; the join already enforces that, and a foreign id simply comes
// back empty (the caller has done the ownership check by then).
func staplePurchaseSummary(ctx context.Context, q *store.Queries, userID, stapleID string) (*store.ListStaplePurchaseSummariesByUserRow, error) {
	rows, err := q.ListStaplePurchaseSummariesByUser(ctx, store.ListStaplePurchaseSummariesByUserParams{
		UserId:  userID,
		Column2: stapleID,
	})
	if err != nil {
		return nil, fmt.Errorf("staple purchase summary: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return &rows[0], nil
}

// stapleView combines a Staple row with its summary. A nil summary is the
// "no purchase yet" case: money stays null, the count is 0.
func stapleView(row store.Staple, sm *store.ListStaplePurchaseSummariesByUserRow) StapleView {
	v := StapleView{Staple: row}
	if sm == nil {
		return v
	}
	last, lowest, average := sm.LastPrice, sm.LowestPrice, sm.AveragePrice
	v.LastPrice = &last
	v.LowestPrice = &lowest
	v.AveragePrice = &average
	v.PurchaseCount = sm.PurchaseCount
	return v
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

// ListStaples returns the user's essentials, optionally filtered by state, each
// row carrying its purchase-price summary (migration 0034). The store query
// already puts OUT before LOW before ENOUGH.
//
// Two queries, merged here: the list itself and one grouped summary read for
// every staple the user owns. Staples absent from the summary have never been
// restocked, so their money fields stay null and the count is 0.
func ListStaples(ctx context.Context, db *pgxpool.Pool, userID string, state *string) ([]StapleView, error) {
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
	summaries, err := q.ListStaplePurchaseSummariesByUser(ctx, store.ListStaplePurchaseSummariesByUserParams{
		UserId: userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list staple purchase summaries: %w", err)
	}
	byStaple := make(map[string]*store.ListStaplePurchaseSummariesByUserRow, len(summaries))
	for i := range summaries {
		byStaple[summaries[i].StapleId] = &summaries[i]
	}
	items := make([]StapleView, 0, len(rows))
	for _, row := range rows {
		items = append(items, stapleView(row, byStaple[row.ID]))
	}
	return items, nil
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
//
// The response is a StapleView even though a brand-new item cannot have a
// purchase yet: every endpoint that returns a staple uses the same shape (money
// null, count 0), so a client never has to decode two variants of the same
// object.
func CreateStaple(ctx context.Context, db *pgxpool.Pool, userID string, in StapleInput) (StapleView, error) {
	if err := ValidateStapleInput(ctx, &in); err != nil {
		return StapleView{}, err
	}
	last, err := parseStapleDay(in.LastBoughtAt)
	if err != nil {
		return StapleView{}, ErrValidationKeyed(
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
		return StapleView{}, fmt.Errorf("create staple: %w", err)
	}
	return stapleView(row, nil), nil
}

// UpdateStaple replaces the user-editable fields. The app uses the same call
// for ordinary edits and for the two quick transitions:
//   - "sắp hết"  → state=LOW (or OUT)
//   - "đã mua lại" → state=ENOUGH, lastBoughtAt=today
func UpdateStaple(ctx context.Context, db *pgxpool.Pool, userID, id string, in StapleInput) (StapleView, error) {
	if err := ValidateStapleInput(ctx, &in); err != nil {
		return StapleView{}, err
	}
	last, err := parseStapleDay(in.LastBoughtAt)
	if err != nil {
		return StapleView{}, ErrValidationKeyed(
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
			return StapleView{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy đồ dùng"))
		}
		return StapleView{}, fmt.Errorf("update staple: %w", err)
	}
	// The edit itself does not touch purchase history; the summary is read back
	// so the response keeps the same item shape as the list.
	sm, err := staplePurchaseSummary(ctx, q, userID, id)
	if err != nil {
		return StapleView{}, err
	}
	return stapleView(row, sm), nil
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

// ListStaplePurchases returns one staple's restock receipts, newest first.
//
// The ownership check comes first, like every other detail read in this package:
// a staple that belongs to someone else answers 404 rather than an empty list,
// so the endpoint cannot be used to probe for another account's ids. The list
// query also filters on userId, which is the second lock on the same door.
func ListStaplePurchases(ctx context.Context, db *pgxpool.Pool, userID, stapleID string) ([]store.ListStaplePurchasesRow, error) {
	q := store.New(db)
	if _, err := q.GetStapleByID(ctx, store.GetStapleByIDParams{ID: stapleID, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy đồ dùng"))
		}
		return nil, fmt.Errorf("get staple: %w", err)
	}
	rows, err := q.ListStaplePurchases(ctx, store.ListStaplePurchasesParams{
		StapleId: stapleID,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list staple purchases: %w", err)
	}
	if rows == nil {
		rows = []store.ListStaplePurchasesRow{}
	}
	return rows, nil
}

// CreateStaplePurchase records one restock and applies its two side effects in
// the SAME transaction:
//
//  1. insert the receipt (`StaplePurchase`);
//  2. move the staple's `lastBoughtAt` to the later of the stored day and this
//     purchase's day, and set `state` to ENOUGH — the user just bought it.
//
// All of it commits or none of it does: a receipt without the state change (or
// a bumped lastBoughtAt with no receipt) is a lie the next reminder repeats.
//
// The response is the receipt plus the updated staple WITH its summary, so the
// client can render the new "last / lowest / average" without a second GET.
func CreateStaplePurchase(ctx context.Context, db *pgxpool.Pool, userID, stapleID string, in StaplePurchaseInput) (StaplePurchaseResult, error) {
	if err := ValidateStaplePurchaseInput(ctx, &in); err != nil {
		return StaplePurchaseResult{}, err
	}
	purchasedAt, err := parseDate(in.PurchasedAt)
	if err != nil {
		// Unreachable after validation; parseDate is the single definition of
		// what a day is, so keep the same error shape rather than panicking.
		return StaplePurchaseResult{}, ErrValidationKeyed(
			"Ngày không hợp lệ",
			FieldErrors{"purchasedAt": {i18n.Text(ctx, "Ngày không hợp lệ")}},
		)
	}
	day := wire.Date(purchasedAt)

	tx, err := db.Begin(ctx)
	if err != nil {
		return StaplePurchaseResult{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := store.New(tx)

	// Ownership first: an INSERT against a foreign staple must never happen,
	// and a missing id would otherwise surface as a raw FK violation (500)
	// instead of the 404 the contract documents.
	if _, err := q.GetStapleByID(ctx, store.GetStapleByIDParams{ID: stapleID, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return StaplePurchaseResult{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy đồ dùng"))
		}
		return StaplePurchaseResult{}, fmt.Errorf("get staple: %w", err)
	}

	purchase, err := q.CreateStaplePurchase(ctx, store.CreateStaplePurchaseParams{
		ID:          auth.NewID(),
		StapleId:    stapleID,
		UserId:      userID,
		Price:       in.Price,
		PurchasedAt: day,
		Store:       in.Store,
		Note:        in.Note,
	})
	if err != nil {
		return StaplePurchaseResult{}, fmt.Errorf("create staple purchase: %w", err)
	}

	updated, err := q.TouchStapleAfterPurchase(ctx, store.TouchStapleAfterPurchaseParams{
		ID:           stapleID,
		UserId:       userID,
		LastBoughtAt: day,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return StaplePurchaseResult{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy đồ dùng"))
		}
		return StaplePurchaseResult{}, fmt.Errorf("touch staple: %w", err)
	}

	summary, err := staplePurchaseSummary(ctx, q, userID, stapleID)
	if err != nil {
		return StaplePurchaseResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return StaplePurchaseResult{}, fmt.Errorf("commit: %w", err)
	}
	return StaplePurchaseResult{
		Purchase: purchase,
		Item:     stapleView(updated, summary),
	}, nil
}
