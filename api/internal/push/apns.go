package push

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sync"

	"github.com/sideshow/apns2"
	"github.com/sideshow/apns2/token"
)

// APNsPusher wraps an apns2.Client with lazy env-driven init. The underlying
// library handles JWT minting, the 50-minute cache, and HTTP/2 multiplexing.
// Env required (else SendAPNS returns notConfigured):
//
//	APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_PRIVATE_KEY (.p8 contents)
//	APNS_PRODUCTION="1" → prod gateway, anything else → sandbox
type APNsPusher struct {
	loadOnce sync.Once
	client   *apns2.Client
	bundleID string
	loadErr  error
}

// NewAPNsPusher returns a pusher with deferred init.
func NewAPNsPusher() *APNsPusher {
	return &APNsPusher{}
}

func (a *APNsPusher) load() error {
	a.loadOnce.Do(func() {
		keyID := os.Getenv("APNS_KEY_ID")
		teamID := os.Getenv("APNS_TEAM_ID")
		bundleID := os.Getenv("APNS_BUNDLE_ID")
		keyPEM := os.Getenv("APNS_PRIVATE_KEY")
		if keyID == "" || teamID == "" || bundleID == "" || keyPEM == "" {
			a.loadErr = errors.New("apns not configured")
			return
		}
		authKey, err := token.AuthKeyFromBytes([]byte(keyPEM))
		if err != nil {
			a.loadErr = fmt.Errorf("apns parse key: %w", err)
			return
		}
		tok := &token.Token{
			AuthKey: authKey,
			KeyID:   keyID,
			TeamID:  teamID,
		}
		client := apns2.NewTokenClient(tok)
		if os.Getenv("APNS_PRODUCTION") == "1" {
			client = client.Production()
		} else {
			client = client.Development()
		}
		a.client = client
		a.bundleID = bundleID
	})
	return a.loadErr
}

// Configured reports whether the env-derived config is usable.
func (a *APNsPusher) Configured() bool {
	return a.load() == nil
}

// apnsBody mirrors the JSON the TS sender produces.
type apnsBody struct {
	Aps apnsAps `json:"aps"`
	URL string  `json:"url,omitempty"`
}

type apnsAps struct {
	Alert    apnsAlert `json:"alert"`
	Sound    string    `json:"sound"`
	ThreadID string    `json:"thread-id"`
}

type apnsAlert struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// SendAPNS pushes to a single device token. Mirrors `sendApnsPush`:
// 410 → Gone:true, anything else non-2xx is a soft error.
func (a *APNsPusher) SendAPNS(deviceToken string, payload Payload) Result {
	if err := a.load(); err != nil {
		return notConfigured("apns")
	}
	if deviceToken == "" {
		return Result{Ok: false, Error: "empty apns device token"}
	}

	tag := payload.Tag
	if tag == "" {
		tag = "default"
	}

	body, err := json.Marshal(apnsBody{
		Aps: apnsAps{
			Alert:    apnsAlert{Title: payload.Title, Body: payload.Body},
			Sound:    "default",
			ThreadID: tag,
		},
		URL: payload.URL,
	})
	if err != nil {
		return Result{Ok: false, Error: err.Error()}
	}

	n := &apns2.Notification{
		DeviceToken: deviceToken,
		Topic:       a.bundleID,
		Payload:     body,
		Priority:    apns2.PriorityHigh,
		PushType:    apns2.PushTypeAlert,
	}
	if payload.Tag != "" {
		n.CollapseID = payload.Tag
	}

	resp, err := a.client.Push(n)
	if err != nil {
		return Result{Ok: false, Error: err.Error()}
	}
	if resp.StatusCode == http.StatusOK {
		return Result{Ok: true}
	}
	if resp.StatusCode == http.StatusGone {
		return Result{Ok: false, Gone: true, Error: resp.Reason}
	}
	return Result{Ok: false, Error: fmt.Sprintf("APNs %d: %s", resp.StatusCode, resp.Reason)}
}
