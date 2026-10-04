// Package services / backup_ids.go — the cross-account id guard (roadmap: "Import
// with a foreign id returns 500").
//
// Every entity table in this schema uses a *global* text primary key: two accounts
// cannot own rows with the same id. A backup file imported into a different
// account therefore collides with the exporter's rows, and the insert fails on the
// primary key — which the handler can only render as a 500.
//
// Decision: REFUSE with a clear 400, do not remap.
//
//   * Remapping would have to rewrite the whole id graph (device → warranty →
//     reminder, device → attachment, wishlist item → price, subscription →
//     payment) *and* each attachment's on-disk `storagePath`, which embeds the
//     device id. One missed edge silently corrupts the restored account.
//   * It would also break merge idempotency: after a remap the file's ids no
//     longer exist in the database, so importing the same file twice would
//     duplicate everything instead of skipping.
//   * The message names the entity and the id, so the user can tell that the file
//     belongs to another account — a state a remap would hide.
//
// The check runs before the transaction (and before any blob is written), so a
// rejected import touches nothing.

package services

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// assertNoForeignBackupIDs returns a VALIDATION error when any id in the payload
// already exists under a different account. Rows owned by the importing user are
// ignored: merge mode skips them, and replace mode deletes them first.
func assertNoForeignBackupIDs(ctx context.Context, db *pgxpool.Pool, userID string, payload *BackupExport) error {
	q := store.New(db)

	deviceIDs := make([]string, 0, len(payload.Devices))
	var warrantyIDs, reminderIDs, attachmentIDs []string
	for _, d := range payload.Devices {
		if safeIDRE.MatchString(d.ID) {
			deviceIDs = append(deviceIDs, d.ID)
		}
		for _, w := range d.Warranties {
			if safeIDRE.MatchString(w.ID) {
				warrantyIDs = append(warrantyIDs, w.ID)
			}
			for _, r := range w.Reminders {
				if safeIDRE.MatchString(r.ID) {
					reminderIDs = append(reminderIDs, r.ID)
				}
			}
		}
		for _, a := range d.Attachments {
			if safeIDRE.MatchString(a.ID) {
				attachmentIDs = append(attachmentIDs, a.ID)
			}
		}
	}
	wishlistIDs := make([]string, 0, len(payload.Wishlist))
	var priceIDs []string
	for _, w := range payload.Wishlist {
		if safeIDRE.MatchString(w.ID) {
			wishlistIDs = append(wishlistIDs, w.ID)
		}
		for _, p := range w.Prices {
			if safeIDRE.MatchString(p.ID) {
				priceIDs = append(priceIDs, p.ID)
			}
		}
	}
	subIDs := make([]string, 0, len(payload.Subscriptions))
	var paymentIDs []string
	for _, s := range payload.Subscriptions {
		if safeIDRE.MatchString(s.ID) {
			subIDs = append(subIDs, s.ID)
		}
		for _, p := range s.Payments {
			if safeIDRE.MatchString(p.ID) {
				paymentIDs = append(paymentIDs, p.ID)
			}
		}
	}

	type probe struct {
		// label names the entity in the internal error below (a log line, never
		// translated) AND in the user-facing refusal, where it is interpolated into
		// a sentence. That second use means it must pass through `i18n.Text`, which
		// is why the seven entity names have catalog entries: "thiết bị" →
		// "device", "gói bảo hành" → "warranty", and so on. "subscription"
		// deliberately has none — it is the same word in both languages, and a key
		// the catalog does not know renders as the key itself.
		label string
		ids   []string
		find  func([]string) ([]string, error)
	}
	probes := []probe{
		{"thiết bị", deviceIDs, func(ids []string) ([]string, error) {
			return q.BackupFindForeignDeviceIDs(ctx, store.BackupFindForeignDeviceIDsParams{Ids: ids, UserId: userID})
		}},
		{"gói bảo hành", warrantyIDs, func(ids []string) ([]string, error) {
			return q.BackupFindForeignWarrantyIDs(ctx, store.BackupFindForeignWarrantyIDsParams{Ids: ids, UserId: userID})
		}},
		{"nhắc nhở", reminderIDs, func(ids []string) ([]string, error) {
			return q.BackupFindForeignReminderIDs(ctx, store.BackupFindForeignReminderIDsParams{Ids: ids, UserId: userID})
		}},
		{"file đính kèm", attachmentIDs, func(ids []string) ([]string, error) {
			return q.BackupFindForeignAttachmentIDs(ctx, store.BackupFindForeignAttachmentIDsParams{Ids: ids, UserId: userID})
		}},
		{"món wishlist", wishlistIDs, func(ids []string) ([]string, error) {
			return q.BackupFindForeignWishlistIDs(ctx, store.BackupFindForeignWishlistIDsParams{Ids: ids, UserId: userID})
		}},
		{"lịch sử giá", priceIDs, func(ids []string) ([]string, error) {
			return q.BackupFindForeignWishlistPriceIDs(ctx, store.BackupFindForeignWishlistPriceIDsParams{Ids: ids, UserId: userID})
		}},
		{"subscription", subIDs, func(ids []string) ([]string, error) {
			return q.BackupFindForeignSubscriptionIDs(ctx, store.BackupFindForeignSubscriptionIDsParams{Ids: ids, UserId: userID})
		}},
		{"thanh toán", paymentIDs, func(ids []string) ([]string, error) {
			return q.BackupFindForeignPaymentIDs(ctx, store.BackupFindForeignPaymentIDsParams{Ids: ids, UserId: userID})
		}},
	}

	for _, p := range probes {
		if len(p.ids) == 0 {
			continue
		}
		conflicts, err := p.find(p.ids)
		if err != nil {
			return fmt.Errorf("check foreign %s ids: %w", p.label, err)
		}
		if len(conflicts) > 0 {
			return &Error{Code: "VALIDATION", Message: i18n.T(ctx,
				"Bản sao lưu chứa dữ liệu của một tài khoản khác: id %s \"%s\" đã tồn tại. Không thể khôi phục bản sao lưu này vào tài khoản hiện tại — hãy đăng nhập đúng tài khoản đã xuất bản sao lưu.",
				i18n.Text(ctx, p.label), conflicts[0])}
		}
	}
	return nil
}
