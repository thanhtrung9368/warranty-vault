package email

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"time"
)

const (
	defaultFrom    = "AssetVault <onboarding@resend.dev>"
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

// SendPasswordReset emails the password-reset link. Mirrors the Vietnamese
// template from website/src/lib/services/password-reset.ts.
func (c *Client) SendPasswordReset(ctx context.Context, to, resetLink string) error {
	subject := "Đặt lại mật khẩu AssetVault"
	text := fmt.Sprintf(
		"Chào %s,\n\n"+
			"Có yêu cầu đặt lại mật khẩu cho tài khoản này.\n\n"+
			"Bấm link dưới (hiệu lực %d phút):\n%s\n\n"+
			"Nếu không phải bạn, bỏ qua email này.",
		to, resetTTLMin, resetLink,
	)
	html := fmt.Sprintf(`<div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; margin: auto; padding: 24px;">
  <h2 style="color:#1e40af;">Đặt lại mật khẩu</h2>
  <p>Chào <strong>%s</strong>,</p>
  <p>Có yêu cầu đặt lại mật khẩu cho tài khoản AssetVault này.</p>
  <p style="margin: 24px 0;">
    <a href="%s" style="display:inline-block;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">
      Đặt lại mật khẩu
    </a>
  </p>
  <p style="color:#666;font-size:13px;">Link có hiệu lực trong %d phút. Nếu không phải bạn, bỏ qua email này.</p>
</div>`, to, resetLink, resetTTLMin)

	return c.send(ctx, to, subject, text, html)
}

// SendEmailChange emails the confirmation link for an email change (roadmap #10).
// It goes to the NEW address — receiving it is what proves the user controls that
// address — and carries the raw token as text as well as a link, so a native
// client that has no web route for the token can still complete the flow with
// POST /api/v1/auth/confirm-email-change.
//
// `oldEmail` is rendered so the recipient can recognise an account they may not
// have known was moving, and TTL matches the password-reset window (30 minutes).
func (c *Client) SendEmailChange(ctx context.Context, to, oldEmail, confirmLink, token string) error {
	subject := "Xác nhận đổi email AssetVault"
	text := fmt.Sprintf(
		"Chào bạn,\n\n"+
			"Có yêu cầu đổi email của tài khoản AssetVault từ %s sang địa chỉ này.\n\n"+
			"Bấm link dưới (hiệu lực %d phút):\n%s\n\n"+
			"Hoặc nhập mã xác nhận trong ứng dụng:\n%s\n\n"+
			"Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận. Nếu không phải bạn, bỏ qua email này — không có gì thay đổi.",
		oldEmail, resetTTLMin, confirmLink, token,
	)
	html := fmt.Sprintf(`<div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 480px; margin: auto; padding: 24px;">
  <h2 style="color:#1e40af;">Xác nhận đổi email</h2>
  <p>Chào bạn,</p>
  <p>Có yêu cầu đổi email của tài khoản AssetVault từ <strong>%s</strong> sang địa chỉ này.</p>
  <p style="margin: 24px 0;">
    <a href="%s" style="display:inline-block;padding:10px 20px;background:#1e40af;color:#fff;text-decoration:none;border-radius:6px;">
      Xác nhận đổi email
    </a>
  </p>
  <p>Hoặc nhập mã xác nhận trong ứng dụng:</p>
  <p style="font-family: monospace; word-break: break-all; background:#f3f4f6; padding:12px; border-radius:6px;">%s</p>
  <p style="color:#666;font-size:13px;">Link có hiệu lực trong %d phút. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận. Nếu không phải bạn, bỏ qua email này — không có gì thay đổi.</p>
</div>`, oldEmail, confirmLink, token, resetTTLMin)

	return c.send(ctx, to, subject, text, html)
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
