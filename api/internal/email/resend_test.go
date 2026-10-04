package email

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

func TestSendPasswordReset_DevMode(t *testing.T) {
	t.Parallel()
	c := &Client{} // apiKey empty
	if err := c.SendPasswordReset(context.Background(), i18n.VI, "u@example.com", "https://app/reset/abc"); err != nil {
		t.Fatalf("dev mode should not error, got %v", err)
	}
}

func TestSendPasswordReset_PostsExpectedBody(t *testing.T) {
	t.Parallel()

	var captured sendRequest
	var auth string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = r.Header.Get("Authorization")
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &captured); err != nil {
			t.Errorf("unmarshal body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"abc"}`))
	}))
	defer srv.Close()

	c := &Client{
		apiKey:     "test_key",
		from:       "Test <noreply@test.local>",
		endpoint:   srv.URL,
		httpClient: srv.Client(),
	}

	err := c.SendPasswordReset(context.Background(), i18n.VI, "user@example.com", "https://app.local/reset/tok")
	if err != nil {
		t.Fatalf("send returned err: %v", err)
	}
	if auth != "Bearer test_key" {
		t.Errorf("Authorization=%q want 'Bearer test_key'", auth)
	}
	if captured.From != "Test <noreply@test.local>" {
		t.Errorf("From=%q", captured.From)
	}
	if len(captured.To) != 1 || captured.To[0] != "user@example.com" {
		t.Errorf("To=%v", captured.To)
	}
	if captured.Subject != "Đặt lại mật khẩu Warranty Vault" {
		t.Errorf("Subject=%q", captured.Subject)
	}
	if !strings.Contains(captured.Text, "https://app.local/reset/tok") {
		t.Errorf("Text missing reset link: %q", captured.Text)
	}
	if !strings.Contains(captured.HTML, "https://app.local/reset/tok") {
		t.Errorf("HTML missing reset link")
	}
	if !strings.Contains(captured.HTML, "Đặt lại mật khẩu") {
		t.Errorf("HTML missing Vietnamese subject text")
	}
}

func TestSendPasswordReset_PropagatesNon2xx(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"invalid_api_key"}`))
	}))
	defer srv.Close()

	c := &Client{
		apiKey:     "bad",
		from:       "x",
		endpoint:   srv.URL,
		httpClient: srv.Client(),
	}
	err := c.SendPasswordReset(context.Background(), i18n.VI, "u@example.com", "x")
	if err == nil {
		t.Fatalf("expected error on 401")
	}
	if !strings.Contains(err.Error(), "401") || !strings.Contains(err.Error(), "invalid_api_key") {
		t.Errorf("error should include status + body, got %v", err)
	}
}

func TestNewFromEnv_DefaultsFrom(t *testing.T) {
	t.Setenv("RESEND_API_KEY", "")
	t.Setenv("RESEND_FROM", "")
	c := NewFromEnv()
	if c.from != defaultFrom {
		t.Errorf("from=%q want %q", c.from, defaultFrom)
	}
	if c.apiKey != "" {
		t.Errorf("apiKey should be empty in dev")
	}
}

func TestSendEmailChange_DevMode(t *testing.T) {
	t.Parallel()
	c := &Client{} // apiKey empty
	if err := c.SendEmailChange(context.Background(), i18n.VI, "new@example.com", "old@example.com",
		"https://app/confirm-email/tok", "tok"); err != nil {
		t.Fatalf("dev mode should not error, got %v", err)
	}
}

// The confirmation email goes to the NEW address, names the OLD one, and carries
// both the link and the raw token (native clients post the token directly).
func TestSendEmailChange_PostsExpectedBody(t *testing.T) {
	t.Parallel()

	var captured sendRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &captured); err != nil {
			t.Errorf("unmarshal body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"abc"}`))
	}))
	defer srv.Close()

	c := &Client{
		apiKey:     "test_key",
		from:       "Test <noreply@test.local>",
		endpoint:   srv.URL,
		httpClient: srv.Client(),
	}

	err := c.SendEmailChange(context.Background(), i18n.VI, "new@example.com", "old@example.com",
		"https://app.local/confirm-email/raw-token", "raw-token")
	if err != nil {
		t.Fatalf("send returned err: %v", err)
	}
	if len(captured.To) != 1 || captured.To[0] != "new@example.com" {
		t.Errorf("To=%v, want the NEW address only", captured.To)
	}
	if captured.Subject != "Xác nhận đổi email Warranty Vault" {
		t.Errorf("Subject=%q", captured.Subject)
	}
	for _, want := range []string{"old@example.com", "https://app.local/confirm-email/raw-token", "raw-token"} {
		if !strings.Contains(captured.Text, want) {
			t.Errorf("Text missing %q: %q", want, captured.Text)
		}
	}
	if !strings.Contains(captured.HTML, "https://app.local/confirm-email/raw-token") {
		t.Error("HTML missing confirm link")
	}
	if !strings.Contains(captured.HTML, "raw-token") {
		t.Error("HTML missing the raw token")
	}
	if !strings.Contains(captured.Text, "Địa chỉ cũ vẫn dùng được") {
		t.Error("Text does not promise that the old address keeps working until confirm")
	}
}

// ── wave 5: both languages, asserted on the RENDERED body ────────────────────
//
// Both templates are restructured (not merely wrapped), so what needs pinning is
// the rendered message — subject, plain text and HTML — not the existence of a
// catalog key. Each case also asserts that the OTHER language's copy is absent,
// which is what catches a half-converted template: a body that is English except
// for one Vietnamese sentence reads as broken to the person receiving it, and it
// is exactly the failure mode a "the key exists" test cannot see.
//
// The two `Subject` values also prove the write path picks a language at all:
// they are rendered from `lang`, so a send that ignored the parameter would fail
// the English case with the Vietnamese subject.

// captureSend spins up one Resend stand-in and returns the captured request.
func captureSend(t *testing.T) (*Client, *sendRequest) {
	t.Helper()
	captured := &sendRequest{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, captured); err != nil {
			t.Errorf("unmarshal body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"abc"}`))
	}))
	t.Cleanup(srv.Close)
	return &Client{
		apiKey:     "test_key",
		from:       "Test <noreply@test.local>",
		endpoint:   srv.URL,
		httpClient: srv.Client(),
	}, captured
}

func TestPasswordResetEmailInBothLanguages(t *testing.T) {
	const link = "https://app.local/reset/tok"

	for _, tc := range []struct {
		lang     i18n.Tag
		subject  string
		mustHave []string
		mustNot  []string
	}{
		{
			lang:    i18n.VI,
			subject: "Đặt lại mật khẩu Warranty Vault",
			mustHave: []string{
				"Chào user@example.com,",
				"Có yêu cầu đặt lại mật khẩu cho tài khoản này.",
				"Bấm link dưới (hiệu lực 30 phút):",
				"Nếu không phải bạn, bỏ qua email này.",
				"Đặt lại mật khẩu",
			},
			mustNot: []string{"Reset password", "Hi user@example.com,", "valid for 30 minutes"},
		},
		{
			lang:    i18n.EN,
			subject: "Reset your Warranty Vault password",
			mustHave: []string{
				"Hi user@example.com,",
				"Someone asked to reset the password for this account.",
				"Click the link below (valid for 30 minutes):",
				"If this was not you, you can ignore this email.",
				"Reset password",
			},
			mustNot: []string{"Đặt lại mật khẩu", "Chào user@example.com,", "hiệu lực 30 phút"},
		},
	} {
		t.Run(string(tc.lang), func(t *testing.T) {
			c, captured := captureSend(t)
			if err := c.SendPasswordReset(context.Background(), tc.lang, "user@example.com", link); err != nil {
				t.Fatalf("send: %v", err)
			}
			if captured.Subject != tc.subject {
				t.Errorf("Subject = %q, want %q", captured.Subject, tc.subject)
			}
			// Both projections carry the link VERBATIM in both languages — the
			// link is not copy and must never be translated or escaped into
			// something a mail client cannot resolve.
			for _, body := range []string{captured.Text, captured.HTML} {
				if !strings.Contains(body, link) {
					t.Errorf("body missing the reset link %q", link)
				}
			}
			t.Logf("text = %q", captured.Text)
			t.Logf("html = %q", captured.HTML)
			for _, want := range tc.mustHave {
				if !strings.Contains(captured.Text, want) && !strings.Contains(captured.HTML, want) {
					t.Errorf("neither body contains %q", want)
				}
			}
			for _, not := range tc.mustNot {
				if strings.Contains(captured.Text, not) || strings.Contains(captured.HTML, not) {
					t.Errorf("body still contains the other language's copy %q", not)
				}
			}
		})
	}
}

func TestEmailChangeEmailInBothLanguages(t *testing.T) {
	const link = "https://app.local/confirm-email/raw-token"

	for _, tc := range []struct {
		lang     i18n.Tag
		subject  string
		mustHave []string
		mustNot  []string
	}{
		{
			lang:    i18n.VI,
			subject: "Xác nhận đổi email Warranty Vault",
			mustHave: []string{
				"Chào bạn,",
				"Có yêu cầu đổi email của tài khoản Warranty Vault từ old@example.com sang địa chỉ này.",
				"Hoặc nhập mã xác nhận trong ứng dụng:",
				"Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận.",
				"Xác nhận đổi email",
			},
			mustNot: []string{"Confirm email change", "Hi,", "old address keeps working"},
		},
		{
			lang:    i18n.EN,
			subject: "Confirm your new Warranty Vault email",
			mustHave: []string{
				"Hi,",
				"Someone asked to change this Warranty Vault account's email from old@example.com to this address.",
				"Or enter the confirmation code in the app:",
				"The old address keeps working until you confirm.",
				"Confirm email change",
			},
			mustNot: []string{"Xác nhận đổi email", "Chào bạn,", "Địa chỉ cũ vẫn dùng được"},
		},
	} {
		t.Run(string(tc.lang), func(t *testing.T) {
			c, captured := captureSend(t)
			if err := c.SendEmailChange(context.Background(), tc.lang, "new@example.com", "old@example.com", link, "raw-token"); err != nil {
				t.Fatalf("send: %v", err)
			}
			if captured.Subject != tc.subject {
				t.Errorf("Subject = %q, want %q", captured.Subject, tc.subject)
			}
			if len(captured.To) != 1 || captured.To[0] != "new@example.com" {
				t.Errorf("To = %v, want the NEW address only", captured.To)
			}
			// The TOKEN is not copy either: a native client posts it back, so it
			// must survive verbatim in both languages and in both projections.
			for _, body := range []string{captured.Text, captured.HTML} {
				if !strings.Contains(body, link) || !strings.Contains(body, "raw-token") {
					t.Errorf("body missing the confirm link or the raw token: %q", body)
				}
			}
			t.Logf("text = %q", captured.Text)
			t.Logf("html = %q", captured.HTML)
			for _, want := range tc.mustHave {
				if !strings.Contains(captured.Text, want) && !strings.Contains(captured.HTML, want) {
					t.Errorf("neither body contains %q", want)
				}
			}
			for _, not := range tc.mustNot {
				if strings.Contains(captured.Text, not) || strings.Contains(captured.HTML, not) {
					t.Errorf("body still contains the other language's copy %q", not)
				}
			}
		})
	}
}

// The address is interpolated into an HTML attribute-free `<strong>` wrapper, and
// it comes from a registration form. It is escaped by the builder, so a hostile
// address cannot inject markup into a mail that renders in the recipient's inbox.
// (The Vietnamese and English greetings are the same code path; this pins the
// escaping, not the language.)
func TestEmailEscapesTheRecipientAddressInHTML(t *testing.T) {
	c, captured := captureSend(t)
	hostile := `a<script>alert(1)</script>@example.com`
	if err := c.SendPasswordReset(context.Background(), i18n.EN, hostile, "https://app.local/reset/tok"); err != nil {
		t.Fatalf("send: %v", err)
	}
	if strings.Contains(captured.HTML, "<script>") {
		t.Errorf("HTML contains an unescaped script tag: %q", captured.HTML)
	}
	if !strings.Contains(captured.HTML, "&lt;script&gt;") {
		t.Errorf("HTML does not contain the escaped address: %q", captured.HTML)
	}
}
