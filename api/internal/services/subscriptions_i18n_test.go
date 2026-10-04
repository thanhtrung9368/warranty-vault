package services

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// Service-level i18n tests for the subscriptions + wishlist slice (wave 2 of
// docs/I18N_PLAN.md §3).
//
// These live in the services package because the two things they pin are not
// reachable over HTTP: the SINGULAR branch of a plural pair whose reachable
// ceiling is 100, and the argument-list discipline that branch depends on. The
// HTTP surface is covered by internal/handlers/subscriptions_i18n_test.go.
//
// Every case pins the language (i18n.WithTag) rather than relying on the default,
// so no assertion here can pass because of the machine's locale
// (docs/I18N_PLAN.md §4.3).

// ctxForTest pins a language on a bare context — the shape a service call has when
// there is no request to carry `?lang=`.
func ctxForTest(lang string) context.Context {
	return i18n.WithTag(context.Background(), i18n.Tag(lang))
}

// The subscription ceiling, both forms and both languages.
//
// This is the plural/Sprintf bug class the brief calls out, and it is asserted
// rather than assumed: wave 0 shipped `"expires in 1 day%!(EXTRA int=7)"` by
// giving one argument list to two templates. The singular form must therefore be
// rendered with an EMPTY argument list and still contain its literal "1".
func TestSubscriptionLimitMessagePluralPair(t *testing.T) {
	for _, tc := range []struct {
		name string
		n    int
		lang string
		want string
	}{
		{"plural, vi", MaxSubscriptionsPerUser, "vi", "Đã đạt giới hạn 100 gói. Xoá bớt rồi thử lại."},
		{"plural, en", MaxSubscriptionsPerUser, "en", "You have reached the limit of 100 subscriptions. Delete some and try again."},
		{"singular, vi", 1, "vi", "Đã đạt giới hạn 1 gói. Xoá bớt rồi thử lại."},
		{"singular, en", 1, "en", "You have reached the limit of 1 subscription. Delete it and try again."},
		{"two, vi", 2, "vi", "Đã đạt giới hạn 2 gói. Xoá bớt rồi thử lại."},
		{"two, en", 2, "en", "You have reached the limit of 2 subscriptions. Delete some and try again."},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := subscriptionLimitMessage(ctxForTest(tc.lang), tc.n)
			if got != tc.want {
				t.Errorf("lang=%s n=%d = %q, want %q", tc.lang, tc.n, got, tc.want)
			}
			if strings.Contains(got, "%!") {
				t.Errorf("lang=%s n=%d produced %q — a template was given an argument list it does not have verbs for", tc.lang, tc.n, got)
			}
		})
	}

	// The Vietnamese side is the ORIGINAL: at the real ceiling it must be
	// byte-for-byte the string the endpoint produced before this wave.
	if got := subscriptionLimitMessage(ctxForTest("vi"), MaxSubscriptionsPerUser); got !=
		"Đã đạt giới hạn 100 gói. Xoá bớt rồi thử lại." {
		t.Errorf("the Vietnamese sentence changed: %q", got)
	}
}

// The wishlist ceiling is a single key (see wishlistLimitMessage), so this pins
// the sentence and its number in both languages rather than a pair.
func TestWishlistLimitMessageIsTranslated(t *testing.T) {
	for _, tc := range []struct {
		lang string
		want string
	}{
		{"vi", "Đã đạt giới hạn 200 món. Xoá bớt rồi thử lại."},
		{"en", "You have reached the limit of 200 wishlist items. Delete some and try again."},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			got := i18n.T(ctxForTest(tc.lang), wishlistLimitMessage, MaxWishlistPerUser)
			if got != tc.want {
				t.Errorf("lang=%s = %q, want %q", tc.lang, got, tc.want)
			}
			if strings.Contains(got, "%!") {
				t.Errorf("lang=%s produced %q — the interpolated count did not match the verbs", tc.lang, got)
			}
		})
	}
}

// The audit's money and dates follow the language, independently of the sentences
// around them.
//
// Asserted here as pure helpers because the full finding is covered over HTTP in
// handlers/subscriptions_i18n_test.go, and because the failure this guards against
// is subtle: "1.200.000 ₫" and "₫1,200,000" are the same VALUE rendered for two
// readers, and "07/05/2026" is a genuinely different DAY to each of them.
func TestAuditMoneyAndDateFollowTheLanguage(t *testing.T) {
	for _, tc := range []struct {
		name   string
		amount int64
		vi     string
		en     string
	}{
		{"thousands", 177000, "177.000 ₫", "₫177,000"},
		{"millions", 1990000, "1.990.000 ₫", "₫1,990,000"},
		{"one digit", 5000, "5.000 ₫", "₫5,000"},
		{"zero", 0, "0 ₫", "₫0"},
		// A negative total cannot arise from these rows (every amount is validated
		// >= 0), but the formatter is shared and must not render one as positive.
		{"negative", -1000, "-1.000 ₫", "-₫1,000"},
	} {
		t.Run("money "+tc.name, func(t *testing.T) {
			if got := formatMoney(i18n.VI, tc.amount); got != tc.vi {
				t.Errorf("vi = %q, want %q", got, tc.vi)
			}
			if got := formatMoney(i18n.EN, tc.amount); got != tc.en {
				t.Errorf("en = %q, want %q", got, tc.en)
			}
		})
	}

	// 7 May 2026 in ISO terms: read as 07/05 by a Vietnamese reader (dd/mm) and as
	// 05/07 by an English one (mm/dd). Both are the SAME instant, which is exactly
	// why the format cannot be shared.
	t.Run("date", func(t *testing.T) {
		d := time.Date(2026, time.May, 7, 0, 0, 0, 0, time.UTC)
		if got := formatDate(i18n.VI, d); got != "07/05/2026" {
			t.Errorf("vi = %q, want %q", got, "07/05/2026")
		}
		if got := formatDate(i18n.EN, d); got != "05/07/2026" {
			t.Errorf("en = %q, want %q", got, "05/07/2026")
		}
	})
}
