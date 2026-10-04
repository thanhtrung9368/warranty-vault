package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
)

// Wave 3's proof of the i18n pattern over HTTP, on the backup + attachments
// slice (docs/I18N_PLAN.md §3).
//
// What each test is for, and why the assertions are written the way they are:
//
//  1. `message` AND `fieldErrors` move together. The `includeBlobs=maybe`
//     refusal is the case that carries both, and it is asserted in both
//     languages: an English headline above a Vietnamese per-field hint is worse
//     than an untranslated response (the shape every wave's test scans for).
//  2. The honesty notes are asserted in BOTH SHAPES — the metadata-only JSON
//     envelope and the v6 data.json inside the .zip — because they say opposite
//     things on purpose ("does NOT contain the images" vs "DOES contain them, and
//     needs the right FILE_MASTER_KEY"). A test that only read the JSON export
//     would not notice the .zip note being softened, and the .zip note is the one
//     a user relies on when moving servers.
//  3. The attachment refusals prove the internal/files copy reaches the wire in
//     the request's language — those messages are produced by a package with no
//     request context, so this is the only place the whole chain
//     (handler → service → filesText → catalog) is exercised end to end.
//  4. The error CODE and the status do not move with the language.
//
// Every case pins its language explicitly (`?lang=`), and the request bodies are
// logged verbatim so the report can quote what a client actually receives.
//
// Each test gets its own scratch database, like every DB-backed handler test
// (testDatabaseURL → newScratchDatabaseDSN).

type backupI18nEnv struct {
	mux    *http.ServeMux
	token  string
	pool   *pgxpool.Pool
	userID string
	device string
}

func setupBackupI18nEnv(t *testing.T) *backupI18nEnv {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir())
	t.Setenv("FILE_MASTER_KEY", "3q2+7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect scratch: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	const (
		userID = "zz_test_backup_i18n_user"
		device = "zz_test_backup_i18n_dev"
	)
	insertUser(t, pool, userID, "backup-i18n@example.invalid", hash)
	deleteUsers(t, pool, userID)

	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Tủ lạnh Samsung', 'FRIDGE', '2025-01-01', 15000000, NOW())`, device, userID); err != nil {
		t.Fatalf("insert device: %v", err)
	}

	issued, err := auth.IssueToken(ctx, pool, userID, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	mux := http.NewServeMux()
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	RegisterBackup(mux, deps)
	RegisterAttachments(mux, deps)
	return &backupI18nEnv{mux: mux, token: issued.AccessToken, pool: pool, userID: userID, device: device}
}

// do issues one request with the language pinned by `?lang=`. The handlers call
// i18n.Attach themselves, so no middleware is needed — and that is deliberate:
// the mux here is the same shape the tests have always built.
func (e *backupI18nEnv) do(t *testing.T, method, path, contentType string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Authorization", "Bearer "+e.token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	rr := httptest.NewRecorder()
	e.mux.ServeHTTP(rr, req)
	return rr
}

// envelope decodes an error response and logs its RAW body, so a run with -v
// shows exactly what a client receives in each language.
func envelope(t *testing.T, rr *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	t.Logf("HTTP %d %s", rr.Code, strings.TrimSpace(rr.Body.String()))
	var out map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode envelope %q: %v", rr.Body.String(), err)
	}
	return out
}

// ── 1. One message + one fieldErrors entry, both languages ───────────────────

func TestBackupExportParamErrorIsTranslated(t *testing.T) {
	env := setupBackupI18nEnv(t)
	const path = "/api/v1/backup/export?includeBlobs=maybe"

	for _, tc := range []struct {
		lang       string
		wantMsg    string
		wantField  string
		wantStatus int
	}{
		{"vi", "Tham số includeBlobs không hợp lệ", "Phải là true hoặc false", http.StatusBadRequest},
		{"en", "Invalid includeBlobs parameter", "Must be true or false", http.StatusBadRequest},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := env.do(t, http.MethodGet, path+"&lang="+tc.lang, "", nil)
			if rr.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rr.Code, tc.wantStatus)
			}
			body := envelope(t, rr)
			if body["error"] != "bad_input" {
				t.Errorf("error = %v, want bad_input — the code is contract and does not move with the language", body["error"])
			}
			if body["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMsg)
			}
			fields, ok := body["fieldErrors"].(map[string]any)
			if !ok {
				t.Fatalf("fieldErrors = %v, want an object", body["fieldErrors"])
			}
			got, ok := fields["includeBlobs"].([]any)
			if !ok || len(got) != 1 || got[0] != tc.wantField {
				t.Errorf("fieldErrors.includeBlobs = %v, want [%q]", fields["includeBlobs"], tc.wantField)
			}
		})
	}
}

// ── 2. The honesty notes, both shapes, both languages ────────────────────────

func TestBackupHonestyNotesOverHTTP(t *testing.T) {
	env := setupBackupI18nEnv(t)

	const (
		wantVIJSON = "Bản sao lưu này KHÔNG chứa nội dung ảnh/hoá đơn đính kèm (chỉ có tên file, loại file và kích thước). Khôi phục sang một máy chủ khác sẽ không khôi phục được ảnh."
		wantENJSON = "This backup does NOT contain the contents of the attached images/invoices (only the file name, file type and size). Restoring it onto a different server will not bring those images back."
		wantVIZip  = "Bản sao lưu này CÓ chứa nội dung ảnh/hoá đơn đính kèm (đã mã hoá AES-256-GCM). Cần đúng FILE_MASTER_KEY của máy chủ đã xuất bản sao lưu thì mới giải mã được; thiếu hoặc sai khoá thì file vẫn được khôi phục nhưng không mở được."
		wantENZip  = "This backup DOES contain the contents of the attached images/invoices (encrypted with AES-256-GCM). You need the exact FILE_MASTER_KEY of the server that exported it in order to decrypt them; with a missing or wrong key the files are still restored but cannot be opened."
	)

	for _, tc := range []struct {
		lang string
		json string
		zip  string
	}{
		{"vi", wantVIJSON, wantVIZip},
		{"en", wantENJSON, wantENZip},
	} {
		t.Run("JSON "+tc.lang, func(t *testing.T) {
			rr := env.do(t, http.MethodGet, "/api/v1/backup/export?lang="+tc.lang, "", nil)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			var payload map[string]any
			if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode export: %v", err)
			}
			if payload["attachmentBytesNote"] != tc.json {
				t.Errorf("attachmentBytesNote = %q,\nwant %q", payload["attachmentBytesNote"], tc.json)
			}
			if payload["includesAttachmentBytes"] != false {
				t.Errorf("includesAttachmentBytes = %v, want false", payload["includesAttachmentBytes"])
			}
			if payload["version"] != float64(5) {
				t.Errorf("version = %v, want 5 (the metadata-only document did not change)", payload["version"])
			}
		})

		t.Run("ZIP "+tc.lang, func(t *testing.T) {
			rr := env.do(t, http.MethodGet, "/api/v1/backup/export?includeBlobs=true&lang="+tc.lang, "", nil)
			if rr.Code != http.StatusOK {
				t.Fatalf("status = %d (%s)", rr.Code, rr.Body.String())
			}
			if ct := rr.Header().Get("Content-Type"); ct != "application/zip" {
				t.Fatalf("Content-Type = %q, want application/zip", ct)
			}
			data := zipEntry(t, rr.Body.Bytes(), "data.json")
			var payload map[string]any
			if err := json.Unmarshal(data, &payload); err != nil {
				t.Fatalf("decode data.json: %v", err)
			}
			if payload["attachmentBytesNote"] != tc.zip {
				t.Errorf("data.json attachmentBytesNote = %q,\nwant %q", payload["attachmentBytesNote"], tc.zip)
			}
			if payload["includesAttachmentBytes"] != true {
				t.Errorf("includesAttachmentBytes = %v, want true", payload["includesAttachmentBytes"])
			}
			if payload["version"] != float64(6) {
				t.Errorf("version = %v, want 6", payload["version"])
			}
		})
	}
}

func zipEntry(t *testing.T, archive []byte, name string) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(archive), int64(len(archive)))
	if err != nil {
		t.Fatalf("read zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", name, err)
		}
		defer func() { _ = rc.Close() }()
		b, err := io.ReadAll(rc)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		return b
	}
	t.Fatalf("zip has no %s entry", name)
	return nil
}

// ── 3. Backup refusals over HTTP, both languages ─────────────────────────────

func TestBackupImportRefusalsOverHTTP(t *testing.T) {
	env := setupBackupI18nEnv(t)

	for _, tc := range []struct {
		name    string
		lang    string
		body    string
		wantMsg string
		wantErr string
	}{
		{
			name: "bad mode, vi", lang: "vi", body: `{"version":5}`,
			wantMsg: "Mode không hợp lệ", wantErr: "bad_input",
		},
		{
			name: "bad mode, en", lang: "en", body: `{"version":5}`,
			wantMsg: "Invalid mode", wantErr: "bad_input",
		},
		{
			name: "future version, vi", lang: "vi", body: `{"version":99}`,
			wantMsg: "Bản sao lưu phiên bản 99 mới hơn phiên bản ứng dụng hỗ trợ (6). Cập nhật ứng dụng rồi thử lại.",
			wantErr: "validation",
		},
		{
			name: "future version, en", lang: "en", body: `{"version":99}`,
			wantMsg: "This backup is version 99, newer than this app supports (6). Update the app and try again.",
			wantErr: "validation",
		},
		{
			name: "not JSON at all, vi", lang: "vi", body: `not json`,
			wantMsg: "File JSON không hợp lệ", wantErr: "bad_input",
		},
		{
			name: "not JSON at all, en", lang: "en", body: `not json`,
			wantMsg: "Invalid JSON file", wantErr: "bad_input",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mode := "merge"
			if strings.Contains(tc.name, "bad mode") {
				mode = "sideways"
			}
			rr := env.do(t, http.MethodPost, "/api/v1/backup/import?mode="+mode+"&lang="+tc.lang,
				"application/json", []byte(tc.body))
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := envelope(t, rr)
			if body["error"] != tc.wantErr {
				t.Errorf("error = %v, want %q", body["error"], tc.wantErr)
			}
			if body["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMsg)
			}
		})
	}
}

// ── 4. Attachments: the internal/files copy, and the ceiling ─────────────────

// uploadFile posts one multipart attachment. The part carries an explicit
// Content-Type because the upload path compares it against the magic bytes —
// `CreateFormFile` would send application/octet-stream and every real image would
// be refused as a mismatch.
func (e *backupI18nEnv) uploadFile(t *testing.T, lang, filename, contentType string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
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
	req := httptest.NewRequest(http.MethodPost,
		"/api/v1/devices/"+e.device+"/attachments?lang="+lang, bytes.NewReader(buf.Bytes()))
	req.Header.Set("Authorization", "Bearer "+e.token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	rr := httptest.NewRecorder()
	e.mux.ServeHTTP(rr, req)
	return rr
}

func tinyPNGForHandler(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for x := 0; x < 4; x++ {
		for y := 0; y < 4; y++ {
			img.Set(x, y, color.RGBA{R: 20, G: uint8(x * 30), B: uint8(y * 30), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

// A rejected TYPE. The sentence comes from internal/files (which has no request
// context) and is rendered by services.filesText, so this is the end-to-end proof
// that the catalog entry and the emitted error still match.
func TestAttachmentTypeRefusalIsTranslated(t *testing.T) {
	env := setupBackupI18nEnv(t)

	for _, tc := range []struct {
		lang string
		want string
	}{
		{"vi", "Chỉ chấp nhận JPG/PNG/WEBP/GIF/HEIC hoặc PDF"},
		{"en", "Only JPG/PNG/WEBP/GIF/HEIC or PDF files are accepted"},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := env.uploadFile(t, tc.lang, "notes.txt", "text/plain", []byte("just some text, not a receipt"))
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := envelope(t, rr)
			if body["error"] != "bad_input" {
				t.Errorf("error = %v, want bad_input", body["error"])
			}
			if body["message"] != tc.want {
				t.Errorf("message = %v, want %q", body["message"], tc.want)
			}
		})
	}
}

// The per-device ceiling: the SIXTH attachment is refused, in both languages,
// with the same code and status. 5 is a fixed constant, so the sentence is not a
// plural pair (see the catalog comment) — but it IS this domain's count-bearing
// limit message, and the code (`limit_reached`) must not drift.
func TestAttachmentCeilingIsTranslated(t *testing.T) {
	env := setupBackupI18nEnv(t)
	png := tinyPNGForHandler(t)

	// Fill the device in Vietnamese; the ceiling is language-independent.
	for i := 0; i < 5; i++ {
		rr := env.uploadFile(t, "vi", "hoa-don.png", "image/png", png)
		if rr.Code != http.StatusCreated {
			t.Fatalf("upload %d = %d (%s), want 201", i+1, rr.Code, rr.Body.String())
		}
	}

	for _, tc := range []struct {
		lang       string
		want       string
		wantStatus int
	}{
		{"vi", "Tối đa 5 file/thiết bị", http.StatusBadRequest},
		{"en", "At most 5 files per device", http.StatusBadRequest},
	} {
		t.Run(tc.lang, func(t *testing.T) {
			rr := env.uploadFile(t, tc.lang, "hoa-don.png", "image/png", png)
			if rr.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d (%s)", rr.Code, tc.wantStatus, rr.Body.String())
			}
			body := envelope(t, rr)
			if body["error"] != "limit_reached" {
				t.Errorf("error = %v, want limit_reached", body["error"])
			}
			if body["message"] != tc.want {
				t.Errorf("message = %v, want %q", body["message"], tc.want)
			}
		})
	}
}

// The description-only PATCH path: unknown fields and a bad `description` are
// field-level failures, so their fieldErrors entries have to be translated at the
// call site (the map holds finished strings).
func TestAttachmentPatchFieldErrorsAreTranslated(t *testing.T) {
	env := setupBackupI18nEnv(t)

	// An id that does not exist would 404 before the body is read, so create one.
	up := env.uploadFile(t, "vi", "hoa-don.png", "image/png", tinyPNGForHandler(t))
	if up.Code != http.StatusCreated {
		t.Fatalf("upload = %d (%s)", up.Code, up.Body.String())
	}
	var created struct {
		Attachment struct {
			ID string `json:"id"`
		} `json:"attachment"`
	}
	if err := json.Unmarshal(up.Body.Bytes(), &created); err != nil {
		t.Fatalf("decode upload: %v", err)
	}

	for _, tc := range []struct {
		lang      string
		body      string
		wantMsg   string
		wantField string
	}{
		{"vi", `{"description":"x","fileName":"y"}`, "Chỉ hỗ trợ sửa mô tả", "Chỉ hỗ trợ sửa mô tả"},
		{"en", `{"description":"x","fileName":"y"}`, "Only the description can be edited", "Only the description can be edited"},
		{"vi", `{"description":42}`, "Dữ liệu không hợp lệ", "Mô tả không hợp lệ"},
		{"en", `{"description":42}`, "Invalid input", "Invalid description"},
	} {
		t.Run(tc.lang+" "+tc.body, func(t *testing.T) {
			rr := env.do(t, http.MethodPatch, "/api/v1/attachments/"+created.Attachment.ID+"?lang="+tc.lang,
				"application/json", []byte(tc.body))
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%s)", rr.Code, rr.Body.String())
			}
			body := envelope(t, rr)
			if body["message"] != tc.wantMsg {
				t.Errorf("message = %v, want %q", body["message"], tc.wantMsg)
			}
			fields, _ := body["fieldErrors"].(map[string]any)
			found := false
			for _, v := range fields {
				list, _ := v.([]any)
				for _, item := range list {
					if item == tc.wantField {
						found = true
					}
				}
			}
			if !found {
				t.Errorf("fieldErrors = %v, want an entry %q", fields, tc.wantField)
			}
		})
	}
}
