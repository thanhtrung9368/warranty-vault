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

// MaxWishlistPerUser mirrors website/src/lib/services/wishlist.ts::MAX_WISHLIST_PER_USER.
const MaxWishlistPerUser = 200

// wishlistCategoryMessage is the wishlist-flavoured spelling of
// ErrCategoryInvalidMessage ("Loại SẢN PHẨM", not "Loại THIẾT BỊ"): a wishlist
// item is something the user wants to buy, so the device wording would be wrong.
// It is the headline AND the `category` field error of the same failure, which is
// why it is a constant — a key must reach `i18n.Text` as DATA.
const wishlistCategoryMessage = "Loại sản phẩm không hợp lệ"

// wishlistLimitMessage is the wishlist ceiling. ONE key, unlike the
// subscription ceiling: MaxWishlistPerUser is 200 and no argument from the user's
// data reaches the sentence, so "1 item" cannot occur — and a singular key that
// nothing can produce would be dead weight in the catalog rather than safety.
const wishlistLimitMessage = "Đã đạt giới hạn %d món. Xoá bớt rồi thử lại."

// validWishlistPriorities mirrors website/src/lib/wishlist-types.ts::WISHLIST_PRIORITIES.
var validWishlistPriorities = map[string]bool{
	"MUST":  true,
	"WANT":  true,
	"MAYBE": true,
}

// validWishlistStatuses mirrors website/src/lib/wishlist-types.ts::WISHLIST_STATUSES.
var validWishlistStatuses = map[string]bool{
	"WATCHING":  true,
	"DECIDED":   true,
	"SKIPPED":   true,
	"PURCHASED": true,
}

// WishlistInput mirrors website/src/lib/services/wishlist.ts::wishlistInputSchema.
// Optional ints/strings are pointers. Empty/blank strings are normalized to nil.
type WishlistInput struct {
	Name                 string  `json:"name"`
	Category             *string `json:"category,omitempty"`
	Brand                *string `json:"brand,omitempty"`
	InitialPrice         *int32  `json:"initialPrice,omitempty"`
	CurrentPrice         *int32  `json:"currentPrice,omitempty"`
	BuyUrl               *string `json:"buyUrl,omitempty"`
	ImageUrl             *string `json:"imageUrl,omitempty"`
	TargetDate           *string `json:"targetDate,omitempty"` // YYYY-MM-DD or RFC3339
	Priority             string  `json:"priority,omitempty"`   // default WANT
	Status               string  `json:"status,omitempty"`     // default WATCHING
	Notes                *string `json:"notes,omitempty"`
	ReminderIntervalDays *int32  `json:"reminderIntervalDays,omitempty"`
}

// PriceLogInput mirrors website/src/lib/services/wishlist.ts::priceLogInputSchema.
type PriceLogInput struct {
	Price int32   `json:"price"`
	Note  *string `json:"note,omitempty"`
}

// WishlistDetail bundles a wishlist item with its price-history rows.
// Mirrors getWishlistItem in TS (which returns { item, prices }).
type WishlistDetail struct {
	Item   store.WishlistItem    `json:"item"`
	Prices []store.WishlistPrice `json:"prices"`
}

// ValidateWishlistInput hand-rolls the same validation as the Zod schema.
//
// i18n (docs/I18N_PLAN.md §3, Phase 1 wave 2): every message is the EXISTING
// Vietnamese literal wrapped in `i18n.Text(ctx, …)`, and the headline is
// ErrValidationHeadline so it moves with the field errors. See
// ValidateDeviceInput for the same pattern.
//
// `name`/`initialPrice`/`currentPrice` are checked from the SAME field-error map
// as the subscription validator, which is why the shared spellings
// ("Giá không hợp lệ", "Giá phải ≥ 0", "Trạng thái không hợp lệ") are keyed by
// their Vietnamese text rather than by a per-domain id: one entry serves every
// domain that says the same thing.
func ValidateWishlistInput(ctx context.Context, in *WishlistInput) error {
	in.Name = strings.TrimSpace(in.Name)
	trimPtr(&in.Category)
	trimPtr(&in.Brand)
	trimPtr(&in.BuyUrl)
	trimPtr(&in.ImageUrl)
	trimPtr(&in.Notes)
	trimPtr(&in.TargetDate)
	in.Priority = strings.TrimSpace(in.Priority)
	in.Status = strings.TrimSpace(in.Status)

	fieldErrors := FieldErrors{}
	if in.Name == "" {
		fieldErrors["name"] = []string{i18n.Text(ctx, "Tên sản phẩm bắt buộc")}
	} else if len([]rune(in.Name)) > 200 {
		fieldErrors["name"] = []string{i18n.Text(ctx, "Tên sản phẩm tối đa 200 ký tự")}
	}
	if in.InitialPrice != nil && *in.InitialPrice < 0 {
		fieldErrors["initialPrice"] = []string{i18n.Text(ctx, "Giá không hợp lệ")}
	}
	if in.CurrentPrice != nil && *in.CurrentPrice < 0 {
		fieldErrors["currentPrice"] = []string{i18n.Text(ctx, "Giá không hợp lệ")}
	}
	if in.ReminderIntervalDays != nil {
		v := *in.ReminderIntervalDays
		if v < 1 || v > 3650 {
			fieldErrors["reminderIntervalDays"] = []string{i18n.Text(ctx, "Số ngày nhắc không hợp lệ")}
		}
	}
	if in.BuyUrl != nil && !looksLikeURL(*in.BuyUrl) {
		fieldErrors["buyUrl"] = []string{i18n.Text(ctx, "URL không hợp lệ")}
	}
	if in.ImageUrl != nil && !looksLikeURL(*in.ImageUrl) {
		fieldErrors["imageUrl"] = []string{i18n.Text(ctx, "URL không hợp lệ")}
	}
	if in.Priority == "" {
		in.Priority = "WANT"
	} else if !validWishlistPriorities[in.Priority] {
		fieldErrors["priority"] = []string{i18n.Text(ctx, "Mức ưu tiên không hợp lệ")}
	}
	if in.Status == "" {
		in.Status = "WATCHING"
	} else if !validWishlistStatuses[in.Status] {
		fieldErrors["status"] = []string{i18n.Text(ctx, "Trạng thái không hợp lệ")}
	}
	if len(fieldErrors) > 0 {
		return ErrValidationHeadline(fieldErrors)
	}
	return nil
}

func looksLikeURL(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

// ListWishlist returns all wishlist items for the user, optionally filtered
// by status. Mirrors GET /api/v1/wishlist + the optional ?status= filter.
func ListWishlist(ctx context.Context, db *pgxpool.Pool, userID string, status *string) ([]store.WishlistItem, error) {
	q := store.New(db)
	st := ""
	if status != nil {
		st = strings.TrimSpace(*status)
		if st != "" && !validWishlistStatuses[st] {
			// Single-field failure: the sentence IS the whole story, so the
			// envelope headline names it instead of saying "invalid input"
			// (ErrValidationKeyed). Mirrors the `status` filter on
			// GET /api/v1/subscriptions.
			return nil, ErrValidationKeyed(
				"Trạng thái không hợp lệ",
				FieldErrors{"status": {i18n.Text(ctx, "Trạng thái không hợp lệ")}},
			)
		}
	}
	rows, err := q.ListWishlistByUser(ctx, store.ListWishlistByUserParams{
		UserId:  userID,
		Column2: st,
	})
	if err != nil {
		return nil, fmt.Errorf("list wishlist: %w", err)
	}
	if rows == nil {
		rows = []store.WishlistItem{}
	}
	return rows, nil
}

// GetWishlist mirrors website/src/lib/services/wishlist.ts::getWishlistItem.
func GetWishlist(ctx context.Context, db *pgxpool.Pool, userID, id string) (*WishlistDetail, error) {
	q := store.New(db)
	item, err := q.GetWishlistByID(ctx, store.GetWishlistByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound(i18n.Text(ctx, "Không tìm thấy món"))
		}
		return nil, fmt.Errorf("get wishlist: %w", err)
	}
	prices, err := q.ListWishlistPricesByItem(ctx, store.ListWishlistPricesByItemParams{
		ItemId: id,
		UserId: userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list wishlist prices: %w", err)
	}
	if prices == nil {
		prices = []store.WishlistPrice{}
	}
	return &WishlistDetail{Item: item, Prices: prices}, nil
}

// CreateWishlist mirrors website/src/lib/services/wishlist.ts::createWishlistItem.
// Wrapped in a transaction because we also seed the first WishlistPrice row
// (currentPrice ?? initialPrice) when a starting price is supplied.
func CreateWishlist(ctx context.Context, db *pgxpool.Pool, userID string, in WishlistInput) (store.WishlistItem, error) {
	if err := ValidateWishlistInput(ctx, &in); err != nil {
		return store.WishlistItem{}, err
	}
	if in.Category != nil {
		if err := assertCategoryExists(ctx, store.New(db), *in.Category); err != nil {
			// Domain-translate to wishlist-flavored message.
			if de, ok := As(err); ok && de.Code == "CATEGORY_INVALID" {
				// The wishlist spellings of ErrCategoryInvalid: same error code
				// and shape, "sản phẩm" instead of "thiết bị". Both the headline
				// and the field error are rendered HERE rather than by the
				// constructor, because the map holds finished strings and this is
				// the frame that has the request context.
				return store.WishlistItem{}, &Error{
					Code:        "CATEGORY_INVALID",
					Message:     i18n.Text(ctx, wishlistCategoryMessage),
					MessageKey:  wishlistCategoryMessage,
					FieldErrors: FieldErrors{"category": {i18n.Text(ctx, wishlistCategoryMessage)}},
				}
			}
			return store.WishlistItem{}, err
		}
	}

	q := store.New(db)
	count, err := q.CountWishlistByUser(ctx, userID)
	if err != nil {
		return store.WishlistItem{}, fmt.Errorf("count wishlist: %w", err)
	}
	if count >= MaxWishlistPerUser {
		return store.WishlistItem{}, ErrLimit(
			i18n.T(ctx, wishlistLimitMessage, MaxWishlistPerUser))
	}

	var targetTS pgtype.Timestamp
	if in.TargetDate != nil {
		t, err := parseDate(*in.TargetDate)
		if err != nil {
			return store.WishlistItem{}, ErrValidationKeyed(
				"Ngày không hợp lệ",
				FieldErrors{"targetDate": {i18n.Text(ctx, "Ngày không hợp lệ")}},
			)
		}
		targetTS = pgtype.Timestamp{Time: t, Valid: true}
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return store.WishlistItem{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tq := q.WithTx(tx)

	priority := in.Priority
	status := in.Status

	created, err := tq.CreateWishlist(ctx, store.CreateWishlistParams{
		ID:                   auth.NewID(),
		UserId:               userID,
		Name:                 in.Name,
		Category:             in.Category,
		Brand:                in.Brand,
		InitialPrice:         in.InitialPrice,
		CurrentPrice:         in.CurrentPrice,
		BuyUrl:               in.BuyUrl,
		ImageUrl:             in.ImageUrl,
		TargetDate:           targetTS,
		Notes:                in.Notes,
		ReminderIntervalDays: in.ReminderIntervalDays,
		Priority:             &priority,
		Status:               &status,
	})
	if err != nil {
		return store.WishlistItem{}, fmt.Errorf("create wishlist: %w", err)
	}

	// Seed price history with currentPrice or fallback to initialPrice — mirror
	// the TS `prices: { create: [...] }` nested write.
	var seed *int32
	if in.CurrentPrice != nil {
		seed = in.CurrentPrice
	} else if in.InitialPrice != nil {
		seed = in.InitialPrice
	}
	if seed != nil {
		if _, err := tq.CreateWishlistPrice(ctx, store.CreateWishlistPriceParams{
			ID:     auth.NewID(),
			ItemId: created.ID,
			Price:  *seed,
			Note:   nil,
		}); err != nil {
			return store.WishlistItem{}, fmt.Errorf("seed wishlist price: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return store.WishlistItem{}, fmt.Errorf("commit: %w", err)
	}
	return created, nil
}

// UpdateWishlist mirrors website/src/lib/services/wishlist.ts::updateWishlistItem
// PLUS the status-transition side effect:
//   - WATCHING|DECIDED|SKIPPED → PURCHASED creates a new Device row from the
//     wishlist item's mappable fields, and the wishlist row's purchasedDeviceId
//     gets set, all inside the same pgx.Tx.
//   - Other transitions are plain field updates.
//   - If currentPrice changes, a new WishlistPrice row is appended (matches TS).
func UpdateWishlist(ctx context.Context, db *pgxpool.Pool, userID, id string, in WishlistInput) (store.WishlistItem, error) {
	if err := ValidateWishlistInput(ctx, &in); err != nil {
		return store.WishlistItem{}, err
	}
	if in.Category != nil {
		if err := assertCategoryExists(ctx, store.New(db), *in.Category); err != nil {
			if de, ok := As(err); ok && de.Code == "CATEGORY_INVALID" {
				// The wishlist spellings of ErrCategoryInvalid: same error code
				// and shape, "sản phẩm" instead of "thiết bị". Both the headline
				// and the field error are rendered HERE rather than by the
				// constructor, because the map holds finished strings and this is
				// the frame that has the request context.
				return store.WishlistItem{}, &Error{
					Code:        "CATEGORY_INVALID",
					Message:     i18n.Text(ctx, wishlistCategoryMessage),
					MessageKey:  wishlistCategoryMessage,
					FieldErrors: FieldErrors{"category": {i18n.Text(ctx, wishlistCategoryMessage)}},
				}
			}
			return store.WishlistItem{}, err
		}
	}

	q := store.New(db)
	owned, err := q.GetWishlistByID(ctx, store.GetWishlistByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.WishlistItem{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy món"))
		}
		return store.WishlistItem{}, fmt.Errorf("get wishlist: %w", err)
	}

	var targetTS pgtype.Timestamp
	if in.TargetDate != nil {
		t, perr := parseDate(*in.TargetDate)
		if perr != nil {
			return store.WishlistItem{}, ErrValidationKeyed(
				"Ngày không hợp lệ",
				FieldErrors{"targetDate": {i18n.Text(ctx, "Ngày không hợp lệ")}},
			)
		}
		targetTS = pgtype.Timestamp{Time: t, Valid: true}
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return store.WishlistItem{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tq := q.WithTx(tx)

	updated, err := tq.UpdateWishlist(ctx, store.UpdateWishlistParams{
		ID:                   id,
		UserId:               userID,
		Name:                 in.Name,
		Category:             in.Category,
		Brand:                in.Brand,
		InitialPrice:         in.InitialPrice,
		CurrentPrice:         in.CurrentPrice,
		BuyUrl:               in.BuyUrl,
		ImageUrl:             in.ImageUrl,
		TargetDate:           targetTS,
		Priority:             in.Priority,
		Status:               in.Status,
		Notes:                in.Notes,
		ReminderIntervalDays: in.ReminderIntervalDays,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.WishlistItem{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy món"))
		}
		return store.WishlistItem{}, fmt.Errorf("update wishlist: %w", err)
	}

	// Append a price-history row if currentPrice changed.
	if in.CurrentPrice != nil && !int32PtrEq(in.CurrentPrice, owned.CurrentPrice) {
		if _, perr := tq.CreateWishlistPrice(ctx, store.CreateWishlistPriceParams{
			ID:     auth.NewID(),
			ItemId: id,
			Price:  *in.CurrentPrice,
			Note:   nil,
		}); perr != nil {
			return store.WishlistItem{}, fmt.Errorf("log wishlist price: %w", perr)
		}
	}

	// Status transition → PURCHASED: spawn a Device row + back-link.
	transitioningToPurchased := in.Status == "PURCHASED" && owned.Status != "PURCHASED"
	if transitioningToPurchased {
		// Device ceiling (FEATURE_IDEAS #14). This is a THIRD write path into
		// "Device" (the others are CreateDevice and the backup import) and it used
		// to bypass the quota entirely — which, now that sold devices are free,
		// would also be a way around the 500-row storage backstop: create a
		// wishlist item, mark it PURCHASED, repeat. Checked here, before the insert,
		// so a refused transition leaves the item exactly as it was (the deferred
		// rollback discards the update above).
		if qerr := assertDeviceQuota(ctx, q, userID, 1, 1); qerr != nil {
			return store.WishlistItem{}, qerr
		}
		// Map wishlist fields → device. Use currentPrice ?? initialPrice as
		// purchasePrice; today as purchaseDate; category if it maps.
		var price int32
		switch {
		case in.CurrentPrice != nil:
			price = *in.CurrentPrice
		case owned.CurrentPrice != nil:
			price = *owned.CurrentPrice
		case in.InitialPrice != nil:
			price = *in.InitialPrice
		case owned.InitialPrice != nil:
			price = *owned.InitialPrice
		}
		if price < 0 {
			price = 0
		}

		category := "OTHER"
		if in.Category != nil && *in.Category != "" {
			// Verify the wishlist category maps onto a Device category code.
			if _, cerr := tq.GetCategoryByCode(ctx, *in.Category); cerr == nil {
				category = *in.Category
			}
		} else if owned.Category != nil && *owned.Category != "" {
			if _, cerr := tq.GetCategoryByCode(ctx, *owned.Category); cerr == nil {
				category = *owned.Category
			}
		}

		// Fallback: if OTHER isn't in the Category table either, pick the first
		// active category. Avoids a FK violation on devices that have a
		// category column referencing Category.code (it's just a string column,
		// but we keep parity with TS which uses freeform strings).
		if _, cerr := tq.GetCategoryByCode(ctx, category); cerr != nil {
			category = "OTHER"
		}

		now := time.Now().UTC()
		statusActive := "ACTIVE"
		device, derr := tq.CreateDevice(ctx, store.CreateDeviceParams{
			ID:            auth.NewID(),
			UserId:        userID,
			Name:          updated.Name,
			Category:      category,
			Brand:         updated.Brand,
			Model:         nil,
			SerialNumber:  nil,
			PurchaseDate:  pgtype.Timestamp{Time: now, Valid: true},
			PurchasePrice: price,
			PurchasePlace: nil,
			Notes:         updated.Notes,
			Status:        &statusActive,
		})
		if derr != nil {
			return store.WishlistItem{}, fmt.Errorf("create device from wishlist: %w", derr)
		}

		marked, merr := tq.MarkWishlistPurchased(ctx, store.MarkWishlistPurchasedParams{
			ID:                id,
			UserId:            userID,
			PurchasedDeviceId: &device.ID,
		})
		if merr != nil {
			return store.WishlistItem{}, fmt.Errorf("mark wishlist purchased: %w", merr)
		}
		updated = marked
	}

	if err := tx.Commit(ctx); err != nil {
		return store.WishlistItem{}, fmt.Errorf("commit: %w", err)
	}
	return updated, nil
}

// DeleteWishlist mirrors website/src/lib/services/wishlist.ts::deleteWishlistItem.
func DeleteWishlist(ctx context.Context, db *pgxpool.Pool, userID, id string) error {
	q := store.New(db)
	rows, err := q.DeleteWishlist(ctx, store.DeleteWishlistParams{ID: id, UserId: userID})
	if err != nil {
		return fmt.Errorf("delete wishlist: %w", err)
	}
	if rows == 0 {
		return ErrNotFound(i18n.Text(ctx, "Không tìm thấy món"))
	}
	return nil
}

// LogWishlistPrice mirrors website/src/lib/services/wishlist.ts::logWishlistPrice.
// Wrapped in a transaction: append WishlistPrice + bump WishlistItem.currentPrice.
func LogWishlistPrice(ctx context.Context, db *pgxpool.Pool, userID, id string, in PriceLogInput) error {
	if in.Price < 0 {
		return ErrValidationKeyed(
			"Giá không hợp lệ",
			FieldErrors{"price": {i18n.Text(ctx, "Giá không hợp lệ")}},
		)
	}
	trimPtr(&in.Note)
	if in.Note != nil && len([]rune(*in.Note)) > 500 {
		return ErrValidationKeyed(
			"Ghi chú tối đa 500 ký tự",
			FieldErrors{"note": {i18n.Text(ctx, "Ghi chú tối đa 500 ký tự")}},
		)
	}

	q := store.New(db)
	if _, err := q.GetWishlistByID(ctx, store.GetWishlistByIDParams{ID: id, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound(i18n.Text(ctx, "Không tìm thấy món"))
		}
		return fmt.Errorf("get wishlist: %w", err)
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tq := q.WithTx(tx)

	if _, err := tq.CreateWishlistPrice(ctx, store.CreateWishlistPriceParams{
		ID:     auth.NewID(),
		ItemId: id,
		Price:  in.Price,
		Note:   in.Note,
	}); err != nil {
		return fmt.Errorf("create wishlist price: %w", err)
	}
	priceCopy := in.Price
	if err := tq.SetWishlistCurrentPrice(ctx, store.SetWishlistCurrentPriceParams{
		ID:           id,
		CurrentPrice: &priceCopy,
		UserId:       userID,
	}); err != nil {
		return fmt.Errorf("bump current price: %w", err)
	}
	return tx.Commit(ctx)
}

// SetWishlistStatus mirrors the simple status-only update path used by the
// wishlist toolbar (without any side effects). For a PURCHASED transition
// callers should use UpdateWishlist instead.
func SetWishlistStatus(ctx context.Context, db *pgxpool.Pool, userID, id, status string) error {
	if !validWishlistStatuses[status] {
		return ErrValidationKeyed(
			"Trạng thái không hợp lệ",
			FieldErrors{"status": {i18n.Text(ctx, "Trạng thái không hợp lệ")}},
		)
	}
	q := store.New(db)
	if _, err := q.GetWishlistByID(ctx, store.GetWishlistByIDParams{ID: id, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound(i18n.Text(ctx, "Không tìm thấy món"))
		}
		return fmt.Errorf("get wishlist: %w", err)
	}
	if _, err := q.SetWishlistStatus(ctx, store.SetWishlistStatusParams{
		ID:     id,
		UserId: userID,
		Status: status,
	}); err != nil {
		return fmt.Errorf("set status: %w", err)
	}
	return nil
}

func int32PtrEq(a, b *int32) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}
	return *a == *b
}
