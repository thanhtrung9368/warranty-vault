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
// Phase 0 filled in the auth slice plus the cron push bodies. Phase 1 adds the
// rest, one domain per wave (docs/I18N_PLAN.md §3); the mechanism does not
// change. Reach for `i18n.T(ctx, "<the Vietnamese literal>", args...)` at the
// call site and add the entry here — that is the entire Phase 1 recipe.
//
// Converted so far: auth (Phase 0) · devices + warranties (wave 1) ·
// subscriptions + subscription audit + wishlist (wave 2).

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

	// ── Shared envelopes whose callers have been converted.
	//
	// "Lỗi hệ thống" is deliberately NOT in this group: it is the 500 headline of
	// every per-domain error writer (writeServiceError, writeDevicesErr,
	// writeAttachmentError, …), so translating it would change responses in
	// domains Phase 1 has not reached. It is already in the catalog above because
	// the converted auth slice serves it, and each remaining writer adopts
	// i18n.Text for it in its own wave.
	"Thiếu id thiết bị":       {vi: "Thiếu id thiết bị", en: "Missing device id"},
	"Thiếu id gói bảo hành":   {vi: "Thiếu id gói bảo hành", en: "Missing warranty id"},
	"Không tìm thấy thiết bị": {vi: "Không tìm thấy thiết bị", en: "Device not found"},
	"Không tìm thấy gói bảo hành": {
		vi: "Không tìm thấy gói bảo hành",
		en: "Warranty not found",
	},
	"Loại thiết bị không hợp lệ": {
		vi: "Loại thiết bị không hợp lệ",
		en: "Invalid device category",
	},

	// ── Device validation (internal/services/devices.go).
	//
	// Vietnamese is the original in every entry below; only the English column is
	// new. Each sentence keeps its meaning rather than its word order — "Tên thiết
	// bị bắt buộc" is "Device name is required", not "Name device mandatory".
	"Tên thiết bị bắt buộc":  {vi: "Tên thiết bị bắt buộc", en: "Device name is required"},
	"Loại thiết bị bắt buộc": {vi: "Loại thiết bị bắt buộc", en: "Device category is required"},
	"Ngày mua bắt buộc":      {vi: "Ngày mua bắt buộc", en: "Purchase date is required"},
	"Giá mua không hợp lệ":   {vi: "Giá mua không hợp lệ", en: "Invalid purchase price"},
	"Giá bán không hợp lệ":   {vi: "Giá bán không hợp lệ", en: "Invalid sale price"},
	"Thiếu ngày bán":         {vi: "Thiếu ngày bán", en: "Missing sale date"},
	"Thiếu giá bán":          {vi: "Thiếu giá bán", en: "Missing sale price"},
	"Ngày mua không hợp lệ":  {vi: "Ngày mua không hợp lệ", en: "Invalid purchase date"},
	"Ngày bán không hợp lệ":  {vi: "Ngày bán không hợp lệ", en: "Invalid sale date"},
	"Ngày nhận hàng không hợp lệ": {
		vi: "Ngày nhận hàng không hợp lệ",
		en: "Invalid delivery date",
	},
	"Số tháng bảo hành không hợp lệ": {
		vi: "Số tháng bảo hành không hợp lệ",
		en: "Invalid warranty length in months",
	},
	"Trạng thái không hợp lệ": {vi: "Trạng thái không hợp lệ", en: "Invalid status"},
	"Số ngày đổi trả phải từ %d tới %d": {
		vi: "Số ngày đổi trả phải từ %d tới %d",
		en: "The return window must be between %d and %d days",
	},
	// The active-device ceiling. Read aloud, not word for word
	// (docs/I18N_PLAN.md §4.4): the Vietnamese says sold devices "do not occupy a
	// slot", which is the whole point of the message — a user at 50 active rows is
	// told that marking one SOLD frees the one they are trying to add.
	"Đã đạt giới hạn %d thiết bị chưa bán. Thiết bị đã đánh dấu \"Đã bán\" không chiếm suất — đánh dấu đã bán một thiết bị rồi thử lại.": {
		vi: "Đã đạt giới hạn %d thiết bị chưa bán. Thiết bị đã đánh dấu \"Đã bán\" không chiếm suất — đánh dấu đã bán một thiết bị rồi thử lại.",
		en: "You have reached the limit of %d unsold devices. Devices marked as sold do not count against it — mark one as sold and try again.",
	},
	// The storage ceiling, which counts sold rows too (the anti-gaming backstop).
	"Đã đạt giới hạn %d thiết bị lưu trữ (tính cả thiết bị đã bán). Xoá bớt hồ sơ cũ rồi thử lại.": {
		vi: "Đã đạt giới hạn %d thiết bị lưu trữ (tính cả thiết bị đã bán). Xoá bớt hồ sơ cũ rồi thử lại.",
		en: "You have reached the %d-device storage limit (sold devices included). Delete some older records and try again.",
	},

	// ── Warranty validation (internal/services/warranties.go).
	"Loại bảo hành không hợp lệ": {vi: "Loại bảo hành không hợp lệ", en: "Invalid warranty type"},
	"Ngày bắt đầu bắt buộc":      {vi: "Ngày bắt đầu bắt buộc", en: "Start date is required"},
	"Ngày bắt đầu không hợp lệ":  {vi: "Ngày bắt đầu không hợp lệ", en: "Invalid start date"},
	// The Vietnamese states a numeric floor with a `>=` glyph; English says it in
	// words. Same rule, and it reads like a sentence rather than a formula.
	"Số tháng bảo hành >= 1": {vi: "Số tháng bảo hành >= 1", en: "Warranty length must be at least 1 month"},
	"Chi phí không hợp lệ":   {vi: "Chi phí không hợp lệ", en: "Invalid cost"},
	"Mỗi thiết bị tối đa %d gói bảo hành.": {
		vi: "Mỗi thiết bị tối đa %d gói bảo hành.",
		en: "A device can have at most %d warranties.",
	},

	// ── Serial / IMEI advisories (internal/services/serial_validation.go).
	//
	// The last two were string CONCATENATION in the source
	// (`"… chuỗi này có " + strconv.Itoa(len(v)) + ". …"`), which cannot be a
	// catalog key, so they are `%d` templates here. The Vietnamese side is
	// byte-for-byte what it was — the concatenation is simply done by Sprintf.
	// None of the three is an error: they are warnings shown next to a value that
	// was still saved, so the English keeps the same reassuring tone.
	"15 số này không đúng checksum IMEI (Luhn) — có thể sai một chữ số. Vẫn lưu được, nhưng nên đối chiếu lại với tem máy hoặc hoá đơn trước khi đi bảo hành.": {
		vi: "15 số này không đúng checksum IMEI (Luhn) — có thể sai một chữ số. Vẫn lưu được, nhưng nên đối chiếu lại với tem máy hoặc hoá đơn trước khi đi bảo hành.",
		en: "This 15-digit number fails the IMEI (Luhn) checksum — one digit may be wrong. It is saved anyway, but check it against the sticker on the device or the receipt before you claim the warranty.",
	},
	"IMEI chuẩn có đúng 15 chữ số, chuỗi này có %d. Nếu đây là số serial của hãng thì bỏ qua cảnh báo này.": {
		vi: "IMEI chuẩn có đúng 15 chữ số, chuỗi này có %d. Nếu đây là số serial của hãng thì bỏ qua cảnh báo này.",
		en: "A standard IMEI has exactly 15 digits; this one has %d. If it is the manufacturer's own serial number, ignore this warning.",
	},
	"Số serial/IMEI này đã có ở %d thiết bị khác trong tài khoản của bạn. Kiểm tra để tránh trùng hồ sơ bảo hành.": {
		vi: "Số serial/IMEI này đã có ở %d thiết bị khác trong tài khoản của bạn. Kiểm tra để tránh trùng hồ sơ bảo hành.",
		en: "This serial/IMEI already appears on %d other devices in your account. Check it to avoid duplicate warranty records.",
	},

	// ── Subscriptions + wishlist (internal/services/subscriptions.go,
	// wishlist.go, and their handlers).
	//
	// "Gói" is the Vietnamese word this app uses for a subscription, and the
	// English noun is "subscription" — never "package", which reads as a parcel.
	// The wishlist counterpart is "item"; a human would say "the thing I want",
	// but the API's own noun (`WishlistItem`) is what the three clients display.
	"Thiếu id":                      {vi: "Thiếu id", en: "Missing id"},
	"Thiếu id món":                  {vi: "Thiếu id món", en: "Missing wishlist item id"},
	"Không tìm thấy gói":            {vi: "Không tìm thấy gói", en: "Subscription not found"},
	"Không tìm thấy món":            {vi: "Không tìm thấy món", en: "Wishlist item not found"},
	"Tên gói bắt buộc":              {vi: "Tên gói bắt buộc", en: "Subscription name is required"},
	"Tên gói tối đa 200 ký tự":      {vi: "Tên gói tối đa 200 ký tự", en: "Subscription name must be at most 200 characters"},
	"Tên sản phẩm bắt buộc":         {vi: "Tên sản phẩm bắt buộc", en: "Wishlist item name is required"},
	"Tên sản phẩm tối đa 200 ký tự": {vi: "Tên sản phẩm tối đa 200 ký tự", en: "Wishlist item name must be at most 200 characters"},
	"Chu kỳ không hợp lệ":           {vi: "Chu kỳ không hợp lệ", en: "Invalid billing cycle"},
	"Mức ưu tiên không hợp lệ":      {vi: "Mức ưu tiên không hợp lệ", en: "Invalid priority"},
	"URL không hợp lệ":              {vi: "URL không hợp lệ", en: "Invalid URL"},
	"Giá không hợp lệ":              {vi: "Giá không hợp lệ", en: "Invalid price"},
	"Giá phải ≥ 0":                  {vi: "Giá phải ≥ 0", en: "Price must be at least 0"},
	"Số tiền phải ≥ 0":              {vi: "Số tiền phải ≥ 0", en: "Amount must be at least 0"},
	"Số ngày phải từ 1 đến 3650": {
		vi: "Số ngày phải từ 1 đến 3650",
		en: "Number of days must be between 1 and 3650",
	},
	"Số ngày nhắc không hợp lệ":    {vi: "Số ngày nhắc không hợp lệ", en: "Invalid reminder interval in days"},
	"Ngày thanh toán bắt buộc":     {vi: "Ngày thanh toán bắt buộc", en: "Payment date is required"},
	"Ngày thanh toán không hợp lệ": {vi: "Ngày thanh toán không hợp lệ", en: "Invalid payment date"},
	"Ngày gia hạn không hợp lệ":    {vi: "Ngày gia hạn không hợp lệ", en: "Invalid renewal date"},
	"Ngày không hợp lệ":            {vi: "Ngày không hợp lệ", en: "Invalid date"},
	"Ghi chú tối đa 500 ký tự":     {vi: "Ghi chú tối đa 500 ký tự", en: "Note must be at most 500 characters"},
	"Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh": {
		vi: "Cần nhập số ngày khi chọn chu kỳ Tuỳ chỉnh",
		en: "Enter the number of days when the cycle is Custom",
	},
	"Loại sản phẩm không hợp lệ": {
		vi: "Loại sản phẩm không hợp lệ",
		en: "Invalid wishlist category",
	},

	// The subscription ceiling. A pair like the device one, but here the count is
	// 100 only in the plural: the refusal is real at 1 too (a client can call
	// POST /subscriptions directly), and English must not say "1 subscriptions".
	"Đã đạt giới hạn %d gói. Xoá bớt rồi thử lại.": {
		vi: "Đã đạt giới hạn %d gói. Xoá bớt rồi thử lại.",
		en: "You have reached the limit of %d subscriptions. Delete some and try again.",
	},
	"Đã đạt giới hạn 1 gói. Xoá bớt rồi thử lại.": {
		vi: "Đã đạt giới hạn 1 gói. Xoá bớt rồi thử lại.",
		en: "You have reached the limit of 1 subscription. Delete it and try again.",
	},

	// The wishlist ceiling, same shape.
	"Đã đạt giới hạn %d món. Xoá bớt rồi thử lại.": {
		vi: "Đã đạt giới hạn %d món. Xoá bớt rồi thử lại.",
		en: "You have reached the limit of %d wishlist items. Delete some and try again.",
	},
	// Manual renew cannot touch a LIFETIME row: there is no next cycle to advance
	// to, so there is nothing to charge for.
	"Gói lifetime không có gia hạn": {
		vi: "Gói lifetime không có gia hạn",
		en: "A lifetime subscription has nothing to renew",
	},
	"Gói chu kỳ Tuỳ chỉnh thiếu số ngày — không thể gia hạn": {
		vi: "Gói chu kỳ Tuỳ chỉnh thiếu số ngày — không thể gia hạn",
		en: "This custom-cycle subscription has no interval in days, so it cannot be renewed",
	},

	// ── Subscription audit (internal/services/subscription_audit.go).
	//
	// Long-form copy. Every one of these is READ ALOUD rather than substituted
	// word for word (docs/I18N_PLAN.md §4.4): the audit's whole value is that its
	// claims are exactly as strong as the data, and a literal translation of
	// "lâu rồi không thấy ghi nhận gì" would claim more than the rows say.
	//
	// `note` is returned with every report so no client can render a finding as
	// if it were usage data.
	"Đây là số liệu TỰ SOÁT từ những gì bạn đã ghi, không phải kết luận về việc bạn có dùng hay không: app không đọc được giao dịch ngân hàng và không có cách nào biết một gói có đang được dùng. «Lâu rồi không thấy ghi nhận gì» nghĩa là không có khoản nào do bạn tự ghi — các khoản tự động trừ vẫn được tính riêng. Không có gì bị sửa hay huỷ tự động.": {
		vi: "Đây là số liệu TỰ SOÁT từ những gì bạn đã ghi, không phải kết luận về việc bạn có dùng hay không: app không đọc được giao dịch ngân hàng và không có cách nào biết một gói có đang được dùng. «Lâu rồi không thấy ghi nhận gì» nghĩa là không có khoản nào do bạn tự ghi — các khoản tự động trừ vẫn được tính riêng. Không có gì bị sửa hay huỷ tự động.",
		en: "These figures are a SELF-AUDIT of what you recorded, not a verdict on whether you use the service: the app cannot read your bank transactions and has no way to know whether a subscription is being used. \"No activity recorded for a long time\" means no payment was logged by you — automatic charges are counted separately. Nothing has been changed or cancelled automatically.",
	},

	"Gói tự trừ tiền đã lâu mà không thấy ghi nhận gì": {
		vi: "Gói tự trừ tiền đã lâu mà không thấy ghi nhận gì",
		en: "This subscription has been auto-charging for a long time with nothing recorded by you",
	},
	// Pair: the count is what makes it singular, so the singular template has no
	// `%d` slot and the caller passes a different argument list
	// (internal/services/subscription_audit.go::auditCountVND).
	"«%s» đã tự động trừ %d lần, tổng %s, lần đầu từ %s — và bạn chưa từng tự ghi khoản nào cho gói này. Nếu đã lâu không dùng, đây là lúc xem lại.": {
		vi: "«%s» đã tự động trừ %d lần, tổng %s, lần đầu từ %s — và bạn chưa từng tự ghi khoản nào cho gói này. Nếu đã lâu không dùng, đây là lúc xem lại.",
		en: "\"%s\" has been charged automatically %d times, %s in total, starting on %s — and you have never logged a payment of your own for it. If you have not used it for a while, this is the moment to take another look.",
	},
	"«%s» đã tự động trừ 1 lần, tổng %s, lần đầu từ %s — và bạn chưa từng tự ghi khoản nào cho gói này. Nếu đã lâu không dùng, đây là lúc xem lại.": {
		vi: "«%s» đã tự động trừ 1 lần, tổng %s, lần đầu từ %s — và bạn chưa từng tự ghi khoản nào cho gói này. Nếu đã lâu không dùng, đây là lúc xem lại.",
		en: "\"%s\" has been charged automatically 1 time, %s in total, starting on %s — and you have never logged a payment of your own for it. If you have not used it for a while, this is the moment to take another look.",
	},

	"Giá gói đã tăng": {vi: "Giá gói đã tăng", en: "The subscription price went up"},
	"«%s» tăng từ %s lên %s (+%s, +%d%%) ở kỳ thanh toán ngày %s.": {
		vi: "«%s» tăng từ %s lên %s (+%s, +%d%%) ở kỳ thanh toán ngày %s.",
		en: "\"%s\" rose from %s to %s (+%s, +%d%%) in the billing period on %s.",
	},
	"«%s» tăng từ %s lên %s (+%s) ở kỳ thanh toán ngày %s.": {
		vi: "«%s» tăng từ %s lên %s (+%s) ở kỳ thanh toán ngày %s.",
		en: "\"%s\" rose from %s to %s (+%s) in the billing period on %s.",
	},

	"Hai gói trùng tên": {vi: "Hai gói trùng tên", en: "Two subscriptions share a name"},
	"«%s» và «%s» đang cùng hoạt động và trùng tên (khác cách viết). Kiểm tra xem có phải bạn đang trả tiền hai lần cho cùng một thứ.": {
		vi: "«%s» và «%s» đang cùng hoạt động và trùng tên (khác cách viết). Kiểm tra xem có phải bạn đang trả tiền hai lần cho cùng một thứ.",
		en: "\"%s\" and \"%s\" are both active and share a name (spelled differently). Check whether you are paying twice for the same thing.",
	},
	"Hai gói cùng hãng và cùng loại": {vi: "Hai gói cùng hãng và cùng loại", en: "Two subscriptions share a brand and category"},
	"«%s» và «%s» đang cùng hoạt động, cùng hãng và cùng loại. Kiểm tra xem có phải bạn đang trả tiền hai lần cho cùng một dịch vụ.": {
		vi: "«%s» và «%s» đang cùng hoạt động, cùng hãng và cùng loại. Kiểm tra xem có phải bạn đang trả tiền hai lần cho cùng một dịch vụ.",
		en: "\"%s\" and \"%s\" are both active, from the same brand and in the same category. Check whether you are paying twice for the same service.",
	},

	// ── Wave 3: backup, attachments and files (docs/I18N_PLAN.md §3.1).
	//
	// The two honesty notes come first because they are the reason this domain
	// cannot be translated casually: they are the export's own statement about
	// what the file does and does not contain, backup_honesty_test.go pins them,
	// and a shortened or softened translation would turn a truthful warning into a
	// reassuring one. They are rendered in the language of the EXPORT request and
	// travel inside the document, so the same archive read by two clients still
	// says the same thing.
	"Bản sao lưu này KHÔNG chứa nội dung ảnh/hoá đơn đính kèm (chỉ có tên file, loại file và kích thước). Khôi phục sang một máy chủ khác sẽ không khôi phục được ảnh.": {
		vi: "Bản sao lưu này KHÔNG chứa nội dung ảnh/hoá đơn đính kèm (chỉ có tên file, loại file và kích thước). Khôi phục sang một máy chủ khác sẽ không khôi phục được ảnh.",
		en: "This backup does NOT contain the contents of the attached images/invoices (only the file name, file type and size). Restoring it onto a different server will not bring those images back.",
	},
	"Bản sao lưu này CÓ chứa nội dung ảnh/hoá đơn đính kèm (đã mã hoá AES-256-GCM). Cần đúng FILE_MASTER_KEY của máy chủ đã xuất bản sao lưu thì mới giải mã được; thiếu hoặc sai khoá thì file vẫn được khôi phục nhưng không mở được.": {
		vi: "Bản sao lưu này CÓ chứa nội dung ảnh/hoá đơn đính kèm (đã mã hoá AES-256-GCM). Cần đúng FILE_MASTER_KEY của máy chủ đã xuất bản sao lưu thì mới giải mã được; thiếu hoặc sai khoá thì file vẫn được khôi phục nhưng không mở được.",
		en: "This backup DOES contain the contents of the attached images/invoices (encrypted with AES-256-GCM). You need the exact FILE_MASTER_KEY of the server that exported it in order to decrypt them; with a missing or wrong key the files are still restored but cannot be opened.",
	},
	// Pair: the same rule as every other count-bearing sentence — the count is
	// what makes the English singular, so the singular template has no `%d` slot
	// and the caller passes a DIFFERENT argument list for it
	// (internal/services/backup_blobs.go::missingBlobNote). The `%s` is the
	// translated note above, which is why both forms keep it.
	"%s LƯU Ý: %d file đính kèm không còn trên đĩa nên KHÔNG có trong bản sao lưu này (xem missingAttachmentIds).": {
		vi: "%s LƯU Ý: %d file đính kèm không còn trên đĩa nên KHÔNG có trong bản sao lưu này (xem missingAttachmentIds).",
		en: "%s NOTE: %d attachments were no longer on disk, so they are NOT in this backup (see missingAttachmentIds).",
	},
	"%s LƯU Ý: 1 file đính kèm không còn trên đĩa nên KHÔNG có trong bản sao lưu này (xem missingAttachmentIds).": {
		vi: "%s LƯU Ý: 1 file đính kèm không còn trên đĩa nên KHÔNG có trong bản sao lưu này (xem missingAttachmentIds).",
		en: "%s NOTE: 1 attachment was no longer on disk, so it is NOT in this backup (see missingAttachmentIds).",
	},

	// Version refusals. Too new and too old are different sentences on purpose:
	// one tells the user to update the app, the other that the file predates the
	// supported range. Both name the version received.
	"Bản sao lưu phiên bản %d mới hơn phiên bản ứng dụng hỗ trợ (%d). Cập nhật ứng dụng rồi thử lại.": {
		vi: "Bản sao lưu phiên bản %d mới hơn phiên bản ứng dụng hỗ trợ (%d). Cập nhật ứng dụng rồi thử lại.",
		en: "This backup is version %d, newer than this app supports (%d). Update the app and try again.",
	},
	"Bản sao lưu phiên bản %d quá cũ, phiên bản được hỗ trợ: %d-%d.": {
		vi: "Bản sao lưu phiên bản %d quá cũ, phiên bản được hỗ trợ: %d-%d.",
		en: "This backup is version %d, which is too old; supported versions: %d-%d.",
	},

	// Import refusals. Most are whole-document failures with no fieldErrors, so
	// they describe what is wrong with the FILE rather than with a form field.
	"File data.json này là phần dữ liệu của một bản sao lưu .zip có kèm nội dung ảnh. Hãy chọn chính file .zip để khôi phục — import riêng data.json sẽ mất toàn bộ ảnh/hoá đơn.": {
		vi: "File data.json này là phần dữ liệu của một bản sao lưu .zip có kèm nội dung ảnh. Hãy chọn chính file .zip để khôi phục — import riêng data.json sẽ mất toàn bộ ảnh/hoá đơn.",
		en: "This data.json is the data half of a .zip backup that carries the invoice images. Choose the .zip file itself to restore — importing data.json on its own loses every image/invoice.",
	},
	"File JSON không hợp lệ":                   {vi: "File JSON không hợp lệ", en: "Invalid JSON file"},
	"File JSON trong bản sao lưu không hợp lệ": {vi: "File JSON trong bản sao lưu không hợp lệ", en: "The JSON inside this backup is invalid"},
	"ID thiết bị không hợp lệ: %s":             {vi: "ID thiết bị không hợp lệ: %s", en: "Invalid device id: %s"},
	"Mode không hợp lệ":                        {vi: "Mode không hợp lệ", en: "Invalid mode"},
	"Không ghi được file đính kèm \"%s\" ra đĩa.": {
		vi: "Không ghi được file đính kèm \"%s\" ra đĩa.",
		en: "Could not write attachment \"%s\" to disk.",
	},
	// A single key, NOT a pair: the guard is `len(attachments) > 5`, so the
	// smallest count this sentence can carry is 6 and "1 attachment" is
	// unreachable. A singular key would be a catalog entry nothing can produce —
	// the same reason wave 2 dropped the wishlist singular (docs/I18N_PLAN.md
	// §3.1).
	"Thiết bị \"%s\" có %d file đính kèm, vượt giới hạn %d file/thiết bị.": {
		vi: "Thiết bị \"%s\" có %d file đính kèm, vượt giới hạn %d file/thiết bị.",
		en: "Device \"%s\" has %d attachments, over the limit of %d per device.",
	},
	"Đường dẫn file không hợp lệ trong \"%s\". File backup có thể đã bị sửa.": {
		vi: "Đường dẫn file không hợp lệ trong \"%s\". File backup có thể đã bị sửa.",
		en: "Invalid file path in \"%s\". This backup file may have been tampered with.",
	},
	"Khoá file hỏng trong \"%s\".": {vi: "Khoá file hỏng trong \"%s\".", en: "Corrupt file key in \"%s\"."},
	"Đường dẫn file không hợp lệ trong bản sao lưu: %s": {
		vi: "Đường dẫn file không hợp lệ trong bản sao lưu: %s",
		en: "Invalid file path inside this backup: %s",
	},
	"Bản sao lưu chứa dữ liệu của một tài khoản khác: id %s \"%s\" đã tồn tại. Không thể khôi phục bản sao lưu này vào tài khoản hiện tại — hãy đăng nhập đúng tài khoản đã xuất bản sao lưu.": {
		vi: "Bản sao lưu chứa dữ liệu của một tài khoản khác: id %s \"%s\" đã tồn tại. Không thể khôi phục bản sao lưu này vào tài khoản hiện tại — hãy đăng nhập đúng tài khoản đã xuất bản sao lưu.",
		en: "This backup contains data from another account: the %s id \"%s\" already exists. It cannot be restored into the current account — sign in to the account that exported it.",
	},

	// The entity names that sentence interpolates (the probe labels in
	// services/backup_ids.go). They are fragments, so they read as part of the
	// sentence around them rather than as titles. There is deliberately NO entry
	// for "subscription": the Vietnamese label is the English word, and a key the
	// catalog does not know renders as the key itself, which is correct in both
	// languages — an entry with identical vi/en would fail
	// TestTranslationsAreActuallyTranslated.
	"thiết bị":      {vi: "thiết bị", en: "device"},
	"gói bảo hành":  {vi: "gói bảo hành", en: "warranty"},
	"nhắc nhở":      {vi: "nhắc nhở", en: "reminder"},
	"file đính kèm": {vi: "file đính kèm", en: "attachment"},
	"món wishlist":  {vi: "món wishlist", en: "wishlist item"},
	"lịch sử giá":   {vi: "lịch sử giá", en: "price history"},
	"thanh toán":    {vi: "thanh toán", en: "payment"},

	// .zip-entry refusals (services/backup_blobs.go). Every one of them is a
	// statement about the archive the user handed us, so the English keeps the
	// same bluntness as the Vietnamese.
	"File backup không phải ZIP hợp lệ": {vi: "File backup không phải ZIP hợp lệ", en: "This backup file is not a valid ZIP"},
	"Phần dữ liệu (data.json) trong file backup quá lớn": {
		vi: "Phần dữ liệu (data.json) trong file backup quá lớn",
		en: "The data.json part of this backup file is too large",
	},
	"File backup thiếu data.json": {vi: "File backup thiếu data.json", en: "This backup file is missing data.json"},
	"Không đọc được data.json trong file backup": {
		vi: "Không đọc được data.json trong file backup",
		en: "Could not read data.json inside this backup file",
	},
	"File backup chứa thành phần không mong đợi: %s": {
		vi: "File backup chứa thành phần không mong đợi: %s",
		en: "This backup file contains an unexpected entry: %s",
	},
	// Byte sizes are the only unit this domain renders, and the only sizes in it
	// are the fixed limits (5 MB per file, 100 MB per user). English puts a space
	// between the number and the unit and Vietnamese does not — that is the whole
	// extent of "sizes follow the language" here; no variable byte size is ever
	// interpolated into a sentence.
	"File đính kèm %s vượt quá giới hạn %d MB": {
		vi: "File đính kèm %s vượt quá giới hạn %d MB",
		en: "Attachment %s is over the %d MB limit",
	},
	"Bản sao lưu chứa hơn %d MB file đính kèm, vượt giới hạn dung lượng mỗi người dùng.": {
		vi: "Bản sao lưu chứa hơn %d MB file đính kèm, vượt giới hạn dung lượng mỗi người dùng.",
		en: "This backup holds more than %d MB of attachments, over the per-user storage limit.",
	},
	"Bản sao lưu thiếu nội dung của file đính kèm \"%s\" (%s). File có thể đã hỏng hoặc bị sửa.": {
		vi: "Bản sao lưu thiếu nội dung của file đính kèm \"%s\" (%s). File có thể đã hỏng hoặc bị sửa.",
		en: "This backup is missing the contents of attachment \"%s\" (%s). The file may be corrupt or edited.",
	},
	"Bản sao lưu thiếu nội dung của file đính kèm \"%s\".": {
		vi: "Bản sao lưu thiếu nội dung của file đính kèm \"%s\".",
		en: "This backup is missing the contents of attachment \"%s\".",
	},
	"Không đọc được nội dung file đính kèm \"%s\" trong bản sao lưu.": {
		vi: "Không đọc được nội dung file đính kèm \"%s\" trong bản sao lưu.",
		en: "Could not read the contents of attachment \"%s\" inside this backup.",
	},
	"File backup không nhất quán: data.json nói không chứa nội dung ảnh nhưng archive lại có.": {
		vi: "File backup không nhất quán: data.json nói không chứa nội dung ảnh nhưng archive lại có.",
		en: "This backup is inconsistent: data.json says it carries no image contents, but the archive does.",
	},
	"File backup không nhất quán: archive chứa file đính kèm nhưng data.json không khai báo file nào.": {
		vi: "File backup không nhất quán: archive chứa file đính kèm nhưng data.json không khai báo file nào.",
		en: "This backup is inconsistent: the archive contains attachments but data.json declares none.",
	},

	// Attachment upload copy (services/attachments.go). The two limit sentences
	// name a FIXED ceiling (5 files, 100 MB), so neither is a plural pair: no
	// count is interpolated and the noun is plural at both 5 and 100.
	"Thiết bị không tồn tại": {vi: "Thiết bị không tồn tại", en: "Device not found"},
	"Device không hợp lệ":    {vi: "Device không hợp lệ", en: "Invalid device"},
	"File trống":             {vi: "File trống", en: "File is empty"},
	"File vượt quá 5MB":      {vi: "File vượt quá 5MB", en: "File is larger than 5 MB"},
	"Tối đa 5 file/thiết bị": {vi: "Tối đa 5 file/thiết bị", en: "At most 5 files per device"},
	"Không xử lý được ảnh, file có thể đã hỏng": {
		vi: "Không xử lý được ảnh, file có thể đã hỏng",
		en: "Could not process this image; the file may be corrupt",
	},
	"Dung lượng tổng vượt quá 100MB. Xoá bớt file cũ.": {
		vi: "Dung lượng tổng vượt quá 100MB. Xoá bớt file cũ.",
		en: "Your total storage is over 100 MB. Delete some old files.",
	},
	"Lỗi mã hoá file": {vi: "Lỗi mã hoá file", en: "Could not encrypt the file"},
	"Lỗi ghi file":    {vi: "Lỗi ghi file", en: "Could not write the file"},

	// internal/files copy. That package has no request context of its own and is
	// called from two domains, so its error TEXT is the key and the caller that
	// owns a request renders it (services.filesText). The AI handler, which is a
	// later wave, keeps passing err.Error() and therefore keeps emitting the
	// Vietnamese source byte-for-byte.
	"Chỉ chấp nhận JPG/PNG/WEBP/GIF/HEIC hoặc PDF": {
		vi: "Chỉ chấp nhận JPG/PNG/WEBP/GIF/HEIC hoặc PDF",
		en: "Only JPG/PNG/WEBP/GIF/HEIC or PDF files are accepted",
	},
	"Nội dung file không khớp định dạng khai báo": {
		vi: "Nội dung file không khớp định dạng khai báo",
		en: "The file contents do not match the declared format",
	},
	"FILE_MASTER_KEY chưa được cấu hình": {
		vi: "FILE_MASTER_KEY chưa được cấu hình",
		en: "FILE_MASTER_KEY is not configured",
	},
	"FILE_MASTER_KEY phải decode được (base64 hoặc hex) thành ≥ 32 byte": {
		vi: "FILE_MASTER_KEY phải decode được (base64 hoặc hex) thành ≥ 32 byte",
		en: "FILE_MASTER_KEY must decode (base64 or hex) to at least 32 bytes",
	},

	// Request-shape copy in the two converted handlers. The generic 500
	// ("Lỗi hệ thống") is deliberately NOT here: it is shared by every domain and
	// is added when the last of them is converted (handlers/handlers.go).
	"Tham số includeBlobs không hợp lệ": {vi: "Tham số includeBlobs không hợp lệ", en: "Invalid includeBlobs parameter"},
	"Phải là true hoặc false":           {vi: "Phải là true hoặc false", en: "Must be true or false"},
	"File backup quá lớn (giới hạn %s)": {
		vi: "File backup quá lớn (giới hạn %s)",
		en: "Backup file is too large (limit %s)",
	},
	"Không đọc được nội dung file": {vi: "Không đọc được nội dung file", en: "Could not read the file contents"},
	"Content-Type phải là multipart/form-data": {
		vi: "Content-Type phải là multipart/form-data",
		en: "Content-Type must be multipart/form-data",
	},
	"File quá lớn":                     {vi: "File quá lớn", en: "File is too large"},
	"Không đọc được multipart payload": {vi: "Không đọc được multipart payload", en: "Could not read the multipart payload"},
	"Thiếu file":                       {vi: "Thiếu file", en: "Missing file"},
	"Thiếu id file":                    {vi: "Thiếu id file", en: "Missing file id"},
	"Chỉ hỗ trợ sửa mô tả":             {vi: "Chỉ hỗ trợ sửa mô tả", en: "Only the description can be edited"},
	"Thiếu description":                {vi: "Thiếu description", en: "Missing description"},
	"Mô tả không hợp lệ":               {vi: "Mô tả không hợp lệ", en: "Invalid description"},
	"Không tìm thấy file":              {vi: "Không tìm thấy file", en: "File not found"},

	// ── Wave 4: AI receipt extraction, shares, search and the service directory
	// (docs/I18N_PLAN.md §3.1).
	//
	// Three of these entries are the interesting ones:
	//
	//  1. The SHARE CERTIFICATE is an HTML document with no authenticated user
	//     behind it, so its copy is rendered for the RECIPIENT (see
	//     handlers.publicShareLanguage for the rule and why the fallback is
	//     Vietnamese, not the product default). The labels are separate entries
	//     from the equivalent device-form fields on purpose: "Trạng thái" is a
	//     table header here and a validation subject there, and the two English
	//     sentences are not the same.
	//  2. The AI upstream errors are the source text of internal/ai, a package
	//     with no request context. Its message IS the catalog key, so these entries
	//     are what turn a 502 body into English without touching that package.
	//     "Dịch vụ AI lỗi (%d)" is deliberately ABSENT: it carries an upstream
	//     status code, so it can never be a key, and `i18n.Text` returns it
	//     verbatim — see services.mapAIError.
	//  3. "Lỗi hệ thống" is still absent, exactly as the wave-3 note below says.
	//     The AI, share, search and directory handlers keep sending it in
	//     Vietnamese on their 500 branch; it moves with the last domain.

	// ── AI receipt extraction (internal/services/ai_extract.go, handlers/ai.go).
	//
	// `feature_disabled` and `ai_optin_required` are the two sentences a user
	// meets BEFORE any model call, so they are the ones worth reading aloud: the
	// first says the server has no key configured, the second says the user has not
	// switched the feature on yet, and conflating them would send someone to the
	// wrong fix.
	"Tính năng quét hoá đơn chưa được bật": {
		vi: "Tính năng quét hoá đơn chưa được bật",
		en: "Receipt scanning is not enabled",
	},
	"Cần bật tính năng quét hoá đơn (AI) trong Cài đặt trước khi dùng": {
		vi: "Cần bật tính năng quét hoá đơn (AI) trong Cài đặt trước khi dùng",
		en: "Turn on AI receipt scanning in Settings before using this",
	},
	"Thiếu ảnh": {vi: "Thiếu ảnh", en: "Missing image"},
	"Thiếu attachmentId": {
		vi: "Thiếu attachmentId",
		en: "Missing attachmentId",
	},
	"Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF": {
		vi: "Chỉ hỗ trợ ảnh JPEG, PNG, WEBP hoặc PDF",
		en: "Only JPEG, PNG, WEBP images or PDF files are supported",
	},
	"Content-Type phải là application/json hoặc multipart/form-data": {
		vi: "Content-Type phải là application/json hoặc multipart/form-data",
		en: "Content-Type must be application/json or multipart/form-data",
	},
	"Người dùng không tồn tại": {
		vi: "Người dùng không tồn tại",
		en: "User not found",
	},
	"Lỗi tải người dùng": {vi: "Lỗi tải người dùng", en: "Could not load the user"},
	"Lỗi trích xuất ảnh": {vi: "Lỗi trích xuất ảnh", en: "Could not read the image"},
	"Lỗi tải danh mục":   {vi: "Lỗi tải danh mục", en: "Could not load the catalog"},
	// internal/ai's own messages. Keys are that package's Vietnamese source text;
	// only the sentence moves, never the Error.Code the handler maps to a status.
	"Định dạng tài liệu không hỗ trợ": {
		vi: "Định dạng tài liệu không hỗ trợ",
		en: "That document format is not supported",
	},
	"Lỗi tạo yêu cầu": {vi: "Lỗi tạo yêu cầu", en: "Could not build the request"},
	"Không kết nối được dịch vụ AI": {
		vi: "Không kết nối được dịch vụ AI",
		en: "Could not reach the AI service",
	},
	"Dịch vụ AI đang quá tải, thử lại sau": {
		vi: "Dịch vụ AI đang quá tải, thử lại sau",
		en: "The AI service is overloaded. Try again later",
	},
	"Không đọc được kết quả AI": {
		vi: "Không đọc được kết quả AI",
		en: "Could not read the AI response",
	},
	"Kết quả AI không hợp lệ": {
		vi: "Kết quả AI không hợp lệ",
		en: "The AI response was not valid",
	},
	"AI không trả về dữ liệu trích xuất": {
		vi: "AI không trả về dữ liệu trích xuất",
		en: "The AI returned no extracted data",
	},

	// ── Shares (internal/services/shares.go, handlers/shares.go).
	//
	// The owner half first. "Không tìm thấy thiết bị" already exists above (device
	// reads use the same sentence) — it is reused rather than duplicated.
	"Không tìm thấy link chia sẻ": {
		vi: "Không tìm thấy link chia sẻ",
		en: "Share link not found",
	},
	"Đã đạt giới hạn %d link chia sẻ còn hiệu lực cho thiết bị này. Thu hồi bớt rồi thử lại.": {
		vi: "Đã đạt giới hạn %d link chia sẻ còn hiệu lực cho thiết bị này. Thu hồi bớt rồi thử lại.",
		en: "This device already has the maximum of %d active share links. Revoke some and try again.",
	},
	"Số ngày hiệu lực phải từ %d tới %d": {
		vi: "Số ngày hiệu lực phải từ %d tới %d",
		en: "The validity period must be between %d and %d days",
	},
	// The one sentence the four public failure cases all render. It is ONE entry
	// read by one call site (handlers.writeShareLookupFailure), which is what makes
	// the four answers byte-identical in each language as well as across them.
	"Link chia sẻ không tồn tại, đã hết hạn hoặc đã bị thu hồi": {
		vi: "Link chia sẻ không tồn tại, đã hết hạn hoặc đã bị thu hồi",
		en: "This share link does not exist, has expired, or has been revoked",
	},
	// The certificate's own statement of what it is not. Translated faithfully and
	// at full length: it is the only thing standing between a buyer and the
	// assumption that this page is an invoice.
	"Phiếu này do chủ máy tạo từ ứng dụng Warranty Vault và chỉ chứa thông tin bảo hành của một thiết bị. Phiếu không phải hoá đơn, không thay thế hoá đơn gốc và không kèm ảnh chứng từ. Người nhận nên đối chiếu số máy (IMEI/serial) in trên máy với phiếu trước khi nhận.": {
		vi: "Phiếu này do chủ máy tạo từ ứng dụng Warranty Vault và chỉ chứa thông tin bảo hành của một thiết bị. Phiếu không phải hoá đơn, không thay thế hoá đơn gốc và không kèm ảnh chứng từ. Người nhận nên đối chiếu số máy (IMEI/serial) in trên máy với phiếu trước khi nhận.",
		en: "This certificate was created by the device owner in the Warranty Vault app and contains the warranty information of one device only. It is not an invoice, it does not replace the original invoice, and it carries no photos of the paperwork. The recipient should check the serial/IMEI printed on the device against this certificate before accepting it.",
	},
	// Certificate page labels.
	"Phiếu bàn giao bảo hành": {vi: "Phiếu bàn giao bảo hành", en: "Warranty handover certificate"},
	"Thông tin bảo hành của một thiết bị, do chủ máy tạo từ Warranty Vault.": {
		vi: "Thông tin bảo hành của một thiết bị, do chủ máy tạo từ Warranty Vault.",
		en: "The warranty information of one device, created by its owner in Warranty Vault.",
	},
	"Bảo hành còn lại tới": {vi: "Bảo hành còn lại tới", en: "Warranty covered until"},
	"Số máy (IMEI/serial)": {vi: "Số máy (IMEI/serial)", en: "Serial number (IMEI/serial)"},
	// `%s` is interpolated by the page (handlers.safeNote), which escapes the value
	// and keeps the surrounding markup, so the parenthesis stays in the template.
	"đầy đủ: %s": {vi: "đầy đủ: %s", en: "full: %s"},
	"Ngày mua":   {vi: "Ngày mua", en: "Purchase date"},
	"Nơi mua":    {vi: "Nơi mua", en: "Purchased at"},
	"Trạng thái": {vi: "Trạng thái", en: "Status"},
	"Ngày bán / bàn giao": {
		vi: "Ngày bán / bàn giao",
		en: "Sold / handed over on",
	},
	"Gói bảo hành": {vi: "Gói bảo hành", en: "Warranty plan"},
	"Thời gian":    {vi: "Thời gian", en: "Period"},
	"Nơi bảo hành": {vi: "Nơi bảo hành", en: "Warranty centre"},
	"ĐT: %s":       {vi: "ĐT: %s", en: "Phone: %s"},
	"Chưa ghi số điện thoại": {
		vi: "Chưa ghi số điện thoại",
		en: "No phone number recorded",
	},
	"Không có ngày hết hạn": {vi: "Không có ngày hết hạn", en: "No expiry date"},
	"Còn hiệu lực":          {vi: "Còn hiệu lực", en: "Still covered"},
	"Đã hết hạn":            {vi: "Đã hết hạn", en: "Expired"},
	// Device status labels. Mirrors STATUS_LABELS in website/src/lib/types.ts; a
	// printed certificate carries words, not the enum codes the API stores.
	"Đang dùng":    {vi: "Đang dùng", en: "In use"},
	"Hết bảo hành": {vi: "Hết bảo hành", en: "Out of warranty"},
	"Đã bán":       {vi: "Đã bán", en: "Sold"},
	"Hỏng":         {vi: "Hỏng", en: "Broken"},
	"Mất":          {vi: "Mất", en: "Lost"},
	// The link's own lifetime. Two `%s`, both dates, in the order the page passes
	// them; the English phrasing keeps the same order so the one argument list
	// serves both languages (catalog_test.go pins the verb sets).
	"Link này hết hiệu lực sau ngày %s (tạo ngày %s) và có thể bị chủ máy thu hồi bất kỳ lúc nào.": {
		vi: "Link này hết hiệu lực sau ngày %s (tạo ngày %s) và có thể bị chủ máy thu hồi bất kỳ lúc nào.",
		en: "This link stops working after %s (created on %s) and the owner can revoke it at any time.",
	},
	"%d tháng": {vi: "%d tháng", en: "%d months"},
	"1 tháng":  {vi: "1 tháng", en: "1 month"},
	"Không mở được phiếu": {
		vi: "Không mở được phiếu",
		en: "This certificate could not be opened",
	},
	"Link chia sẻ có thời hạn và có thể đã bị chủ máy thu hồi. Hãy liên hệ người gửi link để lấy link mới.": {
		vi: "Link chia sẻ có thời hạn và có thể đã bị chủ máy thu hồi. Hãy liên hệ người gửi link để lấy link mới.",
		en: "Share links expire and the owner may have revoked this one. Ask whoever sent you the link for a new one.",
	},

	// ── Shares: request-shape copy in handlers/shares.go. "Trường không được hỗ trợ"
	// already exists above (the attachments PATCH path added it in wave 3) and is
	// reused rather than duplicated — one field-level sentence, one English
	// translation, two endpoints that refuse an unknown key the same way.
	"Body quá lớn": {vi: "Body quá lớn", en: "Request body is too large"},

	// ── Search (internal/services/search.go, handlers/search.go).
	"Từ khoá tìm kiếm quá dài (tối đa %d ký tự)": {
		vi: "Từ khoá tìm kiếm quá dài (tối đa %d ký tự)",
		en: "The search query is too long (at most %d characters)",
	},
	"Tham số limit không hợp lệ": {
		vi: "Tham số limit không hợp lệ",
		en: "Invalid limit parameter",
	},
	"Phải là số nguyên từ 1 tới %d": {
		vi: "Phải là số nguyên từ 1 tới %d",
		en: "Must be an integer from 1 to %d",
	},

	// ── Service directory (internal/services/directory.go).
	//
	// The disclaimer is the reason the response has so many nulls, so it is
	// translated in full rather than trimmed: an English reader has to come away
	// understanding that the app deliberately carries no hotline of its own.
	"App không lưu sẵn hotline hay địa chỉ trung tâm bảo hành: những thông tin đó thay đổi liên tục và app không kiểm chứng được, nên một hotline sai còn tệ hơn không có. Số điện thoại và địa chỉ hiện ở đây là do bạn tự ghi cho gói bảo hành. Link bên dưới là trang tra cứu chính thức của hãng.": {
		vi: "App không lưu sẵn hotline hay địa chỉ trung tâm bảo hành: những thông tin đó thay đổi liên tục và app không kiểm chứng được, nên một hotline sai còn tệ hơn không có. Số điện thoại và địa chỉ hiện ở đây là do bạn tự ghi cho gói bảo hành. Link bên dưới là trang tra cứu chính thức của hãng.",
		en: "The app does not ship hotlines or service-centre addresses: those change constantly and the app cannot verify them, so a wrong hotline would be worse than none. Any phone number or address shown here is one you recorded yourself for a warranty plan. The link below is the manufacturer's own official lookup page.",
	},

	// ── Wave 5: the shared machinery, plus the domains nobody had converted
	// (docs/I18N_PLAN.md §3.1 and §3.4).
	//
	// This is the group that changes responses for EVERY endpoint at once, which
	// is why it waited for the last wave. Three of them are worth reading before
	// the rest:
	//
	//  1. "Lỗi hệ thống" — the 500 headline of every per-domain error writer. It
	//     has been in the catalog since Phase 0 (the auth slice serves it) and was
	//     deliberately left UNWRAPPED in writeServiceError / writeDevicesErr /
	//     writeAttachmentError / writeAIError and the backup, session and share
	//     handlers until every domain those writers serve had been converted.
	//     There is no new entry for it here; the change is at the call sites.
	//  2. The retry-after UNITS ("%d phút" / "%d giây") are separate keys rather
	//     than part of "Thao tác quá nhanh. Đợi %s", because the same helper
	//     renders the 429 in two packages (handlers.rateLimited and
	//     ratelimit.Auth/UserWrite) and the number arrives as a value. The
	//     singular forms are separate keys for the reason every pair in this
	//     catalog is: `seconds == 60` really does produce "1 minute".
	//  3. The transactional EMAIL templates (internal/email/resend.go) are the
	//     last monolingual surface on the auth path. Their keys are the
	//     SENTENCES only — the HTML skeleton, the newlines and the button markup
	//     stay in Go — so a translation cannot break the layout, and the
	//     recipient's address is escaped by the builder rather than trusted to a
	//     catalog entry.

	// ── The shared 429 retry window (internal/ratelimit/helpers.go).
	//
	// Vietnamese does not inflect, so "%d phút" is also the source text of the
	// singular; both forms exist because English does inflect.
	"%d phút": {vi: "%d phút", en: "%d minutes"},
	"1 phút":  {vi: "1 phút", en: "1 minute"},
	"%d giây": {vi: "%d giây", en: "%d seconds"},
	"1 giây":  {vi: "1 giây", en: "1 second"},

	// ── Push subscription registration (internal/services/push.go,
	// internal/handlers/push.go).
	"Bắt buộc":         {vi: "Bắt buộc", en: "Required"},
	"Tối đa 500 ký tự": {vi: "Tối đa 500 ký tự", en: "At most 500 characters"},
	"Token thiết bị không hợp lệ": {
		vi: "Token thiết bị không hợp lệ",
		en: "Invalid device token",
	},
	"Nền tảng không hợp lệ":  {vi: "Nền tảng không hợp lệ", en: "Invalid platform"},
	"Không tìm thấy đăng ký": {vi: "Không tìm thấy đăng ký", en: "Subscription not found"},
	"Thiếu id đăng ký":       {vi: "Thiếu id đăng ký", en: "Missing subscription id"},
	"Push dispatcher chưa khởi tạo": {
		vi: "Push dispatcher chưa khởi tạo",
		en: "Push dispatcher is not configured",
	},
	"CRON_SECRET chưa set": {vi: "CRON_SECRET chưa set", en: "CRON_SECRET is not set"},

	// ── Action queue (internal/services/actions.go, internal/handlers/actions.go).
	//
	// The queue is the one place where the service both DERIVES the rows and
	// writes the sentences, so the whole body of copy is rendered from the
	// request context in the service itself — including the dates and the money,
	// which follow the language too (i18n.FormatDate / i18n.FormatMoney): the
	// queue's dates used to come from a Vietnamese-only `formatViDate`, so an
	// English reader was shown "07/05/2026" and left to guess whether that meant
	// May or July.
	"Bảo hành đã hết hạn":              {vi: "Bảo hành đã hết hạn", en: "Warranty has expired"},
	"Thiết bị chưa có gói bảo hành":    {vi: "Thiết bị chưa có gói bảo hành", en: "Device has no warranty plan"},
	"Trạng thái thiết bị có thể đã cũ": {vi: "Trạng thái thiết bị có thể đã cũ", en: "Device status may be out of date"},
	"Thiếu số serial / IMEI":           {vi: "Thiếu số serial / IMEI", en: "Missing serial / IMEI"},
	"Chưa có ảnh hoá đơn":              {vi: "Chưa có ảnh hoá đơn", en: "No receipt image yet"},
	"Sắp hết hạn đổi trả":              {vi: "Sắp hết hạn đổi trả", en: "Return window closing soon"},
	"Chưa ghi hạn đổi trả":             {vi: "Chưa ghi hạn đổi trả", en: "Return window not recorded"},
	"Sắp bị trừ tiền nhưng chưa có link huỷ": {
		vi: "Sắp bị trừ tiền nhưng chưa có link huỷ",
		en: "About to be charged with no cancel link",
	},
	"Ngày gia hạn chưa được cập nhật": {
		vi: "Ngày gia hạn chưa được cập nhật",
		en: "Renewal date has not been updated",
	},
	"Đã qua ngày dự kiến mua": {vi: "Đã qua ngày dự kiến mua", en: "Target purchase date has passed"},

	"Gói %s của «%s» đã hết hạn ngày %s (%d ngày trước). Máy vẫn đang ở trạng thái đang dùng.": {
		vi: "Gói %s của «%s» đã hết hạn ngày %s (%d ngày trước). Máy vẫn đang ở trạng thái đang dùng.",
		en: "The %s plan for «%s» expired on %s (%d days ago). The device is still marked as in use.",
	},
	"Gói %s của «%s» đã hết hạn ngày %s (1 ngày trước). Máy vẫn đang ở trạng thái đang dùng.": {
		vi: "Gói %s của «%s» đã hết hạn ngày %s (1 ngày trước). Máy vẫn đang ở trạng thái đang dùng.",
		en: "The %s plan for «%s» expired on %s (1 day ago). The device is still marked as in use.",
	},
	"Một gói bảo hành của «%s» đã hết hạn.": {
		vi: "Một gói bảo hành của «%s» đã hết hạn.",
		en: "A warranty plan for «%s» has expired.",
	},
	"«%s» chưa có gói bảo hành nào, nên app không biết món này còn được bảo vệ hay không và không thể nhắc trước khi hết hạn.": {
		vi: "«%s» chưa có gói bảo hành nào, nên app không biết món này còn được bảo vệ hay không và không thể nhắc trước khi hết hạn.",
		en: "«%s» has no warranty plan, so the app cannot tell whether it is still covered and cannot remind you before cover ends.",
	},
	"Bảo hành của «%s» đã hết từ %s nhưng trạng thái vẫn là đang dùng. Bộ lọc «Đã hết hạn» vì thế trả về một danh sách khác với «bảo hành đã hết».": {
		vi: "Bảo hành của «%s» đã hết từ %s nhưng trạng thái vẫn là đang dùng. Bộ lọc «Đã hết hạn» vì thế trả về một danh sách khác với «bảo hành đã hết».",
		en: "The warranty for «%s» ended on %s but the device is still marked as in use. That is why the “Expired” filter returns a different list from “warranty expired”.",
	},
	"«%s» vẫn đang ở trạng thái đang dùng nhưng bảo hành đã hết từ lâu.": {
		vi: "«%s» vẫn đang ở trạng thái đang dùng nhưng bảo hành đã hết từ lâu.",
		en: "«%s» is still marked as in use, but its warranty ended long ago.",
	},
	"«%s» chưa có số serial/IMEI. Trung tâm bảo hành tra máy theo số này, thiếu hoặc sai một ký tự là bị từ chối.": {
		vi: "«%s» chưa có số serial/IMEI. Trung tâm bảo hành tra máy theo số này, thiếu hoặc sai một ký tự là bị từ chối.",
		en: "«%s» has no serial/IMEI recorded. Service centres look a device up by this number, and one missing or wrong character is a refusal.",
	},
	"«%s» chưa có ảnh hoá đơn hay giấy tờ nào đính kèm. Lúc cần bảo hành sẽ không có gì để đưa ra.": {
		vi: "«%s» chưa có ảnh hoá đơn hay giấy tờ nào đính kèm. Lúc cần bảo hành sẽ không có gì để đưa ra.",
		en: "«%s» has no receipt photo or document attached. When you need warranty service there will be nothing to show.",
	},
	"«%s» còn %d ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.": {
		vi: "«%s» còn %d ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.",
		en: "«%s» has %d days left to return or exchange (deadline %s). After that you can only send it for repair, not exchange it.",
	},
	"«%s» còn 1 ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.": {
		vi: "«%s» còn 1 ngày đổi/trả (hạn %s). Quá hạn này chỉ còn gửi bảo hành, không đổi mới.",
		en: "«%s» has 1 day left to return or exchange (deadline %s). After that you can only send it for repair, not exchange it.",
	},
	"Cửa sổ đổi/trả của «%s» sắp hết.": {
		vi: "Cửa sổ đổi/trả của «%s» sắp hết.",
		en: "The return/exchange window for «%s» is closing soon.",
	},
	"«%s» mua ngày %s nhưng chưa ghi hạn đổi trả, nên app không thể nhắc bạn trước khi hết hạn đổi/trả.": {
		vi: "«%s» mua ngày %s nhưng chưa ghi hạn đổi trả, nên app không thể nhắc bạn trước khi hết hạn đổi/trả.",
		en: "«%s» was bought on %s but the return window was never recorded, so the app cannot remind you before it closes.",
	},
	"«%s» chưa ghi hạn đổi trả.": {
		vi: "«%s» chưa ghi hạn đổi trả.",
		en: "The return window for «%s» has not been recorded.",
	},
	"«%s» sẽ tự gia hạn ngày %s (%s) và chưa có link huỷ — muốn dừng thì phải vào tận trang của nhà cung cấp.": {
		vi: "«%s» sẽ tự gia hạn ngày %s (%s) và chưa có link huỷ — muốn dừng thì phải vào tận trang của nhà cung cấp.",
		en: "«%s» renews automatically on %s (%s) and has no cancel link — stopping it means going to the provider's own site.",
	},
	"«%s» sẽ tự gia hạn và chưa có link huỷ.": {
		vi: "«%s» sẽ tự gia hạn và chưa có link huỷ.",
		en: "«%s» renews automatically and has no cancel link.",
	},
	"«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua %d ngày). Gia hạn hoặc sửa lại ngày cho khớp.": {
		vi: "«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua %d ngày). Gia hạn hoặc sửa lại ngày cho khớp.",
		en: "A payment for «%s» was recorded on %s but the renewal date is still %s (%d days in the past). Renew it or fix the date so they match.",
	},
	"«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua 1 ngày). Gia hạn hoặc sửa lại ngày cho khớp.": {
		vi: "«%s» đã ghi nhận thanh toán ngày %s nhưng ngày gia hạn vẫn là %s (đã qua 1 ngày). Gia hạn hoặc sửa lại ngày cho khớp.",
		en: "A payment for «%s» was recorded on %s but the renewal date is still %s (1 day in the past). Renew it or fix the date so they match.",
	},
	"«%s» có thanh toán đã ghi nhận nhưng ngày gia hạn vẫn ở quá khứ.": {
		vi: "«%s» có thanh toán đã ghi nhận nhưng ngày gia hạn vẫn ở quá khứ.",
		en: "«%s» has a recorded payment but its renewal date is still in the past.",
	},
	"Giá ghi nhận gần nhất: %s.": {
		vi: "Giá ghi nhận gần nhất: %s.",
		en: "Last recorded price: %s.",
	},
	"«%s» có ngày dự kiến mua %s, đã qua %d ngày.": {
		vi: "«%s» có ngày dự kiến mua %s, đã qua %d ngày.",
		en: "«%s» had a target purchase date of %s, which passed %d days ago.",
	},
	"«%s» có ngày dự kiến mua %s, đã qua 1 ngày.": {
		vi: "«%s» có ngày dự kiến mua %s, đã qua 1 ngày.",
		en: "«%s» had a target purchase date of %s, which passed 1 day ago.",
	},
	"«%s» đã qua ngày dự kiến mua.": {
		vi: "«%s» đã qua ngày dự kiến mua.",
		en: "«%s» is past its target purchase date.",
	},
	"Số ngày hoãn phải từ %d tới %d": {
		vi: "Số ngày hoãn phải từ %d tới %d",
		en: "Snooze days must be between %d and %d",
	},
	"Không tìm thấy việc cần xử lý này": {
		vi: "Không tìm thấy việc cần xử lý này",
		en: "Action item not found",
	},
	"Đã đạt giới hạn %d việc đang hoãn. Bỏ hoãn bớt rồi thử lại.": {
		vi: "Đã đạt giới hạn %d việc đang hoãn. Bỏ hoãn bớt rồi thử lại.",
		en: "You have reached the limit of %d snoozed items. Un-snooze some and try again.",
	},
	"Việc này không đang được hoãn": {
		vi: "Việc này không đang được hoãn",
		en: "This item is not snoozed",
	},
	"Danh sách này chỉ gồm những việc app TỰ SUY RA từ dữ liệu bạn đã nhập và không tự quyết được. Nó không phải thông báo đẩy — bảo hiểm/bảo hành vẫn nhắc riêng theo mốc ngày. Hoãn một việc ở đây không ảnh hưởng tới nhắc bảo hành.": {
		vi: "Danh sách này chỉ gồm những việc app TỰ SUY RA từ dữ liệu bạn đã nhập và không tự quyết được. Nó không phải thông báo đẩy — bảo hiểm/bảo hành vẫn nhắc riêng theo mốc ngày. Hoãn một việc ở đây không ảnh hưởng tới nhắc bảo hành.",
		en: "This list contains only the things the app INFERS from the data you entered and cannot decide on its own. It is not a push feed — insurance and warranty reminders still fire separately on their own dates. Snoozing an item here does not affect warranty reminders.",
	},

	// Request-shape copy the two action-queue handlers own.
	"Tham số snoozed không hợp lệ": {
		vi: "Tham số snoozed không hợp lệ",
		en: "Invalid snoozed parameter",
	},
	"Mã việc cần xử lý không hợp lệ": {
		vi: "Mã việc cần xử lý không hợp lệ",
		en: "Invalid action item key",
	},
	"Phải có dạng <LOẠI_VIỆC>:<id>": {
		vi: "Phải có dạng <LOẠI_VIỆC>:<id>",
		en: "Must be in the form <KIND>:<id>",
	},

	// ── Reminders query parameters (internal/handlers/reminders.go).
	//
	// The `withinDays` field error is the case §3.4 flagged: it used to be built
	// by CONCATENATION ("Phải là số nguyên từ 1 tới " + strconv.Itoa(max)), which
	// can never be a catalog key because no literal at any call site equals it.
	// It now reuses the printf-shaped key wave 4 added for /search, which says the
	// same thing about a different parameter.
	"Tham số withinDays không hợp lệ": {
		vi: "Tham số withinDays không hợp lệ",
		en: "Invalid withinDays parameter",
	},
	"Tham số includeDismissed không hợp lệ": {
		vi: "Tham số includeDismissed không hợp lệ",
		en: "Invalid includeDismissed parameter",
	},

	// ── Sessions (internal/handlers/sessions.go).
	//
	// The revocation message is assembled from up to three sentences, so each is
	// its own key and the caller joins them with a space — the Vietnamese output
	// is byte-identical to the concatenation it replaces.
	"Không tìm thấy phiên đăng nhập": {vi: "Không tìm thấy phiên đăng nhập", en: "Session not found"},
	"Thiếu id phiên đăng nhập":       {vi: "Thiếu id phiên đăng nhập", en: "Missing session id"},
	"Đã thu hồi phiên đăng nhập.":    {vi: "Đã thu hồi phiên đăng nhập.", en: "The session has been revoked."},
	"Phiên đăng nhập này đã được thu hồi trước đó.": {
		vi: "Phiên đăng nhập này đã được thu hồi trước đó.",
		en: "That session had already been revoked.",
	},
	"Đây là phiên bạn đang dùng — hãy đăng nhập lại.": {
		vi: "Đây là phiên bạn đang dùng — hãy đăng nhập lại.",
		en: "This is the session you are using — sign in again.",
	},

	// ── Spending forecast (internal/services/forecast.go).
	//
	// The note is the honesty line that explains what the numbers do and do not
	// include, so it is translated in full rather than summarised: an English
	// reader has to come away knowing that LIFETIME never charges, that the window
	// is partial at both ends, and that warranty/wishlist figures are potential
	// spending rather than money already committed.
	"Chỉ tính các gói đang ACTIVE; gói LIFETIME không bao giờ bị trừ. Cửa sổ tính từ hôm nay, nên tháng đầu và tháng cuối chỉ tính phần nằm trong cửa sổ. subscriptionAutoRenewVnd là tiền sẽ bị trừ tự động, phần còn lại là các gói bạn phải tự gia hạn. Tiền bảo hành và wishlist là khoản có thể phát sinh, không phải khoản chắc chắn trả.": {
		vi: "Chỉ tính các gói đang ACTIVE; gói LIFETIME không bao giờ bị trừ. Cửa sổ tính từ hôm nay, nên tháng đầu và tháng cuối chỉ tính phần nằm trong cửa sổ. subscriptionAutoRenewVnd là tiền sẽ bị trừ tự động, phần còn lại là các gói bạn phải tự gia hạn. Tiền bảo hành và wishlist là khoản có thể phát sinh, không phải khoản chắc chắn trả.",
		en: "Only ACTIVE plans are counted; LIFETIME plans are never charged. The window starts today, so the first and last months count only the part that falls inside it. subscriptionAutoRenewVnd is money that will be taken automatically; the rest is plans you have to renew yourself. Warranty and wishlist money is spending that may happen, not a charge you are certain to pay.",
	},
	"Số tháng phải trong khoảng %d–%d": {
		vi: "Số tháng phải trong khoảng %d–%d",
		en: "Months must be between %d and %d",
	},
	"Số tháng phải là số trong khoảng %d–%d": {
		vi: "Số tháng phải là số trong khoảng %d–%d",
		en: "Months must be a number between %d and %d",
	},

	// ── Transactional email (internal/email/resend.go).
	//
	// The keys are SENTENCES, never HTML. The two templates share the greeting,
	// the link sentence and the button label; the skeleton (div, h2, a href) and
	// the newlines stay in Go, so a translation cannot break the markup, and the
	// builder escapes the recipient's address itself instead of trusting a
	// catalog entry to do it.
	//
	// These are the last monolingual surface on the auth path: someone who cannot
	// read Vietnamese cannot complete a password reset or confirm a new email
	// address, so they are sent in the RECIPIENT's stored language
	// (i18n.FromStored) rather than in the language of the request that happened
	// to trigger them.
	"Đặt lại mật khẩu Warranty Vault": {vi: "Đặt lại mật khẩu Warranty Vault", en: "Reset your Warranty Vault password"},
	"Đặt lại mật khẩu":            {vi: "Đặt lại mật khẩu", en: "Reset password"},
	"Chào %s,":                    {vi: "Chào %s,", en: "Hi %s,"},
	"Có yêu cầu đặt lại mật khẩu cho tài khoản này.": {
		vi: "Có yêu cầu đặt lại mật khẩu cho tài khoản này.",
		en: "Someone asked to reset the password for this account.",
	},
	"Có yêu cầu đặt lại mật khẩu cho tài khoản Warranty Vault này.": {
		vi: "Có yêu cầu đặt lại mật khẩu cho tài khoản Warranty Vault này.",
		en: "Someone asked to reset the password for this Warranty Vault account.",
	},
	"Bấm link dưới (hiệu lực %d phút):": {
		vi: "Bấm link dưới (hiệu lực %d phút):",
		en: "Click the link below (valid for %d minutes):",
	},
	"Nếu không phải bạn, bỏ qua email này.": {
		vi: "Nếu không phải bạn, bỏ qua email này.",
		en: "If this was not you, you can ignore this email.",
	},
	"Link có hiệu lực trong %d phút. Nếu không phải bạn, bỏ qua email này.": {
		vi: "Link có hiệu lực trong %d phút. Nếu không phải bạn, bỏ qua email này.",
		en: "This link is valid for %d minutes. If this was not you, you can ignore this email.",
	},
	"Xác nhận đổi email Warranty Vault": {vi: "Xác nhận đổi email Warranty Vault", en: "Confirm your new Warranty Vault email"},
	"Xác nhận đổi email":            {vi: "Xác nhận đổi email", en: "Confirm email change"},
	"Chào bạn,":                     {vi: "Chào bạn,", en: "Hi,"},
	"Có yêu cầu đổi email của tài khoản Warranty Vault từ %s sang địa chỉ này.": {
		vi: "Có yêu cầu đổi email của tài khoản Warranty Vault từ %s sang địa chỉ này.",
		en: "Someone asked to change this Warranty Vault account's email from %s to this address.",
	},
	"Hoặc nhập mã xác nhận trong ứng dụng:": {
		vi: "Hoặc nhập mã xác nhận trong ứng dụng:",
		en: "Or enter the confirmation code in the app:",
	},
	"Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận. Nếu không phải bạn, bỏ qua email này — không có gì thay đổi.": {
		vi: "Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận. Nếu không phải bạn, bỏ qua email này — không có gì thay đổi.",
		en: "The old address keeps working until you confirm. If this was not you, ignore this email — nothing has changed.",
	},
	"Link có hiệu lực trong %d phút. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận. Nếu không phải bạn, bỏ qua email này — không có gì thay đổi.": {
		vi: "Link có hiệu lực trong %d phút. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận. Nếu không phải bạn, bỏ qua email này — không có gì thay đổi.",
		en: "This link is valid for %d minutes. The old address keeps working until you confirm. If this was not you, ignore this email — nothing has changed.",
	},
}
