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
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
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
// # i18n
//
// Every sentence in this file is generated HERE, on the server, rather than by a
// client: the derived rows carry `title` and `detail` as finished strings. The
// language therefore comes from the request context, and it governs the DATES and
// the MONEY inside those sentences as well as the words — "07/05/2026" is 7 May
// to a Vietnamese reader and 5 July to an English one, so a queue rendered in the
// request's words but the source language's date format would be actively
// misleading.
//
// The formatters are the locale-aware pair wave 2 added for the subscription
// audit (formatDate/formatMoney below, which delegate to i18n), NOT the
// Vietnamese-only helpers that used to live at the bottom of this file. Those two
// are gone: nothing should be able to reach for a date formatter that cannot
// follow the language.
//
// Two design rules govern this file:
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
		Note:         i18n.Text(ctx, actionQueueNoteKey),
	}, nil
}

// actionQueueNoteKey is returned with every queue so no client has to guess what
// the list is. It says plainly what the queue is NOT: a reminder feed, or advice.
//
// It is the Vietnamese SOURCE text, unchanged, and it doubles as the catalog key
// (internal/i18n/catalog.go) — a named constant rather than an inline literal
// because the sentence is long, because it is rendered as DATA (see textIn), and
// because it is the one string in this file that every client displays verbatim.
const actionQueueNoteKey = "Danh sách này chỉ gồm những việc app TỰ SUY RA từ dữ liệu bạn đã nhập và không tự quyết được. Nó không phải thông báo đẩy — bảo hiểm/bảo hành vẫn nhắc riêng theo mốc ngày. Hoãn một việc ở đây không ảnh hưởng tới nhắc bảo hành."

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
		// The headline and the field error are the SAME sentence here: this
		// failure is the whole story (one bad field), so a generic "Dữ liệu không
		// hợp lệ" headline above it would be a second, vaguer sentence in a
		// second language if the generic constructor were used. Rendered once so
		// the two cannot drift.
		msg := i18n.T(ctx, "Số ngày hoãn phải từ %d tới %d", SnoozeDaysMin, SnoozeDaysMax)
		return SnoozeResult{}, ErrValidationKeyed(msg, FieldErrors{"days": {msg}})
	}

	q := store.New(db)
	items, err := deriveActionItems(ctx, q, userID, now)
	if err != nil {
		return SnoozeResult{}, err
	}
	if !containsItemKey(items, itemKey) {
		// ErrNotFound has no keyed variant, so the sentence is rendered here,
		// where the context is — the handler writes `Message` out verbatim.
		return SnoozeResult{}, ErrNotFound(i18n.Text(ctx, "Không tìm thấy việc cần xử lý này"))
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
			// No singular form: MaxSnoozesPerUser is a constant 500, so the only
			// value this sentence can ever interpolate is 500. A "1 việc" key
			// would be an entry nothing can produce.
			return SnoozeResult{}, ErrLimit(i18n.T(ctx,
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
		return ErrNotFound(i18n.Text(ctx, "Việc này không đang được hoãn"))
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

	// One language for the whole queue, read once. It drives the words AND the
	// two value formats inside them; see the file header.
	lang := i18n.From(ctx)
	date := func(t time.Time) string { return formatDate(lang, t) }
	// formatMoney takes an int64 and narrows to the int32 the column type uses —
	// see its note on why that cannot truncate here.
	money := func(v int64) string { return formatMoney(lang, v) }

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
			it.Title = textIn(lang, "Bảo hành đã hết hạn")
			// A count-bearing sentence, so it is a singular/plural pair with a
			// separate argument list per form: `days` is >= 1 by construction
			// (the row is in the past), and "1 days ago" is not English.
			typeLabel := warrantyTypeLabel(lang, r.WarrantyType)
			it.Detail = pluralText(lang, days,
				"Gói %s của «%s» đã hết hạn ngày %s (%d ngày trước). Máy vẫn đang ở trạng thái đang dùng.",
				"Gói %s của «%s» đã hết hạn ngày %s (1 ngày trước). Máy vẫn đang ở trạng thái đang dùng.",
				[]any{typeLabel, r.DeviceName, date(r.EndDate.Time), days},
				[]any{typeLabel, r.DeviceName, date(r.EndDate.Time)})
		} else {
			it.Title = textIn(lang, "Bảo hành đã hết hạn")
			it.Detail = i18n.Translate(lang, "Một gói bảo hành của «%s» đã hết hạn.", r.DeviceName)
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
			Title:    textIn(lang, "Thiết bị chưa có gói bảo hành"),
			Detail: i18n.Translate(lang, "«%s» chưa có gói bảo hành nào, nên app không biết món này còn được bảo vệ hay không và không thể nhắc trước khi hết hạn.",
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
			Title:    textIn(lang, "Trạng thái thiết bị có thể đã cũ"),
			DeviceID: ptrOf(r.DeviceID),
		}
		if r.LastEndDate.Valid {
			it.DueDate = tsPtrUTC(r.LastEndDate)
			it.Detail = i18n.Translate(lang, "Bảo hành của «%s» đã hết từ %s nhưng trạng thái vẫn là đang dùng. Bộ lọc «Đã hết hạn» vì thế trả về một danh sách khác với «bảo hành đã hết».",
				r.DeviceName, date(r.LastEndDate.Time))
		} else {
			it.Detail = i18n.Translate(lang, "«%s» vẫn đang ở trạng thái đang dùng nhưng bảo hành đã hết từ lâu.", r.DeviceName)
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
			Title:    textIn(lang, "Thiếu số serial / IMEI"),
			Detail: i18n.Translate(lang, "«%s» chưa có số serial/IMEI. Trung tâm bảo hành tra máy theo số này, thiếu hoặc sai một ký tự là bị từ chối.",
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
			Title:    textIn(lang, "Chưa có ảnh hoá đơn"),
			Detail: i18n.Translate(lang, "«%s» chưa có ảnh hoá đơn hay giấy tờ nào đính kèm. Lúc cần bảo hành sẽ không có gì để đưa ra.",
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
			Title:    textIn(lang, "Sắp hết hạn đổi trả"),
			DeviceID: ptrOf(r.DeviceID),
		}
		if r.ReturnDeadline.Valid {
			days := DaysUntil(r.ReturnDeadline.Time, now)
			it.DueDate = tsPtrUTC(r.ReturnDeadline)
			// `days` counts DOWN to the deadline and reaches 1 the day before it,
			// so the pair is reachable rather than theoretical.
			it.Detail = pluralText(lang, days,
				"«%s» còn %d ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.",
				"«%s» còn 1 ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.",
				[]any{r.DeviceName, days, date(r.ReturnDeadline.Time)},
				[]any{r.DeviceName, date(r.ReturnDeadline.Time)})
		} else {
			it.Detail = i18n.Translate(lang, "Cửa sổ đổi/trả của «%s» sắp hết.", r.DeviceName)
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
			Title:    textIn(lang, "Chưa ghi hạn đổi trả"),
			DeviceID: ptrOf(r.DeviceID),
		}
		if r.PurchaseDate.Valid {
			it.DueDate = tsPtrUTC(r.PurchaseDate)
			it.Detail = i18n.Translate(lang, "«%s» mua ngày %s nhưng chưa ghi hạn đổi trả, nên app không thể nhắc bạn trước khi hết hạn đổi/trả.",
				r.DeviceName, date(r.PurchaseDate.Time))
		} else {
			it.Detail = i18n.Translate(lang, "«%s» chưa ghi hạn đổi trả.", r.DeviceName)
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
			Title:          textIn(lang, "Sắp bị trừ tiền nhưng chưa có link huỷ"),
			SubscriptionID: ptrOf(r.ID),
			AmountVnd:      ptrOf(int64(r.Price)),
		}
		if r.RenewalDate.Valid {
			it.DueDate = tsPtrUTC(r.RenewalDate)
			it.Detail = i18n.Translate(lang, "«%s» sẽ tự gia hạn ngày %s (%s) và chưa có link huỷ — muốn dừng thì phải vào tận trang của nhà cung cấp.",
				r.Name, date(r.RenewalDate.Time), money(int64(r.Price)))
		} else {
			it.Detail = i18n.Translate(lang, "«%s» sẽ tự gia hạn và chưa có link huỷ.", r.Name)
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
			Title:          textIn(lang, "Ngày gia hạn chưa được cập nhật"),
			SubscriptionID: ptrOf(r.ID),
			AmountVnd:      ptrOf(int64(r.LastPaidAmount)),
		}
		if r.RenewalDate.Valid && r.LastPaidAt.Valid {
			it.DueDate = tsPtrUTC(r.RenewalDate)
			// The renewal date is strictly before today (the query says so), so
			// the count reaches 1 and the singular form is reachable.
			elapsed := -DaysUntil(r.RenewalDate.Time, now)
			it.Detail = pluralText(lang, elapsed,
				"«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua %d ngày). Gia hạn hoặc sửa lại ngày cho khớp.",
				"«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua 1 ngày). Gia hạn hoặc sửa lại ngày cho khớp.",
				[]any{r.Name, date(r.LastPaidAt.Time), date(r.RenewalDate.Time), elapsed},
				[]any{r.Name, date(r.LastPaidAt.Time), date(r.RenewalDate.Time)})
		} else {
			it.Detail = i18n.Translate(lang, "«%s» có thanh toán đã ghi nhận nhưng ngày gia hạn vẫn ở quá khứ.", r.Name)
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
			Title:          textIn(lang, "Đã qua ngày dự kiến mua"),
			WishlistItemID: ptrOf(r.ID),
		}
		if r.CurrentPrice != nil {
			it.AmountVnd = ptrOf(int64(*r.CurrentPrice))
		}
		if r.TargetDate.Valid {
			it.DueDate = tsPtrUTC(r.TargetDate)
			// The optional price is its own sentence appended after the base one
			// rather than a `%s` slot inside it: a slot would force every
			// translation to keep a trailing fragment's punctuation, and the
			// Vietnamese output is identical either way.
			price := ""
			if r.CurrentPrice != nil {
				price = " " + i18n.Translate(lang, "Giá ghi nhận gần nhất: %s.", money(int64(*r.CurrentPrice)))
			}
			elapsed := -DaysUntil(r.TargetDate.Time, now)
			it.Detail = pluralText(lang, elapsed,
				"«%s» có ngày dự kiến mua %s, đã qua %d ngày.",
				"«%s» có ngày dự kiến mua %s, đã qua 1 ngày.",
				[]any{r.Name, date(r.TargetDate.Time), elapsed},
				[]any{r.Name, date(r.TargetDate.Time)}) + price
		} else {
			it.Detail = i18n.Translate(lang, "«%s» đã qua ngày dự kiến mua.", r.Name)
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

// The two Vietnamese-only formatters that used to live here — a dd/mm/yyyy date
// and a hand-rolled "1.200.000 ₫" — are GONE. They were the reason wave 2 had to
// add a second, locale-aware pair rather than reuse these, and leaving a
// Vietnamese-only date formatter next to converted call sites is an invitation to
// reintroduce the bug this file was converted to fix. The queue now calls
// formatDate / formatMoney (subscription_audit.go), which delegate to
// i18n.FormatDate / i18n.FormatMoney, so a push body, an audit finding and a
// queue row describe the same date and the same amount identically in the same
// language.

// warrantyTypeLabel names a Warranty.type code in `lang`, using the same three
// catalog entries the cron's warrantyTypeLabels map resolves to — so the package
// a push notification names and the package the queue names cannot drift.
//
// An unknown code (a hand-edited row) falls through to the raw code, exactly as
// the cron does, rather than inventing a label.
func warrantyTypeLabel(lang i18n.Tag, t string) string {
	var key string
	switch t {
	case "STANDARD":
		key = "Tiêu chuẩn"
	case "EXTENDED":
		key = "Mở rộng"
	case "THIRD_PARTY":
		key = "Bên thứ ba"
	default:
		return t
	}
	return textIn(lang, key)
}

// ptrOf returns a pointer to a copy — a small helper so the item builders above
// can set optional JSON fields inline.
func ptrOf[T any](v T) *T { return &v }
