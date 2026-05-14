package email

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSendPasswordReset_DevMode(t *testing.T) {
	t.Parallel()
	c := &Client{} // apiKey empty
	if err := c.SendPasswordReset(context.Background(), "u@example.com", "https://app/reset/abc"); err != nil {
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

	err := c.SendPasswordReset(context.Background(), "user@example.com", "https://app.local/reset/tok")
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
	if captured.Subject != "Đặt lại mật khẩu AssetVault" {
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
	err := c.SendPasswordReset(context.Background(), "u@example.com", "x")
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
