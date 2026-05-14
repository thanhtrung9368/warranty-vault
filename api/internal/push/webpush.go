package push

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"sync"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// WebSub is the W3C Push API subscription shape we need to deliver a message.
// Mirrors the `{ endpoint, p256dh, auth }` blob the browser hands the client.
type WebSub struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// WebPusher holds the VAPID config. Zero value (Configured == false) is the
// "not configured" state and Send returns a not-configured Result.
type WebPusher struct {
	cfg     webPushConfig
	loaded  bool
	loadMu  sync.Mutex
	loadErr error
}

type webPushConfig struct {
	publicKey  string
	privateKey string
	subject    string
}

// NewWebPusher returns a WebPusher that lazily reads VAPID env vars on first
// Send. Mirrors `configure()` in push.ts.
func NewWebPusher() *WebPusher {
	return &WebPusher{}
}

// load reads + memoizes env. Idempotent. Errors propagate to Send.
func (w *WebPusher) load() error {
	w.loadMu.Lock()
	defer w.loadMu.Unlock()
	if w.loaded {
		return w.loadErr
	}
	w.loaded = true

	pub := firstEnv("VAPID_PUBLIC_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY")
	priv := os.Getenv("VAPID_PRIVATE_KEY")
	subj := os.Getenv("VAPID_SUBJECT")
	if subj == "" {
		subj = "mailto:admin@example.com"
	}
	if pub == "" || priv == "" {
		w.loadErr = errors.New("web push not configured")
		return w.loadErr
	}
	w.cfg = webPushConfig{publicKey: pub, privateKey: priv, subject: subj}
	return nil
}

// Configured reports whether the env-derived config is usable.
func (w *WebPusher) Configured() bool {
	if err := w.load(); err != nil {
		return false
	}
	return true
}

// SendWeb pushes a notification to a single subscription. Mirrors `sendPush`
// in website/src/lib/push.ts: returns Gone:true on HTTP 404/410 so the caller
// can delete the row.
func (w *WebPusher) SendWeb(sub WebSub, payload Payload) Result {
	if err := w.load(); err != nil {
		return notConfigured("web push")
	}
	if sub.Endpoint == "" || sub.P256dh == "" || sub.Auth == "" {
		return Result{Ok: false, Error: "non-web subscription"}
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return Result{Ok: false, Error: err.Error()}
	}

	resp, err := webpush.SendNotification(body, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}, &webpush.Options{
		Subscriber:      w.cfg.subject,
		VAPIDPublicKey:  w.cfg.publicKey,
		VAPIDPrivateKey: w.cfg.privateKey,
		TTL:             60 * 60 * 24,
	})
	if err != nil {
		return Result{Ok: false, Error: err.Error()}
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return Result{Ok: true}
	}

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone {
		msg := string(bytes.TrimSpace(respBody))
		if msg == "" {
			msg = "gone"
		}
		return Result{Ok: false, Gone: true, Error: msg}
	}
	return Result{Ok: false, Error: string(respBody)}
}

// firstEnv returns the value of the first env var in the list that's set
// non-empty. Used to keep parity with the TS code's `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
// while preferring the new server-side `VAPID_PUBLIC_KEY`.
func firstEnv(keys ...string) string {
	for _, k := range keys {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return ""
}
