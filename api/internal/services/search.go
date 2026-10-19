// Package services / search.go — cross-entity search (roadmap #7).
//
// Before this file, `q` existed only on `GET /api/v1/devices`, so a user typing
// "samsung" could not find their Samsung Cloud subscription or the Galaxy Buds on
// their wishlist. The per-entity filters are unchanged; this adds one grouped
// endpoint that searches devices, subscriptions, wishlist and — since roadmap
// #13 / migration 0019 — the OCR text stored on attachments, in a single round
// trip (see openapi.yaml for the choice of a new endpoint over extending the
// list endpoints).
package services

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

const (
	// DefaultSearchLimit is how many rows each group returns unless asked
	// otherwise. The groups are independent: 20 devices + 20 subscriptions + 20
	// wishlist items + 20 attachments.
	DefaultSearchLimit = 20
	// MaxSearchLimit caps the per-group limit so one request cannot pull a whole
	// account (the hard ceilings are 500 stored devices / 100 subscriptions /
	// 200 wishlist items per user — devices count sold ones too, and the tighter
	// 50 applies only to devices that are still active). Attachments have no row
	// cap: their bound is the 100 MB per-user byte ceiling, so the per-request
	// LIMIT matters more for that group, not less.
	MaxSearchLimit = 50
	// MaxSearchQueryRunes bounds the pattern handed to LIKE. 200 runes is longer
	// than any real product name; beyond that the input is a paste accident and
	// the query would only get slower.
	MaxSearchQueryRunes = 200
)

// AttachmentSearchHit is one attachment in GET /api/v1/search's `attachments`
// group. It is the redacted public attachment shape (AttachmentMeta, which is
// also what the device-detail/list/inbox endpoints return) plus the owning
// device id.
//
// deviceId is added here rather than to AttachmentMeta on purpose: the existing
// attachment endpoints are either device-scoped (the id is already in the path)
// or the inbox (there is no device), and leaving it out of AttachmentMeta keeps
// those payloads unchanged. A SEARCH hit is different — it can be either a filed
// attachment or an inbox item, and a client needs to know where to navigate.
// `null` means the item is still in the inbox.
type AttachmentSearchHit struct {
	AttachmentMeta
	DeviceID *string `json:"deviceId"`
}

// DeviceSearchHit is one device in GET /api/v1/search's `devices` group: the
// DeviceVND shape every other device read returns plus the computed
// effectiveWarrantyEnd.
//
// The field is added here rather than to DeviceVND because DeviceVND is also the
// create/update response, and those two payloads must keep their existing shape.
// It is still the SAME value the list row and the device detail carry: all three
// call wholeUnitWarrantyEnd (max endDate over Component NULL/blank rows).
type DeviceSearchHit struct {
	DeviceVND
	EffectiveWarrantyEnd *time.Time `json:"effectiveWarrantyEnd"`
}

// SearchResults is the grouped payload of GET /api/v1/search.
//
// Empty groups always serialise as `[]`, never `null`, so a client can iterate
// unconditionally.
type SearchResults struct {
	Query string `json:"query"`
	// Devices is the same DeviceVND shape every other device read returns
	// (migration 0022), plus the computed effectiveWarrantyEnd: a search hit must
	// answer the same "when does cover end?" question the list and detail do.
	Devices       []DeviceSearchHit     `json:"devices"`
	Subscriptions []store.Subscription  `json:"subscriptions"`
	Wishlist      []store.WishlistItem  `json:"wishlist"`
	Attachments   []AttachmentSearchHit `json:"attachments"`
}

// Search returns up to `limit` rows per entity whose searchable text matches
// `rawQuery`, diacritic-insensitively ("dien thoai" finds "Điện thoại").
//
// An empty / whitespace-only query is not an error: it returns empty groups.
// Search boxes are cleared by deleting characters, and a 400 on that keystroke
// would only make the UI show an error for a non-event.
//
// i18n: the one refusal below is the existing Vietnamese sentence wrapped in
// `i18n.T`, so the ctx must be the REQUEST's. The error keeps its VALIDATION code
// — only the words move — and the count is a `%d` in both languages, so the one
// argument list serves both.
func Search(ctx context.Context, db *pgxpool.Pool, userID, rawQuery string, limit int) (*SearchResults, error) {
	query := strings.TrimSpace(rawQuery)
	out := &SearchResults{
		Query:         query,
		Devices:       []DeviceSearchHit{},
		Subscriptions: []store.Subscription{},
		Wishlist:      []store.WishlistItem{},
		Attachments:   []AttachmentSearchHit{},
	}
	if utf8.RuneCountInString(query) > MaxSearchQueryRunes {
		// The CODE stays VALIDATION and the status stays 400; only the sentence
		// follows the request's language. `i18n.T` because the message carries the
		// limit, and the key is a literal at the call site (what `go vet`'s printf
		// analyzer requires).
		return nil, &Error{Code: "VALIDATION", Message: i18n.T(ctx,
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

	deviceRows, err := q.SearchDevices(ctx, store.SearchDevicesParams{
		UserId:   userID,
		Q:        query,
		RowLimit: rowLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("search devices: %w", err)
	}
	// One batch query for the matched devices' warranties: the computed
	// warrantyMismatch (gap #11) is part of every device read, and a search hit
	// must not be the one payload whose mismatch is always null. The set is
	// bounded by MaxSearchLimit.
	warByDevice := map[string][]store.Warranty{}
	if len(deviceRows) > 0 {
		deviceIDs := make([]string, 0, len(deviceRows))
		for _, d := range deviceRows {
			deviceIDs = append(deviceIDs, d.ID)
		}
		warrantyRows, werr := q.ListWarrantiesByDeviceIDs(ctx, store.ListWarrantiesByDeviceIDsParams{
			Column1: deviceIDs,
			UserId:  userID,
		})
		if werr != nil {
			return nil, fmt.Errorf("search device warranties: %w", werr)
		}
		for _, w := range warrantyRows {
			warByDevice[w.DeviceId] = append(warByDevice[w.DeviceId], w)
		}
	}
	for _, d := range deviceRows {
		warranties := warByDevice[d.ID]
		out.Devices = append(out.Devices, DeviceSearchHit{
			DeviceVND:            withVNDAndWarranties(d, warranties),
			EffectiveWarrantyEnd: wholeUnitWarrantyEnd(warranties),
		})
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
	// OCR text on attachments (migration 0019). The query returns raw Attachment
	// rows, which carry storagePath/iv/wrappedKey, so every hit goes through the
	// same redaction the attachment endpoints use; deviceId is added because a
	// search hit may be filed or still in the inbox.
	attachments, err := q.SearchAttachments(ctx, store.SearchAttachmentsParams{
		UserId:   userID,
		Q:        query,
		RowLimit: rowLimit,
	})
	if err != nil {
		return nil, fmt.Errorf("search attachments: %w", err)
	}

	if len(subs) > 0 {
		out.Subscriptions = subs
	}
	if len(wishlist) > 0 {
		out.Wishlist = wishlist
	}
	if len(attachments) > 0 {
		hits := make([]AttachmentSearchHit, 0, len(attachments))
		for _, a := range attachments {
			hits = append(hits, AttachmentSearchHit{
				AttachmentMeta: toAttachmentMeta(a),
				DeviceID:       a.DeviceId,
			})
		}
		out.Attachments = hits
	}
	return out, nil
}
