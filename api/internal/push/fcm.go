package push

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// FCMPusher mints OAuth2 access tokens from a Google service account and POSTs
// to FCM v1's `messages:send`. Mirrors website/src/lib/push-fcm.ts byte-for-byte.
//
// Env required (else SendFCM returns notConfigured):
//
//	FCM_SERVICE_ACCOUNT_JSON  — full JSON service account, single-line
//
// Optional:
//
//	FCM_PROJECT_ID  — overrides the project_id field in the JSON
type FCMPusher struct {
	loadOnce sync.Once
	loadErr  error
	sa       *serviceAccount
	project  string

	httpClient *http.Client

	// Test hooks: if set, the OAuth2 mint + send hit these URLs instead of
	// the production endpoints. Used by fcm_test.go.
	tokenURL string
	sendURL  string

	tokenMu     sync.Mutex
	cachedToken cachedToken
}

type serviceAccount struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	ProjectID   string `json:"project_id"`
	TokenURI    string `json:"token_uri"`
}

type cachedToken struct {
	token     string
	expiresAt time.Time
}

// NewFCMPusher returns a pusher with deferred init (env read on first Send).
func NewFCMPusher() *FCMPusher {
	return &FCMPusher{
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
}

func (f *FCMPusher) load() error {
	f.loadOnce.Do(func() {
		raw := os.Getenv("FCM_SERVICE_ACCOUNT_JSON")
		if raw == "" {
			f.loadErr = errors.New("fcm not configured")
			return
		}
		var sa serviceAccount
		if err := json.Unmarshal([]byte(raw), &sa); err != nil {
			f.loadErr = fmt.Errorf("fcm parse service account: %w", err)
			return
		}
		if sa.ClientEmail == "" || sa.PrivateKey == "" || sa.ProjectID == "" {
			f.loadErr = errors.New("fcm service account missing required fields")
			return
		}
		if sa.TokenURI == "" {
			sa.TokenURI = "https://oauth2.googleapis.com/token"
		}
		f.sa = &sa
		f.project = os.Getenv("FCM_PROJECT_ID")
		if f.project == "" {
			f.project = sa.ProjectID
		}
	})
	return f.loadErr
}

// Configured reports whether the env-derived config is usable.
func (f *FCMPusher) Configured() bool {
	return f.load() == nil
}

// getAccessToken mints (or returns cached) an OAuth2 access token. Cached
// until 1 minute before expiry, matching push-fcm.ts.
func (f *FCMPusher) getAccessToken(ctx context.Context) (string, error) {
	f.tokenMu.Lock()
	defer f.tokenMu.Unlock()

	if f.cachedToken.token != "" && time.Until(f.cachedToken.expiresAt) > time.Minute {
		return f.cachedToken.token, nil
	}

	rsaKey, err := jwt.ParseRSAPrivateKeyFromPEM([]byte(f.sa.PrivateKey))
	if err != nil {
		return "", fmt.Errorf("fcm parse private key: %w", err)
	}

	tokenURL := f.sa.TokenURI
	if f.tokenURL != "" {
		tokenURL = f.tokenURL
	}

	now := time.Now().Unix()
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, jwt.MapClaims{
		"iss":   f.sa.ClientEmail,
		"scope": "https://www.googleapis.com/auth/firebase.messaging",
		"aud":   tokenURL,
		"iat":   now,
		"exp":   now + 3600,
	})
	assertion, err := tok.SignedString(rsaKey)
	if err != nil {
		return "", fmt.Errorf("fcm sign jwt: %w", err)
	}

	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", assertion)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("fcm token mint %d: %s", resp.StatusCode, string(body))
	}
	var parsed struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("fcm token decode: %w", err)
	}
	if parsed.AccessToken == "" {
		return "", errors.New("fcm token mint returned empty access_token")
	}
	ttl := parsed.ExpiresIn
	if ttl <= 0 {
		ttl = 3500
	}
	f.cachedToken = cachedToken{
		token:     parsed.AccessToken,
		expiresAt: time.Now().Add(time.Duration(ttl) * time.Second),
	}
	return parsed.AccessToken, nil
}

// fcmMessage mirrors the TS body. `data` is omitted when URL is empty.
type fcmMessage struct {
	Message fcmMessageInner `json:"message"`
}
type fcmMessageInner struct {
	Token        string                 `json:"token"`
	Notification fcmNotification        `json:"notification"`
	Data         map[string]string      `json:"data,omitempty"`
	Android      fcmAndroid             `json:"android"`
	Apns         map[string]any         `json:"apns"`
}
type fcmNotification struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}
type fcmAndroid struct {
	Priority     string                 `json:"priority"`
	Notification map[string]any         `json:"notification"`
}

// SendFCM pushes to a single registration token. Mirrors `sendFcmPush`:
// HTTP 404 OR error body matching UNREGISTERED|NOT_FOUND → Gone:true.
func (f *FCMPusher) SendFCM(registrationToken string, payload Payload) Result {
	if err := f.load(); err != nil {
		return notConfigured("fcm")
	}
	if registrationToken == "" {
		return Result{Ok: false, Error: "empty fcm registration token"}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	accessToken, err := f.getAccessToken(ctx)
	if err != nil {
		return Result{Ok: false, Error: err.Error()}
	}

	msg := fcmMessage{
		Message: fcmMessageInner{
			Token: registrationToken,
			Notification: fcmNotification{
				Title: payload.Title,
				Body:  payload.Body,
			},
			Android: fcmAndroid{
				Priority: "HIGH",
				Notification: map[string]any{
					"tag": nilIfEmpty(payload.Tag),
				},
			},
			Apns: map[string]any{
				"payload": map[string]any{
					"aps": map[string]any{
						"sound": "default",
					},
				},
			},
		},
	}
	if payload.URL != "" {
		msg.Message.Data = map[string]string{"url": payload.URL}
	}

	body, err := json.Marshal(msg)
	if err != nil {
		return Result{Ok: false, Error: err.Error()}
	}

	sendURL := f.sendURL
	if sendURL == "" {
		sendURL = fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", f.project)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sendURL, bytes.NewReader(body))
	if err != nil {
		return Result{Ok: false, Error: err.Error()}
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := f.httpClient.Do(req)
	if err != nil {
		return Result{Ok: false, Error: err.Error()}
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8192))
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return Result{Ok: true}
	}
	bodyStr := string(respBody)
	if resp.StatusCode == http.StatusNotFound ||
		strings.Contains(bodyStr, "UNREGISTERED") ||
		strings.Contains(bodyStr, "NOT_FOUND") {
		return Result{Ok: false, Gone: true, Error: bodyStr}
	}
	return Result{Ok: false, Error: fmt.Sprintf("FCM %d: %s", resp.StatusCode, bodyStr)}
}

// nilIfEmpty returns nil for an empty string so the JSON encoder emits null.
// Mirrors the TS `tag: payload.tag` where undefined → null.
func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
