package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

const (
	defaultFrom    = "Warrly <onboarding@resend.dev>"
	resetTTLMin    = 30
	resendEndpoint = "https://api.resend.com/emails"
)

// Client sends transactional email through Resend. With an empty apiKey it
// runs in dev mode: it logs the message via slog and returns nil.
type Client struct {
	apiKey     string
	from       string
	endpoint   string
	httpClient *http.Client
}

// NewFromEnv reads RESEND_API_KEY and RESEND_FROM. An empty RESEND_API_KEY
// is fine — the returned Client logs instead of dispatching.
func NewFromEnv() *Client {
	from := os.Getenv("RESEND_FROM")
	if from == "" {
		from = defaultFrom
	}
	return &Client{
		apiKey:   os.Getenv("RESEND_API_KEY"),
		from:     from,
		endpoint: resendEndpoint,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

type sendRequest struct {
	From    string   `json:"from"`
	To      []string `json:"to"`
	Subject string   `json:"subject"`
	HTML    string   `json:"html"`
	Text    string   `json:"text"`
}

// ── language ─────────────────────────────────────────────────────────────────
//
// Both templates below are rendered in the RECIPIENT's language, passed in by the
// caller as `lang` rather than read from ctx.
//
// Why explicit, when the request context is right there: the two flows mail
// different people from the person who triggered them in principle (and in
// practice the send happens inside a DETACHED goroutine with
// context.Background(), so a tag on the request would not even reach here). The
// caller — handlers.Forgot / ChangeEmail — has the User row and resolves
// `i18n.FromStored(user.Locale)`, which is the same "stored preference, else the
// product default" rule the cron applies per recipient. A request signal
// deliberately does NOT outrank it: the mail outlives the request that caused it,
// and a password-reset link opened tomorrow should not be in a language the
// recipient never chose.
//
// The keys are SENTENCES, never HTML. The skeleton, the newlines and the button
// markup stay here, so a translation cannot break the layout — and every
// interpolated value that lands in HTML is escaped HERE (html.EscapeString)
// rather than trusted to a catalog entry. `to` is a user-supplied address and
// `resetLink`/`confirmLink` are built from APP_URL, so neither is markup.

// SendPasswordReset emails the password-reset link, in `lang`.
func (c *Client) SendPasswordReset(ctx context.Context, lang i18n.Tag, to, resetLink string) error {
	subject := i18n.Translate(lang, "Đặt lại mật khẩu Warrly")
	heading := i18n.Translate(lang, "Đặt lại mật khẩu")

	// Plain-text body. It is the same four sentences as the HTML in the same
	// order; only the button becomes a bare URL.
	text := i18n.Translate(lang, "Chào %s,", to) + "\n\n" +
		i18n.Translate(lang, "Có yêu cầu đặt lại mật khẩu cho tài khoản này.") + "\n\n" +
		i18n.Translate(lang, "Bấm link dưới (hiệu lực %d phút):", resetTTLMin) + "\n" + resetLink + "\n\n" +
		i18n.Translate(lang, "Nếu không phải bạn, bỏ qua email này.")

	htmlBody := fmt.Sprintf(`<div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; margin: auto; padding: 24px;">
  <h2 style="color:#1e40af;">%s</h2>
  <p>%s</p>
  <p>%s</p>
  <p style="margin: 24px 0;">
    <a href="%s" style="display:inline-block;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">
      %s
    </a>
  </p>
  <p style="color:#666;font-size:13px;">%s</p>
</div>`,
		heading,
		// The greeting wraps the address in <strong> in the HTML form only; that
		// markup is added here and escaped here, so the catalog keeps one plain
		// "Chào %s," shared by both bodies.
		i18n.Translate(lang, "Chào %s,", "<strong>"+html.EscapeString(to)+"</strong>"),
		i18n.Translate(lang, "Có yêu cầu đặt lại mật khẩu cho tài khoản Warrly này."),
		html.EscapeString(resetLink),
		heading,
		i18n.Translate(lang, "Link có hiệu lực trong %d phút. Nếu không phải bạn, bỏ qua email này.", resetTTLMin),
	)

	return c.send(ctx, to, subject, text, htmlBody)
}

// SendEmailChange emails the confirmation link for an email change (roadmap #10).
// It goes to the NEW address — receiving it is what proves the user controls that
// address — and carries the raw token as text as well as a link, so a native
// client that has no web route for the token can still complete the flow with
// POST /api/v1/auth/confirm-email-change.
//
// `oldEmail` is rendered so the recipient can recognise an account they may not
// have known was moving, and TTL matches the password-reset window (30 minutes).
//
// `lang` is the recipient's language and is the SAME account as the old address's
// owner: the change is requested from inside an authenticated session, so the
// stored preference on that row is the right one even though the mail is
// addressed to an address that is not yet the account's.
func (c *Client) SendEmailChange(ctx context.Context, lang i18n.Tag, to, oldEmail, confirmLink, token string) error {
	subject := i18n.Translate(lang, "Xác nhận đổi email Warrly")
	heading := i18n.Translate(lang, "Xác nhận đổi email")
	greeting := i18n.Translate(lang, "Chào bạn,")
	changeLine := i18n.Translate(lang, "Có yêu cầu đổi email của tài khoản Warrly từ %s sang địa chỉ này.", oldEmail)
	orEnter := i18n.Translate(lang, "Hoặc nhập mã xác nhận trong ứng dụng:")

	text := greeting + "\n\n" +
		changeLine + "\n\n" +
		i18n.Translate(lang, "Bấm link dưới (hiệu lực %d phút):", resetTTLMin) + "\n" + confirmLink + "\n\n" +
		orEnter + "\n" + token + "\n\n" +
		i18n.Translate(lang, "Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận. Nếu không phải bạn, bỏ qua email này — không có gì thay đổi.")

	htmlBody := fmt.Sprintf(`<div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; margin: auto; padding: 24px;">
  <h2 style="color:#1e40af;">%s</h2>
  <p>%s</p>
  <p>%s</p>
  <p style="margin: 24px 0;">
    <a href="%s" style="display:inline-block;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">
      %s
    </a>
  </p>
  <p>%s</p>
  <p style="font-family: monospace; word-break: break-all; background:#f3f4f6; padding:12px; border-radius:6px;">%s</p>
  <p style="color:#666;font-size:13px;">%s</p>
</div>`,
		heading,
		greeting,
		i18n.Translate(lang, "Có yêu cầu đổi email của tài khoản Warrly từ %s sang địa chỉ này.",
			"<strong>"+html.EscapeString(oldEmail)+"</strong>"),
		html.EscapeString(confirmLink),
		heading,
		orEnter,
		html.EscapeString(token),
		i18n.Translate(lang, "Link có hiệu lực trong %d phút. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận. Nếu không phải bạn, bỏ qua email này — không có gì thay đổi.", resetTTLMin),
	)

	return c.send(ctx, to, subject, text, htmlBody)
}

// ── reminder email fallback ──────────────────────────────────────────────────
//
// The fallback mail of FEATURE_RESEARCH_2026-11 §5 #8. Push is the primary
// channel; when it reaches nobody, a user who opted in gets ONE transactional
// email per reminder lead day instead of silence. The cron owns the "should this
// user get mail at all / is this the first send" decision (User.reminderEmailFallback
// + ReminderEmailNotice, migration 0033); this file only renders and sends.
//
// It is an ARTIFACT, so it is written in Vietnamese whenever the caller passes
// i18n.VI — which the cron does unconditionally, even for an account whose
// interface language is English. That is the same rule as the public certificate
// and the insurance PDF: the mail leaves the system, may be opened on another
// device, and a deadline is a fact about the user's purchase, not a UI string.
// The `lang` parameter is kept so the template machinery is identical to the two
// mails above, and so a future explicit opt-in to translated reminder mail is a
// call-site change rather than a rewrite.
//
// Every interpolated value (device/item/subscription name, formatted date) comes
// from user data, so it is escaped HERE in the HTML body, exactly like `to` and
// the links in the templates above. The subject and the plain-text body are not
// markup and are sent as-is.

// ReminderKind identifies which deadline a fallback mail is about. The string
// values are the same tokens the cron stores in "ReminderEmailNotice".kind
// (migration 0033), so a log line and a dedupe row can be read together.
type ReminderKind string

const (
	ReminderWarranty            ReminderKind = "warranty"
	ReminderWishlistTarget      ReminderKind = "wishlist_target"
	ReminderWishlistCheckin     ReminderKind = "wishlist_checkin"
	ReminderSubscriptionRenewal ReminderKind = "subscription_renewal"
)

// ReminderNotice is one already-selected fallback notice. Everything the cron
// knows about the deadline is passed in; nothing here reads the database.
//
//   - Name     — device / wishlist item / subscription name, user-controlled.
//   - Days     — the lead day that fired (0 = today). Used by the check-in copy,
//     where the interval was the trigger, and not printed for the others (the
//     deadline date is the useful fact there).
//   - Deadline — the deadline rendered for a Vietnamese reader (dd/mm/yyyy).
//   - Detail   — optional extra line the cron already localized (provider,
//     price + brand, password-cancel hint). Kept opaque on purpose: the cron
//     knows which fields exist for which kind, and the mail must not invent one.
//   - URL      — the app path for the notice (e.g. "/devices/<id>"); the cron
//     prefixes APP_URL before calling, because a mail needs an absolute link.
type ReminderNotice struct {
	Kind     ReminderKind
	Name     string
	Days     int
	Deadline string
	Detail   string
	URL      string
}

// Configured reports whether a real Resend key is present. With no key the
// client still runs in dev mode (send logs the message), but a cron pass must
// NOT claim a fallback send it never made, so the caller checks this first and
// skips the notice entirely. Kept as a method rather than an exported field so
// the env read at construction stays the only source of truth.
func (c *Client) Configured() bool {
	return c != nil && c.apiKey != ""
}

// SendReminderFallback emails one deadline reminder, in `lang`.
func (c *Client) SendReminderFallback(ctx context.Context, lang i18n.Tag, to string, n ReminderNotice) error {
	subject, noticeLine := reminderCopy(lang, n)

	greeting := i18n.Translate(lang, "Chào bạn,")
	heading := i18n.Translate(lang, "Nhắc hạn từ Warrly")
	intro := i18n.Translate(lang, "Bạn nhận được email này vì đã bật nhắc hạn qua email trong Warrly, và ứng dụng chưa gửi được thông báo đẩy tới thiết bị của bạn.")
	footer := i18n.Translate(lang, "Bạn có thể tắt nhắc hạn qua email trong Cài đặt của Warrly.")
	button := i18n.Translate(lang, "Mở Warrly")

	// Plain text: the same sentences as the HTML, in the same order; the button
	// becomes a bare URL.
	text := greeting + "\n\n" + intro + "\n\n" + noticeLine
	if n.Detail != "" {
		text += "\n" + n.Detail
	}
	text += "\n\n" + button + ": " + n.URL + "\n\n" + footer

	// The notice line and the detail carry user data (names) and are escaped as
	// whole sentences; the catalog entries never contain markup. The detail is
	// optional, so it is appended only when present rather than leaving an empty
	// <p> in every warranty mail.
	detail := ""
	if n.Detail != "" {
		detail = "<br>" + html.EscapeString(n.Detail)
	}
	htmlBody := fmt.Sprintf(`<div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; margin: auto; padding: 24px;">
  <h2 style="color:#1e40af;">%s</h2>
  <p>%s</p>
  <p><strong>%s</strong>%s</p>
  <p style="margin: 24px 0;">
    <a href="%s" style="display:inline-block;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">
      %s
    </a>
  </p>
  <p style="color:#666;font-size:13px;">%s</p>
</div>`,
		heading,
		greeting,
		html.EscapeString(noticeLine),
		detail,
		html.EscapeString(n.URL),
		button,
		footer,
	)

	return c.send(ctx, to, subject, text, htmlBody)
}

// reminderCopy renders the kind-specific subject and body sentence. The two
// strings are returned together because they must agree on the same count and
// the same date; splitting them across call sites is how one of them ends up
// naming the wrong deadline.
//
// The subjects do NOT repeat the push title verbatim: a mail is read hours later
// and must say what it is about on its own ("Sắp hết hạn bảo hành: <name>").
func reminderCopy(lang i18n.Tag, n ReminderNotice) (subject, line string) {
	switch n.Kind {
	case ReminderWarranty:
		subject = i18n.Translate(lang, "Sắp hết hạn bảo hành: %s", n.Name)
		line = i18n.Translate(lang, "Bảo hành của \"%s\" hết hạn ngày %s.", n.Name, n.Deadline)
	case ReminderWishlistTarget:
		subject = i18n.Translate(lang, "Sắp tới ngày mua: %s", n.Name)
		line = i18n.Translate(lang, "Món \"%s\" — ngày dự kiến mua %s.", n.Name, n.Deadline)
	case ReminderWishlistCheckin:
		subject = i18n.Translate(lang, "Còn thèm \"%s\"?", n.Name)
		line = i18n.Translate(lang, "Món \"%s\" đã %d ngày chưa cập nhật giá.", n.Name, n.Days)
	case ReminderSubscriptionRenewal:
		// "Sắp tới hạn", not "Sắp gia hạn": a subscription with autoRenew=false
		// does not renew at all — it EXPIRES that day. The deadline is the same,
		// and the (already localized) Detail line says which of the two applies.
		subject = i18n.Translate(lang, "Sắp tới hạn gói: %s", n.Name)
		line = i18n.Translate(lang, "Gói \"%s\" tới hạn ngày %s.", n.Name, n.Deadline)
	default:
		// Defensive only: every cron call site passes one of the four kinds above.
		subject = i18n.Translate(lang, "Nhắc hạn từ Warrly")
		line = i18n.Translate(lang, "Một mốc nhắc hạn trong Warrly sắp tới.")
	}
	return subject, line
}

func (c *Client) send(ctx context.Context, to, subject, text, html string) error {
	if c.apiKey == "" {
		slog.Info("email dev-mode (no RESEND_API_KEY)",
			"to", to,
			"subject", subject,
			"text", text,
		)
		return nil
	}

	body, err := json.Marshal(sendRequest{
		From:    c.from,
		To:      []string{to},
		Subject: subject,
		HTML:    html,
		Text:    text,
	})
	if err != nil {
		return fmt.Errorf("marshal email body: %w", err)
	}

	endpoint := c.endpoint
	if endpoint == "" {
		endpoint = resendEndpoint
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build resend request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("send via resend: %w", err)
	}
	defer func() { _ = res.Body.Close() }()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		raw, _ := io.ReadAll(res.Body)
		return fmt.Errorf("resend status %d: %s", res.StatusCode, string(raw))
	}
	return nil
}
