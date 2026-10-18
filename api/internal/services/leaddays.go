package services

import (
	"context"
	"sort"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// Reminder lead days — migration 0015.
//
// A "lead day" is one milestone BEFORE a deadline at which the cron pushes a
// reminder: 30 means "a month ahead", 7 means "a week ahead". The old cron had
// exactly two hard-coded milestones (7 and 30 days before a warranty end date);
// a user's device set is far too varied for that (a 14-day exchange window, a
// 3-month accessory warranty and a 10-year appliance do not share a schedule),
// so the milestones are now per-subject data on both Device and Subscription.
//
// The rules below are enforced here, in the service layer, rather than by a DB
// CHECK: a bad request body has to become a normal 400 with
// `fieldErrors.leadDays`, and a CHECK violation from the insert would surface as
// a 500 instead. That is the same split the repo already uses for soldAt /
// soldPrice, the duplicate-serial advisory and the device quotas.
//
// Why an EMPTY array is rejected rather than read as "no reminders": a user who
// wants fewer reminders should pick fewer days. Silently turning an empty array
// into "never notify me" makes a broken form look like a working setting, and
// there is no UI state that can show the difference.

const (
	// LeadDaysMin / LeadDaysMax bound every milestone. 0 is allowed and means
	// "the deadline day itself" on both subjects; 365 is a year, which covers even
	// an appliance warranty that wants a long runway and keeps a typo from storing
	// a milestone in the year 9999.
	LeadDaysMin = 0
	LeadDaysMax = 365

	// LeadDaysMaxCount is the number of milestones a single subject may carry.
	// Five is enough for the "one year / three months / one month / one week /
	// tomorrow" ladder without turning the notification list into noise.
	LeadDaysMaxCount = 5
)

// The default schedule differs by subject, because the two old crons did not
// share one. A single default cannot preserve both.
//
//   - Device: the old cron fired at 7 and 30 days, so [30, 7] is exactly the
//     previous behaviour and adding the column changes nothing for a user who
//     never touches the setting.
//   - Subscription: the old renewal cron fired at 3, 1 and 0 days. Defaulting
//     these to [30, 7] would have silently moved every existing user's renewal
//     warnings two weeks earlier — a regression, not a product decision.
//
// Both are slices (so they can be passed straight to pgx) and must never be
// mutated; the helpers below make their own copy when they hand one out.
var (
	DefaultDeviceLeadDays       = []int32{30, 7}
	DefaultSubscriptionLeadDays = []int32{3, 1, 0}
)

// leadDaysMessage returns the Vietnamese message for the first rule `days`
// breaks, or "" when it is valid. The message is rendered in the REQUEST's
// language (English comes from internal/i18n/catalog.go); the key is the
// Vietnamese source string, as everywhere else in this package.
//
// One message per invalid value, not a list of every problem: the form shows one
// line under one input, and a request that is both too long and out of range is
// still one thing to fix. The rules are checked in the order a user is most
// likely to hit them: count, range, duplicate.
func leadDaysMessage(ctx context.Context, days []int32) string {
	if len(days) < 1 || len(days) > LeadDaysMaxCount {
		return i18n.Text(ctx, "Số ngày nhắc phải có từ 1 đến 5 giá trị")
	}
	for _, d := range days {
		if d < LeadDaysMin || d > LeadDaysMax {
			return i18n.Text(ctx, "Mỗi ngày nhắc phải nằm trong khoảng 0 đến 365")
		}
	}
	seen := make(map[int32]struct{}, len(days))
	for _, d := range days {
		if _, ok := seen[d]; ok {
			return i18n.Text(ctx, "Số ngày nhắc không được trùng nhau")
		}
		seen[d] = struct{}{}
	}
	return ""
}

// normalizeLeadDays validates days and returns a descending-sorted COPY, which
// is the order the server stores. The message is "" on success.
//
// A copy is deliberate: the caller's input may also be referenced by a handler
// DTO or a test fixture, and sorting it in place would make the request look
// different from the response for no reason. "Descending" is not a business
// rule — no consumer depends on the order — but pinning it makes the stored
// payload and the cron's push order deterministic.
func normalizeLeadDays(ctx context.Context, days []int32) ([]int32, string) {
	if msg := leadDaysMessage(ctx, days); msg != "" {
		return nil, msg
	}
	sorted := append([]int32(nil), days...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] > sorted[j] })
	return sorted, ""
}

// leadDaysForCreate applies the create-time default for `fallback`: absent/null
// means that default, while an explicitly-sent EMPTY array stays empty and is
// rejected by normalizeLeadDays before this is reached. (A slice's nil vs
// non-nil zero length is exactly the JSON `null`/absent vs `[]` distinction,
// which is why the field is a slice rather than a pointer.)
func leadDaysForCreate(days, fallback []int32) []int32 {
	if days == nil {
		return append([]int32(nil), fallback...)
	}
	return days
}

// leadDaysForUpdate applies the update-time rule: absent/null leaves the stored
// value untouched. It is deliberately NOT the create default — a client that
// PATCHes a device's name without repeating leadDays must not silently reset a
// custom schedule.
//
// The existing value is passed in by the caller (which has already loaded the
// row for the ownership check) so the rule is a pure function and testable
// without a database. The final fallback covers a legacy/hand-edited row whose
// array is NULL despite the NOT NULL column; the write path must never send NULL.
func leadDaysForUpdate(days, existing []int32) []int32 {
	if days != nil {
		return days
	}
	if existing != nil {
		return existing
	}
	return leadDaysForCreate(nil, DefaultDeviceLeadDays)
}
