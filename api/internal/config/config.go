package config

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	DatabaseURL   string
	Port          string
	WebURL        string
	SessionSecret string
}

// AnthropicAPIKey / AnthropicModel are read directly from the env by
// ai.NewFromEnv() (mirroring email/ratelimit which self-read). They are NOT
// part of Config.validate() — the OCR feature degrades gracefully when the
// key is absent, so the server still boots without it.

func Load() (*Config, error) {
	// Best-effort load; ignore error if .env is absent.
	_ = godotenv.Load()

	cfg := &Config{
		DatabaseURL:   strings.TrimSpace(os.Getenv("DATABASE_URL")),
		Port:          strings.TrimSpace(os.Getenv("PORT")),
		WebURL:        strings.TrimSpace(os.Getenv("WEB_URL")),
		SessionSecret: strings.TrimSpace(os.Getenv("SESSION_SECRET")),
	}

	if cfg.Port == "" {
		cfg.Port = "4000"
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}
	return cfg, nil
}

func (c *Config) validate() error {
	var missing []string
	if c.DatabaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}
	if len(missing) > 0 {
		return fmt.Errorf("config: missing required env vars: %s", strings.Join(missing, ", "))
	}
	if c.SessionSecret != "" && len(c.SessionSecret) < 32 {
		return errors.New("config: SESSION_SECRET must be at least 32 characters when set")
	}
	return nil
}
