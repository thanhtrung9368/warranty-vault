package services

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// "Việc cần xử lý" — the action queue (FEATURE_IDEAS #3).
//
// The app knows enough to ask but never asks: a warranty that expired yesterday
// falls off every screen (listUpcomingReminders only looks FORWARD —
// `w."endDate" >= endDateFrom`), `Device.status` is never moved to EXPIRED by
// anything (services/devices.go only validates the enum), and `Reminder` has no
// time field so "hoãn 90 ngày" cannot be expressed there.
//
// Two design rules govern this file:
//
//  1. Every item is DERIVED from rows that already exist. Nothing here invents a
//     state the schema cannot support. Where a rule the feature doc suggested
//     could not be derived, the item was reformulated to what the data actually
//     says (see SUBSCRIPTION_PAID_NOT_ADVANCED) instead of guessing.
//  2. SNOOZES LIVE IN THEIR OWN TABLE, never in "Reminder".
//     "Reminder"."isDismissed" is the push gate for warranty notices: both
//     ListWarrantiesInWindow and CountActiveReminders carry
//     `NOT EXISTS (... isDismissed = true)`, so a generic snooze row written into
//     that table would silence a real warranty push. That is the loudest warning
//     in docs/FEATURE_IDEAS.md and §2.3 of docs/SPEC-MAINTENANCE-SCHEDULES.md.
//     "Reminder" also has no time column to snooze against and its "warrantyId" is
//     NOT NULL, so it could not represent a device- or subscription-level item
//     anyway. See migration 0011.

// Severities, ordered HIGH > MEDIUM > LOW by actionSeverityRank.
const (
	ActionSeverityHigh   = "HIGH"
	ActionSeverityMedium = "MEDIUM"
	ActionSeverityLow    = "LOW"
)

// Item kinds. Stable machine codes — clients switch on these to decide which
// buttons to render; the Vietnamese title/detail are display-only. The full list
// is documented in openapi.yaml.
const (
	ActionWarrantyExpired        = "WARRANTY_EXPIRED"
	ActionDeviceNoWarranty       = "DEVICE_NO_WARRANTY"
	ActionDeviceStatusStale      = "DEVICE_STATUS_STALE"
	ActionDeviceMissingSerial    = "DEVICE_MISSING_SERIAL"
	ActionDeviceMissingReceipt   = "DEVICE_MISSING_RECEIPT"
	ActionReturnWindowClosing    = "RETURN_WINDOW_CLOSING"
	ActionReturnWindowUnknown    = "RETURN_WINDOW_UNKNOWN"
	ActionSubRenewingNoCancelURL = "SUBSCRIPTION_RENEWING_NO_CANCEL_URL"
	ActionSubPaidNotAdvanced     = "SUBSCRIPTION_PAID_NOT_ADVANCED"
	ActionWishlistTargetPassed   = "WISHLIST_TARGET_PASSED"
)

// Thresholds. Named constants with a stated reason, because each one is a product
// decision rather than a fact, and each is pinned by a test.
const (
	// ActionWarrantyExpiredLookbackDays bounds how far back "vừa hết hạn" reaches.
	// 90 days is long enough to still buy an extended package or sell the device,
	// and short enough that the queue cannot fill up with a decade of history. It
	// also splits cleanly against DEVICE_STATUS_STALE, which owns "older than this".
	ActionWarrantyExpiredLookbackDays = 90
	// ActionReturnWindowClosingDays is the horizon for "sắp hết hạn đổi trả".
	// 7 days is the smallest window in which a person can still find the invoice,
	// the box and a free afternoon; a shorter one would fire when acting is
	// already unrealistic. Cron separately warns at T-3 and T-1.
	ActionReturnWindowClosingDays = 7
	// ActionReturnWindowUnknownDays is how long after purchase the app asks for the
	// exchange-window length. 30 days is the most common window in VN retail, so
	// asking inside it covers the whole period during which the answer still
	// matters — and it is the only moment the user still remembers the number.
	ActionReturnWindowUnknownDays = 30
	// ActionSubRenewalHorizonDays is how close a charge must be before "no cancel
	// link" becomes worth acting on. 14 days matches the audit's own horizon and
	// gives a full billing cycle of slack for a monthly plan.
	ActionSubRenewalHorizonDays = 14
)

// Snooze bounds. A snooze is an acknowledgement with an expiry, not a delete:
// SnoozeDaysDefault (90) is the "để đó 90 ngày" the feature doc asks for, and the
// 365-day cap keeps a snooze from outliving the item it hides.
const (
	SnoozeDaysDefault = 90
	SnoozeDaysMin     = 1
	SnoozeDaysMax     = 365
	// MaxSnoozesPerUser is a hard stop, not an expected value. The write path
	// already refuses keys that are not the caller's own derived items, so the
	// reachable maximum is bounded by the per-user row caps; this constant exists
	// so a future item kind cannot quietly make the table unbounded.
	MaxSnoozesPerUser = 500
)

// ActionItem is one derived thing that needs the user to decide something. Every
// field beyond the identifiers is display-ready Vietnamese; `AmountVnd` is int64
// because it is a money value on its way to a client.
type ActionItem struct {
	ItemKey  string `json:"itemKey"`
	Kind     string `json:"kind"`
	Severity string `json:"severity"`
	Title    string `json:"title"`
	Detail   string `json:"detail"`

	DeviceID       *string `json:"deviceId,omitempty"`
	WarrantyID     *string `json:"warrantyId,omitempty"`
	SubscriptionID *string `json:"subscriptionId,omitempty"`
	WishlistItemID *string `json:"wishlistItemId,omitempty"`

	// DueDate is the date the item is about (warranty end, return deadline,
	// renewal date, wishlist target) — RFC3339Nano UTC, or absent when the item
	// has no single date.
	DueDate *string `json:"dueDate,omitempty"`
	// AmountVnd is the money the item is about, when there is one (VND, int64).
	AmountVnd *int64 `json:"amountVnd,omitempty"`
	// SnoozedUntil is present only on rows returned by `?snoozed=true`, i.e. rows
	// the default queue hides. Absent means "actionable now".
	SnoozedUntil *string `json:"snoozedUntil,omitempty"`
}

// ActionCounts counts the ACTIONABLE items — never the snoozed ones — so a
// dashboard badge reading `counts.total` cannot be inflated by things the user
// already deferred.
type ActionCounts struct {
	Total  int `json:"total"`
	High   int `json:"high"`
	Medium int `json:"medium"`
	Low    int `json:"low"`
}

// ActionQueue is the GET /api/v1/actions payload.
type ActionQueue struct {
	GeneratedAt string       `json:"generatedAt"`
	Items       []ActionItem `json:"items"`
	Counts      ActionCounts `json:"counts"`
	// SnoozedCount is how many of the user's items are currently hidden by a
	// snooze, even when `items` does not include them — so a client can render
	// "N việc đang hoãn" and link to the un-snooze list.
	SnoozedCount int    `json:"snoozedCount"`
	Note         string `json:"note"`
}

// SnoozeResult is the POST /api/v1/actions/{itemKey}/snooze response.
type SnoozeResult struct {
	ItemKey      string `json:"itemKey"`
	SnoozedUntil string `json:"snoozedUntil"`
	Days         int    `json:"days"`
}

// ActionItemKey builds the stable identity of a derived item: `<KIND>:<entityId>`.
// Entity ids are immutable, so the key survives any edit to the item's payload or
// copy. Neither part contains a ':' (kinds are UPPER_SNAKE, ids are cuid/uuid),
// which is what makes ParseActionItemKey unambiguous.
func ActionItemKey(kind, entityID string) string { return kind + ":" + entityID }

// ParseActionItemKey splits a key back into (kind, entityId). ok=false for
// anything that is not `<known kind>:<non-empty id>` — the handler answers 400
// rather than 404 for those, so a typo is not reported as "this item is gone".
func ParseActionItemKey(key string) (kind, entityID string, ok bool) {
	kind, entityID, found := strings.Cut(key, ":")
	if !found || entityID == "" || strings.Contains(entityID, ":") {
		return "", "", false
	}
	if !isKnownActionKind(kind) {
		return "", "", false
	}
	return kind, entityID, true
}

// IsKnownActionKind reports whether `kind` is one of the item kinds this build
// can derive. Exported for the handler's request validation.
func IsKnownActionKind(kind string) bool { return isKnownActionKind(kind) }

func isKnownActionKind(kind string) bool {
	switch kind {
	case ActionWarrantyExpired, ActionDeviceNoWarranty, ActionDeviceStatusStale,
		ActionDeviceMissingSerial, ActionDeviceMissingReceipt,
		ActionReturnWindowClosing, ActionReturnWindowUnknown,
		ActionSubRenewingNoCancelURL, ActionSubPaidNotAdvanced,
		ActionWishlistTargetPassed:
		return true
	}
	return false
}

// actionSeverityRank orders the queue: the money-losing, time-boxed items first.
func actionSeverityRank(severity string) int {
	switch severity {
	case ActionSeverityHigh:
		return 0
	case ActionSeverityMedium:
		return 1
	default:
		return 2
	}
}

// ListActionItems builds the queue for one user.
//
// `includeSnoozed = false` (the default every client gets) returns only what is
// actionable now. `includeSnoozed = true` ADDS the snoozed rows, each carrying
// `snoozedUntil` — the same "the flag only ever reveals rows, never removes them"
// contract the reminders feed uses for `includeDismissed`. `counts` always counts
// the actionable subset so a badge never changes meaning with the flag.
func ListActionItems(ctx context.Context, db *pgxpool.Pool, userID string, now time.Time, includeSnoozed bool) (ActionQueue, error) {
	q := store.New(db)

	items, err := deriveActionItems(ctx, q, userID, now)
	if err != nil {
		return ActionQueue{}, err
	}

	snoozes, err := q.ListActiveSnoozesByUser(ctx, store.ListActiveSnoozesByUserParams{
		UserId:       userID,
		SnoozedUntil: pgtype.Timestamp{Time: now.UTC(), Valid: true},
	})
	if err != nil {
		return ActionQueue{}, fmt.Errorf("list active snoozes: %w", err)
	}
	snoozedByKey := make(map[string]time.Time, len(snoozes))
	for _, s := range snoozes {
		if s.SnoozedUntil.Valid {
			snoozedByKey[s.ItemKey] = s.SnoozedUntil.Time
		}
	}

	visible := make([]ActionItem, 0, len(items))
	var snoozedCount int
	for _, it := range items {
		until, snoozed := snoozedByKey[it.ItemKey]
		if !snoozed {
			visible = append(visible, it)
			continue
		}
		snoozedCount++
		if includeSnoozed {
			s := until.UTC().Format(time.RFC3339Nano)
			it.SnoozedUntil = &s
			visible = append(visible, it)
		}
	}

	// Sort AFTER filtering: the visible slice is what the client renders, and
	// sorting the union first would cost work for rows that were dropped.
	sortActionItems(visible)

	counts := ActionCounts{}
	for _, it := range visible {
		if it.SnoozedUntil != nil {
			continue
		}
		counts.Total++
		switch it.Severity {
		case ActionSeverityHigh:
			counts.High++
		case ActionSeverityMedium:
			counts.Medium++
		default:
			counts.Low++
		}
	}

	return ActionQueue{
		GeneratedAt:  now.UTC().Format(time.RFC3339Nano),
		Items:        visible,
		Counts:       counts,
		SnoozedCount: snoozedCount,
		Note:         actionQueueNoteVN,
	}, nil
}

// actionQueueNoteVN is returned with every queue so no client has to guess what
// the list is. It says plainly what the queue is NOT: a reminder feed, or advice.
const actionQueueNoteVN = "Danh sách này chỉ gồm những việc app TỰ SUY RA từ dữ liệu bạn đã nhập và không tự quyết được. Nó không phải thông báo đẩy — bảo hiểm/bảo hành vẫn nhắc riêng theo mốc ngày. Hoãn một việc ở đây không ảnh hưởng tới nhắc bảo hành."

// SnoozeActionItem hides one derived item until now+days, for this user, on every
// device. The key is validated against the caller's OWN derived items, which is
// what makes the table safe: a key that belongs to another account is never
// derived for this userID, so it can never be snoozed (and never leaks whether it
// exists).
func SnoozeActionItem(ctx context.Context, db *pgxpool.Pool, userID, itemKey string, days int, now time.Time) (SnoozeResult, error) {
	if days == 0 {
		days = SnoozeDaysDefault
	}
	if days < SnoozeDaysMin || days > SnoozeDaysMax {
		return SnoozeResult{}, ErrValidation(FieldErrors{
			"days": {fmt.Sprintf("Số ngày hoãn phải từ %d tới %d", SnoozeDaysMin, SnoozeDaysMax)},
		})
	}

	q := store.New(db)
	items, err := deriveActionItems(ctx, q, userID, now)
	if err != nil {
		return SnoozeResult{}, err
	}
	if !containsItemKey(items, itemKey) {
		return SnoozeResult{}, ErrNotFound("Không tìm thấy việc cần xử lý này")
	}

	// Re-snoozing an already snoozed item is allowed and simply moves the
	// deadline; only a NEW key can hit the per-user cap, so an existing row is
	// never blocked by it.
	if _, err := q.GetDecisionSnooze(ctx, store.GetDecisionSnoozeParams{UserId: userID, ItemKey: itemKey}); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return SnoozeResult{}, fmt.Errorf("get snooze: %w", err)
		}
		count, cerr := q.CountSnoozesByUser(ctx, userID)
		if cerr != nil {
			return SnoozeResult{}, fmt.Errorf("count snoozes: %w", cerr)
		}
		if count >= MaxSnoozesPerUser {
			return SnoozeResult{}, ErrLimit(fmt.Sprintf(
				"Đã đạt giới hạn %d việc đang hoãn. Bỏ hoãn bớt rồi thử lại.", MaxSnoozesPerUser))
		}
	}

	until := now.AddDate(0, 0, days)
	row, err := q.UpsertDecisionSnooze(ctx, store.UpsertDecisionSnoozeParams{
		ID:           auth.NewID(),
		UserId:       userID,
		ItemKey:      itemKey,
		SnoozedUntil: pgtype.Timestamp{Time: until.UTC(), Valid: true},
	})
	if err != nil {
		return SnoozeResult{}, fmt.Errorf("upsert snooze: %w", err)
	}
	return SnoozeResult{
		ItemKey:      row.ItemKey,
		SnoozedUntil: row.SnoozedUntil.Time.UTC().Format(time.RFC3339Nano),
		Days:         days,
	}, nil
}

// UnSnoozeActionItem removes a snooze so the item is actionable again. The row is
// deleted rather than back-dated: there is nothing to keep.
func UnSnoozeActionItem(ctx context.Context, db *pgxpool.Pool, userID, itemKey string) error {
	rows, err := store.New(db).DeleteDecisionSnooze(ctx, store.DeleteDecisionSnoozeParams{
		UserId:  userID,
		ItemKey: itemKey,
	})
	if err != nil {
		return fmt.Errorf("delete snooze: %w", err)
	}
	if rows == 0 {
		return ErrNotFound("Việc này không đang được hoãn")
	}
	return nil
}

// ─── derivation ───────────────────────────────────────────────────────────

// deriveActionItems runs every rule against the user's rows. No snooze filtering
// happens here — callers that need the raw set (the write path's ownership check)
// use it directly, which is why `includeSnoozed` semantics live one level up.
//
// The rules are run sequentially rather than through an errgroup: each one is a
// small index-backed aggregate over at most 50 devices / 100 subscriptions / 200
// wishlist items, and the first error tells the caller which rule failed.
func deriveActionItems(ctx context.Context, q *store.Queries, userID string, now time.Time) ([]ActionItem, error) {
	startOfToday := startOfDay(now)
	ts := func(t time.Time) pgtype.Timestamp { return pgtype.Timestamp{Time: t.UTC(), Valid: true} }

	items := make([]ActionItem, 0, 16)

	// 1. Warranty just expired — the rows that fell off every screen.
	expired, err := q.ListActionWarrantiesJustExpired(ctx, store.ListActionWarrantiesJustExpiredParams{
		UserId:        userID,
		ExpiredBefore: ts(startOfToday),
		ExpiredAfter:  ts(startOfToday.AddDate(0, 0, -ActionWarrantyExpiredLookbackDays)),
	})
	if err != nil {
		return nil, fmt.Errorf("action: warranties just expired: %w", err)
	}
	for _, r := range expired {
		it := ActionItem{
			ItemKey:    ActionItemKey(ActionWarrantyExpired, r.WarrantyID),
			Kind:       ActionWarrantyExpired,
			Severity:   ActionSeverityHigh,
			WarrantyID: ptrOf(r.WarrantyID),
			DeviceID:   ptrOf(r.DeviceID),
		}
		if r.EndDate.Valid {
			days := -DaysUntil(r.EndDate.Time, now)
			it.DueDate = tsPtrUTC(r.EndDate)
			it.Title = "Bảo hành đã hết hạn"
			it.Detail = fmt.Sprintf("Gói %s của «%s» đã hết hạn ngày %s (%d ngày trước). Máy vẫn đang ở trạng thái đang dùng.",
				warrantyTypeLabel(r.WarrantyType), r.DeviceName, formatViDate(r.EndDate.Time), days)
		} else {
			it.Title = "Bảo hành đã hết hạn"
			it.Detail = fmt.Sprintf("Một gói bảo hành của «%s» đã hết hạn.", r.DeviceName)
		}
		items = append(items, it)
	}

	// 2. ACTIVE device with no warranty at all.
	noWarranty, err := q.ListActionDevicesWithoutWarranty(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("action: devices without warranty: %w", err)
	}
	for _, r := range noWarranty {
		items = append(items, ActionItem{
			ItemKey:  ActionItemKey(ActionDeviceNoWarranty, r.DeviceID),
			Kind:     ActionDeviceNoWarranty,
			Severity: ActionSeverityMedium,
			Title:    "Thiết bị chưa có gói bảo hành",
			Detail: fmt.Sprintf("«%s» chưa có gói bảo hành nào, nên app không biết món này còn được bảo vệ hay không và không thể nhắc trước khi hết hạn.",
				r.DeviceName),
			DeviceID: ptrOf(r.DeviceID),
		})
	}

	// 3. status still ACTIVE long after the last warranty ended.
	stale, err := q.ListActionDevicesStatusStale(ctx, store.ListActionDevicesStatusStaleParams{
		UserId:    userID,
		OlderThan: ts(startOfToday.AddDate(0, 0, -ActionWarrantyExpiredLookbackDays)),
	})
	if err != nil {
		return nil, fmt.Errorf("action: stale device status: %w", err)
	}
	for _, r := range stale {
		it := ActionItem{
			ItemKey:  ActionItemKey(ActionDeviceStatusStale, r.DeviceID),
			Kind:     ActionDeviceStatusStale,
			Severity: ActionSeverityLow,
			Title:    "Trạng thái thiết bị có thể đã cũ",
			DeviceID: ptrOf(r.DeviceID),
		}
		if r.LastEndDate.Valid {
			it.DueDate = tsPtrUTC(r.LastEndDate)
			it.Detail = fmt.Sprintf("Bảo hành của «%s» đã hết từ %s nhưng trạng thái vẫn là đang dùng. Bộ lọc «Đã hết hạn» vì thế trả về một danh sách khác với «bảo hành đã hết».",
				r.DeviceName, formatViDate(r.LastEndDate.Time))
		} else {
			it.Detail = fmt.Sprintf("«%s» vẫn đang ở trạng thái đang dùng nhưng bảo hành đã hết từ lâu.", r.DeviceName)
		}
		items = append(items, it)
	}

	// 4. Missing serial / IMEI.
	missingSerial, err := q.ListActionDevicesMissingSerial(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("action: devices missing serial: %w", err)
	}
	for _, r := range missingSerial {
		items = append(items, ActionItem{
			ItemKey:  ActionItemKey(ActionDeviceMissingSerial, r.DeviceID),
			Kind:     ActionDeviceMissingSerial,
			Severity: ActionSeverityLow,
			Title:    "Thiếu số serial / IMEI",
			Detail: fmt.Sprintf("«%s» chưa có số serial/IMEI. Trung tâm bảo hành tra máy theo số này, thiếu hoặc sai một ký tự là bị từ chối.",
				r.DeviceName),
			DeviceID: ptrOf(r.DeviceID),
		})
	}

	// 5. No receipt / invoice attachment at all.
	missingReceipt, err := q.ListActionDevicesMissingReceipt(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("action: devices missing receipt: %w", err)
	}
	for _, r := range missingReceipt {
		items = append(items, ActionItem{
			ItemKey:  ActionItemKey(ActionDeviceMissingReceipt, r.DeviceID),
			Kind:     ActionDeviceMissingReceipt,
			Severity: ActionSeverityLow,
			Title:    "Chưa có ảnh hoá đơn",
			Detail: fmt.Sprintf("«%s» chưa có ảnh hoá đơn hay giấy tờ nào đính kèm. Lúc cần bảo hành sẽ không có gì để đưa ra.",
				r.DeviceName),
			DeviceID: ptrOf(r.DeviceID),
		})
	}

	// 6. Exchange window closing inside the horizon.
	closing, err := q.ListActionReturnWindowsClosing(ctx, store.ListActionReturnWindowsClosingParams{
		UserId:      userID,
		WindowStart: ts(startOfToday),
		WindowEnd:   ts(startOfToday.AddDate(0, 0, ActionReturnWindowClosingDays)),
	})
	if err != nil {
		return nil, fmt.Errorf("action: return windows closing: %w", err)
	}
	for _, r := range closing {
		it := ActionItem{
			ItemKey:  ActionItemKey(ActionReturnWindowClosing, r.DeviceID),
			Kind:     ActionReturnWindowClosing,
			Severity: ActionSeverityHigh,
			Title:    "Sắp hết hạn đổi trả",
			DeviceID: ptrOf(r.DeviceID),
		}
		if r.ReturnDeadline.Valid {
			days := DaysUntil(r.ReturnDeadline.Time, now)
			it.DueDate = tsPtrUTC(r.ReturnDeadline)
			it.Detail = fmt.Sprintf("«%s» còn %d ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.",
				r.DeviceName, days, formatViDate(r.ReturnDeadline.Time))
		} else {
			it.Detail = fmt.Sprintf("Cửa sổ đổi/trả của «%s» sắp hết.", r.DeviceName)
		}
		items = append(items, it)
	}

	// 7. Recently bought, exchange window unknown — the cold-start entry point.
	unknown, err := q.ListActionReturnWindowUnknown(ctx, store.ListActionReturnWindowUnknownParams{
		UserId:       userID,
		PurchaseFrom: ts(startOfToday.AddDate(0, 0, -ActionReturnWindowUnknownDays)),
		PurchaseTo:   ts(startOfToday.AddDate(0, 0, 1)),
	})
	if err != nil {
		return nil, fmt.Errorf("action: return window unknown: %w", err)
	}
	for _, r := range unknown {
		it := ActionItem{
			ItemKey:  ActionItemKey(ActionReturnWindowUnknown, r.DeviceID),
			Kind:     ActionReturnWindowUnknown,
			Severity: ActionSeverityMedium,
			Title:    "Chưa ghi hạn đổi trả",
			DeviceID: ptrOf(r.DeviceID),
		}
		if r.PurchaseDate.Valid {
			it.DueDate = tsPtrUTC(r.PurchaseDate)
			it.Detail = fmt.Sprintf("«%s» mua ngày %s nhưng chưa ghi hạn đổi trả, nên app không thể nhắc bạn trước khi hết hạn đổi/trả.",
				r.DeviceName, formatViDate(r.PurchaseDate.Time))
		} else {
			it.Detail = fmt.Sprintf("«%s» chưa ghi hạn đổi trả.", r.DeviceName)
		}
		items = append(items, it)
	}

	// 8. Auto-renewing soon with no cancel link to act on.
	noCancel, err := q.ListActionSubscriptionsRenewingNoCancelUrl(ctx, store.ListActionSubscriptionsRenewingNoCancelUrlParams{
		UserId:      userID,
		RenewalFrom: ts(startOfToday),
		RenewalTo:   ts(startOfToday.AddDate(0, 0, ActionSubRenewalHorizonDays)),
	})
	if err != nil {
		return nil, fmt.Errorf("action: subscriptions without cancel url: %w", err)
	}
	for _, r := range noCancel {
		it := ActionItem{
			ItemKey:        ActionItemKey(ActionSubRenewingNoCancelURL, r.ID),
			Kind:           ActionSubRenewingNoCancelURL,
			Severity:       ActionSeverityMedium,
			Title:          "Sắp bị trừ tiền nhưng chưa có link huỷ",
			SubscriptionID: ptrOf(r.ID),
			AmountVnd:      ptrOf(int64(r.Price)),
		}
		if r.RenewalDate.Valid {
			it.DueDate = tsPtrUTC(r.RenewalDate)
			it.Detail = fmt.Sprintf("«%s» sẽ tự gia hạn ngày %s (%s) và chưa có link huỷ — muốn dừng thì phải vào tận trang của nhà cung cấp.",
				r.Name, formatViDate(r.RenewalDate.Time), formatVNDInt64(int64(r.Price)))
		} else {
			it.Detail = fmt.Sprintf("«%s» sẽ tự gia hạn và chưa có link huỷ.", r.Name)
		}
		items = append(items, it)
	}

	// 9. Recorded payment for a renewal date that has already passed.
	paidNotAdvanced, err := q.ListActionSubscriptionsPaidNotAdvanced(ctx, store.ListActionSubscriptionsPaidNotAdvancedParams{
		UserId:        userID,
		RenewalBefore: ts(startOfToday),
	})
	if err != nil {
		return nil, fmt.Errorf("action: subscriptions paid not advanced: %w", err)
	}
	for _, r := range paidNotAdvanced {
		it := ActionItem{
			ItemKey:        ActionItemKey(ActionSubPaidNotAdvanced, r.ID),
			Kind:           ActionSubPaidNotAdvanced,
			Severity:       ActionSeverityMedium,
			Title:          "Ngày gia hạn chưa được cập nhật",
			SubscriptionID: ptrOf(r.ID),
			AmountVnd:      ptrOf(int64(r.LastPaidAmount)),
		}
		if r.RenewalDate.Valid && r.LastPaidAt.Valid {
			it.DueDate = tsPtrUTC(r.RenewalDate)
			it.Detail = fmt.Sprintf("«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua %d ngày). Gia hạn hoặc sửa lại ngày cho khớp.",
				r.Name, formatViDate(r.LastPaidAt.Time), formatViDate(r.RenewalDate.Time),
				-DaysUntil(r.RenewalDate.Time, now))
		} else {
			it.Detail = fmt.Sprintf("«%s» có thanh toán đã ghi nhận nhưng ngày gia hạn vẫn ở quá khứ.", r.Name)
		}
		items = append(items, it)
	}

	// 10. Wishlist target date has gone by.
	targetPassed, err := q.ListActionWishlistTargetPassed(ctx, store.ListActionWishlistTargetPassedParams{
		UserId:       userID,
		TargetBefore: ts(startOfToday),
	})
	if err != nil {
		return nil, fmt.Errorf("action: wishlist target passed: %w", err)
	}
	for _, r := range targetPassed {
		it := ActionItem{
			ItemKey:        ActionItemKey(ActionWishlistTargetPassed, r.ID),
			Kind:           ActionWishlistTargetPassed,
			Severity:       ActionSeverityLow,
			Title:          "Đã qua ngày dự kiến mua",
			WishlistItemID: ptrOf(r.ID),
		}
		if r.CurrentPrice != nil {
			it.AmountVnd = ptrOf(int64(*r.CurrentPrice))
		}
		if r.TargetDate.Valid {
			it.DueDate = tsPtrUTC(r.TargetDate)
			price := ""
			if r.CurrentPrice != nil {
				price = fmt.Sprintf(" Giá ghi nhận gần nhất: %s.", formatVNDInt64(int64(*r.CurrentPrice)))
			}
			it.Detail = fmt.Sprintf("«%s» có ngày dự kiến mua %s, đã qua %d ngày.%s",
				r.Name, formatViDate(r.TargetDate.Time), -DaysUntil(r.TargetDate.Time, now), price)
		} else {
			it.Detail = fmt.Sprintf("«%s» đã qua ngày dự kiến mua.", r.Name)
		}
		items = append(items, it)
	}

	return items, nil
}

// sortActionItems orders by severity, then by the date the item is about (nil
// last), then by kind and key so the order is total and stable across runs — a
// client diffing two responses must not see rows shuffle for no reason.
func sortActionItems(items []ActionItem) {
	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		if ra, rb := actionSeverityRank(a.Severity), actionSeverityRank(b.Severity); ra != rb {
			return ra < rb
		}
		if (a.DueDate == nil) != (b.DueDate == nil) {
			return a.DueDate != nil
		}
		if a.DueDate != nil && b.DueDate != nil && *a.DueDate != *b.DueDate {
			return *a.DueDate < *b.DueDate
		}
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		return a.ItemKey < b.ItemKey
	})
}

func containsItemKey(items []ActionItem, key string) bool {
	for _, it := range items {
		if it.ItemKey == key {
			return true
		}
	}
	return false
}

// startOfDay rolls `now` back to 00:00 in its own location, the same convention
// cron's dayWindow() uses so SQL comparisons and Go comparisons agree.
func startOfDay(now time.Time) time.Time {
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
}

// formatViDate renders dd/mm/yyyy — the Vietnamese short form, matching cron's
// formatVi() so a push body and a queue row describe the same date identically.
func formatViDate(t time.Time) string {
	return fmt.Sprintf("%02d/%02d/%d", t.Day(), int(t.Month()), t.Year())
}

// formatVNDInt64 mirrors cron's formatVND for the int64 money values in this
// file. "." is the thousands separator in vi-VN.
func formatVNDInt64(amount int64) string {
	if amount == 0 {
		return "0 ₫"
	}
	neg := amount < 0
	if neg {
		amount = -amount
	}
	s := ""
	count := 0
	for amount > 0 {
		if count > 0 && count%3 == 0 {
			s = "." + s
		}
		s = string(rune('0'+(amount%10))) + s
		amount /= 10
		count++
	}
	if neg {
		s = "-" + s
	}
	return s + " ₫"
}

// warrantyTypeLabel mirrors cron's warrantyTypeLabels so the same package is
// named the same way in a push and in the queue.
func warrantyTypeLabel(t string) string {
	switch t {
	case "STANDARD":
		return "Tiêu chuẩn"
	case "EXTENDED":
		return "Mở rộng"
	case "THIRD_PARTY":
		return "Bên thứ ba"
	default:
		return t
	}
}

// ptrOf returns a pointer to a copy — a small helper so the item builders above
// can set optional JSON fields inline.
func ptrOf[T any](v T) *T { return &v }
