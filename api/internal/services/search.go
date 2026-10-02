// Package services / search.go — cross-entity search (roadmap #7).
//
// Before this file, `q` existed only on `GET /api/v1/devices`, so a user typing
// "samsung" could not find their Samsung Cloud subscription or the Galaxy Buds on
// their wishlist. The per-entity filters are unchanged; this adds one grouped
// endpoint that searches devices, subscriptions and wishlist in a single round
// trip (see openapi.yaml for the choice of a new endpoint over extending the
// three list endpoints).
package services

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

const (
	// DefaultSearchLimit is how many rows each group returns unless asked
	// otherwise. The groups are independent: 20 devices + 20 subscriptions + 20
	// wishlist items.
	DefaultSearchLimit = 20
	// MaxSearchLimit caps the per-group limit so one request cannot pull a whole
	// account (the hard ceilings are 50 devices / 100 subscriptions / 200 wishlist
	// items per user).
	MaxSearchLimit = 50
	// MaxSearchQueryRunes bounds the pattern handed to LIKE. 200 runes is longer
	// than any real product name; beyond that the input is a paste accident and
	// the query would only get slower.
	MaxSearchQueryRunes = 200
)

// SearchResults is the grouped payload of GET /api/v1/search.
//
// Empty groups always serialise as `[]`, never `null`, so a client can iterate
// unconditionally.
type SearchResults struct {
	Query         string               `json:"query"`
	Devices       []store.Device       `json:"devices"`
	Subscriptions []store.Subscription `json:"subscriptions"`
	Wishlist      []store.WishlistItem `json:"wishlist"`
}

// Search returns up to `limit` rows per entity whose searchable text matches
// `rawQuery`, diacritic-insensitively ("dien thoai" finds "Điện thoại").
//
// An empty / whitespace-only query is not an error: it returns empty groups.
// Search boxes are cleared by deleting characters, and a 400 on that keystroke
// would only make the UI show an error for a non-event.
func Search(ctx context.Context, db *pgxpool.Pool, userID, rawQuery string, limit int) (*SearchResults, error) {
	query := strings.TrimSpace(rawQuery)
	out := &SearchResults{
		Query:         query,
		Devices:       []store.Device{},
		Subscriptions: []store.Subscription{},
		Wishlist:      []store.WishlistItem{},
	}
	if utf8.RuneCountInString(query) > MaxSearchQueryRunes {
		return nil, &Error{Code: "VALIDATION", Message: fmt.Sprintf(
			"Từ khoá tìm kiếm quá dài (tối đa %d ký tự)", MaxSearchQueryRunes)}
	}
	if query == "" {
		return out, nil
	}
	if limit <= 0 {
		limit = DefaultSearchLimit
	}
	if limit > MaxSearchLimit {
		limit = MaxSearchLimit
	}
	rowLimit := int32(limit) //nolint:gosec // clamped to MaxSearchLimit above

	q := store.New(db)

	devices, err := q.SearchDevices(ctx, store.SearchDevicesParams{
		UserId:   userID,
		Q:        query,
		RowLimit: rowLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("search devices: %w", err)
	}
	subs, err := q.SearchSubscriptions(ctx, store.SearchSubscriptionsParams{
		UserId:   userID,
		Q:        query,
		RowLimit: rowLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("search subscriptions: %w", err)
	}
	wishlist, err := q.SearchWishlist(ctx, store.SearchWishlistParams{
		UserId:   userID,
		Q:        query,
		RowLimit: rowLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("search wishlist: %w", err)
	}

	if len(devices) > 0 {
		out.Devices = devices
	}
	if len(subs) > 0 {
		out.Subscriptions = subs
	}
	if len(wishlist) > 0 {
		out.Wishlist = wishlist
	}
	return out, nil
}
