// Package cron hosts the warranty-check job logic, used by both the CLI
// command (cmd/cron) and the protected HTTP endpoint
// (POST /api/v1/cron/warranty-check).
//
// Mirrors website/src/app/api/cron/warranty-check/route.ts for the buckets, the
// auto-bill transaction and the per-row "delete on Gone" cleanup of dead
// PushSubscription rows.
//
// # i18n
//
// Every notification body is rendered through internal/i18n in the RECIPIENT's
// language, read from `User.locale` (migration 0014) — this is the reason that
// column exists. There is no request here and therefore no `Accept-Language` and
// no caller to ask: a cron pass builds text for hundreds of users at once, each
// of whom may want a different language, so the stored preference is the only
// signal available. A user with no stored preference (locale IS NULL, i.e. every
// account that predates the column, and anyone who never opened the picker) gets
// the product default (English).
//
// The locale map is read ONCE per pass by loadLocales and then consulted per
// recipient, so a run costs one extra query in total rather than one per push.
//
// The date and money helpers below are locale-aware for the same reason:
// "05/07/2026" is 5 July to a Vietnamese reader and 7 May to an English one, and
// sending the wrong one is worse than sending an unformatted date.
package cron

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/sync/errgroup"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	"github.com/thanhtrung9368/warranty-vault/api/internal/push"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// pushFanoutLimit caps how many push deliveries run concurrently within a
// single dispatch() call. Mirrors the bound used by Snapshot in
// services/stats.go.
const pushFanoutLimit = 8

// Stats summarises one Run pass. All counters are best-effort — failures on
// any one row are logged and skipped, never aborting the rest of the job.
type Stats struct {
	WarrantyNotices      int `json:"warrantyNotices"`
	ReturnWindowNotices  int `json:"returnWindowNotices"`
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

// warrantyTypeLabels maps a Warranty.type code to its catalog key. The key is the
// Vietnamese label (the catalog is keyed on source text), so the push body for a
// Vietnamese recipient is byte-identical to what this job sent before i18n
// existed. A code the catalog does not know (a hand-edited row) falls through to
// the raw code at the call site.
var warrantyTypeLabels = map[string]string{
	"STANDARD":    "Tiêu chuẩn",
	"EXTENDED":    "Mở rộng",
	"THIRD_PARTY": "Bên thứ ba",
}

// loadLocales reads every stored language preference in one query and returns it
// as userId -> locale. Users who never chose one are simply absent, and the
// lookup below returns the default for them.
//
// A failure is NOT fatal: the run continues with every notification in the
// default language, which is what the whole service did before migration 0014.
// Losing a day's reminders because a preference could not be read would be a far
// worse outcome than one day of English.
func loadLocales(ctx context.Context, q *store.Queries) map[string]i18n.Tag {
	out := map[string]i18n.Tag{}
	rows, err := q.ListUserLocales(ctx)
	if err != nil {
		slog.Error("cron: list user locales failed; falling back to the default language", "err", err)
		return out
	}
	for _, r := range rows {
		if tag, ok := i18n.Normalize(derefString(r.Locale)); ok {
			out[r.ID] = tag
		}
	}
	return out
}

// derefString tolerates a NULL text column.
func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// render looks up a key that was COMPUTED rather than written out, and fills in
// its arguments. The lookup and the interpolation are separate steps because
// i18n.Translate is a printf-shaped function — deliberately, so that a
// hand-written `%` in a Vietnamese source string can never reach Sprintf — and
// `go vet` therefore rejects it for a key that arrives from a variable.
//
// An unknown key degrades to the key text itself, which is the Vietnamese source
// sentence, exactly as i18n.Translate does.
func render(tag i18n.Tag, key string, args ...any) string {
	text, ok := i18n.Lookup(tag, key)
	if !ok {
		text = key
	}
	return i18n.Interpolate(text, args...)
}

// renderCount renders one of a singular/plural KEY PAIR, taking a separate
// argument list for each form.
//
// The two lists are not a convenience: the singular template genuinely takes
// fewer verbs, because the count is what makes it singular — "expires in 1 day"
// has no slot for a number. Feeding the plural's argument list to the singular
// template produced `... expires in 1 day%!(EXTRA int=7)`, which is what the
// first version of this helper did and what
// internal/i18n/catalog_test.go::TestSingularPluralPairsAgreeOnVerbCounts now
// forbids.
//
// Both lists are passed on every call, so the caller states the count only once
// in each and neither branch can drift from the other.
func renderCount(tag i18n.Tag, n int, pluralKey, singularKey string, pluralArgs, singularArgs []any) string {
	if n == 1 {
		return render(tag, singularKey, singularArgs...)
	}
	return render(tag, pluralKey, pluralArgs...)
}

// pluralKey picks between a singular and a plural catalog key. Vietnamese does
// not inflect for number and English does ("1 day" / "3 days"), so the catalog
// carries both entries for each count-bearing message and the caller chooses.
//
// There is deliberately no plural-rule engine: the only counts that ever appear
// are 1, 3, 7 and 30, the choice is a single `== 1`, and pulling in
// golang.org/x/text/feature/plural plus its CLDR tables to answer it would be a
// large dependency for a boolean.
func pluralKey(n int, plural, singular string) string {
	if n == 1 {
		return singular
	}
	return plural
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

// formatVND renders an amount for a Vietnamese reader: "." thousands separator
// and a trailing " ₫". It mirrors website/src/lib/format.ts::formatVND and the
// locale-aware implementation now lives in i18n.FormatMoney, which also knows the
// English form ("₫1,200,000"). Kept as a named wrapper because the cron's own
// tests and its Vietnamese wording pin this exact output.
func formatVND(amount int32) string {
	return i18n.FormatMoney(i18n.VI, amount)
}

// formatVi formats a date as dd/mm/yyyy for a Vietnamese reader, mirroring
// `Date.toLocaleDateString('vi-VN')` (we deliberately do not pull in a full ICU
// locale). English notifications get i18n.FormatDate(i18n.EN, ...) instead —
// mm/dd/yyyy — because a bare "05/07/2026" is read differently in the two
// languages.
func formatVi(t time.Time) string {
	return i18n.FormatDate(i18n.VI, t)
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
	// statsMu guards the push counters in `stats`, which are now incremented
	// from multiple goroutines inside dispatch(). The non-push counters are
	// only touched on the (sequential) outer loops, so they need no lock.
	var statsMu sync.Mutex
	q := store.New(db)

	// Recipient language lookup. Read once for the whole pass — see loadLocales.
	locales := loadLocales(ctx, q)
	langOf := func(userID string) i18n.Tag {
		if tag, ok := locales[userID]; ok {
			return tag
		}
		return i18n.Default
	}

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
	// Gone/Failed counters and deleting dead rows. Deliveries run concurrently
	// (bounded by pushFanoutLimit) since each Send() is a blocking network
	// call; the stats counters are guarded by statsMu because they are now
	// written from multiple goroutines.
	dispatch := func(userID string, payload push.Payload, kind string, extra ...any) {
		subs := pushFor(userID)
		g, gctx := errgroup.WithContext(ctx)
		g.SetLimit(pushFanoutLimit)
		for _, s := range subs {
			s := s
			g.Go(func() error {
				res := dispatcher.Send(s, payload)
				args := append([]any{
					"user", userID,
					"kind", kind,
					"platform", s.Platform,
					"sub", s.ID,
					"ok", res.Ok,
				}, extra...)
				if res.Ok {
					statsMu.Lock()
					stats.PushesSent++
					statsMu.Unlock()
					slog.Info("push", args...)
					return nil
				}
				if res.Gone {
					statsMu.Lock()
					stats.PushesGone++
					statsMu.Unlock()
					if _, err := q.DeletePushSubscriptionByIDInternal(gctx, s.ID); err != nil {
						slog.Error("cron: delete gone push sub failed", "sub", s.ID, "err", err)
					}
					slog.Info("push", append(args, "gone", true, "err", res.Error)...)
					return nil
				}
				statsMu.Lock()
				stats.PushesFailed++
				statsMu.Unlock()
				slog.Warn("push", append(args, "err", res.Error)...)
				return nil
			})
		}
		// The goroutines never return an error (per-row failures are folded
		// into the counters), so Wait only serves as a barrier here.
		_ = g.Wait()
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

			lang := langOf(w.UserID)
			typeKey := warrantyTypeLabels[w.Type]
			if typeKey == "" {
				typeKey = w.Type
			}
			typeLabel := render(lang, typeKey)
			endStr := ""
			if w.EndDate.Valid {
				endStr = i18n.FormatDate(lang, w.EndDate.Time)
			}
			body := i18n.Translate(lang, "Hết hạn: %s", endStr)
			if w.Provider != nil && *w.Provider != "" {
				body = i18n.Translate(lang, "Hết hạn: %s • %s", endStr, *w.Provider)
			}

			payload := push.Payload{
				Title: renderCount(lang, days,
					"BH %s của \"%s\" sắp hết trong %d ngày",
					"BH %s của \"%s\" sắp hết trong 1 ngày",
					[]any{typeLabel, w.DeviceName, days},
					[]any{typeLabel, w.DeviceName}),
				Body: body,
				URL:  fmt.Sprintf("/devices/%s", w.DeviceId),
				Tag:  fmt.Sprintf("wv-%d-%s", days, w.ID),
			}
			dispatch(w.UserID, payload, "warranty",
				"warranty", w.ID, "device", w.DeviceId, "days", days)

			// Stamp Reminder.lastNotifiedAt so a 2nd cron run on the same day
			// is filtered out by ListWarrantiesInWindow. If no Reminder row
			// exists for this warranty yet, the query inserts one with
			// isDismissed=false. Dismissed reminders are still filtered by the
			// query's other NOT EXISTS clause, so this can't accidentally
			// re-show a warranty the user already dismissed.
			if err := q.StampWarrantyNotified(ctx, store.StampWarrantyNotifiedParams{
				WarrantyId: w.ID,
				ID:         uuid.NewString(),
			}); err != nil {
				slog.Error("cron: stamp warranty notified", "warranty", w.ID, "err", err)
			}
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

			lang := langOf(it.UserId)
			money := func(v int32) string { return i18n.FormatMoney(lang, v) }
			var body string
			switch {
			case it.CurrentPrice != nil:
				body = render(lang, "Check lại giá nhé • %s", money(*it.CurrentPrice))
			case it.InitialPrice != nil:
				body = render(lang, "Check lại giá nhé • ~%s", money(*it.InitialPrice))
			default:
				body = render(lang, "Check lại giá nhé")
			}

			var headline string
			if days == 0 {
				headline = render(lang, `🛍️ Hôm nay là ngày dự kiến mua "%s"`, it.Name)
			} else {
				headline = renderCount(lang, days,
					`🛍️ Còn %d ngày tới ngày mua "%s"`,
					`🛍️ Còn 1 ngày tới ngày mua "%s"`,
					[]any{days, it.Name},
					[]any{it.Name})
			}

			tagPrefix := fmt.Sprintf("wl-d%d", days)
			payload := push.Payload{
				Title: headline,
				Body:  body,
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

		lang := langOf(it.UserId)
		var checkinBody string
		if it.CurrentPrice != nil {
			checkinBody = render(lang, "Còn thèm không? Check lại giá nhé • giá hiện tại %s.",
				i18n.FormatMoney(lang, *it.CurrentPrice))
		} else {
			checkinBody = render(lang, "Còn thèm không? Check lại giá nhé.")
		}

		// English names the item first ("No price update for X in N days"),
		// Vietnamese names the count first; the English templates therefore get
		// the arguments in the other order.
		titleArgs, titleArgsSingular := []any{interval, it.Name}, []any{it.Name}
		if lang != i18n.VI {
			titleArgs, titleArgsSingular = []any{it.Name, interval}, []any{it.Name}
		}

		payload := push.Payload{
			Title: renderCount(lang, int(interval),
				`🔔 Đã %d ngày chưa update giá "%s"`,
				`🔔 Đã 1 ngày chưa update giá "%s"`,
				titleArgs, titleArgsSingular),
			Body: checkinBody,
			URL:  fmt.Sprintf("/wishlist/%s", it.ID),
			Tag:  fmt.Sprintf("wl-int-%s", it.ID),
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
			lang := langOf(s.UserId)
			verbKey := "sẽ tự gia hạn"
			if !s.AutoRenew {
				verbKey = "sẽ hết hạn"
			}
			verb := render(lang, verbKey)

			// The English phrasing names the subscription first and the verb
			// last, the Vietnamese one does the opposite, so the argument ORDER
			// differs per language. That is why the call site builds the list
			// instead of one template serving both (docs/I18N_PLAN.md §4.4).
			var head string
			// The renewal push has three forms: "today", "in N days", "tomorrow".
			// The first two are grammatically the plural/zero bucket and the third
			// is the singular one, so renderCount's `n == 1` split handles it.
			switch {
			case days == 0 && lang == i18n.VI:
				head = render(lang, `💸 Hôm nay %s: "%s"`, verb, s.Name)
			case days == 0:
				head = render(lang, `💸 Hôm nay %s: "%s"`, s.Name, verb)
			case lang == i18n.VI:
				head = renderCount(lang, days,
					`💸 Còn %d ngày %s: "%s"`,
					`💸 Còn 1 ngày %s: "%s"`,
					[]any{days, verb, s.Name},
					[]any{verb, s.Name})
			default:
				head = renderCount(lang, days,
					`💸 Còn %d ngày %s: "%s"`,
					`💸 Còn 1 ngày %s: "%s"`,
					[]any{days, s.Name, verb},
					[]any{s.Name, verb})
			}

			brand := ""
			if s.Brand != nil {
				brand = *s.Brand
			}
			body := i18n.FormatMoney(lang, s.Price) + " • " + brand
			if s.CancelUrl != nil && *s.CancelUrl != "" {
				body += render(lang, " • có link huỷ")
			}

			payload := push.Payload{
				Title: head,
				Body:  body,
				URL:   fmt.Sprintf("/subscriptions/%s", s.ID),
				Tag:   fmt.Sprintf("sub-d%d-%s", days, s.ID),
			}
			dispatch(s.UserId, payload, "subscription_renewal",
				"sub", s.ID, "days", days)

			// Stamp lastNotifiedRenewalAt so a 2nd same-day cron run skips this
			// row in ListSubscriptionsDueForRenewal. Cron firing across the 3
			// different timing buckets (3/1/0d) doesn't collide because a given
			// sub's renewalDate only matches one bucket per run.
			if err := q.StampSubscriptionRenewalNotified(ctx, s.ID); err != nil {
				slog.Error("cron: stamp subscription renewal notified",
					"sub", s.ID, "err", err)
			}
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

			lang := langOf(s.UserId)
			payload := push.Payload{
				Title: render(lang, `✅ Đã gia hạn "%s"`, s.Name),
				Body: render(lang, "Tự động charge %s. Kỳ tới: %s",
					i18n.FormatMoney(lang, s.Price), i18n.FormatDate(lang, next)),
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

			lang := langOf(s.UserId)
			payload := push.Payload{
				Title: render(lang, `⌛️ Gói "%s" đã hết hạn`, s.Name),
				Body:  render(lang, "Không tự gia hạn — đăng ký lại hoặc đánh dấu huỷ."),
				URL:   fmt.Sprintf("/subscriptions/%s", s.ID),
				Tag:   fmt.Sprintf("sub-expired-%s", s.ID),
			}
			dispatch(s.UserId, payload, "subscription_expired",
				"sub", s.ID)
		}
	}

	// ─── 6. Return / exchange window closing (T-3 / T-1) ───────────────────
	//
	// The deadline is NOT "Warranty"."endDate" — it is
	// COALESCE("receivedAt", "purchaseDate") + "returnWindowDays", which belongs to
	// no warranty package. That is why this bucket reads "Device" directly and
	// stamps "Device"."returnWindowNotifiedAt" instead of writing a "Reminder" row:
	// "Reminder"."isDismissed" is the push gate for the warranty buckets, and
	// putting a second kind of item in that table can silence a real warranty
	// notice (docs/SPEC-MAINTENANCE-SCHEDULES.md §2.3).
	//
	// T-3 and T-1 mirror the feature's lead times.
	//
	// These buckets use dayWindow(now, days) — NOT dayWindow(now, days-1) the way
	// the warranty bucket does — and the difference is deliberate: returnDeadline
	// is an INCLUSIVE last day. services.DaysUntil(deadline, now) is 0 on the
	// deadline itself and ListOpenReturnWindows still lists the device that day,
	// so "còn 3 ngày" is exactly the deadline == now+3 bucket, i.e.
	// [now+3 00:00, now+4 00:00). "Warranty"."endDate" is read the other way by
	// the existing buckets (an endDate of now+6 is announced as "7 ngày"), which is
	// established behaviour for that column and is not changed here.
	// A given device's deadline can fall in only one bucket per run.
	for _, days := range []int{3, 1} {
		start, end := dayWindow(now, days)
		rows, err := q.ListReturnWindowsInWindow(ctx, store.ListReturnWindowsInWindowParams{
			WindowStart: pgtype.Timestamp{Time: start, Valid: true},
			WindowEnd:   pgtype.Timestamp{Time: end, Valid: true},
		})
		if err != nil {
			return stats, fmt.Errorf("list return windows in window (%dd): %w", days, err)
		}
		for _, d := range rows {
			stats.ReturnWindowNotices++

			lang := langOf(d.UserID)
			deadline := ""
			if d.ReturnDeadline.Valid {
				deadline = i18n.FormatDate(lang, d.ReturnDeadline.Time)
			}
			body := render(lang, "Hạn đổi/trả: %s", deadline)
			if d.ReturnWindowDays != nil {
				body = renderCount(lang, int(*d.ReturnWindowDays),
					"Hạn đổi/trả: %s (%d ngày kể từ ngày nhận)",
					"Hạn đổi/trả: %s (1 ngày kể từ ngày nhận)",
					[]any{deadline, *d.ReturnWindowDays},
					[]any{deadline})
			}

			payload := push.Payload{
				Title: renderCount(lang, days,
					`↩️ Còn %d ngày đổi trả "%s"`,
					`↩️ Còn 1 ngày đổi trả "%s"`,
					[]any{days, d.DeviceName},
					[]any{d.DeviceName}),
				Body: body,
				URL:  fmt.Sprintf("/devices/%s", d.ID),
				Tag:  fmt.Sprintf("wv-return-%d-%s", days, d.ID),
			}
			dispatch(d.UserID, payload, "return_window",
				"device", d.ID, "days", days)

			// Same-day idempotency, same pattern as StampWarrantyNotified: a second
			// run today is filtered out by ListReturnWindowsInWindow.
			if err := q.StampDeviceReturnWindowNotified(ctx, d.ID); err != nil {
				slog.Error("cron: stamp device return window notified", "device", d.ID, "err", err)
			}
		}
	}

	// ─── 7. Pruning ────────────────────────────────────────────────────────
	pruned, err := q.PruneExpiredSessions(ctx)
	if err != nil {
		slog.Error("cron: prune expired sessions", "err", err)
	} else {
		stats.SessionsPruned = int(pruned)
	}

	// Share links (FEATURE_IDEAS #2) die 30 days after they expire, so the table
	// does not grow forever. Same housekeeping step, same "log and carry on"
	// contract as the session prune: a failure here must not fail the cron run.
	if _, err := q.PruneExpiredShares(ctx, pgtype.Timestamp{Time: time.Now(), Valid: true}); err != nil {
		slog.Error("cron: prune expired shares", "err", err)
	}

	return stats, nil
}
