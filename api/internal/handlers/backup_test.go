package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/auth"
	"github.com/thanhtrung9368/warranty-vault/api/internal/services"
)

// HTTP-level contract of the blob-carrying backup (roadmap #2):
//   GET  /api/v1/backup/export?includeBlobs=true  → application/zip
//   GET  /api/v1/backup/export                    → application/json (unchanged)
//   POST /api/v1/backup/import  with a zip body   → rows + blobs restored
//
// The byte-level round trip into a *clean database* is covered by
// services.TestBackupWithBlobsRoundTripToCleanDatabase; this test pins the wire
// behaviour (query param, content type, filename, counters).

func tinyPNGBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 6, 6))
	for x := 0; x < 6; x++ {
		for y := 0; y < 6; y++ {
			img.Set(x, y, color.RGBA{R: 10, G: uint8(x * 20), B: uint8(y * 20), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func TestBackupExportImportWithBlobsOverHTTP(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir())
	t.Setenv("FILE_MASTER_KEY", "3q2+7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, err := auth.Hash(testPassword)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	const (
		userA   = "zz_test_http_backup_a"
		userB   = "zz_test_http_backup_b"
		deviceA = "zz_test_http_backup_dev"
	)
	insertUser(t, pool, userA, "http-backup-a@example.invalid", hash)
	insertUser(t, pool, userB, "http-backup-b@example.invalid", hash)
	deleteUsers(t, pool, userA, userB)

	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Tủ lạnh Samsung', 'FRIDGE', '2025-01-01', 15000000, NOW())`, deviceA, userA); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	att, err := services.Upload(ctx, pool, userA, services.UploadAttachmentInput{
		DeviceID: deviceA, FileName: "hoa-don.png", DeclaredCT: "image/png", Body: tinyPNGBytes(t),
	})
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	_, _, srcPlain, _, err := services.OpenStream(ctx, pool, userA, att.ID)
	if err != nil {
		t.Fatalf("open source stream: %v", err)
	}
	srcBytes := new(bytes.Buffer)
	if _, err := srcBytes.ReadFrom(srcPlain); err != nil {
		t.Fatalf("read source stream: %v", err)
	}
	_ = srcPlain.Close()

	issuedA, err := auth.IssueToken(ctx, pool, userA, nil, nil)
	if err != nil {
		t.Fatalf("issue token A: %v", err)
	}
	deps := Deps{DB: pool, Limiter: &permissiveLimiter{}}
	// Wrap with the real auth middleware rather than calling the bare handler: the
	// handlers read the user from the request context, exactly like production.
	requireUser := auth.RequireUser(pool)
	exportH := requireUser(http.HandlerFunc(exportBackupHandler(deps)))

	get := func(h http.Handler, url, bearer string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, url, nil)
		req.Header.Set("Authorization", "Bearer "+bearer)
		rr := httptest.NewRecorder()
		h.ServeHTTP(rr, req)
		return rr
	}

	// ---- default path: JSON, unchanged --------------------------------------
	rr := get(exportH, "/api/v1/backup/export", issuedA.AccessToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("default export status = %d (%s)", rr.Code, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("default export Content-Type = %q", ct)
	}
	var payload services.BackupExport
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode default export: %v", err)
	}
	if payload.Version != services.MetadataOnlyBackupVersion || payload.IncludesAttachmentBytes {
		t.Errorf("default export = version %d, includesAttachmentBytes %v; want v5/false",
			payload.Version, payload.IncludesAttachmentBytes)
	}

	jsonBody := bytes.NewBuffer(append([]byte(nil), rr.Body.Bytes()...))

	// ---- garbage param is rejected -----------------------------------------
	if rr := get(exportH, "/api/v1/backup/export?includeBlobs=maybe", issuedA.AccessToken); rr.Code != http.StatusBadRequest {
		t.Errorf("includeBlobs=maybe status = %d, want 400", rr.Code)
	}

	// ---- blob path: ZIP -----------------------------------------------------
	rr = get(exportH, "/api/v1/backup/export?includeBlobs=true", issuedA.AccessToken)
	if rr.Code != http.StatusOK {
		t.Fatalf("blob export status = %d (%s)", rr.Code, rr.Body.String())
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/zip" {
		t.Errorf("blob export Content-Type = %q, want application/zip", ct)
	}
	if cd := rr.Header().Get("Content-Disposition"); !bytes.Contains([]byte(cd), []byte(".zip")) {
		t.Errorf("blob export Content-Disposition = %q, want a .zip filename", cd)
	}
	archive := rr.Body.Bytes()
	if len(archive) < 4 || string(archive[:2]) != "PK" {
		t.Fatalf("blob export body is not a zip archive (%d bytes)", len(archive))
	}

	// ---- import into a CLEAN database over HTTP -----------------------------
	// A second account in the SAME database would be refused by the cross-account
	// id guard (see TestBackupImportForeignIDReturns400), so the honest restore
	// target is a fresh database — which is also the real "new server" scenario.
	clean := createScratchDatabase(t, dsn)
	if _, err := clean.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`,
		userB, "http-backup-b-clean@example.invalid"); err != nil {
		t.Fatalf("insert clean user: %v", err)
	}
	issuedB, err := auth.IssueToken(ctx, clean, userB, nil, nil)
	if err != nil {
		t.Fatalf("issue token B: %v", err)
	}
	cleanDeps := Deps{DB: clean, Limiter: &permissiveLimiter{}}
	cleanImportH := auth.RequireUser(clean)(http.HandlerFunc(importBackupHandler(cleanDeps)))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/backup/import?mode=merge", bytes.NewReader(archive))
	req.Header.Set("Authorization", "Bearer "+issuedB.AccessToken)
	req.Header.Set("Content-Type", "application/zip")
	irr := httptest.NewRecorder()
	cleanImportH.ServeHTTP(irr, req)
	if irr.Code != http.StatusOK {
		t.Fatalf("zip import status = %d (%s)", irr.Code, irr.Body.String())
	}
	var envelope struct {
		OK     bool                  `json:"ok"`
		Result services.ImportResult `json:"result"`
	}
	if err := json.Unmarshal(irr.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode import response: %v", err)
	}
	if !envelope.OK || envelope.Result.Imported != 1 {
		t.Fatalf("import result = %+v", envelope)
	}
	if envelope.Result.AttachmentsImported != 1 || envelope.Result.AttachmentsUnreadable != 0 {
		t.Errorf("attachment counters = imported %d / unreadable %d, want 1 / 0",
			envelope.Result.AttachmentsImported, envelope.Result.AttachmentsUnreadable)
	}

	// The restored attachment must decrypt to the same bytes for user B.
	_, _, body, _, err := services.OpenStream(ctx, clean, userB, att.ID)
	if err != nil {
		t.Fatalf("open restored stream: %v", err)
	}
	restored := new(bytes.Buffer)
	if _, err := restored.ReadFrom(body); err != nil {
		t.Fatalf("read restored stream: %v", err)
	}
	_ = body.Close()
	if !bytes.Equal(restored.Bytes(), srcBytes.Bytes()) {
		t.Errorf("restored bytes (%d) differ from source (%d)", restored.Len(), srcBytes.Len())
	}

	// Re-importing the same archive in merge mode skips the devices AND their
	// blobs (no duplicated rows, no orphan files).
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/backup/import?mode=merge", bytes.NewReader(archive))
	req2.Header.Set("Authorization", "Bearer "+issuedB.AccessToken)
	req2.Header.Set("Content-Type", "application/zip")
	irr2 := httptest.NewRecorder()
	cleanImportH.ServeHTTP(irr2, req2)
	if irr2.Code != http.StatusOK {
		t.Fatalf("second import status = %d (%s)", irr2.Code, irr2.Body.String())
	}
	if err := json.Unmarshal(irr2.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode second import: %v", err)
	}
	if envelope.Result.Skipped != 1 || envelope.Result.AttachmentsImported != 0 || envelope.Result.AttachmentsSkipped != 1 {
		t.Errorf("second import result = %+v, want skipped=1, attachmentsImported=0, attachmentsSkipped=1", envelope.Result)
	}

	// ---- JSON import still works over HTTP ----------------------------------
	req3 := httptest.NewRequest(http.MethodPost, "/api/v1/backup/import?mode=merge",
		bytes.NewReader(jsonBody.Bytes()))
	req3.Header.Set("Authorization", "Bearer "+issuedB.AccessToken)
	req3.Header.Set("Content-Type", "application/json")
	irr3 := httptest.NewRecorder()
	cleanImportH.ServeHTTP(irr3, req3)
	if irr3.Code != http.StatusOK {
		t.Fatalf("json import status = %d (%s)", irr3.Code, irr3.Body.String())
	}
	// The device already exists in the clean database, so the JSON import skips it
	// and writes no attachment bytes.
	if err := json.Unmarshal(irr3.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode json import: %v", err)
	}
	if envelope.Result.Skipped != 1 || envelope.Result.AttachmentsImported != 0 {
		t.Errorf("json import result = %+v, want skipped=1 and no attachment writes", envelope.Result)
	}
}

// The cross-account id guard surfaces as 400 over HTTP, not 500.
func TestBackupImportForeignIDReturns400(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	hash, _ := auth.Hash(testPassword)
	const (
		userA   = "zz_test_foreign_id_a"
		userB   = "zz_test_foreign_id_b"
		deviceA = "zz_test_foreign_id_dev"
	)
	insertUser(t, pool, userA, "foreign-a@example.invalid", hash)
	insertUser(t, pool, userB, "foreign-b@example.invalid", hash)
	deleteUsers(t, pool, userA, userB)

	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Máy ảnh Canon', 'CAMERA', '2025-01-01', 9000000, NOW())`, deviceA, userA); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	issuedB, err := auth.IssueToken(ctx, pool, userB, nil, nil)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	// A payload carrying A's device id, posted by B.
	payload := map[string]any{
		"version":       services.MetadataOnlyBackupVersion,
		"exportedAt":    "2025-01-01T00:00:00Z",
		"subscriptions": []any{},
		"wishlist":      []any{},
		"devices": []any{map[string]any{
			"id": deviceA, "name": "Máy ảnh Canon", "category": "CAMERA",
			"purchaseDate": "2025-01-01T00:00:00Z", "purchasePrice": 9000000, "status": "ACTIVE",
			"createdAt": "2025-01-01T00:00:00Z", "updatedAt": "2025-01-01T00:00:00Z",
			"warranties": []any{}, "attachments": []any{},
		}},
	}
	raw, _ := json.Marshal(payload)
	// `?lang=vi`: the assertion below is about the VIETNAMESE sentence, and the
	// product default is English (docs/I18N_PLAN.md §2.2). The request is what
	// pins the language — the assertion text is unchanged. The English rendering of
	// the same refusal is pinned in backup_i18n_test.go.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/backup/import?mode=merge&lang=vi", bytes.NewReader(raw))
	req.Header.Set("Authorization", "Bearer "+issuedB.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	auth.RequireUser(pool)(http.HandlerFunc(importBackupHandler(Deps{DB: pool, Limiter: &permissiveLimiter{}}))).ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("foreign-id import status = %d, want 400 (was 500 before the guard): %s", rr.Code, rr.Body.String())
	}
	if !bytes.Contains(rr.Body.Bytes(), []byte("tài khoản khác")) {
		t.Errorf("body = %s, want the Vietnamese cross-account message", rr.Body.String())
	}
	// Nothing was imported.
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM "Device" WHERE "userId" = $1`, userB).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("user B has %d devices after a refused import, want 0", count)
	}
}
