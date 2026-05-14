// Package services / backup.go — Export & Import of a user's entire data
// graph. Mirrors the legacy TS `website/src/app/actions/backup.ts` payload
// shape (version 5) so existing exported files can be re-imported here and
// vice-versa.
//
// Export issues 8 independent SELECTs (no joined gather query). Import is
// wrapped in a single transaction; in `replace` mode we wipe the user's
// existing rows first.

package services

import (
	"context"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// safeID mirrors the Prisma backup importer regex.
var (
	safeIDRE          = regexp.MustCompile(`^[a-z0-9_-]+$`)
	safeStoragePathRE = regexp.MustCompile(`^[a-z0-9_-]+/[a-z0-9-]+\.enc$`)
)

// ---- Export shapes (BackupV1 = the canonical Vietnamese-named JSON the web
//      client + mobile apps consume; numbered version: 5 to match TS).

type BackupExport struct {
	Version       int                       `json:"version"`
	ExportedAt    string                    `json:"exportedAt"`
	Subscriptions []BackupSubscription      `json:"subscriptions"`
	Wishlist      []BackupWishlistItem      `json:"wishlist"`
	Devices       []BackupDevice            `json:"devices"`
}

type BackupSubscription struct {
	ID            string             `json:"id"`
	Name          string             `json:"name"`
	Category      *string            `json:"category"`
	Brand         *string            `json:"brand"`
	Plan          *string            `json:"plan"`
	BillingCycle  string             `json:"billingCycle"`
	IntervalDays  *int32             `json:"intervalDays"`
	Price         int32              `json:"price"`
	Currency      string             `json:"currency"`
	StartedAt     string             `json:"startedAt"`
	RenewalDate   string             `json:"renewalDate"`
	AutoRenew     bool               `json:"autoRenew"`
	Status        string             `json:"status"`
	AccountEmail  *string            `json:"accountEmail"`
	PaymentMethod *string            `json:"paymentMethod"`
	ManageUrl     *string            `json:"manageUrl"`
	CancelUrl     *string            `json:"cancelUrl"`
	Notes         *string            `json:"notes"`
	CreatedAt     string             `json:"createdAt"`
	UpdatedAt     string             `json:"updatedAt"`
	Payments      []BackupPayment    `json:"payments"`
}

type BackupPayment struct {
	ID     string  `json:"id"`
	Amount int32   `json:"amount"`
	PaidAt string  `json:"paidAt"`
	Note   *string `json:"note"`
}

type BackupWishlistItem struct {
	ID                   string                 `json:"id"`
	Name                 string                 `json:"name"`
	Category             *string                `json:"category"`
	Brand                *string                `json:"brand"`
	InitialPrice         *int32                 `json:"initialPrice"`
	CurrentPrice         *int32                 `json:"currentPrice"`
	BuyUrl               *string                `json:"buyUrl"`
	ImageUrl             *string                `json:"imageUrl"`
	TargetDate           *string                `json:"targetDate"`
	Priority             string                 `json:"priority"`
	Status               string                 `json:"status"`
	Notes                *string                `json:"notes"`
	ReminderIntervalDays *int32                 `json:"reminderIntervalDays"`
	LastNotifiedAt       *string                `json:"lastNotifiedAt"`
	PurchasedDeviceId    *string                `json:"purchasedDeviceId"`
	CreatedAt            string                 `json:"createdAt"`
	UpdatedAt            string                 `json:"updatedAt"`
	Prices               []BackupWishlistPrice  `json:"prices"`
}

type BackupWishlistPrice struct {
	ID         string  `json:"id"`
	Price      int32   `json:"price"`
	Note       *string `json:"note"`
	RecordedAt string  `json:"recordedAt"`
}

type BackupDevice struct {
	ID            string              `json:"id"`
	Name          string              `json:"name"`
	Category      string              `json:"category"`
	Brand         *string             `json:"brand"`
	Model         *string             `json:"model"`
	SerialNumber  *string             `json:"serialNumber"`
	PurchaseDate  string              `json:"purchaseDate"`
	PurchasePrice int32               `json:"purchasePrice"`
	PurchasePlace *string             `json:"purchasePlace"`
	Status        string              `json:"status"`
	Notes         *string             `json:"notes"`
	CreatedAt     string              `json:"createdAt"`
	UpdatedAt     string              `json:"updatedAt"`
	Warranties    []BackupWarranty    `json:"warranties"`
	Attachments   []BackupAttachment  `json:"attachments"`
}

type BackupWarranty struct {
	ID        string            `json:"id"`
	Type      string            `json:"type"`
	Provider  *string           `json:"provider"`
	StartDate string            `json:"startDate"`
	EndDate   string            `json:"endDate"`
	Months    int32             `json:"months"`
	Cost      *int32            `json:"cost"`
	Address   *string           `json:"address"`
	Phone     *string           `json:"phone"`
	Notes     *string           `json:"notes"`
	CreatedAt string            `json:"createdAt"`
	UpdatedAt string            `json:"updatedAt"`
	Reminders []BackupReminder  `json:"reminders"`
}

type BackupReminder struct {
	ID          string `json:"id"`
	IsDismissed bool   `json:"isDismissed"`
	CreatedAt   string `json:"createdAt"`
}

type BackupAttachment struct {
	ID          string  `json:"id"`
	FileName    string  `json:"fileName"`
	StoragePath string  `json:"storagePath"`
	FileType    string  `json:"fileType"`
	FileSize    int32   `json:"fileSize"`
	IV          string  `json:"iv"`         // base64
	WrappedKey  string  `json:"wrappedKey"` // base64
	Description *string `json:"description"`
	UploadedAt  string  `json:"uploadedAt"`
}

// ImportResult is returned by Import — handler folds it into the JSON envelope.
type ImportResult struct {
	Imported          int `json:"imported"`
	Skipped           int `json:"skipped"`
	WishlistImported  int `json:"wishlistImported"`
	WishlistSkipped   int `json:"wishlistSkipped"`
	SubImported       int `json:"subImported"`
	SubSkipped        int `json:"subSkipped"`
}

// ---- Export ---------------------------------------------------------------

// ExportBackup gathers everything the user owns and returns the v5 payload.
func ExportBackup(ctx context.Context, db *pgxpool.Pool, userID string) (*BackupExport, error) {
	q := store.New(db)

	devices, err := q.BackupListDevices(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list devices: %w", err)
	}
	warranties, err := q.BackupListWarrantiesForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list warranties: %w", err)
	}
	reminders, err := q.BackupListRemindersForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list reminders: %w", err)
	}
	attachments, err := q.BackupListAttachmentsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list attachments: %w", err)
	}
	wishlist, err := q.BackupListWishlistForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list wishlist: %w", err)
	}
	prices, err := q.BackupListWishlistPricesForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list wishlist prices: %w", err)
	}
	subs, err := q.BackupListSubscriptionsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list subs: %w", err)
	}
	payments, err := q.BackupListPaymentsForUser(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("backup list payments: %w", err)
	}

	// Index children by parent id for the assembly step.
	remByWarranty := map[string][]store.Reminder{}
	for _, r := range reminders {
		remByWarranty[r.WarrantyId] = append(remByWarranty[r.WarrantyId], r)
	}
	warByDevice := map[string][]store.Warranty{}
	for _, w := range warranties {
		warByDevice[w.DeviceId] = append(warByDevice[w.DeviceId], w)
	}
	attByDevice := map[string][]store.Attachment{}
	for _, a := range attachments {
		attByDevice[a.DeviceId] = append(attByDevice[a.DeviceId], a)
	}
	priceByItem := map[string][]store.WishlistPrice{}
	for _, p := range prices {
		priceByItem[p.ItemId] = append(priceByItem[p.ItemId], p)
	}
	payBySub := map[string][]store.SubscriptionPayment{}
	for _, p := range payments {
		payBySub[p.SubscriptionId] = append(payBySub[p.SubscriptionId], p)
	}

	out := &BackupExport{
		Version:       5,
		ExportedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		Subscriptions: make([]BackupSubscription, 0, len(subs)),
		Wishlist:      make([]BackupWishlistItem, 0, len(wishlist)),
		Devices:       make([]BackupDevice, 0, len(devices)),
	}

	for _, s := range subs {
		bs := BackupSubscription{
			ID:            s.ID,
			Name:          s.Name,
			Category:      s.Category,
			Brand:         s.Brand,
			Plan:          s.Plan,
			BillingCycle:  s.BillingCycle,
			IntervalDays:  s.IntervalDays,
			Price:         s.Price,
			Currency:      s.Currency,
			StartedAt:     ts(s.StartedAt),
			RenewalDate:   ts(s.RenewalDate),
			AutoRenew:     s.AutoRenew,
			Status:        s.Status,
			AccountEmail:  s.AccountEmail,
			PaymentMethod: s.PaymentMethod,
			ManageUrl:     s.ManageUrl,
			CancelUrl:     s.CancelUrl,
			Notes:         s.Notes,
			CreatedAt:     ts(s.CreatedAt),
			UpdatedAt:     ts(s.UpdatedAt),
			Payments:      []BackupPayment{},
		}
		for _, p := range payBySub[s.ID] {
			bs.Payments = append(bs.Payments, BackupPayment{
				ID:     p.ID,
				Amount: p.Amount,
				PaidAt: ts(p.PaidAt),
				Note:   p.Note,
			})
		}
		out.Subscriptions = append(out.Subscriptions, bs)
	}

	for _, w := range wishlist {
		bw := BackupWishlistItem{
			ID:                   w.ID,
			Name:                 w.Name,
			Category:             w.Category,
			Brand:                w.Brand,
			InitialPrice:         w.InitialPrice,
			CurrentPrice:         w.CurrentPrice,
			BuyUrl:               w.BuyUrl,
			ImageUrl:             w.ImageUrl,
			TargetDate:           tsPtr(w.TargetDate),
			Priority:             w.Priority,
			Status:               w.Status,
			Notes:                w.Notes,
			ReminderIntervalDays: w.ReminderIntervalDays,
			LastNotifiedAt:       tsPtr(w.LastNotifiedAt),
			PurchasedDeviceId:    w.PurchasedDeviceId,
			CreatedAt:            ts(w.CreatedAt),
			UpdatedAt:            ts(w.UpdatedAt),
			Prices:               []BackupWishlistPrice{},
		}
		for _, p := range priceByItem[w.ID] {
			bw.Prices = append(bw.Prices, BackupWishlistPrice{
				ID:         p.ID,
				Price:      p.Price,
				Note:       p.Note,
				RecordedAt: ts(p.RecordedAt),
			})
		}
		out.Wishlist = append(out.Wishlist, bw)
	}

	for _, d := range devices {
		bd := BackupDevice{
			ID:            d.ID,
			Name:          d.Name,
			Category:      d.Category,
			Brand:         d.Brand,
			Model:         d.Model,
			SerialNumber:  d.SerialNumber,
			PurchaseDate:  ts(d.PurchaseDate),
			PurchasePrice: d.PurchasePrice,
			PurchasePlace: d.PurchasePlace,
			Status:        d.Status,
			Notes:         d.Notes,
			CreatedAt:     ts(d.CreatedAt),
			UpdatedAt:     ts(d.UpdatedAt),
			Warranties:    []BackupWarranty{},
			Attachments:   []BackupAttachment{},
		}
		for _, w := range warByDevice[d.ID] {
			bw := BackupWarranty{
				ID:        w.ID,
				Type:      w.Type,
				Provider:  w.Provider,
				StartDate: ts(w.StartDate),
				EndDate:   ts(w.EndDate),
				Months:    w.Months,
				Cost:      w.Cost,
				Address:   w.Address,
				Phone:     w.Phone,
				Notes:     w.Notes,
				CreatedAt: ts(w.CreatedAt),
				UpdatedAt: ts(w.UpdatedAt),
				Reminders: []BackupReminder{},
			}
			for _, r := range remByWarranty[w.ID] {
				bw.Reminders = append(bw.Reminders, BackupReminder{
					ID:          r.ID,
					IsDismissed: r.IsDismissed,
					CreatedAt:   ts(r.CreatedAt),
				})
			}
			bd.Warranties = append(bd.Warranties, bw)
		}
		for _, a := range attByDevice[d.ID] {
			bd.Attachments = append(bd.Attachments, BackupAttachment{
				ID:          a.ID,
				FileName:    a.FileName,
				StoragePath: a.StoragePath,
				FileType:    a.FileType,
				FileSize:    a.FileSize,
				IV:          base64.StdEncoding.EncodeToString(a.Iv),
				WrappedKey:  base64.StdEncoding.EncodeToString(a.WrappedKey),
				Description: a.Description,
				UploadedAt:  ts(a.UploadedAt),
			})
		}
		out.Devices = append(out.Devices, bd)
	}

	return out, nil
}

// ---- Import ---------------------------------------------------------------

// ImportMode controls the wipe-first behavior.
type ImportMode string

const (
	ImportMerge   ImportMode = "merge"
	ImportReplace ImportMode = "replace"
)

// ImportBackup applies a v5 payload to the user. On `replace` we wipe the
// user's existing devices/subs/wishlist first (single transaction so a
// failure mid-import leaves the user's data untouched).
//
// Returns a typed *Error on validation failure (matches the handler's error
// envelope translator).
func ImportBackup(ctx context.Context, db *pgxpool.Pool, userID string, payload *BackupExport, mode ImportMode) (*ImportResult, error) {
	if payload == nil {
		return nil, &Error{Code: "VALIDATION", Message: "File JSON không hợp lệ"}
	}
	if payload.Version != 5 {
		return nil, &Error{Code: "VALIDATION", Message: "Định dạng backup không được hỗ trợ"}
	}
	if mode == "" {
		mode = ImportMerge
	}
	if mode != ImportMerge && mode != ImportReplace {
		return nil, &Error{Code: "VALIDATION", Message: "Mode không hợp lệ"}
	}

	// Pre-validate every device id + every attachment payload BEFORE touching
	// the database, so a malicious file cannot half-wipe the user's data in
	// replace mode.
	for _, d := range payload.Devices {
		if !safeIDRE.MatchString(d.ID) {
			return nil, &Error{Code: "VALIDATION", Message: fmt.Sprintf("ID thiết bị không hợp lệ: %s", d.ID)}
		}
		for _, a := range d.Attachments {
			if !safeStoragePathRE.MatchString(a.StoragePath) ||
				!strings.HasPrefix(a.StoragePath, d.ID+"/") {
				return nil, &Error{Code: "VALIDATION",
					Message: fmt.Sprintf("Đường dẫn file không hợp lệ trong \"%s\". File backup có thể đã bị sửa.", d.Name)}
			}
			iv, ivErr := base64.StdEncoding.DecodeString(a.IV)
			wk, wkErr := base64.StdEncoding.DecodeString(a.WrappedKey)
			if ivErr != nil || wkErr != nil || len(iv) != 12 || len(wk) < 28 {
				return nil, &Error{Code: "VALIDATION",
					Message: fmt.Sprintf("Khoá file hỏng trong \"%s\".", d.Name)}
			}
		}
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)
	q := store.New(tx)

	if mode == ImportReplace {
		// Order matters: child rows first to satisfy FK in the absence of
		// CASCADE delete (some FKs use CASCADE, but a single pass is safer).
		if err := q.BackupDeleteAttachmentsForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe attachments: %w", err)
		}
		if err := q.BackupDeleteRemindersForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe reminders: %w", err)
		}
		if err := q.BackupDeleteWarrantiesForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe warranties: %w", err)
		}
		if err := q.BackupDeleteWishlistPricesForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe wishlist prices: %w", err)
		}
		if err := q.BackupDeleteWishlistForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe wishlist: %w", err)
		}
		if err := q.BackupDeletePaymentsForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe payments: %w", err)
		}
		if err := q.BackupDeleteSubscriptionsForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe subscriptions: %w", err)
		}
		if err := q.BackupDeleteDevicesForUser(ctx, userID); err != nil {
			return nil, fmt.Errorf("wipe devices: %w", err)
		}
	}

	res := &ImportResult{}

	for _, d := range payload.Devices {
		if mode == ImportMerge {
			// Skip if user already owns a device with this id.
			if _, gerr := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: d.ID, UserId: userID}); gerr == nil {
				res.Skipped++
				continue
			}
		}
		if err := q.BackupInsertDevice(ctx, store.BackupInsertDeviceParams{
			ID:            d.ID,
			UserId:        userID,
			Name:          d.Name,
			Category:      d.Category,
			Brand:         d.Brand,
			Model:         d.Model,
			SerialNumber:  d.SerialNumber,
			PurchaseDate:  pgts(d.PurchaseDate),
			PurchasePrice: d.PurchasePrice,
			PurchasePlace: d.PurchasePlace,
			Status:        d.Status,
			Notes:         d.Notes,
			CreatedAt:     pgts(d.CreatedAt),
			UpdatedAt:     pgts(d.UpdatedAt),
		}); err != nil {
			return nil, fmt.Errorf("insert device: %w", err)
		}
		for _, w := range d.Warranties {
			if !safeIDRE.MatchString(w.ID) {
				continue
			}
			if err := q.BackupInsertWarranty(ctx, store.BackupInsertWarrantyParams{
				ID:        w.ID,
				DeviceId:  d.ID,
				Type:      w.Type,
				Provider:  w.Provider,
				StartDate: pgts(w.StartDate),
				EndDate:   pgts(w.EndDate),
				Months:    w.Months,
				Cost:      w.Cost,
				Address:   w.Address,
				Phone:     w.Phone,
				Notes:     w.Notes,
				CreatedAt: pgts(w.CreatedAt),
				UpdatedAt: pgts(w.UpdatedAt),
			}); err != nil {
				return nil, fmt.Errorf("insert warranty: %w", err)
			}
			for _, r := range w.Reminders {
				if !safeIDRE.MatchString(r.ID) {
					continue
				}
				if err := q.BackupInsertReminder(ctx, store.BackupInsertReminderParams{
					ID:          r.ID,
					WarrantyId:  w.ID,
					IsDismissed: r.IsDismissed,
					CreatedAt:   pgts(r.CreatedAt),
				}); err != nil {
					return nil, fmt.Errorf("insert reminder: %w", err)
				}
			}
		}
		for _, a := range d.Attachments {
			if !safeIDRE.MatchString(a.ID) {
				continue
			}
			iv, _ := base64.StdEncoding.DecodeString(a.IV)
			wk, _ := base64.StdEncoding.DecodeString(a.WrappedKey)
			if err := q.BackupInsertAttachment(ctx, store.BackupInsertAttachmentParams{
				ID:          a.ID,
				DeviceId:    d.ID,
				FileName:    a.FileName,
				StoragePath: a.StoragePath,
				FileType:    a.FileType,
				FileSize:    a.FileSize,
				Iv:          iv,
				WrappedKey:  wk,
				Description: a.Description,
				UploadedAt:  pgts(a.UploadedAt),
			}); err != nil {
				return nil, fmt.Errorf("insert attachment: %w", err)
			}
		}
		res.Imported++
	}

	for _, w := range payload.Wishlist {
		if !safeIDRE.MatchString(w.ID) {
			continue
		}
		// If purchasedDeviceId references a device this user does not own,
		// drop the link rather than failing.
		var purchasedDevice *string
		if w.PurchasedDeviceId != nil && *w.PurchasedDeviceId != "" {
			id := *w.PurchasedDeviceId
			if _, gerr := q.GetDeviceByID(ctx, store.GetDeviceByIDParams{ID: id, UserId: userID}); gerr == nil {
				purchasedDevice = &id
			}
		}
		if mode == ImportMerge {
			if _, gerr := q.GetWishlistByID(ctx, store.GetWishlistByIDParams{ID: w.ID, UserId: userID}); gerr == nil {
				res.WishlistSkipped++
				continue
			}
		}
		if err := q.BackupInsertWishlistItem(ctx, store.BackupInsertWishlistItemParams{
			ID:                   w.ID,
			UserId:               userID,
			Name:                 w.Name,
			Category:             w.Category,
			Brand:                w.Brand,
			InitialPrice:         w.InitialPrice,
			CurrentPrice:         w.CurrentPrice,
			BuyUrl:               w.BuyUrl,
			ImageUrl:             w.ImageUrl,
			TargetDate:           pgtsPtr(w.TargetDate),
			Priority:             w.Priority,
			Status:               w.Status,
			Notes:                w.Notes,
			ReminderIntervalDays: w.ReminderIntervalDays,
			LastNotifiedAt:       pgtsPtr(w.LastNotifiedAt),
			PurchasedDeviceId:    purchasedDevice,
			CreatedAt:            pgts(w.CreatedAt),
			UpdatedAt:            pgts(w.UpdatedAt),
		}); err != nil {
			return nil, fmt.Errorf("insert wishlist: %w", err)
		}
		for _, p := range w.Prices {
			if !safeIDRE.MatchString(p.ID) {
				continue
			}
			if err := q.BackupInsertWishlistPrice(ctx, store.BackupInsertWishlistPriceParams{
				ID:         p.ID,
				ItemId:     w.ID,
				Price:      p.Price,
				Note:       p.Note,
				RecordedAt: pgts(p.RecordedAt),
			}); err != nil {
				return nil, fmt.Errorf("insert wishlist price: %w", err)
			}
		}
		res.WishlistImported++
	}

	for _, s := range payload.Subscriptions {
		if !safeIDRE.MatchString(s.ID) {
			continue
		}
		if mode == ImportMerge {
			if _, gerr := q.GetSubscriptionByID(ctx, store.GetSubscriptionByIDParams{ID: s.ID, UserId: userID}); gerr == nil {
				res.SubSkipped++
				continue
			}
		}
		currency := s.Currency
		if currency == "" {
			currency = "VND"
		}
		if err := q.BackupInsertSubscription(ctx, store.BackupInsertSubscriptionParams{
			ID:            s.ID,
			UserId:        userID,
			Name:          s.Name,
			Category:      s.Category,
			Brand:         s.Brand,
			Plan:          s.Plan,
			BillingCycle:  s.BillingCycle,
			IntervalDays:  s.IntervalDays,
			Price:         s.Price,
			Currency:      currency,
			StartedAt:     pgts(s.StartedAt),
			RenewalDate:   pgts(s.RenewalDate),
			AutoRenew:     s.AutoRenew,
			Status:        s.Status,
			AccountEmail:  s.AccountEmail,
			PaymentMethod: s.PaymentMethod,
			ManageUrl:     s.ManageUrl,
			CancelUrl:     s.CancelUrl,
			Notes:         s.Notes,
			CreatedAt:     pgts(s.CreatedAt),
			UpdatedAt:     pgts(s.UpdatedAt),
		}); err != nil {
			return nil, fmt.Errorf("insert subscription: %w", err)
		}
		for _, p := range s.Payments {
			if !safeIDRE.MatchString(p.ID) {
				continue
			}
			if err := q.BackupInsertPayment(ctx, store.BackupInsertPaymentParams{
				ID:             p.ID,
				SubscriptionId: s.ID,
				Amount:         p.Amount,
				PaidAt:         pgts(p.PaidAt),
				Note:           p.Note,
			}); err != nil {
				return nil, fmt.Errorf("insert payment: %w", err)
			}
		}
		res.SubImported++
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return res, nil
}

// ---- helpers --------------------------------------------------------------

func ts(t pgtype.Timestamp) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format(time.RFC3339Nano)
}

func tsPtr(t pgtype.Timestamp) *string {
	if !t.Valid {
		return nil
	}
	s := t.Time.UTC().Format(time.RFC3339Nano)
	return &s
}

// pgts parses an RFC3339 (with or without nanos) or "YYYY-MM-DD" string into
// a pgtype.Timestamp. Empty / unparseable strings yield an invalid timestamp
// — caller is expected to have validated upstream.
func pgts(s string) pgtype.Timestamp {
	s = strings.TrimSpace(s)
	if s == "" {
		return pgtype.Timestamp{}
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return pgtype.Timestamp{Time: t.UTC(), Valid: true}
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return pgtype.Timestamp{Time: t.UTC(), Valid: true}
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return pgtype.Timestamp{Time: t.UTC(), Valid: true}
	}
	return pgtype.Timestamp{}
}

func pgtsPtr(s *string) pgtype.Timestamp {
	if s == nil {
		return pgtype.Timestamp{}
	}
	return pgts(*s)
}

