package ratelimit

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// UpstashLimiter calls the Upstash Redis REST `/pipeline` endpoint with a
// 3-command pipeline (INCR + PEXPIRE NX + PTTL). On any transport / 5xx
// failure it fails open — same behaviour as the TS implementation.
type UpstashLimiter struct {
	url        string
	token      string
	prefix     string
	httpClient *http.Client
}

func NewUpstashLimiter(url, token string) *UpstashLimiter {
	return &UpstashLimiter{
		url:    strings.TrimRight(url, "/"),
		token:  token,
		prefix: "wv:rl:",
		httpClient: &http.Client{
			Timeout: 2 * time.Second,
		},
	}
}

type pipelineEntry struct {
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

func (u *UpstashLimiter) Check(ctx context.Context, key string, max int, windowMs int) (Result, error) {
	k := u.prefix + key
	body, err := json.Marshal([][]any{
		{"INCR", k},
		{"PEXPIRE", k, fmt.Sprintf("%d", windowMs), "NX"},
		{"PTTL", k},
	})
	if err != nil {
		slog.Warn("rate-limit upstash marshal", "err", err)
		return Result{Ok: true, Remaining: max - 1}, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.url+"/pipeline", bytes.NewReader(body))
	if err != nil {
		slog.Warn("rate-limit upstash request", "err", err)
		return Result{Ok: true, Remaining: max - 1}, nil
	}
	req.Header.Set("Authorization", "Bearer "+u.token)
	req.Header.Set("Content-Type", "application/json")

	res, err := u.httpClient.Do(req)
	if err != nil {
		slog.Warn("rate-limit upstash transport; failing open", "err", err)
		return Result{Ok: true, Remaining: max - 1}, nil
	}
	defer func() { _ = res.Body.Close() }()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		slog.Warn("rate-limit upstash non-2xx; failing open", "status", res.StatusCode)
		return Result{Ok: true, Remaining: max - 1}, nil
	}

	raw, err := io.ReadAll(res.Body)
	if err != nil {
		slog.Warn("rate-limit upstash read; failing open", "err", err)
		return Result{Ok: true, Remaining: max - 1}, nil
	}

	var entries []pipelineEntry
	if err := json.Unmarshal(raw, &entries); err != nil || len(entries) < 3 {
		slog.Warn("rate-limit upstash parse; failing open", "err", err, "body", string(raw))
		return Result{Ok: true, Remaining: max - 1}, nil
	}

	count := toInt(entries[0].Result)
	if count > max {
		ttl := toInt(entries[2].Result)
		retry := (ttl + 999) / 1000
		if retry < 1 {
			retry = 1
		}
		return Result{Ok: false, Remaining: 0, RetryAfterSec: retry}, nil
	}
	rem := max - count
	if rem < 0 {
		rem = 0
	}
	return Result{Ok: true, Remaining: rem, RetryAfterSec: 0}, nil
}

func toInt(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case int64:
		return int(x)
	case string:
		var n int
		_, _ = fmt.Sscanf(x, "%d", &n)
		return n
	default:
		return 0
	}
}
