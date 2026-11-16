package services

import (
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// Renewal windows — FEATURE_RESEARCH_2026-11 §6.6.
//
// The trial reminder already shipped (migration 0016): the cron warns before
// `trialEndsAt`, and `convertsToPrice` says what the plan is about to cost. What
// was missing is the two weeks AFTER that charge lands: the user has just been
// billed, the app knows the date it happened, and it still had nothing to say.
//
// This file is deliberately copy + one derived object. There is NO migration, NO
// `nextChargeAmount` column, NO new queue kind and NO new endpoint:
//
//   - the conversion date is `Subscription.trialEndsAt`, a calendar day that
//     already exists;
//   - the amount "recognised" is a `SubscriptionPayment` the user (or the cron)
//     already recorded — never a figure the app invents;
//   - the store rules are a verified constant table, not a per-row setting.
//
// The window is 14 days — two weeks is a product choice for how long a just-
// converted trial deserves a callout. It is NOT a store rule and NOT a legal
// deadline; the store rules live in `storeRules` below, with their sources. A
// reporting window cannot charge, cancel, refund or remind anything.

// renewalWindowDays is how long the post-conversion card stays visible, counted
// from the conversion DAY. It is echoed nowhere in the payload: the window end is
// a calendar day (`windowEndsAt`) and a client counts down on its own calendar,
// which is the same rule the renewal countdown follows.
const renewalWindowDays = 14

// storeRuleCheckedOn is the day the two rows below were last read against their
// `sourceUrl`. It lives in ONE constant so a re-verification is a one-line change
// and the answer to "when was this checked?" cannot differ per store by accident.
const storeRuleCheckedOn = "2026-11-16"

// storeRuleCheckedOnDay is `storeRuleCheckedOn` as the wire day every row carries.
// Parsed once at init: the input is a literal in this file, so a parse error is a
// programmer error and must not degrade into a zero day in a response.
var storeRuleCheckedOnDay = func() wire.Day {
	t, err := time.Parse(wire.DayLayout, storeRuleCheckedOn)
	if err != nil {
		panic("services: storeRuleCheckedOn is not a wire day: " + err.Error())
	}
	return wire.Date(t)
}()

// StoreRule is one row of the verified store-rule table.
//
// It is DATA, not copy: the numbers are the facts (Apple's consent windows depend
// on the billing interval, Google's refund window is 48 hours, Apple publishes no
// fixed refund window) and `consentCopy` / `refundCopy` are rendered from them in
// the request's language, so a sentence can never disagree with the numbers next
// to it. Every row carries the URL it was read from and the day it was read —
// the same honesty rule as the brand warranty lookup table, except that table is
// in Postgres and these facts are platform-wide constants.
type StoreRule struct {
	// Store is `APPLE` | `GOOGLE` — a machine code, because the client may want
	// to draw icons; the human name is `name`.
	Store string `json:"store"`
	Name  string `json:"name"`
	// AnnualConsentNoticeDays / MonthlyConsentNoticeDays are the advance notice
	// the store gives before a price rise takes effect, per billing interval.
	//
	// Apple: 60 days for 2-, 3-, 6-month and annual subscriptions, 27 days for
	// monthly. The 7-day figure in Apple's table is for WEEKLY subscriptions and
	// this app has no weekly billing cycle, so it must not be used here.
	// Google: at least 30 days for every interval.
	AnnualConsentNoticeDays  int `json:"annualConsentNoticeDays"`
	MonthlyConsentNoticeDays int `json:"monthlyConsentNoticeDays"`
	// AutoCancelWithoutConsent is Google's rule: a subscriber who does not accept
	// the new price is auto-cancelled before the first charge at that price.
	// Apple asks for consent and does not raise the price without it, but does not
	// publish an auto-cancel rule for this path.
	AutoCancelWithoutConsent bool `json:"autoCancelWithoutConsent"`
	// RefundWindowHours is the store's PUBLISHED fixed refund window, or null
	// when it publishes none. Apple is null ON PURPOSE: "no fixed window" is the
	// finding, and inventing a number here is the promise §6.6 forbids. Google
	// Play is 48 for apps and in-app purchases.
	RefundWindowHours *int `json:"refundWindowHours"`
	// ConsentCopy / RefundCopy are the sentences a client renders VERBATIM. They
	// are built from the numbers above in the request language, so the two cannot
	// drift; a client writing its own version would be a second, unverified copy
	// of a store policy.
	ConsentCopy string `json:"consentCopy"`
	RefundCopy  string `json:"refundCopy"`
	// SourceURL is where the consent/cancellation rule above was read.
	SourceURL string `json:"sourceUrl"`
	// RefundSourceURL is the refund policy page, which is a different page for
	// both stores. Both URLs are carried because one link cannot honestly cover
	// both claims.
	RefundSourceURL string `json:"refundSourceUrl"`
	// CheckedOn is the day this row was last verified against its sources.
	CheckedOn wire.Day `json:"checkedOn"`
}

// storeRules is the table itself. Two rows, both verified 2026-11-16.
//
// Why this is a Go constant rather than a table or a config file: the facts are
// platform-wide, they change a few times a decade, and every client must agree on
// them. A per-user or per-row setting would imply the app knows which store a
// specific subscription was bought in — it does not, so both rows are returned and
// the copy says "tuỳ nơi bạn mua".
var storeRules = []StoreRule{
	{
		Store:                    "APPLE",
		Name:                     "App Store",
		AnnualConsentNoticeDays:  60,
		MonthlyConsentNoticeDays: 27,
		AutoCancelWithoutConsent: false,
		RefundWindowHours:        nil,
		// Apple's consent timelines: 60 days for 2-, 3-, 6-month and annual
		// subscriptions, 27 days for monthly. The 7-day row in that table is for
		// WEEKLY subscriptions and does not apply here.
		SourceURL: "https://developer.apple.com/documentation/advancedcommerceapi/handling-subscription-price-changes",
		// Apple publishes no fixed refund window: requests are reviewed case by
		// case, which is why RefundWindowHours stays nil.
		RefundSourceURL: "https://support.apple.com/en-us/118223",
		CheckedOn:       storeRuleCheckedOnDay,
	},
	{
		Store:                    "GOOGLE",
		Name:                     "Google Play",
		AnnualConsentNoticeDays:  30,
		MonthlyConsentNoticeDays: 30,
		// Opt-in price rises: at least 30 days to accept, and the subscription is
		// automatically cancelled before the first charge at the higher price when
		// the subscriber does not.
		AutoCancelWithoutConsent: true,
		RefundWindowHours:        ptrOf(48),
		SourceURL:                "https://support.google.com/googleplay/android-developer/answer/12154973",
		RefundSourceURL:          "https://support.google.com/googleplay/answer/2479637",
		CheckedOn:                storeRuleCheckedOnDay,
	},
}

// RenewalWindow is the derived object `GET /api/v1/subscriptions/{id}` carries
// when a trial has converted within the last `renewalWindowDays`.
//
// It is a VIEW over rows that already exist. `convertedOn` is `trialEndsAt`,
// `amountRecognisedVnd` is the earliest `SubscriptionPayment` on or after that
// day, and `expectedAmountVnd` is `convertsToPrice`. No field is writable, and
// there is no endpoint that acts on it.
type RenewalWindow struct {
	// ConvertedOn is the day the free period ended and billing started
	// (Subscription.trialEndsAt). A calendar day, not an instant.
	ConvertedOn wire.Day `json:"convertedOn"`
	// WindowEndsAt is the last day the card is shown (ConvertedOn + 14 days).
	// Also a calendar day: a client that renders "~2 days" must count days on the
	// reader's calendar, never subtract instants.
	WindowEndsAt wire.Day `json:"windowEndsAt"`
	// AmountRecognisedVnd is the amount of the earliest recorded payment on or
	// after ConvertedOn, or null when nothing was recorded. "Recognised" means
	// what the user (or the renewal cron) logged — this app cannot see a store
	// charge it was not told about, and it never guesses.
	AmountRecognisedVnd *int64 `json:"amountRecognisedVnd"`
	// RecognisedPaidOn is the day of that payment, or null. Same calendar-day
	// rule as the two fields above.
	RecognisedPaidOn *wire.Day `json:"recognisedPaidOn"`
	// ExpectedAmountVnd is `convertsToPrice` — what the trial was supposed to
	// become, or null when the user never recorded it. It is NOT a charge: the
	// client must not render it as one.
	ExpectedAmountVnd *int64 `json:"expectedAmountVnd"`
	// StoreRules is the verified store-rule table (both stores), with the copy
	// already rendered in the request's language.
	StoreRules []StoreRule `json:"storeRules"`
}

// BuildRenewalWindow returns the post-conversion object, or nil when the
// subscription is not inside its window.
//
// `now` is passed in (handler: time.Now()) so the boundary is testable and so the
// SQL-free rule reads the same clock every caller does.
//
// Day semantics, matching `trialPhase` on the clients: a trial recorded as ending
// on the 1st is still free through the 1st, so billing starts on the 2nd. The
// window therefore starts at `daysSince == 1` — a trialEndsAt of TODAY is not a
// conversion yet. `daysSince > 14` is outside the window (nil, not a stale card).
func BuildRenewalWindow(lang i18n.Tag, sub store.Subscription, payments []store.SubscriptionPayment, now time.Time) *RenewalWindow {
	if !sub.TrialEndsAt.Valid {
		return nil
	}
	converted := sub.TrialEndsAt
	daysSince, ok := wholeDaysBetween(converted, wire.Date(now))
	if !ok || daysSince < 1 || daysSince > renewalWindowDays {
		return nil
	}

	win := &RenewalWindow{
		ConvertedOn:  converted,
		WindowEndsAt: wire.Date(converted.Time.UTC().AddDate(0, 0, renewalWindowDays)),
		StoreRules:   renewalStoreRules(lang),
	}
	if sub.ConvertsToPrice != nil {
		expected := int64(*sub.ConvertsToPrice)
		win.ExpectedAmountVnd = &expected
	}

	// The conversion charge is the EARLIEST recorded payment on or after the
	// conversion day — later cycles inside the same 14 days are not this object's
	// subject. Chosen by comparing days rather than by relying on the query's
	// ORDER BY, so a caller that hands over a differently sorted slice still gets
	// the same answer.
	var earliestDay wire.Day
	var earliestAmount int64
	found := false
	for i := range payments {
		if !payments[i].PaidAt.Valid {
			continue
		}
		paidDay := wire.Date(payments[i].PaidAt.Time)
		if paidDay.String() < converted.String() {
			continue
		}
		if found && earliestDay.String() <= paidDay.String() {
			continue
		}
		found = true
		earliestDay = paidDay
		earliestAmount = int64(payments[i].Amount)
	}
	if found {
		win.AmountRecognisedVnd = &earliestAmount
		day := earliestDay
		win.RecognisedPaidOn = &day
	}

	return win
}

// renewalStoreRules projects the table into the request's language. Both stores
// are returned because the app does not record where a subscription was bought —
// claiming otherwise would be a fact the schema cannot support.
func renewalStoreRules(lang i18n.Tag) []StoreRule {
	out := make([]StoreRule, 0, len(storeRules))
	for _, row := range storeRules {
		row.ConsentCopy, row.RefundCopy = storeRuleCopy(lang, row)
		out = append(out, row)
	}
	return out
}

// storeRuleCopy renders the two sentences for one row from that row's own
// numbers. The `APPLE` / `GOOGLE` switch is exhaustive by construction: the table
// has exactly those two stores, and an unknown store yields no copy rather than a
// guessed one.
func storeRuleCopy(lang i18n.Tag, r StoreRule) (consent, refund string) {
	switch r.Store {
	case "APPLE":
		consent = i18n.Translate(lang,
			"App Store xin ý kiến trước %d ngày với gói năm và %d ngày với gói tháng trước ngày gia hạn; giá mới chỉ áp dụng khi bạn đồng ý.",
			r.AnnualConsentNoticeDays, r.MonthlyConsentNoticeDays)
		refund = i18n.Translate(lang,
			"Apple không công bố cửa sổ hoàn tiền cố định: mỗi yêu cầu được xem xét riêng, nên app không hứa hạn hoàn tiền.")
	case "GOOGLE":
		consent = i18n.Translate(lang,
			"Google Play cho bạn ít nhất %d ngày để đồng ý giá mới; không đồng ý thì gói tự huỷ trước lần trừ tiền đầu tiên ở giá mới.",
			r.AnnualConsentNoticeDays)
		if r.RefundWindowHours != nil {
			refund = i18n.Translate(lang,
				"Google Play cho yêu cầu hoàn tiền trong vòng %d giờ sau khi mua.",
				*r.RefundWindowHours)
		}
	}
	return consent, refund
}

// wholeDaysBetween returns the number of whole calendar days from `from` to `to`.
// Both arguments are Day values, so only their UTC dates are compared — never a
// sub-second instant difference, which is what made "còn 2 ngày" wrong at 23:00.
func wholeDaysBetween(from, to wire.Day) (int, bool) {
	if !from.Valid || !to.Valid {
		return 0, false
	}
	fromDay, err := time.Parse(wire.DayLayout, from.String())
	if err != nil {
		return 0, false
	}
	toDay, err := time.Parse(wire.DayLayout, to.String())
	if err != nil {
		return 0, false
	}
	return int(toDay.Sub(fromDay).Hours() / 24), true
}
