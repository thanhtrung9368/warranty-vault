package push

import (
	"fmt"
	"strings"
)

// Subscription is the platform-agnostic descriptor of one push target. Mirrors
// the relevant columns of "PushSubscription" in the DB (and the TS
// `services/push.ts::endpointFor` encoding for native platforms).
//
// For platform == "web", the W3C subscription bits live in P256dh + Auth and
// Endpoint is the browser's push gateway URL.
//
// For platform == "apns" or "fcm", the bare device token / FCM registration
// token is encoded in Endpoint as `<platform>://<token>` per the TS
// convention. P256dh + Auth are unused.
type Subscription struct {
	ID       string
	Platform string  // "web" | "apns" | "fcm"
	Endpoint string  //
	P256dh   *string // web only — pointer matches the sqlc-generated nullable column
	Auth     *string // web only
}

// WebTransport, APNsTransport, FCMTransport are the per-platform contracts the
// dispatcher depends on. Tests inject stubs; production wires the concrete
// *WebPusher / *APNsPusher / *FCMPusher.
type WebTransport interface {
	SendWeb(sub WebSub, payload Payload) Result
}

type APNsTransport interface {
	SendAPNS(deviceToken string, payload Payload) Result
}

type FCMTransport interface {
	SendFCM(registrationToken string, payload Payload) Result
}

// Dispatcher fans out one Payload across the per-platform pushers (web, apns,
// fcm) based on Subscription.Platform. Mirrors `sendToSubscription` in
// website/src/lib/push-fanout.ts.
//
// A Dispatcher returned by NewFromEnv() lazily reads each transport's env
// vars; transports that aren't configured return a not-configured Result on
// Send (Result.Ok == false, Result.Gone == false). Callers (the cron) only
// delete a PushSubscription row when Result.Gone == true.
type Dispatcher struct {
	Web  WebTransport
	APNs APNsTransport
	FCM  FCMTransport
}

// NewFromEnv constructs a Dispatcher whose transports lazily read env on the
// first matching Send. Safe to call at process start even if no env is set —
// each platform fails-closed with a not-configured Result, never panics.
func NewFromEnv() *Dispatcher {
	return &Dispatcher{
		Web:  NewWebPusher(),
		APNs: NewAPNsPusher(),
		FCM:  NewFCMPusher(),
	}
}

// Send routes payload to the right transport based on sub.Platform.
//   - "web"  → SendWeb (VAPID web push)
//   - "apns" → APNs HTTP/2 (token stripped from "apns://<token>" prefix)
//   - "fcm"  → FCM v1 (token stripped from "fcm://<token>" prefix)
//
// Anything else returns Ok:false with an "unknown platform" error matching
// the TS fanout's wording.
func (d *Dispatcher) Send(sub Subscription, payload Payload) Result {
	switch sub.Platform {
	case "web", "":
		// Empty platform falls through to web for parity with the TS default.
		if d.Web == nil {
			return Result{Ok: false, Error: "web transport not initialized"}
		}
		return d.Web.SendWeb(WebSub{
			Endpoint: sub.Endpoint,
			P256dh:   derefString(sub.P256dh),
			Auth:     derefString(sub.Auth),
		}, payload)
	case "apns":
		if d.APNs == nil {
			return Result{Ok: false, Error: "apns transport not initialized"}
		}
		token, ok := tokenFromEndpoint(sub.Endpoint, "apns://")
		if !ok {
			return Result{Ok: false, Error: "invalid apns endpoint"}
		}
		return d.APNs.SendAPNS(token, payload)
	case "fcm":
		if d.FCM == nil {
			return Result{Ok: false, Error: "fcm transport not initialized"}
		}
		token, ok := tokenFromEndpoint(sub.Endpoint, "fcm://")
		if !ok {
			return Result{Ok: false, Error: "invalid fcm endpoint"}
		}
		return d.FCM.SendFCM(token, payload)
	default:
		return Result{Ok: false, Error: fmt.Sprintf("unknown platform: %s", sub.Platform)}
	}
}

func tokenFromEndpoint(endpoint, prefix string) (string, bool) {
	if !strings.HasPrefix(endpoint, prefix) {
		return "", false
	}
	tok := strings.TrimPrefix(endpoint, prefix)
	if tok == "" {
		return "", false
	}
	return tok, true
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
