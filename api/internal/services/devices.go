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
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// MAX_DEVICES_PER_USER mirrors website/src/lib/services/devices.ts.
const MaxDevicesPerUser = 50

// validStatus mirrors website/src/lib/types.ts::STATUSES.
var validStatuses = map[string]bool{
	"ACTIVE":  true,
	"EXPIRED": true,
	"SOLD":    true,
	"BROKEN":  true,
	"LOST":    true,
}

// DeviceInput mirrors website/src/lib/services/devices.ts::deviceInputSchema.
// All optional string fields use `*string`; empty string is normalized to nil
// (matching the Zod `blankToNull` preprocess in actions/devices.ts).
type DeviceInput struct {
	Name             string  `json:"name"`
	Category         string  `json:"category"`
	Brand            *string `json:"brand,omitempty"`
	Model            *string `json:"model,omitempty"`
	SerialNumber     *string `json:"serialNumber,omitempty"`
	PurchaseDate     string  `json:"purchaseDate"`     // YYYY-MM-DD or RFC3339
	PurchasePrice    int32   `json:"purchasePrice"`
	PurchasePlace    *string `json:"purchasePlace,omitempty"`
	Status           string  `json:"status,omitempty"` // default ACTIVE
	Notes            *string `json:"notes,omitempty"`
	WarrantyMonths   int32   `json:"warrantyMonths"`
	WarrantyProvider *string `json:"warrantyProvider,omitempty"`
	WarrantyAddress  *string `json:"warrantyAddress,omitempty"`
	WarrantyPhone    *string `json:"warrantyPhone,omitempty"`
	WarrantyNotes    *string `json:"warrantyNotes,omitempty"`
}

// DeviceFilter is the listDevices filter.
type DeviceFilter struct {
	Q        string
	Category string
	Status   string
	Sort     string // purchaseDate | warrantyEndDate | price | name
	Dir      string // asc | desc
}

// DeviceListItem is a list-row projection: device + counts + the effective
// warranty end (max over Warranty.endDate). Mirrors website/src/lib/devices.ts.
type DeviceListItem struct {
	store.Device
	AttachmentCount       int64      `json:"attachmentCount"`
	EffectiveWarrantyEnd  *time.Time `json:"effectiveWarrantyEnd"`
}

// DeviceDetail is the full device read: device + warranties (with reminders) +
// attachments. Mirrors website/src/lib/devices.ts::getDevice.
type DeviceDetail struct {
	store.Device
	Warranties  []WarrantyWithReminders `json:"warranties"`
	Attachments []store.Attachment      `json:"attachments"`
}

// WarrantyWithReminders bundles a warranty row with its Reminder rows.
type WarrantyWithReminders struct {
	store.Warranty
	Reminders []store.Reminder `json:"reminders"`
}

// ValidateDeviceInput hand-rolls the same validation as the Zod schema in
// website/src/lib/services/devices.ts::deviceInputSchema. Returns nil on
// success or *Error{Code: VALIDATION} with field messages on failure.
func ValidateDeviceInput(in *DeviceInput) error {
	in.Name = strings.TrimSpace(in.Name)
	in.Category = strings.TrimSpace(in.Category)
	in.PurchaseDate = strings.TrimSpace(in.PurchaseDate)
	trimPtr(&in.Brand)
	trimPtr(&in.Model)
	trimPtr(&in.SerialNumber)
	trimPtr(&in.PurchasePlace)
	trimPtr(&in.Notes)
	trimPtr(&in.WarrantyProvider)
	trimPtr(&in.WarrantyAddress)
	trimPtr(&in.WarrantyPhone)
	trimPtr(&in.WarrantyNotes)
	in.Status = strings.TrimSpace(in.Status)

	fieldErrors := FieldErrors{}
	if in.Name == "" {
		fieldErrors["name"] = []string{"Tên thiết bị bắt buộc"}
	}
	if in.Category == "" {
		fieldErrors["category"] = []string{"Loại thiết bị bắt buộc"}
	}
	if in.PurchaseDate == "" {
		fieldErrors["purchaseDate"] = []string{"Ngày mua bắt buộc"}
	}
	if in.PurchasePrice < 0 {
		fieldErrors["purchasePrice"] = []string{"Giá mua không hợp lệ"}
	}
	if in.WarrantyMonths < 0 {
		fieldErrors["warrantyMonths"] = []string{"Số tháng bảo hành không hợp lệ"}
	}
	if in.Status == "" {
		in.Status = "ACTIVE"
	} else if !validStatuses[in.Status] {
		fieldErrors["status"] = []string{"Trạng thái không hợp lệ"}
	}
	if len(fieldErrors) > 0 {
		return ErrValidation(fieldErrors)
	}
	return nil
}

// ListDevices mirrors website/src/lib/devices.ts::listDevices. Filter values
// are passed straight to the sqlc query (which uses NULLIF semantics via the
// ($N::text IS NULL OR ...) pattern); empty strings act as "no filter".
func ListDevices(ctx context.Context, db *pgxpool.Pool, userID string, f DeviceFilter) ([]DeviceListItem, error) {
	q := store.New(db)

	cat := f.Category
	if cat == "ALL" {
		cat = ""
	}
	st := f.Status
	if st == "ALL" {
		st = ""
	}

	rows, err := q.ListDevicesByUser(ctx, store.ListDevicesByUserParams{
		UserId:   userID,
		Column2:  cat,
		Column3:  st,
		Column4:  strings.TrimSpace(f.Q),
	})
	if err != nil {
		return nil, fmt.Errorf("list devices: %w", err)
	}

	// Hydrate per-row attachment count + effective warranty end. The TS layer
	// does this via Prisma's `_count` + an `include`. Rather than two queries
	// per row (~101 round-trips for a full 50-device list), we gather the
	// device ids and issue two batch queries (`= ANY($1)`), then index the
	// results by deviceId in Go — same pattern as ExportBackup in backup.go.
	out := make([]DeviceListItem, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}

	deviceIDs := make([]string, 0, len(rows))
	for _, d := range rows {
		deviceIDs = append(deviceIDs, d.ID)
	}

	warrantyRows, err := q.ListWarrantiesByDeviceIDs(ctx, store.ListWarrantiesByDeviceIDsParams{
		Column1: deviceIDs,
		UserId:  userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	warByDevice := map[string][]store.Warranty{}
	for _, w := range warrantyRows {
		warByDevice[w.DeviceId] = append(warByDevice[w.DeviceId], w)
	}

	countRows, err := q.CountAttachmentsByDeviceIDs(ctx, store.CountAttachmentsByDeviceIDsParams{
		Column1: deviceIDs,
		UserId:  userID,
	})
	if err != nil {
		return nil, fmt.Errorf("count attachments: %w", err)
	}
	countByDevice := map[string]int64{}
	for _, c := range countRows {
		countByDevice[c.DeviceID] = c.Count
	}

	for _, d := range rows {
		end := effectiveWarrantyEnd(warByDevice[d.ID])
		out = append(out, DeviceListItem{
			Device:               d,
			AttachmentCount:      countByDevice[d.ID],
			EffectiveWarrantyEnd: end,
		})
	}

	sort := f.Sort
	if sort == "" {
		sort = "purchaseDate"
	}
	dir := f.Dir
	if dir == "" {
		dir = "desc"
	}
	desc := dir != "asc"

	switch sort {
	case "name":
		sortInPlace(out, func(a, b DeviceListItem) bool {
			return a.Name < b.Name
		}, desc)
	case "price":
		sortInPlace(out, func(a, b DeviceListItem) bool {
			return a.PurchasePrice < b.PurchasePrice
		}, desc)
	case "warrantyEndDate":
		sortInPlace(out, func(a, b DeviceListItem) bool {
			// Missing warranty sorts as "infinitely far away" so devices
			// with warranties show first when ordering "BH sắp hết".
			var av, bv int64
			if a.EffectiveWarrantyEnd == nil {
				if desc {
					av = -1 << 62
				} else {
					av = 1 << 62
				}
			} else {
				av = a.EffectiveWarrantyEnd.UnixNano()
			}
			if b.EffectiveWarrantyEnd == nil {
				if desc {
					bv = -1 << 62
				} else {
					bv = 1 << 62
				}
			} else {
				bv = b.EffectiveWarrantyEnd.UnixNano()
			}
			return av < bv
		}, desc)
	default: // purchaseDate
		sortInPlace(out, func(a, b DeviceListItem) bool {
			return a.PurchaseDate.Time.Before(b.PurchaseDate.Time)
		}, desc)
	}

	return out, nil
}

// GetDevice mirrors website/src/lib/devices.ts::getDevice.
func GetDevice(ctx context.Context, db *pgxpool.Pool, userID, id string) (*DeviceDetail, error) {
	q := store.New(db)
	d, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: id, UserId: userID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound("Không tìm thấy thiết bị")
		}
		return nil, fmt.Errorf("get device: %w", err)
	}
	warranties, err := q.ListWarrantiesByDevice(ctx, store.ListWarrantiesByDeviceParams{
		DeviceId: id,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list warranties: %w", err)
	}
	atts, err := q.ListAttachmentsByDevice(ctx, store.ListAttachmentsByDeviceParams{
		DeviceId: id,
		UserId:   userID,
	})
	if err != nil {
		return nil, fmt.Errorf("list attachments: %w", err)
	}

	wr := make([]WarrantyWithReminders, 0, len(warranties))
	for _, w := range warranties {
		// Fetch the latest non-dismissed reminder (if any) for client convenience.
		// The TS layer includes the full reminder list ordered by createdAt asc,
		// but in practice each warranty has 0..1 active rows; the existing sqlc
		// surface only exposes GetActiveReminderForWarranty so we project that.
		rem := []store.Reminder{}
		if r, rerr := q.GetActiveReminderForWarranty(ctx, w.ID); rerr == nil {
			rem = append(rem, r)
		}
		wr = append(wr, WarrantyWithReminders{Warranty: w, Reminders: rem})
	}
	if atts == nil {
		atts = []store.Attachment{}
	}
	return &DeviceDetail{Device: d, Warranties: wr, Attachments: atts}, nil
}

// CreateDevice mirrors website/src/lib/services/devices.ts::createDevice
// including the optional inline-warranty side effect when warrantyMonths > 0.
func CreateDevice(ctx context.Context, db *pgxpool.Pool, userID string, in DeviceInput, fromWishlistID string) (store.Device, error) {
	if err := ValidateDeviceInput(&in); err != nil {
		return store.Device{}, err
	}
	if err := assertCategoryExists(ctx, db, in.Category); err != nil {
		return store.Device{}, err
	}

	q := store.New(db)
	count, err := q.CountDevicesByUser(ctx, userID)
	if err != nil {
		return store.Device{}, fmt.Errorf("count devices: %w", err)
	}
	if count >= MaxDevicesPerUser {
		return store.Device{}, ErrLimit(fmt.Sprintf(
			"Đã đạt giới hạn %d thiết bị. Xoá bớt rồi thử lại.", MaxDevicesPerUser))
	}

	purchaseDate, err := parseDate(in.PurchaseDate)
	if err != nil {
		return store.Device{}, ErrValidation(FieldErrors{"purchaseDate": {"Ngày mua không hợp lệ"}})
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return store.Device{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tq := q.WithTx(tx)

	status := in.Status
	statusPtr := &status
	created, err := tq.CreateDevice(ctx, store.CreateDeviceParams{
		ID:            auth.NewID(),
		UserId:        userID,
		Name:          in.Name,
		Category:      in.Category,
		Brand:         in.Brand,
		Model:         in.Model,
		SerialNumber:  in.SerialNumber,
		PurchaseDate:  pgtype.Timestamp{Time: purchaseDate, Valid: true},
		PurchasePrice: in.PurchasePrice,
		PurchasePlace: in.PurchasePlace,
		Notes:         in.Notes,
		Status:        statusPtr,
	})
	if err != nil {
		return store.Device{}, fmt.Errorf("create device: %w", err)
	}

	if in.WarrantyMonths > 0 {
		end := addMonths(purchaseDate, int(in.WarrantyMonths))
		_, err := tq.CreateWarranty(ctx, store.CreateWarrantyParams{
			ID:        auth.NewID(),
			DeviceId:  created.ID,
			Type:      "STANDARD",
			Provider:  in.WarrantyProvider,
			StartDate: pgtype.Timestamp{Time: purchaseDate, Valid: true},
			EndDate:   pgtype.Timestamp{Time: end, Valid: true},
			Months:    in.WarrantyMonths,
			Cost:      nil,
			Address:   in.WarrantyAddress,
			Phone:     in.WarrantyPhone,
			Notes:     in.WarrantyNotes,
		})
		if err != nil {
			return store.Device{}, fmt.Errorf("create warranty: %w", err)
		}
	}

	// Wishlist cross-link: if the device was seeded from a wishlist item, mark
	// it purchased and back-reference. The TS layer also does this in a
	// post-create step; we keep it inside the same transaction for atomicity.
	if fromWishlistID != "" && isSafeID(fromWishlistID) {
		if _, gerr := tq.GetWishlistByID(ctx, store.GetWishlistByIDParams{
			ID:     fromWishlistID,
			UserId: userID,
		}); gerr == nil {
			_, _ = tq.MarkWishlistPurchased(ctx, store.MarkWishlistPurchasedParams{
				ID:                fromWishlistID,
				UserId:            userID,
				PurchasedDeviceId: &created.ID,
			})
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return store.Device{}, fmt.Errorf("commit: %w", err)
	}
	return created, nil
}

// UpdateDevice mirrors website/src/lib/services/devices.ts::updateDevice.
// Manages the single STANDARD warranty inline: creates / updates / deletes
// based on warrantyMonths.
func UpdateDevice(ctx context.Context, db *pgxpool.Pool, userID, id string, in DeviceInput) (store.Device, error) {
	if err := ValidateDeviceInput(&in); err != nil {
		return store.Device{}, err
	}
	if err := assertCategoryExists(ctx, db, in.Category); err != nil {
		return store.Device{}, err
	}

	q := store.New(db)
	if _, err := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: id, UserId: userID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Device{}, ErrNotFound("Không tìm thấy thiết bị")
		}
		return store.Device{}, fmt.Errorf("get device: %w", err)
	}

	purchaseDate, err := parseDate(in.PurchaseDate)
	if err != nil {
		return store.Device{}, ErrValidation(FieldErrors{"purchaseDate": {"Ngày mua không hợp lệ"}})
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return store.Device{}, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	tq := q.WithTx(tx)

	updated, err := tq.UpdateDevice(ctx, store.UpdateDeviceParams{
		ID:            id,
		UserId:        userID,
		Name:          in.Name,
		Category:      in.Category,
		Brand:         in.Brand,
		Model:         in.Model,
		SerialNumber:  in.SerialNumber,
		PurchaseDate:  pgtype.Timestamp{Time: purchaseDate, Valid: true},
		PurchasePrice: in.PurchasePrice,
		PurchasePlace: in.PurchasePlace,
		Status:        in.Status,
		Notes:         in.Notes,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return store.Device{}, ErrNotFound("Không tìm thấy thiết bị")
		}
		return store.Device{}, fmt.Errorf("update device: %w", err)
	}

	existing, err := tq.GetStandardWarrantyForDevice(ctx, id)
	hasExisting := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return store.Device{}, fmt.Errorf("get standard warranty: %w", err)
	}

	if in.WarrantyMonths > 0 {
		end := addMonths(purchaseDate, int(in.WarrantyMonths))
		if hasExisting {
			if _, uerr := tq.UpdateWarranty(ctx, store.UpdateWarrantyParams{
				ID:        existing.ID,
				UserId:    userID,
				Type:      "STANDARD",
				Provider:  in.WarrantyProvider,
				StartDate: pgtype.Timestamp{Time: purchaseDate, Valid: true},
				EndDate:   pgtype.Timestamp{Time: end, Valid: true},
				Months:    in.WarrantyMonths,
				Cost:      existing.Cost,
				Address:   in.WarrantyAddress,
				Phone:     in.WarrantyPhone,
				Notes:     in.WarrantyNotes,
			}); uerr != nil {
				return store.Device{}, fmt.Errorf("update warranty: %w", uerr)
			}
		} else {
			if _, cerr := tq.CreateWarranty(ctx, store.CreateWarrantyParams{
				ID:        auth.NewID(),
				DeviceId:  id,
				Type:      "STANDARD",
				Provider:  in.WarrantyProvider,
				StartDate: pgtype.Timestamp{Time: purchaseDate, Valid: true},
				EndDate:   pgtype.Timestamp{Time: end, Valid: true},
				Months:    in.WarrantyMonths,
				Cost:      nil,
				Address:   in.WarrantyAddress,
				Phone:     in.WarrantyPhone,
				Notes:     in.WarrantyNotes,
			}); cerr != nil {
				return store.Device{}, fmt.Errorf("create warranty: %w", cerr)
			}
		}
	} else if hasExisting {
		if _, derr := tq.DeleteWarranty(ctx, store.DeleteWarrantyParams{
			ID:     existing.ID,
			UserId: userID,
		}); derr != nil {
			return store.Device{}, fmt.Errorf("delete warranty: %w", derr)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return store.Device{}, fmt.Errorf("commit: %w", err)
	}
	return updated, nil
}

// DeleteDevice removes the device row (cascade handles warranties / attachments
// / reminders). Disk cleanup of encrypted blobs lives in the attachments
// service; per Phase C task split, this function only touches the DB.
func DeleteDevice(ctx context.Context, db *pgxpool.Pool, userID, id string) error {
	q := store.New(db)
	rows, err := q.DeleteDevice(ctx, store.DeleteDeviceParams{ID: id, UserId: userID})
	if err != nil {
		return fmt.Errorf("delete device: %w", err)
	}
	if rows == 0 {
		return ErrNotFound("Không tìm thấy thiết bị")
	}
	return nil
}

// ---- helpers ---------------------------------------------------------------

func assertCategoryExists(ctx context.Context, db *pgxpool.Pool, code string) error {
	q := store.New(db)
	if _, err := q.GetCategoryByCode(ctx, code); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrCategoryInvalid()
		}
		return fmt.Errorf("get category: %w", err)
	}
	return nil
}

// parseDate accepts both "YYYY-MM-DD" (the Zod schema's expected shape, since
// the form sends a date input) and full RFC3339 timestamps. Returns the parsed
// instant in UTC midnight when only the date portion is supplied — matching
// the TS `new Date(input.purchaseDate)` behavior on date-only strings.
func parseDate(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, errors.New("empty")
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t.UTC(), nil
	}
	if t, err := time.Parse("2006-01-02T15:04:05", s); err == nil {
		return t.UTC(), nil
	}
	return time.Time{}, errors.New("invalid date")
}

// addMonths mirrors date-fns/addMonths: clamps the day-of-month to the last
// day of the target month so e.g. Jan 31 + 1 month → Feb 28 / 29.
func addMonths(t time.Time, months int) time.Time {
	if months == 0 {
		return t
	}
	year, month, day := t.Date()
	hh, mm, ss := t.Clock()
	ns := t.Nanosecond()

	target := time.Date(year, month+time.Month(months), 1, hh, mm, ss, ns, t.Location())
	last := lastDayOfMonth(target.Year(), target.Month(), t.Location())
	if day > last {
		day = last
	}
	return time.Date(target.Year(), target.Month(), day, hh, mm, ss, ns, t.Location())
}

func lastDayOfMonth(year int, month time.Month, loc *time.Location) int {
	first := time.Date(year, month, 1, 0, 0, 0, 0, loc)
	next := first.AddDate(0, 1, 0)
	return next.AddDate(0, 0, -1).Day()
}

// effectiveWarrantyEnd mirrors website/src/lib/warranty.ts::effectiveWarrantyEnd.
func effectiveWarrantyEnd(warranties []store.Warranty) *time.Time {
	if len(warranties) == 0 {
		return nil
	}
	var max time.Time
	first := true
	for _, w := range warranties {
		if !w.EndDate.Valid {
			continue
		}
		if first || w.EndDate.Time.After(max) {
			max = w.EndDate.Time
			first = false
		}
	}
	if first {
		return nil
	}
	return &max
}

func trimPtr(p **string) {
	if p == nil || *p == nil {
		return
	}
	v := strings.TrimSpace(**p)
	if v == "" {
		*p = nil
		return
	}
	*p = &v
}

func isSafeID(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '_' || r == '-':
		default:
			return false
		}
	}
	return true
}

// sortInPlace is a tiny in-place sort that flips less() when desc.
func sortInPlace[T any](items []T, less func(a, b T) bool, desc bool) {
	cmp := less
	if desc {
		cmp = func(a, b T) bool { return less(b, a) }
	}
	// Insertion sort — N ≤ 50 in practice, allocates nothing.
	for i := 1; i < len(items); i++ {
		for j := i; j > 0 && cmp(items[j], items[j-1]); j-- {
			items[j], items[j-1] = items[j-1], items[j]
		}
	}
}
