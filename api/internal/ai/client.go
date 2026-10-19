// Package ai is a thin HTTP client over the Anthropic Messages API used for
// OCR-style extraction of Vietnamese receipts / warranty cards into structured
// drafts. It owns no business logic — the services layer orchestrates decrypt,
// catalog mapping and the confirm-before-save contract. With an empty API key
// the client is disabled (Enabled() == false) and callers must degrade
// gracefully, mirroring the email.Client dev-mode pattern.
package ai

import (
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	// DefaultModel is the cheap extraction tier (Haiku 4.5). Override with
	// ANTHROPIC_MODEL when needed.
	DefaultModel = "claude-haiku-4-5-20251001"

	anthropicEndpoint = "https://api.anthropic.com/v1/messages"
	anthropicVersion  = "2023-06-01"
)

// Client talks to the Anthropic Messages API. Construct via NewFromEnv.
type Client struct {
	apiKey     string
	model      string
	endpoint   string
	httpClient *http.Client
}

// NewFromEnv reads ANTHROPIC_API_KEY and ANTHROPIC_MODEL. An empty key yields a
// disabled client (Enabled() == false); the OCR endpoint then returns a clean
// Vietnamese "feature disabled" error instead of failing to boot.
func NewFromEnv() *Client {
	model := strings.TrimSpace(os.Getenv("ANTHROPIC_MODEL"))
	if model == "" {
		model = DefaultModel
	}
	return &Client{
		apiKey:   strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")),
		model:    model,
		endpoint: anthropicEndpoint,
		httpClient: &http.Client{
			// Vision extraction is a single round-trip; 30s is generous.
			Timeout: 30 * time.Second,
		},
	}
}

// Enabled reports whether an API key is configured.
func (c *Client) Enabled() bool { return c != nil && c.apiKey != "" }

// Model returns the model id this client was configured with. It is echoed in
// the /ai/assess-claim response so a client (and a support engineer reading a
// screenshot) can tell which model produced the advice. Empty on a nil client.
func (c *Client) Model() string {
	if c == nil {
		return ""
	}
	return c.model
}

// NewClientForEndpoint builds a client against an explicit Messages API endpoint.
// Production always uses NewFromEnv; tests use this to exercise the request and
// response wire shape against an httptest.Server, with no real model call.
func NewClientForEndpoint(apiKey, model, endpoint string) *Client {
	if strings.TrimSpace(model) == "" {
		model = DefaultModel
	}
	return &Client{
		apiKey:   apiKey,
		model:    model,
		endpoint: endpoint,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}
