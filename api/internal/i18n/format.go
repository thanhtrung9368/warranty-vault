package i18n

import (
	"fmt"
	"time"
)

// Locale-aware value formatting for the two things that are not sentences but do
// reach the user: a date and an amount of money.
//
// Both are hand-rolled rather than delegated to golang.org/x/text/date or
// /number. The Vietnamese output must stay BYTE-FOR-BYTE what the service already
// emits — `formatVi` and `formatVND` in internal/cron/run.go are mirrored by the
// TypeScript the push notifications were ported from, and existing tests pin
// their exact strings ("07/05/2026", "1.200.000 ₫"). Reaching for CLDR would put
// the three clients' output at the mercy of an ICU version bump, for two formats.
// English gets the same treatment: explicit, `en-US`-style, no locale database.

// FormatDate renders a calendar date in the language's short form.
//
//	vi → 07/05/2026   (dd/mm/yyyy, the Vietnamese convention)
//	en → 05/07/2026   (mm/dd/yyyy, the US convention)
//
// The two are genuinely ambiguous against each other, which is exactly why the
// date has to follow the language rather than the server: a Vietnamese user told
// "05/07/2026" would read it as 5 July, and an English one as 7 May. The returned
// string carries no timezone conversion — callers pass wall-clock dates out of
// `timestamp without time zone` columns.
func FormatDate(tag Tag, t time.Time) string {
	if tag == VI {
		return fmt.Sprintf("%02d/%02d/%d", t.Day(), int(t.Month()), t.Year())
	}
	return fmt.Sprintf("%02d/%02d/%d", int(t.Month()), t.Day(), t.Year())
}

// currencySymbol is the unit both languages show. Vietnamese đồng is not
// denominated in a foreign currency, so translating it would be wrong — only its
// position and the thousands separator change.
const currencySymbol = "₫"

// FormatMoney renders an amount of Vietnamese đồng.
//
//	vi → 1.200.000 ₫   (dot grouping, trailing symbol — the existing formatVND)
//	en → ₫1,200,000    (comma grouping, leading symbol)
//
// Negative amounts keep a leading minus in both ("-1.000 ₫" / "-₫1,000"), which
// can only arise from a mis-set price but must not render as a positive number.
func FormatMoney(tag Tag, amount int32) string {
	n := int64(amount)
	neg := n < 0
	if neg {
		n = -n
	}
	sep := ","
	if tag == VI {
		sep = "."
	}
	digits := groupDigits(n, sep)
	if neg {
		// The sign stays in front of the symbol in BOTH languages ("-1.500 ₫" /
		// "-₫1,500"): a minus sign to the right of the currency symbol reads as
		// part of the amount rather than as its sign.
		digits = "-" + digits
	}
	if tag == VI {
		return digits + " " + currencySymbol
	}
	if neg {
		return "-" + currencySymbol + digits[1:]
	}
	return currencySymbol + digits
}

// groupDigits inserts `sep` every three digits.
func groupDigits(n int64, sep string) string {
	if n == 0 {
		return "0"
	}
	s := ""
	count := 0
	for n > 0 {
		if count > 0 && count%3 == 0 {
			s = sep + s
		}
		s = string(rune('0'+(n%10))) + s
		n /= 10
		count++
	}
	return s
}
