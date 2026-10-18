package handlers

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/ratelimit"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// POST /api/v1/inbox/email over the real HTTP surface (migration 0020).
//
// This file pins the wire contract: the shared-secret header, the two request
// shapes, the 503/401/404/429 cases, partial delivery with reasons, and the
// guarantee that a mail-delivered attachment is the same AttachmentMeta / same
// row as a POST /api/v1/attachments upload. The storage rules themselves are
// asserted in internal/services/inbound_email_test.go.

const (
	itSecret = "test-inbox-shared-secret"
	itDomain = "inbox.warrly.test"
)

type inboxEmailEnv struct {
	mux       *http.ServeMux
	pool      *pgxpool.Pool
	userID    string
	device    string
	bearer    string
	inboxAddr string // <token>@<domain>
}

type inboundPart struct {
	filename    string
	contentType string
	body        []byte
}

func setupInboxEmailEnv(t *testing.T, limiter ratelimit.Limiter) *inboxEmailEnv {
	t.Helper()
	dsn := testDatabaseURL(t) // a fresh scratch database per handler test
	gooseUp(t, dsn)
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir())
	t.Setenv("FILE_MASTER_KEY", "3q2+7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	t.Setenv("INBOX_EMAIL_TOKEN", itSecret)
	t.Setenv("INBOX_EMAIL_DOMAIN", itDomain)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect scratch: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userID = "zz_test_inbox_email_user"
		device = "zz_test_inbox_email_dev"
	)
	insertUser(t, pool, userID, "inbox-email@example.invalid", "x")
	deleteUsers(t, pool, userID)
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Thiết bị test', 'PHONE', NOW(), 0, NOW())`, device, userID); err != nil {
		t.Fatalf("insert device: %v", err)
	}

	var inboxToken string
	if err := pool.QueryRow(ctx,
		`SELECT "inboxToken" FROM "User" WHERE id = $1`, userID).Scan(&inboxToken); err != nil {
		t.Fatalf("read inboxToken: %v", err)
	}
	issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	mux := http.NewServeMux()
	deps := Deps{DB: pool, Limiter: limiter}
	RegisterAttachments(mux, deps)
	RegisterInboxEmail(mux, deps)
	// GET /auth/me is registered by main.go without the shared middleware, so the
	// bare handler is enough here.
	mux.HandleFunc("GET /api/v1/auth/me", Me(deps))

	return &inboxEmailEnv{
		mux:       mux,
		pool:      pool,
		userID:    userID,
		device:    device,
		bearer:    issued.AccessToken,
		inboxAddr: inboxToken + "@" + itDomain,
	}
}

func (e *inboxEmailEnv) postInbound(t *testing.T, secret, lang, contentType string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/inbox/email?lang="+lang, bytes.NewReader(body))
	req.Header.Set("Content-Type", contentType)
	if secret != "" {
		req.Header.Set(inboxTokenHeader, secret)
	}
	rr := httptest.NewRecorder()
	e.mux.ServeHTTP(rr, req)
	return rr
}

func (e *inboxEmailEnv) getAs(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+e.bearer)
	rr := httptest.NewRecorder()
	e.mux.ServeHTTP(rr, req)
	return rr
}

func multipartInboundBody(t *testing.T, fields map[string]string, files []inboundPart) ([]byte, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			t.Fatalf("write field %s: %v", k, err)
		}
	}
	for _, f := range files {
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition",
			fmt.Sprintf(`form-data; name="attachment"; filename=%q`, f.filename))
		if f.contentType != "" {
			header.Set("Content-Type", f.contentType)
		}
		part, err := mw.CreatePart(header)
		if err != nil {
			t.Fatalf("create attachment part: %v", err)
		}
		if _, err := part.Write(f.body); err != nil {
			t.Fatalf("write attachment part: %v", err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	return buf.Bytes(), mw.FormDataContentType()
}

func inboundJSONBody(t *testing.T, to string, attachments []map[string]string) []byte {
	t.Helper()
	payload := map[string]any{
		"to":          to,
		"from":        "shop@example.invalid",
		"subject":     "Hoá đơn",
		"attachments": attachments,
	}
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal inbound json: %v", err)
	}
	return b
}

type inboundResponse struct {
	OK          bool `json:"ok"`
	Attachments []struct {
		ID          string  `json:"id"`
		FileName    string  `json:"fileName"`
		FileType    string  `json:"fileType"`
		FileSize    int32   `json:"fileSize"`
		Description *string `json:"description"`
		UploadedAt  string  `json:"uploadedAt"`
	} `json:"attachments"`
	Skipped []struct {
		FileName string `json:"fileName"`
		Code     string `json:"code"`
		Reason   string `json:"reason"`
	} `json:"skipped"`
	Received     int `json:"received"`
	Stored       int `json:"stored"`
	SkippedCount int `json:"skippedCount"`
}

func decodeInboundResponse(t *testing.T, rr *httptest.ResponseRecorder) inboundResponse {
	t.Helper()
	var out inboundResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode inbound response %q: %v", rr.Body.String(), err)
	}
	return out
}

type apiErrorBody struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

func decodeAPIError(t *testing.T, rr *httptest.ResponseRecorder) apiErrorBody {
	t.Helper()
	var out apiErrorBody
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode error body %q: %v", rr.Body.String(), err)
	}
	return out
}

func inboundPDFForHandler(t *testing.T, label string) []byte {
	t.Helper()
	return []byte("%PDF-1.4\n% " + label +
		"\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")
}

func tinyPNGBytesForInbound(t *testing.T) []byte { return tinyPNGForHandler(t) }

// ---- shared-secret comparison ------------------------------------------------

func TestInboxTokenMatches(t *testing.T) {
	const secret = "correct-horse-battery-staple"
	for _, tc := range []struct {
		name string
		got  string
		want string
		ok   bool
	}{
		{name: "exact", got: secret, want: secret, ok: true},
		{name: "surrounding spaces trimmed", got: "  " + secret + "\n", want: secret, ok: true},
		{name: "wrong", got: "correct-horse-battery-stapl", want: secret, ok: false},
		{name: "case sensitive", got: "Correct-Horse-Battery-Staple", want: secret, ok: false},
		{name: "empty header", got: "", want: secret, ok: false},
		{name: "empty configured secret never matches", got: "", want: "", ok: false},
		{name: "different length", got: secret + "x", want: secret, ok: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := inboxTokenMatches(tc.got, tc.want); got != tc.ok {
				t.Fatalf("inboxTokenMatches(%q, %q) = %v, want %v", tc.got, tc.want, got, tc.ok)
			}
		})
	}
}

func TestInboxEmailRejectsBadSecret(t *testing.T) {
	t.Setenv("INBOX_EMAIL_TOKEN", itSecret)
	t.Setenv("INBOX_EMAIL_DOMAIN", itDomain)
	mux := http.NewServeMux()
	// nil DB is safe: the secret check runs before any storage work.
	RegisterInboxEmail(mux, Deps{Limiter: &permissiveLimiter{}})
	body := inboundJSONBody(t, "someone@"+itDomain, nil)

	post := func(secret string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/inbox/email?lang=en", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if secret != "" {
			req.Header.Set(inboxTokenHeader, secret)
		}
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)
		return rr
	}

	wrong := post("not-the-secret")
	missing := post("")
	for _, tc := range []struct {
		name string
		rr   *httptest.ResponseRecorder
	}{{"wrong", wrong}, {"missing", missing}} {
		if tc.rr.Code != http.StatusUnauthorized {
			t.Fatalf("%s secret: status = %d, want 401 (%s)", tc.name, tc.rr.Code, tc.rr.Body.String())
		}
		got := decodeAPIError(t, tc.rr)
		if got.Error != "unauthorized" {
			t.Errorf("%s secret: error = %q, want unauthorized", tc.name, got.Error)
		}
		if got.Message != "Invalid inbox token" {
			t.Errorf("%s secret: message = %q, want the English catalog string", tc.name, got.Message)
		}
	}
	// The response must not tell the caller how long the configured secret is.
	if strings.Contains(wrong.Body.String(), itSecret) || strings.Contains(wrong.Body.String(), "test-inbox") {
		t.Errorf("401 body leaked the configured secret: %s", wrong.Body.String())
	}
	if wrong.Body.String() != missing.Body.String() {
		t.Errorf("wrong and missing secret got different bodies:\n wrong  = %s\n missing= %s", wrong.Body.String(), missing.Body.String())
	}
}

// ---- disabled feature -------------------------------------------------------

func TestInboxEmailReturns503WhenUnconfigured(t *testing.T) {
	for _, tc := range []struct {
		name   string
		token  string
		domain string
	}{
		{name: "no token", token: "", domain: itDomain},
		{name: "no domain", token: itSecret, domain: ""},
		{name: "neither", token: "", domain: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("INBOX_EMAIL_TOKEN", tc.token)
			t.Setenv("INBOX_EMAIL_DOMAIN", tc.domain)
			mux := http.NewServeMux()
			RegisterInboxEmail(mux, Deps{}) // nil DB and nil limiter: 503 must short-circuit
			req := httptest.NewRequest(http.MethodPost, "/api/v1/inbox/email?lang=en",
				bytes.NewReader(inboundJSONBody(t, "someone@inbox.warrly.test", nil)))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set(inboxTokenHeader, itSecret)
			rr := httptest.NewRecorder()
			mux.ServeHTTP(rr, req)

			if rr.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503 (%s)", rr.Code, rr.Body.String())
			}
			got := decodeAPIError(t, rr)
			if got.Error != "feature_disabled" {
				t.Errorf("error = %q, want feature_disabled", got.Error)
			}
			if got.Message != "Inbound email is not configured" {
				t.Errorf("message = %q, want the English catalog string", got.Message)
			}
		})
	}
}

// ---- address routing / 404 oracle ------------------------------------------

func TestInboxEmailUnknownRecipientIsTheSame404Everywhere(t *testing.T) {
	env := setupInboxEmailEnv(t, &permissiveLimiter{})
	// A valid-looking address that belongs to nobody.
	unknown := "00000000000000000000000000000000@" + itDomain
	// The real token at the wrong domain.
	wrongDomain := strings.Replace(env.inboxAddr, "@"+itDomain, "@elsewhere.test", 1)
	cases := []string{unknown, wrongDomain, "not-an-address", "someone@elsewhere.test"}

	var first string
	for i, to := range cases {
		rr := env.postInbound(t, itSecret, "en", "application/json", inboundJSONBody(t, to, nil))
		if rr.Code != http.StatusNotFound {
			t.Fatalf("to=%q: status = %d, want 404 (%s)", to, rr.Code, rr.Body.String())
		}
		got := decodeAPIError(t, rr)
		if got.Error != "not_found" {
			t.Errorf("to=%q: error = %q, want not_found", to, got.Error)
		}
		if got.Message != "Unknown recipient address" {
			t.Errorf("to=%q: message = %q, want the neutral English sentence", to, got.Message)
		}
		if i == 0 {
			first = rr.Body.String()
			continue
		}
		if rr.Body.String() != first {
			t.Errorf("404 bodies differ for %q:\n first = %s\n got   = %s", to, first, rr.Body.String())
		}
	}
	// No leak of the real account's token, id or email anywhere in the body.
	for _, forbidden := range []string{env.inboxAddr, env.userID, "inbox-email@example.invalid"} {
		if strings.Contains(first, forbidden) {
			t.Errorf("404 body leaked %q: %s", forbidden, first)
		}
	}
}

// ---- success / partial delivery --------------------------------------------

func TestInboxEmailDeliversThreePDFsOverMultipart(t *testing.T) {
	env := setupInboxEmailEnv(t, &permissiveLimiter{})
	pdfs := [][]byte{
		inboundPDFForHandler(t, "one"),
		inboundPDFForHandler(t, "two"),
		inboundPDFForHandler(t, "three"),
	}
	body, ct := multipartInboundBody(t,
		map[string]string{"to": env.inboxAddr, "from": "shop@example.invalid", "subject": "Hoá đơn"},
		[]inboundPart{
			{filename: "hoa-don-1.pdf", contentType: "application/pdf", body: pdfs[0]},
			{filename: "hoa-don-2.pdf", contentType: "application/pdf", body: pdfs[1]},
			{filename: "hoa-don-3.pdf", contentType: "application/pdf", body: pdfs[2]},
		})

	rr := env.postInbound(t, itSecret, "en", ct, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	got := decodeInboundResponse(t, rr)
	if !got.OK || got.Received != 3 || got.Stored != 3 || got.SkippedCount != 0 {
		t.Fatalf("response = %+v, want 3/3/0", got)
	}
	if len(got.Attachments) != 3 {
		t.Fatalf("attachments = %d, want 3", len(got.Attachments))
	}
	for i, att := range got.Attachments {
		if att.FileType != "application/pdf" {
			t.Errorf("attachment %d fileType = %q, want application/pdf", i, att.FileType)
		}
		if att.FileSize != int32(len(pdfs[i])) {
			t.Errorf("attachment %d fileSize = %d, want %d", i, att.FileSize, len(pdfs[i]))
		}
		if att.ID == "" || att.UploadedAt == "" {
			t.Errorf("attachment %d is missing id/uploadedAt: %+v", i, att)
		}
	}
	if got.Skipped == nil {
		t.Error("skipped must be an empty array, not null")
	}

	inbox, err := services.ListInbox(context.Background(), env.pool, env.userID)
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if len(inbox) != 3 {
		t.Fatalf("inbox rows = %d, want 3", len(inbox))
	}
	for _, row := range inbox {
		if row.DeviceId != nil {
			t.Errorf("mail attachment %s has a deviceId, want NULL", row.ID)
		}
		if row.UserId != env.userID {
			t.Errorf("mail attachment %s owner = %q, want %q", row.ID, row.UserId, env.userID)
		}
	}

	// The normal inbox read path sees all three.
	list := env.getAs(t, "/api/v1/inbox?lang=en")
	if list.Code != http.StatusOK {
		t.Fatalf("GET /inbox = %d (%s)", list.Code, list.Body.String())
	}
	var listed struct {
		Attachments []struct {
			ID string `json:"id"`
		} `json:"attachments"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode inbox: %v", err)
	}
	if len(listed.Attachments) != 3 {
		t.Errorf("GET /inbox returned %d items, want 3", len(listed.Attachments))
	}
}

func TestInboxEmailJSONShapeSkipsBadBase64AndKeepsTheRest(t *testing.T) {
	env := setupInboxEmailEnv(t, &permissiveLimiter{})
	png := tinyPNGBytesForInbound(t)
	body := inboundJSONBody(t, env.inboxAddr, []map[string]string{
		{
			"fileName":      "good.png",
			"contentType":   "image/png",
			"contentBase64": base64.StdEncoding.EncodeToString(png),
		},
		{
			"fileName":      "bad.png",
			"contentType":   "image/png",
			"contentBase64": "!!! not base64 !!!",
		},
	})

	rr := env.postInbound(t, itSecret, "en", "application/json", body)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	got := decodeInboundResponse(t, rr)
	if got.Received != 2 || got.Stored != 1 || got.SkippedCount != 1 {
		t.Fatalf("counts = %+v, want received 2 / stored 1 / skipped 1", got)
	}
	if len(got.Attachments) != 1 || got.Attachments[0].FileName != "good.png" {
		t.Fatalf("attachments = %+v, want the good.png row", got.Attachments)
	}
	if got.Skipped[0].FileName != "bad.png" || got.Skipped[0].Code != "bad_input" {
		t.Errorf("skipped = %+v, want bad.png / bad_input", got.Skipped)
	}
	if got.Skipped[0].Reason != "Invalid base64 attachment content" {
		t.Errorf("skip reason = %q, want the English catalog string", got.Skipped[0].Reason)
	}
}

func TestInboxEmailSkipsOversizeAndWrongTypeButDeliversTheRest(t *testing.T) {
	env := setupInboxEmailEnv(t, &permissiveLimiter{})
	png := tinyPNGBytesForInbound(t)
	oversize := append(append([]byte{}, png...), bytes.Repeat([]byte{0}, services.MaxAttachmentBytes)...)

	body, ct := multipartInboundBody(t,
		map[string]string{"to": env.inboxAddr},
		[]inboundPart{
			{filename: "good.png", contentType: "image/png", body: png},
			{filename: "too-big.png", contentType: "image/png", body: oversize},
			{filename: "notes.txt", contentType: "text/plain", body: []byte("not a receipt")},
		})

	rr := env.postInbound(t, itSecret, "en", ct, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — one bad part must not fail the message (%s)", rr.Code, rr.Body.String())
	}
	got := decodeInboundResponse(t, rr)
	if got.Received != 3 || got.Stored != 1 || got.SkippedCount != 2 {
		t.Fatalf("counts = received %d / stored %d / skipped %d, want 3/1/2", got.Received, got.Stored, got.SkippedCount)
	}
	if len(got.Attachments) != 1 || got.Attachments[0].FileName != "good.png" {
		t.Fatalf("attachments = %+v, want only good.png", got.Attachments)
	}
	reasons := map[string]string{}
	for _, s := range got.Skipped {
		reasons[s.FileName] = s.Reason
		if s.Code != "bad_input" {
			t.Errorf("skipped %s code = %q, want bad_input", s.FileName, s.Code)
		}
	}
	if !strings.Contains(reasons["too-big.png"], "5 MB") {
		t.Errorf("oversize reason = %q, want the shared 5 MB message", reasons["too-big.png"])
	}
	if !strings.Contains(reasons["notes.txt"], "Only JPG/PNG/WEBP/GIF/HEIC or PDF") {
		t.Errorf("wrong-type reason = %q, want the shared MIME whitelist message", reasons["notes.txt"])
	}
	inbox, err := services.ListInbox(context.Background(), env.pool, env.userID)
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if len(inbox) != 1 || inbox[0].FileType != "image/png" {
		t.Fatalf("inbox = %+v, want exactly the PNG that passed", inbox)
	}
}

func TestInboxEmailReturns500WhenNothingCouldBeStored(t *testing.T) {
	env := setupInboxEmailEnv(t, &permissiveLimiter{})
	// Simulate a server-side failure every attachment hits. (FILE_MASTER_KEY is
	// process-cached after the first successful Upload in this test binary, so
	// blanking it would be a no-op here; an unwritable root is the reliable
	// equivalent of a disk failure.)
	blocker := filepath.Join(t.TempDir(), "blocker")
	if err := os.WriteFile(blocker, []byte("not a directory"), 0o600); err != nil {
		t.Fatalf("write blocker: %v", err)
	}
	t.Setenv("PRIVATE_UPLOAD_ROOT", filepath.Join(blocker, "uploads"))
	body, ct := multipartInboundBody(t, map[string]string{"to": env.inboxAddr},
		[]inboundPart{{filename: "receipt.png", contentType: "image/png", body: tinyPNGBytesForInbound(t)}})

	rr := env.postInbound(t, itSecret, "en", ct, body)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 so the provider retries (%s)", rr.Code, rr.Body.String())
	}
	if got := decodeAPIError(t, rr); got.Error != "internal_error" {
		t.Errorf("error = %q, want internal_error", got.Error)
	}
	// Nothing was stored, so a retry cannot duplicate anything.
	inbox, err := services.ListInbox(context.Background(), env.pool, env.userID)
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if len(inbox) != 0 {
		t.Errorf("a failed message stored %d rows", len(inbox))
	}
}

func TestInboxEmailCapsAttachmentsPerMessage(t *testing.T) {
	env := setupInboxEmailEnv(t, &permissiveLimiter{})
	parts := make([]inboundPart, services.MaxInboundEmailAttachments+1)
	for i := range parts {
		parts[i] = inboundPart{filename: fmt.Sprintf("p%d.png", i), contentType: "image/png", body: tinyPNGBytesForInbound(t)}
	}
	body, ct := multipartInboundBody(t, map[string]string{"to": env.inboxAddr}, parts)
	rr := env.postInbound(t, itSecret, "en", ct, body)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	got := decodeAPIError(t, rr)
	if got.Error != "bad_input" || !strings.Contains(got.Message, "10") {
		t.Errorf("error = %+v, want bad_input naming the cap", got)
	}
}

// ---- rate limit -------------------------------------------------------------

func TestInboxEmailIsRateLimitedPerIP(t *testing.T) {
	t.Setenv("INBOX_EMAIL_TOKEN", itSecret)
	t.Setenv("INBOX_EMAIL_DOMAIN", itDomain)
	limiter := ratelimit.NewMemoryLimiter()
	mux := http.NewServeMux()
	RegisterInboxEmail(mux, Deps{Limiter: limiter}) // nil DB: the limiter runs before storage

	const ip = "203.0.113.9"
	ctx := context.Background()
	for i := 0; i < 60; i++ {
		res, err := ratelimit.CheckInboundEmail(ctx, limiter, ip)
		if err != nil {
			t.Fatalf("prime limiter: %v", err)
		}
		if !res.Ok {
			t.Fatalf("limiter refused hit %d while priming", i)
		}
	}

	req := httptest.NewRequest(http.MethodPost, "/api/v1/inbox/email?lang=en",
		bytes.NewReader(inboundJSONBody(t, "someone@"+itDomain, nil)))
	req.RemoteAddr = ip + ":4321"
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(inboxTokenHeader, itSecret)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429 (%s)", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Retry-After") == "" {
		t.Error("429 is missing Retry-After")
	}
	if got := decodeAPIError(t, rr); got.Error != "rate_limited" {
		t.Errorf("error = %q, want rate_limited", got.Error)
	}
}

// ---- indistinguishable rows over HTTP --------------------------------------

func TestEmailAttachmentAndUploadAreIndistinguishableOverHTTP(t *testing.T) {
	env := setupInboxEmailEnv(t, &permissiveLimiter{})
	png := tinyPNGBytesForInbound(t)

	// 1. The pre-existing upload path: POST /api/v1/attachments with no deviceId.
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="file"; filename="upload.png"`)
	header.Set("Content-Type", "image/png")
	part, err := mw.CreatePart(header)
	if err != nil {
		t.Fatalf("create upload part: %v", err)
	}
	if _, err := part.Write(png); err != nil {
		t.Fatalf("write upload part: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close upload multipart: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/attachments?lang=en", bytes.NewReader(buf.Bytes()))
	req.Header.Set("Authorization", "Bearer "+env.bearer)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	var uploaded struct {
		Attachment struct {
			ID string `json:"id"`
		} `json:"attachment"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &uploaded); err != nil {
		t.Fatalf("decode upload: %v", err)
	}

	// 2. The mail path: same bytes, same MIME type.
	body, ct := multipartInboundBody(t, map[string]string{"to": env.inboxAddr},
		[]inboundPart{{filename: "email.png", contentType: "image/png", body: png}})
	rr = env.postInbound(t, itSecret, "en", ct, body)
	if rr.Code != http.StatusOK {
		t.Fatalf("inbound status = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	mail := decodeInboundResponse(t, rr)
	if len(mail.Attachments) != 1 {
		t.Fatalf("inbound stored %d attachments, want 1", len(mail.Attachments))
	}
	mailID := mail.Attachments[0].ID

	// 3. GET /api/v1/inbox: identical JSON shape and identical metadata apart
	// from the fields that are expected to differ (id, name, timestamp).
	rr = env.getAs(t, "/api/v1/inbox?lang=en")
	if rr.Code != http.StatusOK {
		t.Fatalf("GET /inbox = %d (%s)", rr.Code, rr.Body.String())
	}
	var envelope struct {
		Attachments []map[string]json.RawMessage `json:"attachments"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode inbox: %v", err)
	}
	var mailItem, uploadItem map[string]json.RawMessage
	for _, item := range envelope.Attachments {
		var id string
		_ = json.Unmarshal(item["id"], &id)
		switch id {
		case mailID:
			mailItem = item
		case uploaded.Attachment.ID:
			uploadItem = item
		}
	}
	if mailItem == nil || uploadItem == nil {
		t.Fatalf("inbox items = %s, want both %s and %s", rr.Body.String(), mailID, uploaded.Attachment.ID)
	}
	if len(mailItem) != len(uploadItem) {
		t.Errorf("inbox JSON key count differs: mail=%v upload=%v", keys(mailItem), keys(uploadItem))
	}
	for _, key := range []string{"id", "fileName", "fileType", "fileSize", "description", "uploadedAt"} {
		if _, ok := mailItem[key]; !ok {
			t.Errorf("mail inbox item is missing %q", key)
		}
		if _, ok := uploadItem[key]; !ok {
			t.Errorf("upload inbox item is missing %q", key)
		}
	}
	for _, key := range []string{"fileType", "fileSize", "description"} {
		if string(mailItem[key]) != string(uploadItem[key]) {
			t.Errorf("inbox %s differs: mail=%s upload=%s", key, mailItem[key], uploadItem[key])
		}
	}
	for _, forbidden := range []string{"deviceId", "storagePath", "wrappedKey", "iv", "userId", "extractedText"} {
		if _, ok := mailItem[forbidden]; ok {
			t.Errorf("mail inbox item leaked %q", forbidden)
		}
	}

	// 4. GET /api/files/{id}: the same bytes through the same download path.
	for _, id := range []string{mailID, uploaded.Attachment.ID} {
		rr = env.getAs(t, "/api/files/"+id)
		if rr.Code != http.StatusOK {
			t.Fatalf("GET /files/%s = %d (%s)", id, rr.Code, rr.Body.String())
		}
		if rr.Header().Get("Content-Type") != "image/png" {
			t.Errorf("GET /files/%s Content-Type = %q, want image/png", id, rr.Header().Get("Content-Type"))
		}
		if !bytes.Equal(rr.Body.Bytes(), png) {
			t.Errorf("GET /files/%s returned %d bytes, want the %d original bytes", id, rr.Body.Len(), len(png))
		}
	}

	// 5. Filing: the mail row goes through POST /attachments/{id}/file and then
	// appears in the device list, exactly like an uploaded row would.
	req = httptest.NewRequest(http.MethodPost, "/api/v1/attachments/"+mailID+"/file?lang=en",
		strings.NewReader(`{"deviceId":"`+env.device+`"}`))
	req.Header.Set("Authorization", "Bearer "+env.bearer)
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("file mail attachment = %d (%s)", rr.Code, rr.Body.String())
	}
	rr = env.getAs(t, "/api/v1/devices/"+env.device+"/attachments?lang=en")
	if rr.Code != http.StatusOK || !strings.Contains(rr.Body.String(), mailID) {
		t.Errorf("device attachment list did not include the filed mail row: %d %s", rr.Code, rr.Body.String())
	}
	rr = env.getAs(t, "/api/v1/inbox?lang=en")
	if rr.Code != http.StatusOK || strings.Contains(rr.Body.String(), mailID) {
		t.Errorf("filed mail row is still in the inbox: %d %s", rr.Code, rr.Body.String())
	}
}

func keys(m map[string]json.RawMessage) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// ---- user payload -----------------------------------------------------------

func TestMeExposesInboxAddressOnlyWhenConfigured(t *testing.T) {
	env := setupInboxEmailEnv(t, &permissiveLimiter{})

	// Configured (setup set the domain): the address is present and exact.
	rr := env.getAs(t, "/api/v1/auth/me?lang=en")
	if rr.Code != http.StatusOK {
		t.Fatalf("GET /auth/me = %d (%s)", rr.Code, rr.Body.String())
	}
	var me struct {
		User struct {
			InboxAddress *string `json:"inboxAddress"`
		} `json:"user"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &me); err != nil {
		t.Fatalf("decode me: %v", err)
	}
	if me.User.InboxAddress == nil || *me.User.InboxAddress != env.inboxAddr {
		t.Fatalf("inboxAddress = %v, want %q", me.User.InboxAddress, env.inboxAddr)
	}

	// Unconfigured: the key is ABSENT, not null and not "". That is the
	// byte-for-byte compatibility guarantee for users who never email in.
	t.Setenv("INBOX_EMAIL_DOMAIN", "")
	rr = env.getAs(t, "/api/v1/auth/me?lang=en")
	if rr.Code != http.StatusOK {
		t.Fatalf("GET /auth/me (unconfigured) = %d (%s)", rr.Code, rr.Body.String())
	}
	var raw map[string]map[string]json.RawMessage
	if err := json.Unmarshal(rr.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode me envelope: %v", err)
	}
	if _, ok := raw["user"]["inboxAddress"]; ok {
		t.Errorf("GET /auth/me carries inboxAddress while INBOX_EMAIL_DOMAIN is unset: %s", rr.Body.String())
	}

	// And the inbox read path is unchanged for a user who never emailed in.
	rr = env.getAs(t, "/api/v1/inbox?lang=en")
	if rr.Code != http.StatusOK || strings.TrimSpace(rr.Body.String()) != `{"attachments":[]}` {
		t.Errorf("empty inbox = %d %q, want %q", rr.Code, strings.TrimSpace(rr.Body.String()), `{"attachments":[]}`)
	}
}
