package i18n

// The message catalog.
//
// ── How a message is identified ───────────────────────────────────────────
//
// **The Vietnamese string IS the key.** There is no separate id such as
// `auth.login.invalid_credentials`.
//
// Why, given that synthetic ids are the more usual choice:
//
//   - Vietnamese is the ORIGINAL. Every string in this repo already exists and is
//     correct (docs/I18N_PLAN.md §2.4). The migration is therefore *additive*:
//     the source text does not change, it only gains an English column. A lookup
//     keyed on the source text makes that literal — `T(ctx, "Email không hợp lệ")`
//     is a compile-time-visible wrap of the existing literal, and a reviewer can
//     diff the two side by side for every one of the ~803 strings Phase 1 has to
//     convert.
//   - With synthetic ids, Phase 1 needs two coordinated edits per string (invent
//     an id, then move the Vietnamese text into the catalog). One of them is
//     mechanical and the other is a naming decision made 803 times by different
//     agents — exactly the kind of drift this design is meant to avoid.
//   - A wrong key degrades safely and is visible in review. If the key is not in
//     the catalog, `T` returns the key itself, i.e. the correct Vietnamese
//     sentence — never an empty string, never a bare identifier. The failure mode
//     is "this one string was not translated", not "the user sees `err.limit50`".
//   - Key churn is caught by a test, not by users: every entry must carry BOTH
//     languages, and the format verbs of the two must match
//     (catalog_test.go::TestEveryMessageHasBothLanguagesAndMatchingVerbs). An
//     entry keyed on a string that no longer exists is dead weight in a map
//     literal, and the English text next to it is unreviewable without the
//     Vietnamese source it belongs to.
//
// The cost, stated plainly: editing a Vietnamese string means editing its key
// here too (two lines, mechanically). A synthetic id would decouple them. That
// trade was taken deliberately — the strings are stable (this is a shipped app
// whose copy already reads well) and, crucially, Phase 1 is 803 strings
// converted by multiple agents in parallel, where "wrap what is there" is far
// less error-prone than "name what is there".
//
// ── Interpolation ────────────────────────────────────────────────────────
//
// Arguments are passed as `any` and filled in with the standard library's
// `fmt.Sprintf` verbs (`%s`, `%d`, `%q`). No custom DSL, no new dependency, and
// the Sprintf verbs that already appear inside today's literals
// (`fmt.Sprintf("... %d ngày", days)`) keep working unchanged.
//
// The caller's argument list must satisfy BOTH languages' verbs, which is why
// catalog_test.go pins that they match. Note the one hazard this creates and how
// it is contained: a catalog value that contains a literal `%` would corrupt
// Sprintf output, so `Interpolate` calls Sprintf only when arguments were
// actually passed — a static message is returned verbatim, `%` and all.
//
// ── English completion ───────────────────────────────────────────────────
//
// Phase 0 (this change) fills in the whole auth slice plus the cron push bodies.
// Phase 1 adds the remaining ~740 strings; the mechanism does not change. Reach
// for `i18n.T(ctx, "<the Vietnamese literal>", args...)` at the call site and add
// the entry here — that is the entire Phase 1 recipe.

// message is one catalog entry. The zero value of the second language is "" and
// means "not translated yet"; `T` then serves the other language instead of an
// empty string (see Translate).
type message struct {
	// vi is always present: it is the source text and the map key.
	vi string
	// en is the translation. Empty until Phase 1 reaches that string.
	en string
}

// messages maps the Vietnamese source text (the key) to its translations.
//
// Entries are grouped by area so Phase 1 can be split across agents without two
// of them editing the same region. Order inside a group is the order the strings
// appear in the handler.
var messages = map[string]message{
	// ── Shared envelopes (auth slice only; the helpers that emit these take a
	// request context so out-of-scope callers can pass it without translating).
	"Dữ liệu không hợp lệ":       {vi: "Dữ liệu không hợp lệ", en: "Invalid input"},
	"Body phải là JSON hợp lệ":   {vi: "Body phải là JSON hợp lệ", en: "Request body must be valid JSON"},
	"Bạn chưa đăng nhập":         {vi: "Bạn chưa đăng nhập", en: "You are not signed in"},
	"Lỗi hệ thống":               {vi: "Lỗi hệ thống", en: "Something went wrong"},
	"Thao tác quá nhanh. Đợi %s": {vi: "Thao tác quá nhanh. Đợi %s", en: "Too many attempts. Try again in %s"},

	// ── Validation copy shared by the auth endpoints.
	"Email không hợp lệ":                 {vi: "Email không hợp lệ", en: "Invalid email address"},
	"Mật khẩu tối thiểu 8 ký tự":         {vi: "Mật khẩu tối thiểu 8 ký tự", en: "Password must be at least 8 characters"},
	"Mật khẩu không được quá 200 ký tự":  {vi: "Mật khẩu không được quá 200 ký tự", en: "Password must be at most 200 characters"},
	"Tên không được quá 80 ký tự":        {vi: "Tên không được quá 80 ký tự", en: "Name must be at most 80 characters"},
	"Platform không hợp lệ":              {vi: "Platform không hợp lệ", en: "Invalid platform"},
	"Nhập mật khẩu":                      {vi: "Nhập mật khẩu", en: "Enter your password"},
	"Nhập mật khẩu hiện tại":             {vi: "Nhập mật khẩu hiện tại", en: "Enter your current password"},
	"Nhập mật khẩu để xác nhận":          {vi: "Nhập mật khẩu để xác nhận", en: "Enter your password to confirm"},
	"Mật khẩu mới tối thiểu 8 ký tự":     {vi: "Mật khẩu mới tối thiểu 8 ký tự", en: "New password must be at least 8 characters"},
	"Mật khẩu hiện tại không đúng":       {vi: "Mật khẩu hiện tại không đúng", en: "Current password is incorrect"},
	"Mật khẩu không đúng":                {vi: "Mật khẩu không đúng", en: "Password is incorrect"},
	"Xác nhận mật khẩu không khớp":       {vi: "Xác nhận mật khẩu không khớp", en: "Password confirmation does not match"},
	"Required":                           {vi: "Required", en: "This field is required"},
	"Thiếu token":                        {vi: "Thiếu token", en: "Missing token"},
	"Email mới trùng với email hiện tại": {vi: "Email mới trùng với email hiện tại", en: "The new email is the same as your current one"},

	// ── POST /auth/register
	"Nếu email chưa đăng ký, tài khoản đã được tạo. Nếu đã có, vào đăng nhập hoặc quên mật khẩu.": {
		vi: "Nếu email chưa đăng ký, tài khoản đã được tạo. Nếu đã có, vào đăng nhập hoặc quên mật khẩu.",
		en: "If that email was not registered yet, the account has been created. If it already existed, sign in or reset your password.",
	},

	// ── POST /auth/login
	"Email hoặc mật khẩu không đúng": {vi: "Email hoặc mật khẩu không đúng", en: "Incorrect email or password"},

	// ── POST /auth/reset-password
	"Link không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.": {
		vi: "Link không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.",
		en: "This link is invalid or has expired. Request a new one.",
	},
	"Đã đổi mật khẩu. Vào /login để đăng nhập.": {
		vi: "Đã đổi mật khẩu. Vào /login để đăng nhập.",
		en: "Password changed. Sign in again to continue.",
	},

	// ── POST /auth/change-password
	"Đã đổi mật khẩu thành công": {vi: "Đã đổi mật khẩu thành công", en: "Password changed successfully"},

	// ── POST /auth/change-email + /auth/confirm-email-change
	"Nếu địa chỉ mới hợp lệ và chưa được dùng cho tài khoản khác, một email xác nhận đã được gửi tới địa chỉ mới. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận.": {
		vi: "Nếu địa chỉ mới hợp lệ và chưa được dùng cho tài khoản khác, một email xác nhận đã được gửi tới địa chỉ mới. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận.",
		en: "If the new address is valid and not already used by another account, a confirmation email has been sent to it. Your current address keeps working until you confirm.",
	},
	"Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.": {
		vi: "Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.",
		en: "This confirmation link is invalid or has expired. Request a new one.",
	},
	"Email này đã được dùng cho một tài khoản khác. Yêu cầu đổi sang địa chỉ khác.": {
		vi: "Email này đã được dùng cho một tài khoản khác. Yêu cầu đổi sang địa chỉ khác.",
		en: "That email already belongs to another account. Choose a different address.",
	},
	"Đã đổi email. Vào /login để đăng nhập lại bằng địa chỉ mới.": {
		vi: "Đã đổi email. Vào /login để đăng nhập lại bằng địa chỉ mới.",
		en: "Email changed. Sign in again with your new address.",
	},

	// ── GET/PATCH /auth/me
	"Không tìm thấy người dùng": {vi: "Không tìm thấy người dùng", en: "User not found"},
	"Thiếu displayName":         {vi: "Thiếu displayName", en: "Missing displayName"},
	"Tên hiển thị không hợp lệ": {vi: "Tên hiển thị không hợp lệ", en: "Invalid display name"},
	"Không đổi email ở đây. Dùng POST /api/v1/auth/change-email (cần mật khẩu hiện tại) rồi xác nhận bằng token gửi tới địa chỉ mới.": {
		vi: "Không đổi email ở đây. Dùng POST /api/v1/auth/change-email (cần mật khẩu hiện tại) rồi xác nhận bằng token gửi tới địa chỉ mới.",
		en: "Email cannot be changed here. Use POST /api/v1/auth/change-email (it requires your current password), then confirm with the token sent to the new address.",
	},
	"Trường không được hỗ trợ": {
		vi: "Trường không được hỗ trợ",
		en: "Unsupported field",
	},
	"Chỉ hỗ trợ sửa tên hiển thị. Đổi email có luồng riêng (change-email + confirm-email-change).": {
		vi: "Chỉ hỗ trợ sửa tên hiển thị. Đổi email có luồng riêng (change-email + confirm-email-change).",
		en: "Only the display name can be edited here. Changing the email has its own flow (change-email + confirm-email-change).",
	},
	"Đã cập nhật hồ sơ": {vi: "Đã cập nhật hồ sơ", en: "Profile updated"},
	"Ngôn ngữ không hợp lệ": {
		vi: "Ngôn ngữ không hợp lệ",
		en: "Unsupported language",
	},

	// ── DELETE /auth/me
	"Không tìm thấy":   {vi: "Không tìm thấy", en: "Not found"},
	"Đã xoá tài khoản": {vi: "Đã xoá tài khoản", en: "Account deleted"},

	// ── Cron push notifications (internal/cron/run.go).
	//
	// These are the reason User.locale exists: the fan-out runs with no request
	// context, so the recipient's stored preference is the only signal available.
	//
	// The `%d` buckets come in singular/plural PAIRS because Vietnamese does not
	// inflect for number and English does ("1 day" vs "3 days",
	// docs/I18N_PLAN.md §4.6). Callers pick the key; there is no plural rule
	// engine, and adding one would drag in CLDR data for a distinction that only
	// ever applies to the literal numbers 1, 3, 7 and 30.
	"BH %s của \"%s\" sắp hết trong %d ngày": {
		vi: "BH %s của \"%s\" sắp hết trong %d ngày",
		en: "%s warranty for \"%s\" expires in %d days",
	},
	// NOTE on the singular/plural pairs: the singular template takes FEWER verbs
	// than the plural one (`%s %s` vs `%s %s %d`) because the count is what makes
	// it singular. Callers therefore supply a separate argument list per form —
	// internal/cron/run.go::render takes both — and catalog_test.go pins the verb
	// counts of the two forms so this stays a rule rather than a convention.
	"BH %s của \"%s\" sắp hết trong 1 ngày": {
		vi: "BH %s của \"%s\" sắp hết trong 1 ngày",
		en: "%s warranty for \"%s\" expires in 1 day",
	},
	"Hết hạn: %s": {vi: "Hết hạn: %s", en: "Expires: %s"},
	"Hết hạn: %s • %s": {
		vi: "Hết hạn: %s • %s",
		en: "Expires: %s • %s",
	},
	"🛍️ Hôm nay là ngày dự kiến mua \"%s\"": {
		vi: "🛍️ Hôm nay là ngày dự kiến mua \"%s\"",
		en: "🛍️ Today is the day you planned to buy \"%s\"",
	},
	"🛍️ Còn %d ngày tới ngày mua \"%s\"": {
		vi: "🛍️ Còn %d ngày tới ngày mua \"%s\"",
		en: "🛍️ %d days until you plan to buy \"%s\"",
	},
	"🛍️ Còn 1 ngày tới ngày mua \"%s\"": {
		vi: "🛍️ Còn 1 ngày tới ngày mua \"%s\"",
		en: "🛍️ 1 day until you plan to buy \"%s\"",
	},
	"Check lại giá nhé": {vi: "Check lại giá nhé", en: "Worth checking the price"},
	"Check lại giá nhé • %s": {
		vi: "Check lại giá nhé • %s",
		en: "Worth checking the price • %s",
	},
	"Check lại giá nhé • ~%s": {
		vi: "Check lại giá nhé • ~%s",
		en: "Worth checking the price • ~%s",
	},
	"🔔 Đã %d ngày chưa update giá \"%s\"": {
		vi: "🔔 Đã %d ngày chưa update giá \"%s\"",
		en: "🔔 No price update for \"%s\" in %d days",
	},
	"🔔 Đã 1 ngày chưa update giá \"%s\"": {
		vi: "🔔 Đã 1 ngày chưa update giá \"%s\"",
		en: "🔔 No price update for \"%s\" in 1 day",
	},
	"Còn thèm không? Check lại giá nhé.": {
		vi: "Còn thèm không? Check lại giá nhé.",
		en: "Still want it? Worth checking the price.",
	},
	"Còn thèm không? Check lại giá nhé • giá hiện tại %s.": {
		vi: "Còn thèm không? Check lại giá nhé • giá hiện tại %s.",
		en: "Still want it? Worth checking the price • now %s.",
	},
	// The English carries one extra verb because "your subscription X will
	// renew" names the subscription while the Vietnamese phrasing puts it last.
	// The argument ORDER differs between the two, so the call site builds the
	// list per locale and catalog_test.go pins the verb COUNT (equal) rather
	// than the verb sequence (deliberately different). See buildReminder* in
	// internal/cron/run.go.
	"💸 Hôm nay %s: \"%s\"": {
		vi: "💸 Hôm nay %s: \"%s\"",
		en: "💸 Today your subscription \"%s\" will %s",
	},
	"💸 Còn %d ngày %s: \"%s\"": {
		vi: "💸 Còn %d ngày %s: \"%s\"",
		en: "💸 In %d days your subscription \"%s\" will %s",
	},
	"💸 Còn 1 ngày %s: \"%s\"": {
		vi: "💸 Còn 1 ngày %s: \"%s\"",
		en: "💸 Tomorrow your subscription \"%s\" will %s",
	},
	"sẽ tự gia hạn": {vi: "sẽ tự gia hạn", en: "renew automatically"},
	"sẽ hết hạn":    {vi: "sẽ hết hạn", en: "expire"},
	" • có link huỷ": {
		vi: " • có link huỷ",
		en: " • cancellation link available",
	},
	"✅ Đã gia hạn \"%s\"": {
		vi: "✅ Đã gia hạn \"%s\"",
		en: "✅ \"%s\" renewed",
	},
	"Tự động charge %s. Kỳ tới: %s": {
		vi: "Tự động charge %s. Kỳ tới: %s",
		en: "Charged %s automatically. Next billing date: %s",
	},
	"⌛️ Gói \"%s\" đã hết hạn": {
		vi: "⌛️ Gói \"%s\" đã hết hạn",
		en: "⌛️ \"%s\" has expired",
	},
	"Không tự gia hạn — đăng ký lại hoặc đánh dấu huỷ.": {
		vi: "Không tự gia hạn — đăng ký lại hoặc đánh dấu huỷ.",
		en: "Auto-renew is off — resubscribe or mark it cancelled.",
	},
	"↩️ Còn %d ngày đổi trả \"%s\"": {
		vi: "↩️ Còn %d ngày đổi trả \"%s\"",
		en: "↩️ %d days left to return \"%s\"",
	},
	"↩️ Còn 1 ngày đổi trả \"%s\"": {
		vi: "↩️ Còn 1 ngày đổi trả \"%s\"",
		en: "↩️ 1 day left to return \"%s\"",
	},
	"Hạn đổi/trả: %s": {vi: "Hạn đổi/trả: %s", en: "Return deadline: %s"},
	"Hạn đổi/trả: %s (%d ngày kể từ ngày nhận)": {
		vi: "Hạn đổi/trả: %s (%d ngày kể từ ngày nhận)",
		en: "Return deadline: %s (%d days from delivery)",
	},
	"Hạn đổi/trả: %s (1 ngày kể từ ngày nhận)": {
		vi: "Hạn đổi/trả: %s (1 ngày kể từ ngày nhận)",
		en: "Return deadline: %s (1 day from delivery)",
	},

	// ── Warranty type labels (cron warranty bucket).
	"Tiêu chuẩn": {vi: "Tiêu chuẩn", en: "Standard"},
	"Mở rộng":    {vi: "Mở rộng", en: "Extended"},
	"Bên thứ ba": {vi: "Bên thứ ba", en: "Third party"},

	// ── Push self-test (internal/handlers/push.go).
	"Đây là thông báo thử nghiệm": {
		vi: "Đây là thông báo thử nghiệm",
		en: "This is a test notification",
	},
}
