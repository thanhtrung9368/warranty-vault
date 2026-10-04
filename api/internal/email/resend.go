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
	defaultFrom    = "Warranty Vault <onboarding@resend.dev>"
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
	subject := i18n.Translate(lang, "Đặt lại mật khẩu Warranty Vault")
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
		i18n.Translate(lang, "Có yêu cầu đặt lại mật khẩu cho tài khoản Warranty Vault này."),
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
	subject := i18n.Translate(lang, "Xác nhận đổi email Warranty Vault")
	heading := i18n.Translate(lang, "Xác nhận đổi email")
	greeting := i18n.Translate(lang, "Chào bạn,")
	changeLine := i18n.Translate(lang, "Có yêu cầu đổi email của tài khoản Warranty Vault từ %s sang địa chỉ này.", oldEmail)
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
		i18n.Translate(lang, "Có yêu cầu đổi email của tài khoản Warranty Vault từ %s sang địa chỉ này.",
			"<strong>"+html.EscapeString(oldEmail)+"</strong>"),
		html.EscapeString(confirmLink),
		heading,
		orEnter,
		html.EscapeString(token),
		i18n.Translate(lang, "Link có hiệu lực trong %d phút. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận. Nếu không phải bạn, bỏ qua email này — không có gì thay đổi.", resetTTLMin),
	)

	return c.send(ctx, to, subject, text, htmlBody)
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
