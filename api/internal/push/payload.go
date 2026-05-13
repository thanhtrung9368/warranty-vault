// Package push dispatches notifications across web push (VAPID), APNs, and
// FCM v1. Mirrors website/src/lib/push.ts + push-apns.ts + push-fcm.ts +
// push-fanout.ts byte-for-byte (same JSON shapes, same gone-detection rules,
// same env vars).
//
// Public surface used by the cron command:
//
//	d := push.NewFromEnv()
//	res := d.Send(push.Subscription{...}, push.Payload{...})
//	if res.Gone { /* delete the row */ }
package push

// Payload is the user-visible notification body. Mirrors PushPayload in
// website/src/lib/push.ts.
type Payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url,omitempty"`
	Tag   string `json:"tag,omitempty"`
}

// Result is the per-send outcome the dispatcher returns. Mirrors the TS
// `{ ok, gone?, error? }` envelope.
type Result struct {
	Ok    bool
	Gone  bool   // 404/410 (web/apns) or NOT_FOUND/UNREGISTERED (fcm) → caller deletes row
	Error string // human-readable, may include upstream body
}

// notConfigured is the canonical "transport disabled by missing env" result.
// Mirrors the TS pattern of returning ok:false with a "*not configured" error
// rather than panicking.
func notConfigured(transport string) Result {
	return Result{Ok: false, Error: transport + " not configured"}
}
