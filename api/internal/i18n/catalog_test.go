package i18n

import (
	"context"
	"sort"
	"strings"
	"testing"
)

// ── Catalog invariants ───────────────────────────────────────────────────────
//
// These run over the real catalog, so every Phase 1 agent's entry is checked the
// moment it lands. The whole point of the string-as-key design is that these are
// the ONLY things a reviewer cannot see by reading the diff.

// Every entry must carry the Vietnamese source text. Vietnamese is the original:
// an entry whose `vi` is empty is either a typo or an English string that was
// added without its source, and either way `Translate(VI, ...)` would serve
// English to a Vietnamese user.
//
// `en` is allowed to be empty until Phase 1 fills it — the fallback serves the
// Vietnamese text instead, which is the pre-i18n behaviour.
func TestEveryMessageHasVietnameseSourceText(t *testing.T) {
	for key, entry := range messages {
		if entry.vi == "" {
			t.Errorf("catalog entry %q has no Vietnamese text", key)
		}
		if key != entry.vi {
			t.Errorf("catalog key %q does not match its Vietnamese text %q — the key IS the source string", key, entry.vi)
		}
	}
}

var validVerbs = map[rune]bool{
	'v': true, 's': true, 'd': true, 'q': true, 't': true, 'f': true,
	'g': true, 'e': true, 'b': true, 'o': true, 'x': true, 'X': true, 'c': true, 'U': true, 'p': true,
}

// verbs returns the Sprintf conversion letters in a message, so an English
// translation that expects a different set of arguments than the Vietnamese
// source can be caught here instead of at 3am as `%!d(string=...)` in a push
// notification.
//
// Positional verbs (`%[2]s`) are rejected outright rather than supported: the
// cron composes one argument list per language, so reordering belongs at the call
// site, where the compiler and the reviewer can both see it. A positional verb in
// the catalog would silently pass a positional arg list that every OTHER language
// for that key does not have.
func verbs(s string) ([]rune, bool) {
	var out []rune
	positional := false
	for i := 0; i < len(s); i++ {
		if s[i] != '%' {
			continue
		}
		i++
		if i >= len(s) {
			break
		}
		if s[i] == '%' { // escaped percent, not a verb
			continue
		}
		if s[i] == '[' {
			positional = true
			continue
		}
		r := rune(s[i])
		if validVerbs[r] {
			out = append(out, r)
		}
	}
	return out, positional
}

// The exception, deliberately spelled out: the subscription-renewal reminders
// name the subscription in English ("your subscription X will renew") but put it
// last in Vietnamese ("sẽ tự gia hạn: X"), so the English template carries one
// extra verb and the call site passes one extra argument for `en`. Keeping the
// keys honest matters more than keeping them uniform, and a blanket rule would
// have forced a worse English sentence.
var verbCountExceptions = map[string]bool{
	"💸 Hôm nay %s: \"%s\"":     true,
	"💸 Còn %d ngày %s: \"%s\"": true,
	"💸 Còn 1 ngày %s: \"%s\"":  true,
}

// A message that exists in both languages must not ask for a different number of
// arguments in each, or one of the two renders fmt's error text to a user.
func TestTranslationsAgreeOnArgumentCount(t *testing.T) {
	for key, entry := range messages {
		if entry.en == "" {
			continue // not translated yet — nothing to disagree with
		}
		viVerbs, viPositional := verbs(entry.vi)
		enVerbs, enPositional := verbs(entry.en)
		if viPositional || enPositional {
			t.Errorf("catalog entry %q uses positional verbs; reorder the arguments at the call site instead", key)
		}
		if len(viVerbs) != len(enVerbs) && !verbCountExceptions[key] {
			t.Errorf("catalog entry %q: vi has %d verbs %q, en has %d verbs %q — one of them will render fmt's error text",
				key, len(viVerbs), string(viVerbs), len(enVerbs), string(enVerbs))
		}
	}
}

// The singular/plural template pairs.
//
// Each pair is one message in two forms, and the singular form takes FEWER verbs
// than the plural one because the count is what makes it singular ("expires in 1
// day" has no slot for a number). Callers pass a separate argument list per form
// (internal/cron/run.go::renderCount), and this test is what holds that shape:
// if someone "fixes" the singular template by adding a `%d` back — which is
// exactly the mistake this codebase made once, rendering
// `... expires in 1 day%!(EXTRA int=7)` — it fails here rather than in a push
// notification.
//
// Both languages are checked, because either one being off breaks its readers.
var singularPluralPairs = []struct {
	plural   string
	singular string
}{
	{
		`BH %s của "%s" sắp hết trong %d ngày`,
		`BH %s của "%s" sắp hết trong 1 ngày`,
	},
	{
		`🛍️ Còn %d ngày tới ngày mua "%s"`,
		`🛍️ Còn 1 ngày tới ngày mua "%s"`,
	},
	{
		`🔔 Đã %d ngày chưa update giá "%s"`,
		`🔔 Đã 1 ngày chưa update giá "%s"`,
	},
	{
		`💸 Còn %d ngày %s: "%s"`,
		`💸 Còn 1 ngày %s: "%s"`,
	},
	{
		`↩️ Còn %d ngày đổi trả "%s"`,
		`↩️ Còn 1 ngày đổi trả "%s"`,
	},
	{
		"Hạn đổi/trả: %s (%d ngày kể từ ngày nhận)",
		"Hạn đổi/trả: %s (1 ngày kể từ ngày nhận)",
	},
	// Wave 2 (subscriptions + wishlist). The subscription ceiling is a pair for
	// the same reason the cron's day counts are: the count is interpolated, the
	// refusal is reachable at 1 through a service-level call, and "1 subscriptions"
	// is not English. The wishlist ceiling is deliberately NOT a pair —
	// MAX_WISHLIST_PER_USER is 200 and no user-supplied count reaches its
	// sentence, so a singular key for it would be a catalog entry nothing can
	// produce.
	{
		"Đã đạt giới hạn %d gói. Xoá bớt rồi thử lại.",
		"Đã đạt giới hạn 1 gói. Xoá bớt rồi thử lại.",
	},
	// The audit's "auto-charged N times" sentence. It IS a pair: the count is
	// reachable at 1 (the threshold is 3, but the sentence is a template), and
	// English cannot say "1 times".
	{
		"«%s» đã tự động trừ %d lần, tổng %s, lần đầu từ %s — và bạn chưa từng tự ghi khoản nào cho gói này. Nếu đã lâu không dùng, đây là lúc xem lại.",
		"«%s» đã tự động trừ 1 lần, tổng %s, lần đầu từ %s — và bạn chưa từng tự ghi khoản nào cho gói này. Nếu đã lâu không dùng, đây là lúc xem lại.",
	},
	// Wave 3: the .zip export's "N attachments were missing from disk" warning.
	// It IS a pair — the export records one missing blob as readily as five, and
	// English cannot say "1 attachments". The `%s` in both forms is the translated
	// honesty note the warning is appended to.
	{
		"%s LƯU Ý: %d file đính kèm không còn trên đĩa nên KHÔNG có trong bản sao lưu này (xem missingAttachmentIds).",
		"%s LƯU Ý: 1 file đính kèm không còn trên đĩa nên KHÔNG có trong bản sao lưu này (xem missingAttachmentIds).",
	},
	// Wave 5: the shared 429 retry window. Both forms are reachable by arithmetic
	// alone — FormatRetry switches to minutes at 60 s, and ceil(60/60) is 1 — so
	// "1 minute" is not a hypothetical, and "1 minutes" is not English.
	{"%d phút", "1 phút"},
	{"%d giây", "1 giây"},
	// Wave 5: the action queue's four count-bearing sentences. Each one's count is
	// reachable at exactly 1 through the SQL the rule is built on (a warranty that
	// expired yesterday, a return window closing tomorrow, a renewal date one day
	// past, a target purchase date one day gone), so "1 days ago" would be a real
	// string a real user reads.
	{
		"Gói %s của «%s» đã hết hạn ngày %s (%d ngày trước). Máy vẫn đang ở trạng thái đang dùng.",
		"Gói %s của «%s» đã hết hạn ngày %s (1 ngày trước). Máy vẫn đang ở trạng thái đang dùng.",
	},
	{
		"«%s» còn %d ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.",
		"«%s» còn 1 ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.",
	},
	{
		"«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua %d ngày). Gia hạn hoặc sửa lại ngày cho khớp.",
		"«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua 1 ngày). Gia hạn hoặc sửa lại ngày cho khớp.",
	},
	{
		"«%s» có ngày dự kiến mua %s, đã qua %d ngày.",
		"«%s» có ngày dự kiến mua %s, đã qua 1 ngày.",
	},
}

func TestSingularPluralPairsAgreeOnVerbCounts(t *testing.T) {
	for _, pair := range singularPluralPairs {
		for _, language := range []string{"vi", "en"} {
			p, ok := messages[pair.plural]
			if !ok {
				t.Errorf("plural key %q is not in the catalog", pair.plural)
				continue
			}
			sg, ok := messages[pair.singular]
			if !ok {
				t.Errorf("singular key %q is not in the catalog", pair.singular)
				continue
			}
			var pluralText, singularText, singularKey string
			if language == "vi" {
				pluralText, singularText, singularKey = p.vi, sg.vi, pair.singular
			} else {
				pluralText, singularText, singularKey = p.en, sg.en, pair.singular
			}
			if pluralText == "" || singularText == "" {
				t.Errorf("pair %q / %q is missing its %s text", pair.plural, pair.singular, language)
				continue
			}
			pluralVerbs, _ := verbs(pluralText)
			singularVerbs, _ := verbs(singularText)
			if len(singularVerbs) >= len(pluralVerbs) {
				t.Errorf("%s: plural %q has %d verbs and singular %q has %d — the singular must carry FEWER, because the count is what makes it singular",
					language, pluralText, len(pluralVerbs), singularText, len(singularVerbs))
			}
			// The Vietnamese singular must be the plural with the count turned
			// into the literal 1: Vietnamese does not inflect, so that identity
			// is what makes the two keys a pair rather than two unrelated
			// strings. English is deliberately NOT checked this way — its
			// singular also has to un-pluralise the noun ("1 day", not
			// "1 days"), which is the whole reason the pair exists.
			if language == "vi" {
				if want := strings.Replace(pluralText, "%d", "1", 1); want != singularText {
					t.Errorf("%s: singular %q is not the plural %q with %%d → 1 (want %q)",
						language, singularText, pluralText, want)
				}
			}
			// And the Vietnamese key must name the Vietnamese text, which is the
			// rule that lets the key double as the source.
			if language == "vi" && singularKey != singularText {
				t.Errorf("singular key %q does not match its Vietnamese text %q", singularKey, singularText)
			}
		}
	}
}

// The cron is the only caller of renderCount, and it must never hand the plural
// argument list to the singular template. This walks the pairs the way the cron
// does, with the two lists it actually passes, and asserts the output contains no
// Sprintf complaint — the failure mode is `%!(EXTRA ...)`, not a panic.
func TestSingularRendersWithoutTheCountArgument(t *testing.T) {
	for _, tc := range []struct {
		plural          string
		singular        string
		plainArgs       []any // the "n != 1" list
		singularArgs    []any // the "n == 1" list
		englishPlain    []any // reordered for the English template; nil = same as plainArgs
		englishSingular []any
	}{
		{
			plural:       `BH %s của "%s" sắp hết trong %d ngày`,
			singular:     `BH %s của "%s" sắp hết trong 1 ngày`,
			plainArgs:    []any{"Standard", "iPhone", 7},
			singularArgs: []any{"Standard", "iPhone"},
		},
		{
			plural:       `🛍️ Còn %d ngày tới ngày mua "%s"`,
			singular:     `🛍️ Còn 1 ngày tới ngày mua "%s"`,
			plainArgs:    []any{7, "iPhone"},
			singularArgs: []any{"iPhone"},
		},
		{
			// Second pair with a language-specific order: the English title names
			// the item first ("No price update for X in N days"), Vietnamese the
			// count first.
			plural:          `🔔 Đã %d ngày chưa update giá "%s"`,
			singular:        `🔔 Đã 1 ngày chưa update giá "%s"`,
			plainArgs:       []any{int32(7), "iPhone"},
			singularArgs:    []any{"iPhone"},
			englishPlain:    []any{"iPhone", int32(7)},
			englishSingular: []any{"iPhone"},
		},
		{
			// The only pair whose argument ORDER differs between the languages:
			// English names the subscription first and the verb last.
			plural:          `💸 Còn %d ngày %s: "%s"`,
			singular:        `💸 Còn 1 ngày %s: "%s"`,
			plainArgs:       []any{7, "renew automatically", "Netflix"},
			singularArgs:    []any{"renew automatically", "Netflix"},
			englishPlain:    []any{7, "Netflix", "renew automatically"},
			englishSingular: []any{"Netflix", "renew automatically"},
		},
		{
			plural:       `↩️ Còn %d ngày đổi trả "%s"`,
			singular:     `↩️ Còn 1 ngày đổi trả "%s"`,
			plainArgs:    []any{7, "iPhone"},
			singularArgs: []any{"iPhone"},
		},
		{
			plural:       "Hạn đổi/trả: %s (%d ngày kể từ ngày nhận)",
			singular:     "Hạn đổi/trả: %s (1 ngày kể từ ngày nhận)",
			plainArgs:    []any{"07/10/2026", int32(30)},
			singularArgs: []any{"07/10/2026"},
		},
		{
			// Wave 5, the shared 429 window: the singular template has no verb at
			// all, because the count IS what makes it singular.
			plural:       "%d phút",
			singular:     "1 phút",
			plainArgs:    []any{2},
			singularArgs: nil,
		},
		{
			plural:       "%d giây",
			singular:     "1 giây",
			plainArgs:    []any{45},
			singularArgs: nil,
		},
		{
			// Wave 5, the action queue. The four arguments are the plan label,
			// the device name, the rendered date and the day count.
			plural:       "Gói %s của «%s» đã hết hạn ngày %s (%d ngày trước). Máy vẫn đang ở trạng thái đang dùng.",
			singular:     "Gói %s của «%s» đã hết hạn ngày %s (1 ngày trước). Máy vẫn đang ở trạng thái đang dùng.",
			plainArgs:    []any{"Standard", "iPhone", "07/05/2026", 1},
			singularArgs: []any{"Standard", "iPhone", "07/05/2026"},
		},
		{
			plural:       "«%s» còn %d ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.",
			singular:     "«%s» còn 1 ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.",
			plainArgs:    []any{"iPhone", 1, "07/05/2026"},
			singularArgs: []any{"iPhone", "07/05/2026"},
		},
		{
			plural:       "«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua %d ngày). Gia hạn hoặc sửa lại ngày cho khớp.",
			singular:     "«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua 1 ngày). Gia hạn hoặc sửa lại ngày cho khớp.",
			plainArgs:    []any{"Netflix", "01/05/2026", "07/05/2026", 1},
			singularArgs: []any{"Netflix", "01/05/2026", "07/05/2026"},
		},
		{
			plural:       "«%s» có ngày dự kiến mua %s, đã qua %d ngày.",
			singular:     "«%s» có ngày dự kiến mua %s, đã qua 1 ngày.",
			plainArgs:    []any{"iPhone 16", "07/05/2026", 1},
			singularArgs: []any{"iPhone 16", "07/05/2026"},
		},
	} {
		for _, tag := range []Tag{VI, EN} {
			plainArgs, singularArgs := tc.plainArgs, tc.singularArgs
			if tag == EN {
				if tc.englishPlain != nil {
					plainArgs = tc.englishPlain
				}
				if tc.englishSingular != nil {
					singularArgs = tc.englishSingular
				}
			}
			for _, form := range []struct {
				key  string
				args []any
			}{
				{tc.plural, plainArgs},
				{tc.singular, singularArgs},
			} {
				text, ok := Lookup(tag, form.key)
				if !ok {
					t.Fatalf("%q missing from the catalog", form.key)
				}
				got := Interpolate(text, form.args...)
				if strings.Contains(got, "%!") {
					t.Errorf("%s %q → %q renders a Sprintf complaint", tag, form.key, got)
				}
			}
		}
	}
}

// A translated entry must not drop a verb the source has (a copy/paste that lost
// a placeholder) and must actually be translated rather than being a copy of the
// Vietnamese source. The second half matters: an agent under time pressure could
// "fill in" the English column by pasting the Vietnamese text, and the catalog
// would look complete while English users see Vietnamese.
func TestTranslationsAreActuallyTranslated(t *testing.T) {
	for key, entry := range messages {
		if entry.en == "" {
			continue
		}
		if entry.en == entry.vi {
			// Two legitimate identical pairs: "Required" is the same word, and
			// the emoji-only segments are not sentences. Anything else is a
			// missed translation.
			if key == "Required" {
				continue
			}
			t.Errorf("catalog entry %q has identical vi/en text %q — is it actually translated?", key, entry.en)
		}
	}
}

// Interpolating every entry with dummy arguments must produce a string with no
// Sprintf error markers. This is the cheap end-to-end proof that the verbs and
// the call convention line up: a `%d` fed a string, or a verb the args do not
// satisfy, shows up as `%!d(...)` here rather than in a push notification.
func TestEveryEntryInterpolatesCleanly(t *testing.T) {
	for key, entry := range messages {
		for _, text := range []string{entry.vi, entry.en} {
			if text == "" {
				continue
			}
			n, _ := verbs(text)
			args := make([]any, len(n))
			for i, v := range n {
				switch v {
				case 'd':
					args[i] = 3
				case 'f', 'e', 'g':
					args[i] = 1.5
				case 't':
					args[i] = true
				default:
					args[i] = "x"
				}
			}
			got := Interpolate(text, args...)
			if strings.Contains(got, "%!") {
				t.Errorf("catalog entry %q renders Sprintf errors: %q", key, got)
			}
			if got == "" {
				t.Errorf("catalog entry %q rendered an empty string", key)
			}
		}
	}
}

// ctxENStub / ctxVIStub pin a language with no HTTP plumbing.
func ctxENStub() context.Context { return WithTag(context.Background(), EN) }
func ctxVIStub() context.Context { return WithTag(context.Background(), VI) }

// Every message must be reachable: a key that no call site uses is dead weight
// and, worse, an English string nobody will ever see. This cannot be checked
// automatically for the whole catalog (the call sites live in other packages), so
// instead pin the areas that exist today — if a Phase 1 agent deletes the last
// use of a key, this list is where they notice.
func TestCatalogCoversTheConvertedAreas(t *testing.T) {
	// A sample from each converted area, chosen so that deleting a whole area's
	// worth of entries fails loudly rather than silently shrinking the catalog.
	mustExist := []string{
		// auth slice — validation, credentials, email change, profile
		"Email không hợp lệ",
		"Email hoặc mật khẩu không đúng",
		"Link không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.",
		"Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.",
		"Đã đổi email. Vào /login để đăng nhập lại bằng địa chỉ mới.",
		"Đã cập nhật hồ sơ",
		"Ngôn ngữ không hợp lệ",
		// cron push
		"BH %s của \"%s\" sắp hết trong %d ngày",
		"↩️ Còn %d ngày đổi trả \"%s\"",
		"✅ Đã gia hạn \"%s\"",
		"⌛️ Gói \"%s\" đã hết hạn",
		// backup + attachments + files (wave 3) — both honesty notes, one import
		// refusal and one attachment ceiling, so deleting this domain's copy
		// fails here rather than shipping a half-translated endpoint.
		"Bản sao lưu này KHÔNG chứa nội dung ảnh/hoá đơn đính kèm (chỉ có tên file, loại file và kích thước). Khôi phục sang một máy chủ khác sẽ không khôi phục được ảnh.",
		"Bản sao lưu này CÓ chứa nội dung ảnh/hoá đơn đính kèm (đã mã hoá AES-256-GCM). Cần đúng FILE_MASTER_KEY của máy chủ đã xuất bản sao lưu thì mới giải mã được; thiếu hoặc sai khoá thì file vẫn được khôi phục nhưng không mở được.",
		"File data.json này là phần dữ liệu của một bản sao lưu .zip có kèm nội dung ảnh. Hãy chọn chính file .zip để khôi phục — import riêng data.json sẽ mất toàn bộ ảnh/hoá đơn.",
		"Tối đa 5 file/thiết bị",
	}
	for _, key := range mustExist {
		if _, ok := messages[key]; !ok {
			t.Errorf("catalog is missing %q — a converted call site is now serving Vietnamese to English users", key)
		}
	}
}

// Report the Phase 1 worklist size, so "how much is left" is a number and not a
// guess. Not an assertion about a specific count (that would be a merge conflict
// magnet) — just a guard that the catalog is non-trivial and every entry is
// consistent.
func TestCatalogStats(t *testing.T) {
	if len(messages) < 60 {
		t.Fatalf("catalog has %d entries; Phase 0 was supposed to seed the auth slice and the cron bodies", len(messages))
	}
	translated := 0
	for _, entry := range messages {
		if entry.en != "" {
			translated++
		}
	}
	t.Logf("catalog: %d entries, %d translated to English, %d still Vietnamese-only (Phase 1 worklist)",
		len(messages), translated, len(messages)-translated)

	// Sorted sample in the log so a failure report shows what is in there.
	keys := make([]string, 0, len(messages))
	for k := range messages {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	if testing.Verbose() {
		for _, k := range keys {
			entry := messages[k]
			en := entry.en
			if en == "" {
				en = "<missing>"
			}
			t.Logf("  %s → %s", k, en)
		}
	}
}

// A catalog entry whose verbs do not match its English translation would render
// the fmt error text; the dry-run check above covers that. This one covers the
// reverse mistake: a key that CONTAINS a percent sign that is not a verb, which
// `Interpolate` protects only because it skips Sprintf when there are no args.
func TestStaticEntriesWithLiteralPercentAreSafe(t *testing.T) {
	// Built at runtime so `go vet` does not read them as malformed format
	// strings: the keys here contain a bare `%`, which is exactly the case that
	// must NOT reach Sprintf.
	key := strings.Join([]string{"zz test — giảm ", "100%"}, "")
	english := strings.Join([]string{"zz test — ", "100% off"}, "")
	messages[key] = message{vi: key, en: english}
	t.Cleanup(func() { delete(messages, key) })

	if got := Text(ctxENStub(), key); got != english {
		t.Errorf("Translate(EN) = %q, want the literal %% preserved", got)
	}
	if got := Text(ctxVIStub(), key); got != key {
		t.Errorf("Translate(VI) = %q, want %q", got, key)
	}
}
