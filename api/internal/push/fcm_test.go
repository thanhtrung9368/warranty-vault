package push

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// makeFakeServiceAccount produces a JSON service-account blob signed by an
// in-memory RSA key. The same key is returned so the test server can verify
// the JWT assertion the FCMPusher mints.
func makeFakeServiceAccount(t *testing.T, tokenURI string) (string, *rsa.PrivateKey) {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("MarshalPKCS8PrivateKey: %v", err)
	}
	pemKey := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))

	sa := map[string]string{
		"client_email": "fake@fake.iam.gserviceaccount.com",
		"private_key":  pemKey,
		"project_id":   "fake-proj",
		"token_uri":    tokenURI,
	}
	raw, err := json.Marshal(sa)
	if err != nil {
		t.Fatalf("marshal sa: %v", err)
	}
	return string(raw), priv
}

func TestFCM_NotConfigured(t *testing.T) {
	t.Setenv("FCM_SERVICE_ACCOUNT_JSON", "")
	p := NewFCMPusher()
	res := p.SendFCM("token", Payload{Title: "x"})
	if res.Ok || res.Gone {
		t.Fatalf("expected not-configured, got %+v", res)
	}
	if !strings.Contains(res.Error, "fcm not configured") {
		t.Fatalf("error should be 'fcm not configured', got %q", res.Error)
	}
}

func TestFCM_MintsTokenAndSends(t *testing.T) {
	// Stand up a fake OAuth2 token endpoint + a fake FCM messages:send.
	var (
		tokenCalls int32
		sendBody   atomic.Value // string
	)

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&tokenCalls, 1)
		if err := r.ParseForm(); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		assertion := r.PostForm.Get("assertion")
		if assertion == "" {
			http.Error(w, "no assertion", 400)
			return
		}
		// Don't verify signature here — we just want to confirm the dispatcher
		// minted a JWT with the expected claims shape.
		parser := jwt.NewParser()
		var claims jwt.MapClaims
		if _, _, err := parser.ParseUnverified(assertion, &claims); err != nil {
			http.Error(w, "bad jwt: "+err.Error(), 400)
			return
		}
		if claims["iss"] != "fake@fake.iam.gserviceaccount.com" {
			http.Error(w, "wrong iss", 400)
			return
		}
		if claims["scope"] != "https://www.googleapis.com/auth/firebase.messaging" {
			http.Error(w, "wrong scope", 400)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "fake-access-token",
			"expires_in":   3600,
			"token_type":   "Bearer",
		})
	}))
	defer tokenSrv.Close()

	sendSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer fake-access-token" {
			http.Error(w, "bad auth: "+got, http.StatusUnauthorized)
			return
		}
		body, _ := io.ReadAll(r.Body)
		sendBody.Store(string(body))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"name":"projects/fake-proj/messages/123"}`))
	}))
	defer sendSrv.Close()

	saJSON, _ := makeFakeServiceAccount(t, tokenSrv.URL)
	t.Setenv("FCM_SERVICE_ACCOUNT_JSON", saJSON)

	p := NewFCMPusher()
	p.sendURL = sendSrv.URL
	p.tokenURL = tokenSrv.URL

	res := p.SendFCM("device-reg-token", Payload{
		Title: "Hi", Body: "world", URL: "/dashboard", Tag: "test",
	})
	if !res.Ok {
		t.Fatalf("expected Ok, got %+v", res)
	}

	body, _ := sendBody.Load().(string)
	if !strings.Contains(body, `"token":"device-reg-token"`) {
		t.Fatalf("body missing token: %s", body)
	}
	if !strings.Contains(body, `"title":"Hi"`) || !strings.Contains(body, `"body":"world"`) {
		t.Fatalf("body missing notification: %s", body)
	}
	if !strings.Contains(body, `"url":"/dashboard"`) {
		t.Fatalf("body missing data.url: %s", body)
	}
	if !strings.Contains(body, `"priority":"HIGH"`) {
		t.Fatalf("body missing android priority: %s", body)
	}

	// Second send should reuse the cached access token (no extra mint).
	res2 := p.SendFCM("device-reg-token", Payload{Title: "again", Body: "x"})
	if !res2.Ok {
		t.Fatalf("second send failed: %+v", res2)
	}
	if got := atomic.LoadInt32(&tokenCalls); got != 1 {
		t.Fatalf("expected token mint once (cached), got %d calls", got)
	}
}

func TestFCM_GoneOnUnregistered(t *testing.T) {
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "tok",
			"expires_in":   3600,
		})
	}))
	defer tokenSrv.Close()

	sendSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":{"status":"NOT_FOUND","message":"requested entity not found"}}`))
	}))
	defer sendSrv.Close()

	saJSON, _ := makeFakeServiceAccount(t, tokenSrv.URL)
	t.Setenv("FCM_SERVICE_ACCOUNT_JSON", saJSON)

	p := NewFCMPusher()
	p.sendURL = sendSrv.URL
	p.tokenURL = tokenSrv.URL

	res := p.SendFCM("dead-token", Payload{Title: "x", Body: "y"})
	if res.Ok || !res.Gone {
		t.Fatalf("expected Gone, got %+v", res)
	}
}

func TestFCM_GoneOnUnregisteredBody(t *testing.T) {
	// Some error responses come back as 200/4xx with UNREGISTERED in the body.
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "tok",
			"expires_in":   3600,
		})
	}))
	defer tokenSrv.Close()

	sendSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"status":"INVALID_ARGUMENT","details":[{"errorCode":"UNREGISTERED"}]}}`))
	}))
	defer sendSrv.Close()

	saJSON, _ := makeFakeServiceAccount(t, tokenSrv.URL)
	t.Setenv("FCM_SERVICE_ACCOUNT_JSON", saJSON)

	p := NewFCMPusher()
	p.sendURL = sendSrv.URL
	p.tokenURL = tokenSrv.URL

	res := p.SendFCM("dead-token", Payload{Title: "x", Body: "y"})
	if res.Ok || !res.Gone {
		t.Fatalf("expected Gone via UNREGISTERED body, got %+v", res)
	}
}

func TestFCM_PayloadShape(t *testing.T) {
	// Verify the body matches the TS shape exactly: notification has no tag,
	// android.notification.tag carries it, apns.payload.aps.sound = default.
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "tok", "expires_in": 3600})
	}))
	defer tokenSrv.Close()

	var captured atomic.Value
	sendSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		captured.Store(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer sendSrv.Close()

	saJSON, _ := makeFakeServiceAccount(t, tokenSrv.URL)
	t.Setenv("FCM_SERVICE_ACCOUNT_JSON", saJSON)

	p := NewFCMPusher()
	p.sendURL = sendSrv.URL
	p.tokenURL = tokenSrv.URL

	if res := p.SendFCM("tk", Payload{Title: "T", Body: "B", URL: "/u", Tag: "warranty-7"}); !res.Ok {
		t.Fatalf("send failed: %+v", res)
	}

	raw, _ := captured.Load().([]byte)
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal body: %v\n%s", err, string(raw))
	}

	msg, ok := got["message"].(map[string]any)
	if !ok {
		t.Fatalf("missing message: %v", got)
	}
	if msg["token"] != "tk" {
		t.Fatalf("token mismatch: %v", msg["token"])
	}
	notif, _ := msg["notification"].(map[string]any)
	if notif["title"] != "T" || notif["body"] != "B" {
		t.Fatalf("notification mismatch: %v", notif)
	}
	data, _ := msg["data"].(map[string]any)
	if data["url"] != "/u" {
		t.Fatalf("data.url mismatch: %v", data)
	}
	android, _ := msg["android"].(map[string]any)
	if android["priority"] != "HIGH" {
		t.Fatalf("priority: %v", android)
	}
	andNotif, _ := android["notification"].(map[string]any)
	if andNotif["tag"] != "warranty-7" {
		t.Fatalf("android tag: %v", andNotif)
	}
	apns, _ := msg["apns"].(map[string]any)
	apnsPayload, _ := apns["payload"].(map[string]any)
	aps, _ := apnsPayload["aps"].(map[string]any)
	if aps["sound"] != "default" {
		t.Fatalf("apns sound: %v", aps)
	}
}

// makeTokenURL builds a token URL with a query param; only used to satisfy
// importing url + time + fmt linting in case other helpers are dropped.
func makeTokenURL(host string) string {
	u, _ := url.Parse(host)
	u.RawQuery = fmt.Sprintf("ts=%d", time.Now().Unix())
	return u.String()
}

var _ = makeTokenURL
