package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// Capture-first inbox over the real HTTP surface (migration 0018). The service
// rules are covered in internal/services/attachment_inbox_test.go; this file
// pins the wire contract the three clients implement against:
//
//   POST /api/v1/attachments                 optional deviceId → inbox item
//   GET  /api/v1/inbox                       { attachments: [...] }, no device data
//   POST /api/v1/attachments/{id}/file       200, 404, 409 limit_reached
//   PATCH /api/v1/attachments/{id}           still description-only
//   DELETE /api/v1/attachments/{id}          removes inbox items too
//
// It reuses setupBackupI18nEnv (same package): it provides a scratch database, a
// user, one device, a bearer token, and registers RegisterAttachments +
// RegisterBackup on a mux.

func uploadMultipart(t *testing.T, env *backupI18nEnv, path string, fields map[string]string,
	filename, contentType string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			t.Fatalf("write multipart field %s: %v", k, err)
		}
	}
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filename))
	header.Set("Content-Type", contentType)
	part, err := mw.CreatePart(header)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(buf.Bytes()))
	req.Header.Set("Authorization", "Bearer "+env.token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rr := httptest.NewRecorder()
	env.mux.ServeHTTP(rr, req)
	return rr
}

func doAs(t *testing.T, mux *http.ServeMux, token, method, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == nil {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, bytes.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, r)
	return rr
}

func decodeUploadedID(t *testing.T, rr *httptest.ResponseRecorder) string {
	t.Helper()
	if rr.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, want 201 (%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Attachment struct {
			ID       string  `json:"id"`
			FileSize int32   `json:"fileSize"`
			FileName string  `json:"fileName"`
			DeviceID *string `json:"deviceId"`
		} `json:"attachment"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode upload: %v", err)
	}
	if body.Attachment.ID == "" {
		t.Fatalf("upload response has no attachment id: %s", rr.Body.String())
	}
	// AttachmentMeta never exposes deviceId, on any endpoint.
	if body.Attachment.DeviceID != nil {
		t.Error("upload response leaked a deviceId field")
	}
	return body.Attachment.ID
}

func inboxIDs(t *testing.T, rr *httptest.ResponseRecorder) []string {
	t.Helper()
	if rr.Code != http.StatusOK {
		t.Fatalf("GET /inbox status = %d, want 200 (%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Attachments []struct {
			ID string `json:"id"`
		} `json:"attachments"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode inbox: %v", err)
	}
	out := make([]string, 0, len(body.Attachments))
	for _, a := range body.Attachments {
		out = append(out, a.ID)
	}
	return out
}

func TestCaptureFirstInboxOverHTTP(t *testing.T) {
	env := setupBackupI18nEnv(t)
	png := tinyPNGForHandler(t)
	ctx := context.Background()

	// ── 2. POST /api/v1/attachments with no deviceId → inbox item ────────────
	rr := uploadMultipart(t, env, "/api/v1/attachments?lang=vi", nil,
		"hoa-don.png", "image/png", png)
	inboxID := decodeUploadedID(t, rr)

	// It really is unassigned and owned by the caller.
	inbox, err := services.ListInbox(ctx, env.pool, env.userID)
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if len(inbox) != 1 || inbox[0].ID != inboxID || inbox[0].DeviceId != nil {
		t.Fatalf("stored inbox row = %+v, want one device-less row", inbox)
	}

	// ── 3. GET /api/v1/inbox: same AttachmentMeta shape, no device data ──────
	rr = doAs(t, env.mux, env.token, http.MethodGet, "/api/v1/inbox?lang=vi", nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("GET /inbox = %d (%s)", rr.Code, rr.Body.String())
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rr.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode inbox envelope: %v", err)
	}
	if _, ok := raw["attachments"]; !ok {
		t.Fatalf("inbox envelope = %s, want key `attachments`", rr.Body.String())
	}
	var one []map[string]json.RawMessage
	if err := json.Unmarshal(raw["attachments"], &one); err != nil {
		t.Fatalf("decode inbox items: %v", err)
	}
	if len(one) != 1 {
		t.Fatalf("inbox = %d items, want 1", len(one))
	}
	for _, key := range []string{"id", "fileName", "fileType", "fileSize", "uploadedAt"} {
		if _, ok := one[0][key]; !ok {
			t.Errorf("inbox item is missing %q: %s", key, rr.Body.String())
		}
	}
	for _, forbidden := range []string{"deviceId", "storagePath", "wrappedKey", "iv", "userId"} {
		if _, ok := one[0][forbidden]; ok {
			t.Errorf("inbox item leaked %q: %s", forbidden, rr.Body.String())
		}
	}

	// GET /api/files/{id} serves an inbox blob exactly like a filed one.
	rr = doAs(t, env.mux, env.token, http.MethodGet, "/api/files/"+inboxID, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("serving the inbox blob %s = %d (%s)", inboxID, rr.Code, rr.Body.String())
	}
	if !bytes.Equal(rr.Body.Bytes(), png) {
		t.Errorf("served inbox bytes differ from the upload (%d vs %d)", rr.Body.Len(), len(png))
	}

	// ── 4. POST /api/v1/attachments/{id}/file assigns it ─────────────────────
	rr = doAs(t, env.mux, env.token, http.MethodPost,
		"/api/v1/attachments/"+inboxID+"/file?lang=vi",
		[]byte(`{"deviceId":"`+env.device+`"}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("file attachment = %d (%s)", rr.Code, rr.Body.String())
	}
	if got := inboxIDs(t, doAs(t, env.mux, env.token, http.MethodGet, "/api/v1/inbox", nil)); len(got) != 0 {
		t.Errorf("inbox after filing = %v, want empty", got)
	}
	rr = doAs(t, env.mux, env.token, http.MethodGet, "/api/v1/devices/"+env.device+"/attachments", nil)
	var deviceList struct {
		Attachments []struct {
			ID string `json:"id"`
		} `json:"attachments"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &deviceList); err != nil || rr.Code != http.StatusOK {
		t.Fatalf("device attachment list = %d %s", rr.Code, rr.Body.String())
	}
	if len(deviceList.Attachments) != 1 || deviceList.Attachments[0].ID != inboxID {
		t.Errorf("device list after filing = %+v, want the item", deviceList.Attachments)
	}

	// ── deviceId: null returns it to the inbox ───────────────────────────────
	rr = doAs(t, env.mux, env.token, http.MethodPost,
		"/api/v1/attachments/"+inboxID+"/file?lang=vi", []byte(`{"deviceId":null}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("unfile attachment = %d (%s)", rr.Code, rr.Body.String())
	}
	if got := inboxIDs(t, doAs(t, env.mux, env.token, http.MethodGet, "/api/v1/inbox", nil)); len(got) != 1 || got[0] != inboxID {
		t.Errorf("inbox after unfiling = %v, want the item back", got)
	}

	// ── body errors: missing key, unknown field, wrong type ──────────────────
	for _, tc := range []struct {
		name string
		body string
	}{
		{"missing deviceId", `{}`},
		{"unknown field", `{"deviceId":null,"other":"x"}`},
		{"wrong type", `{"deviceId":42}`},
		{"malformed", `not-json`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rr := doAs(t, env.mux, env.token, http.MethodPost,
				"/api/v1/attachments/"+inboxID+"/file?lang=vi", []byte(tc.body))
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			var body map[string]any
			if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode error: %v", err)
			}
			if body["error"] != "bad_input" {
				t.Errorf("error = %v, want bad_input", body["error"])
			}
		})
	}

	// ── 5. PATCH still accepts only description ──────────────────────────────
	rr = doAs(t, env.mux, env.token, http.MethodPatch,
		"/api/v1/attachments/"+inboxID+"?lang=vi",
		[]byte(`{"deviceId":"`+env.device+`"}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("PATCH deviceId = %d, want 400 (%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "Chỉ hỗ trợ sửa mô tả") {
		t.Errorf("PATCH refusal = %s, want the description-only message", rr.Body.String())
	}

	// ── 404s: cross-user attachment and cross-user device ────────────────────
	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	const otherUser = "zz_test_inbox_http_other"
	const otherDevice = "zz_test_inbox_http_other_dev"
	insertUser(t, env.pool, otherUser, "inbox-other@example.invalid", hash)
	deleteUsers(t, env.pool, otherUser)
	if _, err := env.pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Máy khác', 'PHONE', NOW(), 0, NOW())`, otherDevice, otherUser); err != nil {
		t.Fatalf("insert other device: %v", err)
	}
	issuedOther, err := auth.IssueToken(ctx, env.pool, otherUser, nil, nil)
	if err != nil {
		t.Fatalf("issue other token: %v", err)
	}

	// Another user's token on this attachment.
	rr = doAs(t, env.mux, issuedOther.AccessToken, http.MethodPost,
		"/api/v1/attachments/"+inboxID+"/file?lang=vi",
		[]byte(`{"deviceId":"`+otherDevice+`"}`))
	if rr.Code != http.StatusNotFound {
		t.Errorf("cross-user attachment = %d, want 404 (%s)", rr.Code, rr.Body.String())
	}
	// The owner's token on another user's device.
	rr = doAs(t, env.mux, env.token, http.MethodPost,
		"/api/v1/attachments/"+inboxID+"/file?lang=vi",
		[]byte(`{"deviceId":"`+otherDevice+`"}`))
	if rr.Code != http.StatusNotFound {
		t.Errorf("cross-user device = %d, want 404 (%s)", rr.Code, rr.Body.String())
	}

	// ── legacy route still works and still requires a device ─────────────────
	// The inbox item was returned to the inbox above, so the device starts empty.
	rr = uploadMultipart(t, env, "/api/v1/devices/"+env.device+"/attachments?lang=vi",
		map[string]string{"deviceId": otherDevice}, "hoa-don.png", "image/png", png)
	decodeUploadedID(t, rr) // path wins; the form field is ignored
	rr = doAs(t, env.mux, env.token, http.MethodGet, "/api/v1/devices/"+env.device+"/attachments", nil)
	if err := json.Unmarshal(rr.Body.Bytes(), &deviceList); err != nil || len(deviceList.Attachments) != 1 {
		t.Fatalf("legacy upload did not land on the path device: %s", rr.Body.String())
	}

	// ── 409 LIMIT_REACHED when filing into a full device ────────────────────
	// Device currently holds 1 (the legacy upload); fill the other four.
	for i := 0; i < 4; i++ {
		uploadMultipart(t, env, "/api/v1/attachments?lang=vi",
			map[string]string{"deviceId": env.device}, "hoa-don.png", "image/png", png)
	}
	rr = doAs(t, env.mux, env.token, http.MethodGet, "/api/v1/devices/"+env.device+"/attachments", nil)
	if err := json.Unmarshal(rr.Body.Bytes(), &deviceList); err != nil || len(deviceList.Attachments) != 5 {
		t.Fatalf("device should be full at 5, got %s", rr.Body.String())
	}

	rr = doAs(t, env.mux, env.token, http.MethodPost,
		"/api/v1/attachments/"+inboxID+"/file?lang=vi",
		[]byte(`{"deviceId":"`+env.device+`"}`))
	if rr.Code != http.StatusConflict {
		t.Fatalf("filing into a full device = %d, want 409 (%s)", rr.Code, rr.Body.String())
	}
	var errBody map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &errBody); err != nil {
		t.Fatalf("decode 409: %v", err)
	}
	if errBody["error"] != "limit_reached" {
		t.Errorf("409 error code = %v, want limit_reached", errBody["error"])
	}
	if errBody["message"] != "Tối đa 5 file/thiết bị" {
		t.Errorf("409 message = %v", errBody["message"])
	}
	// The refused item is still in the inbox.
	if got := inboxIDs(t, doAs(t, env.mux, env.token, http.MethodGet, "/api/v1/inbox", nil)); len(got) != 1 || got[0] != inboxID {
		t.Errorf("inbox after 409 = %v, want the item untouched", got)
	}

	// ── 7. DELETE removes the inbox item (and its blob, covered in services) ─
	rr = doAs(t, env.mux, env.token, http.MethodDelete, "/api/v1/attachments/"+inboxID, nil)
	if rr.Code != http.StatusOK {
		t.Fatalf("DELETE inbox item = %d (%s)", rr.Code, rr.Body.String())
	}
	if got := inboxIDs(t, doAs(t, env.mux, env.token, http.MethodGet, "/api/v1/inbox", nil)); len(got) != 0 {
		t.Errorf("inbox after DELETE = %v, want empty", got)
	}
	rr = doAs(t, env.mux, env.token, http.MethodGet, "/api/files/"+inboxID, nil)
	if rr.Code != http.StatusNotFound {
		t.Errorf("GET deleted inbox blob = %d, want 404", rr.Code)
	}
}
