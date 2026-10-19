package pdfpack

import (
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// vietnam is a fixed UTC+7 zone. A document read in Vietnam must not inherit the
// server's local zone (the service runs in UTC on the deploy host), and a fixed
// offset avoids a tzdata dependency for a country that has no DST.
var vietnam = time.FixedZone("ICT", 7*60*60)

// formatDate renders a stored `timestamp without time zone` date as a
// Vietnamese date. The value is formatted as stored; converting it between zones
// could shift a purchase date by one day for no reason.
func formatDate(t *time.Time) string {
	if t == nil || t.IsZero() {
		return notRecorded
	}
	return t.Format("02/01/2006")
}

func formatDateTime(t time.Time) string {
	return t.In(vietnam).Format("02/01/2006 15:04")
}

// formatMoney renders an amount in its own currency. The ISO code is printed
// rather than a symbol: "999 USD" cannot be mistaken for 999 đồng, which is the
// exact confusion the multi-currency field exists to prevent.
func formatMoney(amount int32, currency string) string {
	currency = strings.ToUpper(strings.TrimSpace(currency))
	if currency == "" {
		currency = "VND"
	}
	return formatThousands(int64(amount)) + " " + currency
}

func formatMoneyPtr(p *int32, currency string) string {
	if p == nil {
		return notRecorded
	}
	return formatMoney(*p, currency)
}

// formatVND renders the locked VND value. nil is "Không xác định", never 0.
func formatVND(v *int64) string {
	if v == nil {
		return noVND
	}
	return formatThousands(*v) + " VND"
}

func formatVNDAmount(v int64) string {
	return formatThousands(v) + " VND"
}

// formatThousands groups the integer part with "." (Vietnamese convention).
func formatThousands(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		// MinInt64 cannot be negated in int64; format via uint64 magnitude.
		u := uint64(-(v + 1))
		u++
		return "-" + formatThousandsUint(u)
	}
	return formatThousandsUint(uint64(v))
}

func formatThousandsUint(v uint64) string {
	var digits [24]byte
	i := len(digits)
	for v > 0 && i > 0 {
		digits[i-1] = byte('0' + v%10)
		i--
		v /= 10
	}
	raw := string(digits[i:])
	if len(raw) <= 3 {
		return raw
	}
	var out strings.Builder
	first := len(raw) % 3
	if first == 0 {
		first = 3
	}
	out.WriteString(raw[:first])
	for j := first; j < len(raw); j += 3 {
		out.WriteByte('.')
		out.WriteString(raw[j : j+3])
	}
	return out.String()
}

func formatDateRange(start, end *time.Time) string {
	if start == nil && end == nil {
		return notRecorded
	}
	return formatDate(start) + " – " + formatDate(end)
}

// claimsUsage renders "2/3 lần" or "2 lần (không ghi giới hạn)".
func claimsUsage(allowed *int32, used int32) string {
	if allowed == nil {
		return fmt.Sprintf("%d lần (không ghi giới hạn)", used)
	}
	return fmt.Sprintf("%d/%d lần", used, *allowed)
}

func valueOr(v, fallback string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return fallback
	}
	return v
}

// sanitizeText makes user input safe for the PDF text layer. gopdf escapes PDF
// string delimiters itself, but invalid UTF-8 and control characters (including
// NUL) are not text and can corrupt a content stream. Newlines are kept because
// the wrapper treats them as deliberate line breaks.
func sanitizeText(s string) string {
	s = strings.ToValidUTF8(s, "")
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r == '\n':
			b.WriteRune(r)
		case r == '\t':
			b.WriteByte(' ')
		case r == utf8.RuneError:
			b.WriteByte('?') // strings.ToValidUTF8 already replaced invalid bytes, but a literal U+FFFD can still arrive
		case unicode.IsControl(r):
			// Drop controls; a form-feed or vertical tab in a copied address is
			// noise, not content.
		default:
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}

func joinNonEmpty(parts ...string) string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, " — ")
}
