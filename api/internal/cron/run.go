// Package cron hosts the warranty-check job logic, used by both the CLI
// command (cmd/cron) and the protected HTTP endpoint
// (POST /v1/cron/warranty-check).
//
// Mirrors website/src/app/api/cron/warranty-check/route.ts byte-for-byte:
// same buckets, same Vietnamese strings, same auto-bill transaction, same
// per-row "delete on Gone" cleanup of dead PushSubscription rows.
package cron

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/push"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Stats summarises one Run pass. All counters are best-effort — failures on
// any one row are logged and skipped, never aborting the rest of the job.
type Stats struct {
	WarrantyNotices      int `json:"warrantyNotices"`
	WishlistTargetHits   int `json:"wishlistTargetHits"`
	WishlistCheckins     int `json:"wishlistCheckins"`
	SubscriptionRenewals int `json:"subscriptionRenewals"`
	SubscriptionExpired  int `json:"subscriptionExpired"`
	SessionsPruned       int `json:"sessionsPruned"`
	PushesSent           int `json:"pushesSent"`
	PushesFailed         int `json:"pushesFailed"`
	PushesGone           int `json:"pushesGone"`
}

// Dispatcher is the consumer-side contract the cron needs from the push
// package. *push.Dispatcher satisfies it; tests pass in a mock.
type Dispatcher interface {
	Send(sub push.Subscription, payload push.Payload) Result
}

// Result aliases push.Result so tests can build mocks without importing the
// push package's transport-specific bits.
type Result = push.Result

// Vietnamese day-bucket labels mirror the TS WARRANTY_TYPE_LABELS / wishlist /
// subscription strings exactly. Don't translate — copy verbatim.
var warrantyTypeLabels = map[string]string{
	"STANDARD":    "Tiêu chuẩn",
	"EXTENDED":    "Mở rộng",
	"THIRD_PARTY": "Bên thứ ba",
}

// dayWindow returns the [00:00 today+offset, 00:00 today+offset+1d) UTC
// window. Mirrors the TS dayWindow() helper which uses local-time setHours;
// we use UTC so the Postgres comparison is consistent regardless of the
// container's TZ. (DB TIMESTAMP columns are stored without TZ; we treat all
// dates as wall-clock UTC.)
func dayWindow(now time.Time, daysFromNow int) (time.Time, time.Time) {
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).
		AddDate(0, 0, daysFromNow)
	end := start.AddDate(0, 0, 1)
	return start, end
}

// formatVND mirrors website/src/lib/format.ts::formatVND. Vietnamese locale
// uses "." as thousands separator and a trailing " ₫".
func formatVND(amount int32) string {
	if amount == 0 {
		return "0 ₫"
	}
	n := int64(amount)
	neg := n < 0
	if neg {
		n = -n
	}
	// Build digits in reverse with thousand-dot separators.
	s := ""
	count := 0
	for n > 0 {
		if count > 0 && count%3 == 0 {
			s = "." + s
		}
		s = string(rune('0'+(n%10))) + s
		n /= 10
		count++
	}
	if neg {
		s = "-" + s
	}
	return s + " ₫"
}

// formatVi formats a date as dd/mm/yyyy (Vietnamese short form). Mirrors
// `Date.toLocaleDateString('vi-VN')` for our purposes (we deliberately don't
// pull in a full ICU locale).
func formatVi(t time.Time) string {
	return fmt.Sprintf("%02d/%02d/%d", t.Day(), int(t.Month()), t.Year())
}

// Run executes one full warranty-check pass. Safe to call concurrently with
// the rest of the API (it never holds a transaction longer than one
// auto-bill).
func Run(ctx context.Context, db *pgxpool.Pool, dispatcher Dispatcher) (Stats, error) {
	if db == nil {
		return Stats{}, errors.New("cron: nil db pool")
	}
	if dispatcher == nil {
		return Stats{}, errors.New("cron: nil dispatcher")
	}

	// Use the process's local time. dayWindow rolls back to 00:00 of the
	// current local day, mirroring the TS route's `new Date(); setHours(0,0,0,0)`.
	// All "TIMESTAMP without time zone" columns are wall-clock in the same
	// zone, so comparisons line up. Set TZ=Asia/Ho_Chi_Minh in deployment.
	now := time.Now()
	stats := Stats{}
	q := store.New(db)

	// Cache PushSubscription lists per user to avoid hammering the DB during
	// the fan-out loops. Same user shows up in many warranty / wishlist /
	// subscription buckets within one Run.
	pushCache := map[string][]push.Subscription{}
	pushFor := func(userID string) []push.Subscription {
		if subs, ok := pushCache[userID]; ok {
			return subs
		}
		rows, err := q.ListPushSubscriptionsByUser(ctx, userID)
		if err != nil {
			slog.Error("cron: list push subs failed", "user", userID, "err", err)
			pushCache[userID] = nil
			return nil
		}
		subs := make([]push.Subscription, 0, len(rows))
		for _, r := range rows {
			subs = append(subs, push.Subscription{
				ID:       r.ID,
				Platform: r.Platform,
				Endpoint: r.Endpoint,
				P256dh:   r.P256dh,
				Auth:     r.Auth,
			})
		}
		pushCache[userID] = subs
		return subs
	}

	// dispatch fans payload to every push sub of userID, accounting for
	// Gone/Failed counters and deleting dead rows.
	dispatch := func(userID string, payload push.Payload, kind string, extra ...any) {
		subs := pushFor(userID)
		for _, s := range subs {
			res := dispatcher.Send(s, payload)
			args := append([]any{
				"user", userID,
				"kind", kind,
				"platform", s.Platform,
				"sub", s.ID,
				"ok", res.Ok,
			}, extra...)
			if res.Ok {
				stats.PushesSent++
				slog.Info("push", args...)
				continue
			}
			if res.Gone {
				stats.PushesGone++
				if _, err := q.DeletePushSubscriptionByIDInternal(ctx, s.ID); err != nil {
					slog.Error("cron: delete gone push sub failed", "sub", s.ID, "err", err)
				}
				slog.Info("push", append(args, "gone", true, "err", res.Error)...)
				continue
			}
			stats.PushesFailed++
			slog.Warn("push", append(args, "err", res.Error)...)
		}
	}

	// ─── 1. Warranty expiry notices (7d / 30d) ─────────────────────────────
	for _, days := range []int{7, 30} {
		// TS uses dayWindow(bucket.days - 1) — the warranty endDate column is
		// midnight-of-day, so a bucket "7 days from now" matches rows whose
		// endDate falls in [now+6 00:00, now+7 00:00). Mirror that exactly.
		start, end := dayWindow(now, days-1)
		rows, err := q.ListWarrantiesInWindow(ctx, store.ListWarrantiesInWindowParams{
			EndDate:   pgtype.Timestamp{Time: start, Valid: true},
			EndDate_2: pgtype.Timestamp{Time: end, Valid: true},
		})
		if err != nil {
			return stats, fmt.Errorf("list warranties in window (%dd): %w", days, err)
		}
		for _, w := range rows {
			stats.WarrantyNotices++

			typeLabel := warrantyTypeLabels[w.Type]
			if typeLabel == "" {
				typeLabel = w.Type
			}
			endStr := ""
			if w.EndDate.Valid {
				endStr = formatVi(w.EndDate.Time)
			}
			body := "Hết hạn: " + endStr
			if w.Provider != nil && *w.Provider != "" {
				body += " • " + *w.Provider
			}

			payload := push.Payload{
				Title: fmt.Sprintf(`BH %s của "%s" sắp hết trong %d ngày`,
					typeLabel, w.DeviceName, days),
				Body: body,
				URL:  fmt.Sprintf("/devices/%s", w.DeviceId),
				Tag:  fmt.Sprintf("wv-%d-%s", days, w.ID),
			}
			dispatch(w.UserID, payload, "warranty",
				"warranty", w.ID, "device", w.DeviceId, "days", days)
		}
	}

	// ─── 2. Wishlist target-date buckets (today / +7 / +30) ────────────────
	for _, days := range []int{0, 7, 30} {
		start, end := dayWindow(now, days)
		rows, err := q.ListWishlistTargetDateDue(ctx, store.ListWishlistTargetDateDueParams{
			TargetDate:   pgtype.Timestamp{Time: start, Valid: true},
			TargetDate_2: pgtype.Timestamp{Time: end, Valid: true},
		})
		if err != nil {
			return stats, fmt.Errorf("list wishlist target-date due (%dd): %w", days, err)
		}
		for _, it := range rows {
			stats.WishlistTargetHits++

			priceText := ""
			if it.CurrentPrice != nil {
				priceText = " • " + formatVND(*it.CurrentPrice)
			} else if it.InitialPrice != nil {
				priceText = " • ~" + formatVND(*it.InitialPrice)
			}

			var headline string
			if days == 0 {
				headline = fmt.Sprintf(`🛍️ Hôm nay là ngày dự kiến mua "%s"`, it.Name)
			} else {
				headline = fmt.Sprintf(`🛍️ Còn %d ngày tới ngày mua "%s"`, days, it.Name)
			}

			tagPrefix := fmt.Sprintf("wl-d%d", days)
			payload := push.Payload{
				Title: headline,
				Body:  "Check lại giá nhé" + priceText,
				URL:   fmt.Sprintf("/wishlist/%s", it.ID),
				Tag:   fmt.Sprintf("%s-%s", tagPrefix, it.ID),
			}
			dispatch(it.UserId, payload, "wishlist_target",
				"item", it.ID, "days", days)

			if err := q.StampWishlistNotified(ctx, it.ID); err != nil {
				slog.Error("cron: stamp wishlist notified", "item", it.ID, "err", err)
			}
		}
	}

	// ─── 3. Wishlist periodic check-in pings ───────────────────────────────
	checkinRows, err := q.ListWishlistDueForCheckin(ctx)
	if err != nil {
		return stats, fmt.Errorf("list wishlist due for checkin: %w", err)
	}
	for _, it := range checkinRows {
		if it.ReminderIntervalDays == nil {
			continue
		}
		interval := *it.ReminderIntervalDays
		stats.WishlistCheckins++

		priceText := ""
		if it.CurrentPrice != nil {
			priceText = " • giá hiện tại " + formatVND(*it.CurrentPrice)
		}

		payload := push.Payload{
			Title: fmt.Sprintf(`🔔 Đã %d ngày chưa update giá "%s"`, interval, it.Name),
			Body:  "Còn thèm không? Check lại giá nhé" + priceText + ".",
			URL:   fmt.Sprintf("/wishlist/%s", it.ID),
			Tag:   fmt.Sprintf("wl-int-%s", it.ID),
		}
		dispatch(it.UserId, payload, "wishlist_checkin",
			"item", it.ID, "interval_days", interval)

		if err := q.StampWishlistNotified(ctx, it.ID); err != nil {
			slog.Error("cron: stamp wishlist notified (checkin)", "item", it.ID, "err", err)
		}
	}

	// ─── 4. Subscription renewal warnings (3 / 1 / 0 days) ─────────────────
	for _, days := range []int{3, 1, 0} {
		start, end := dayWindow(now, days)
		subs, err := q.ListSubscriptionsDueForRenewal(ctx, store.ListSubscriptionsDueForRenewalParams{
			RenewalDate:   pgtype.Timestamp{Time: start, Valid: true},
			RenewalDate_2: pgtype.Timestamp{Time: end, Valid: true},
		})
		if err != nil {
			return stats, fmt.Errorf("list subs due for renewal (%dd): %w", days, err)
		}
		for _, s := range subs {
			verb := "sẽ tự gia hạn"
			if !s.AutoRenew {
				verb = "sẽ hết hạn"
			}
			var head string
			if days == 0 {
				head = fmt.Sprintf(`💸 Hôm nay %s: "%s"`, verb, s.Name)
			} else {
				head = fmt.Sprintf(`💸 Còn %d ngày %s: "%s"`, days, verb, s.Name)
			}

			brand := ""
			if s.Brand != nil {
				brand = *s.Brand
			}
			body := formatVND(s.Price) + " • " + brand
			if s.CancelUrl != nil && *s.CancelUrl != "" {
				body += " • có link huỷ"
			}

			payload := push.Payload{
				Title: head,
				Body:  body,
				URL:   fmt.Sprintf("/subscriptions/%s", s.ID),
				Tag:   fmt.Sprintf("sub-d%d-%s", days, s.ID),
			}
			dispatch(s.UserId, payload, "subscription_renewal",
				"sub", s.ID, "days", days)
		}
	}

	// ─── 5. Subscription auto-bill / expire ────────────────────────────────
	todayStart, _ := dayWindow(now, 0)
	overdue, err := q.ListSubscriptionsOverdue(ctx,
		pgtype.Timestamp{Time: todayStart, Valid: true})
	if err != nil {
		return stats, fmt.Errorf("list subs overdue: %w", err)
	}
	for _, s := range overdue {
		if s.AutoRenew {
			oldRenewal := s.RenewalDate.Time
			next, derr := services.NextRenewalDate(oldRenewal, s.BillingCycle, s.IntervalDays)
			if derr != nil {
				slog.Error("cron: next renewal date", "sub", s.ID, "err", derr)
				continue
			}

			tx, txErr := db.BeginTx(ctx, pgx.TxOptions{})
			if txErr != nil {
				slog.Error("cron: begin auto-bill tx", "sub", s.ID, "err", txErr)
				continue
			}
			qtx := store.New(tx)
			payNote := "Auto-renew"
			if _, err := qtx.CreateSubscriptionPayment(ctx, store.CreateSubscriptionPaymentParams{
				ID:             uuid.NewString(),
				SubscriptionId: s.ID,
				Amount:         s.Price,
				PaidAt:         pgtype.Timestamp{Time: oldRenewal, Valid: true},
				Note:           &payNote,
			}); err != nil {
				_ = tx.Rollback(ctx)
				slog.Error("cron: create payment", "sub", s.ID, "err", err)
				continue
			}
			if _, err := qtx.AdvanceSubscriptionRenewal(ctx, store.AdvanceSubscriptionRenewalParams{
				ID:                    s.ID,
				RenewalDate:           pgtype.Timestamp{Time: next, Valid: true},
				LastNotifiedRenewalAt: pgtype.Timestamp{Time: now, Valid: true},
			}); err != nil {
				_ = tx.Rollback(ctx)
				slog.Error("cron: advance renewal", "sub", s.ID, "err", err)
				continue
			}
			if err := tx.Commit(ctx); err != nil {
				slog.Error("cron: commit auto-bill tx", "sub", s.ID, "err", err)
				continue
			}
			stats.SubscriptionRenewals++

			payload := push.Payload{
				Title: fmt.Sprintf(`✅ Đã gia hạn "%s"`, s.Name),
				Body: fmt.Sprintf("Tự động charge %s. Kỳ tới: %s",
					formatVND(s.Price), formatVi(next)),
				URL: fmt.Sprintf("/subscriptions/%s", s.ID),
				Tag: fmt.Sprintf("sub-billed-%s-%d", s.ID, oldRenewal.UnixMilli()),
			}
			dispatch(s.UserId, payload, "subscription_billed",
				"sub", s.ID, "amount", s.Price)
		} else {
			if _, err := q.ExpireSubscription(ctx, s.ID); err != nil {
				slog.Error("cron: expire sub", "sub", s.ID, "err", err)
				continue
			}
			stats.SubscriptionExpired++

			payload := push.Payload{
				Title: fmt.Sprintf(`⌛️ Gói "%s" đã hết hạn`, s.Name),
				Body:  "Không tự gia hạn — đăng ký lại hoặc đánh dấu huỷ.",
				URL:   fmt.Sprintf("/subscriptions/%s", s.ID),
				Tag:   fmt.Sprintf("sub-expired-%s", s.ID),
			}
			dispatch(s.UserId, payload, "subscription_expired",
				"sub", s.ID)
		}
	}

	// ─── 6. Pruning ────────────────────────────────────────────────────────
	pruned, err := q.PruneExpiredSessions(ctx)
	if err != nil {
		slog.Error("cron: prune expired sessions", "err", err)
	} else {
		stats.SessionsPruned = int(pruned)
	}

	return stats, nil
}
