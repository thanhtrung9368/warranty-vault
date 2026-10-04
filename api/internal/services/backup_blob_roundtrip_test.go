package services

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
)

// ---- helpers ---------------------------------------------------------------

// testMasterKeyB64 is a fixed 32-byte AES key so the round-trip test never
// depends on the developer's .env.
const testMasterKeyB64 = "3q2+7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" // 32 zero-ish bytes, base64

// createScratchDatabase makes a brand-new empty database on the same server as
// dsn and returns its DSN. This is what makes the round trip honest: the import
// target has no rows, no blobs and no goose history of its own.
func createScratchDatabase(t *testing.T, dsn string) string {
	t.Helper()
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse WV_TEST_DATABASE_URL: %v", err)
	}
	name := fmt.Sprintf("wv_rt_%d", time.Now().UnixNano())

	admin, err := pgx.Connect(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect admin: %v", err)
	}
	defer func() { _ = admin.Close(context.Background()) }()

	if _, err := admin.Exec(context.Background(), `CREATE DATABASE "`+name+`"`); err != nil {
		t.Skipf("cannot CREATE DATABASE (%v) — the round-trip test needs a superuser/createdb role", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		admin, err := pgx.Connect(ctx, dsn)
		if err != nil {
			return
		}
		defer func() { _ = admin.Close(ctx) }()
		_, _ = admin.Exec(ctx, `DROP DATABASE IF EXISTS "`+name+`" WITH (FORCE)`)
	})

	u.Path = "/" + name
	return u.String()
}

// tinyPNG renders a real PNG so the upload path's magic-byte detection and
// optional downscale both see a genuine image.
func tinyPNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for x := 0; x < 8; x++ {
		for y := 0; y < 8; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 30), G: uint8(y * 30), B: 128, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

// ---- the round trip --------------------------------------------------------

// Roadmap #2, the part that was deliberately deferred: a backup that carries the
// ENCRYPTED BLOB BYTES, restored onto a clean database, must give back an
// attachment that still decrypts to exactly the same bytes.
//
// Evidence this test produces (printed by -v):
//   - the archive size and its entry list,
//   - the SHA-free byte comparison source-decrypted vs target-decrypted,
//   - the same ciphertext length on both sides,
//   - a decryption attempt with the WRONG master key failing (the ciphertext is
//     genuinely key-dependent, which is why the archive warns about FILE_MASTER_KEY).
func TestBackupWithBlobsRoundTripToCleanDatabase(t *testing.T) {
	sourceDSN := testDatabaseURL(t)
	gooseUp(t, sourceDSN)

	uploadRoot := t.TempDir()
	t.Setenv("PRIVATE_UPLOAD_ROOT", uploadRoot)
	t.Setenv("FILE_MASTER_KEY", testMasterKeyB64)

	// viCtx, not context.Background(): the assertions below compare the exported
	// note to `BlobAttachmentBytesNoteVN`, i.e. to the Vietnamese source text, and
	// the product default is English. The language is pinned; the assertion is
	// unchanged (docs/I18N_PLAN.md §4.3). The English note is pinned in
	// backup_i18n_test.go.
	ctx := viCtx()
	source, err := pgxpool.New(ctx, sourceDSN)
	if err != nil {
		t.Fatalf("connect source: %v", err)
	}
	t.Cleanup(source.Close)

	const (
		userA   = "zz_test_blob_roundtrip_a"
		deviceA = "zz_test_blob_roundtrip_dev"
	)
	if _, err := source.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userA, userA+"@example.invalid"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = source.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userA)
	})
	if _, err := source.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'iPhone 15 Pro', 'PHONE', '2025-01-01', 28990000, NOW())
		 ON CONFLICT (id) DO NOTHING`, deviceA, userA); err != nil {
		t.Fatalf("insert device: %v", err)
	}

	// Upload through the real pipeline (encrypt → write blob → DB row).
	original := tinyPNG(t)
	att, err := Upload(ctx, source, userA, UploadAttachmentInput{
		DeviceID:   deviceA,
		FileName:   "hoa-don-dien-may-xanh.png",
		DeclaredCT: "image/png",
		Body:       original,
	})
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	t.Logf("uploaded attachment id=%s storagePath=%s fileSize=%d", att.ID, att.StoragePath, att.FileSize)

	// Plaintext as this server decrypts it — the reference for "byte-identical".
	srcPlain, _, _, err := decryptAttachment(ctx, source, userA, att.ID)
	if err != nil {
		t.Fatalf("decrypt source attachment: %v", err)
	}
	if !bytes.Equal(srcPlain, original) {
		t.Fatalf("source decrypt != uploaded bytes (%d vs %d)", len(srcPlain), len(original))
	}
	srcCipher, err := files.ReadEncrypted(files.PrivateUploadRoot(), att.StoragePath)
	if err != nil {
		t.Fatalf("read source ciphertext: %v", err)
	}

	// ---- export with blobs --------------------------------------------------
	var archive bytes.Buffer
	envelope, err := WriteBackupZip(ctx, source, userA, &archive)
	if err != nil {
		t.Fatalf("WriteBackupZip: %v", err)
	}
	if !envelope.IncludesAttachmentBytes {
		t.Error("envelope.IncludesAttachmentBytes = false, want true for the blob export")
	}
	if envelope.Version != BackupVersion {
		t.Errorf("envelope.Version = %d, want %d", envelope.Version, BackupVersion)
	}
	if envelope.AttachmentBytesNote != BlobAttachmentBytesNoteVN {
		t.Errorf("envelope.AttachmentBytesNote = %q, want the blob note", envelope.AttachmentBytesNote)
	}
	if len(envelope.MissingAttachmentIds) != 0 {
		t.Errorf("missingAttachmentIds = %v, want none", envelope.MissingAttachmentIds)
	}

	zr, err := zip.NewReader(bytes.NewReader(archive.Bytes()), int64(archive.Len()))
	if err != nil {
		t.Fatalf("open archive: %v", err)
	}
	names := make([]string, 0, len(zr.File))
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	t.Logf("archive: %d bytes, entries=%v", archive.Len(), names)
	if len(archive.Bytes()) <= len(srcCipher) {
		t.Errorf("archive (%d bytes) is not larger than the single ciphertext (%d bytes)", archive.Len(), len(srcCipher))
	}

	// The ciphertext inside the archive must be the raw bytes from disk — not
	// re-encrypted, not base64.
	var archivedCipher []byte
	for _, f := range zr.File {
		if f.Name == "attachments/"+att.StoragePath {
			rc, rerr := f.Open()
			if rerr != nil {
				t.Fatalf("open entry: %v", rerr)
			}
			archivedCipher, _ = io.ReadAll(rc)
			_ = rc.Close()
		}
	}
	if archivedCipher == nil {
		t.Fatalf("archive has no entry for %s (entries: %v)", att.StoragePath, names)
	}
	if !bytes.Equal(archivedCipher, srcCipher) {
		t.Errorf("archived ciphertext differs from the on-disk blob (%d vs %d bytes)", len(archivedCipher), len(srcCipher))
	}

	// ---- import into a CLEAN database --------------------------------------
	targetDSN := createScratchDatabase(t, sourceDSN)
	gooseUp(t, targetDSN)
	target, err := pgxpool.New(ctx, targetDSN)
	if err != nil {
		t.Fatalf("connect target: %v", err)
	}
	t.Cleanup(target.Close)

	const userB = "zz_test_blob_roundtrip_b"
	if _, err := target.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`,
		userB, userB+"@example.invalid"); err != nil {
		t.Fatalf("insert target user: %v", err)
	}

	res, err := ImportBackupZip(ctx, target, userB, archive.Bytes(), ImportMerge)
	if err != nil {
		t.Fatalf("ImportBackupZip into clean DB: %v", err)
	}
	if res.Imported != 1 {
		t.Errorf("imported devices = %d, want 1", res.Imported)
	}
	if res.AttachmentsImported != 1 {
		t.Errorf("attachmentsImported = %d, want 1", res.AttachmentsImported)
	}
	if res.AttachmentsUnreadable != 0 {
		t.Errorf("attachmentsUnreadable = %d, want 0 (same FILE_MASTER_KEY)", res.AttachmentsUnreadable)
	}

	// The restored row must carry the same crypto material…
	var (
		gotPath, gotType, gotName string
		gotSize                   int32
		gotIV, gotKey             []byte
	)
	if err := target.QueryRow(ctx,
		`SELECT "storagePath", "fileType", "fileName", "fileSize", iv, "wrappedKey"
		 FROM "Attachment" WHERE id = $1`, att.ID).Scan(&gotPath, &gotType, &gotName, &gotSize, &gotIV, &gotKey); err != nil {
		t.Fatalf("read restored attachment: %v", err)
	}
	if gotPath != att.StoragePath || gotType != att.FileType || gotName != att.FileName || gotSize != att.FileSize {
		t.Errorf("restored metadata = (%s, %s, %s, %d), want (%s, %s, %s, %d)",
			gotPath, gotType, gotName, gotSize, att.StoragePath, att.FileType, att.FileName, att.FileSize)
	}
	if !bytes.Equal(gotIV, att.Iv) || !bytes.Equal(gotKey, att.WrappedKey) {
		t.Error("restored iv/wrappedKey differ from the source row")
	}

	// …and the blob must exist on disk with the same bytes.
	restoredCipher, err := files.ReadEncrypted(files.PrivateUploadRoot(), gotPath)
	if err != nil {
		t.Fatalf("read restored ciphertext: %v", err)
	}
	if !bytes.Equal(restoredCipher, srcCipher) {
		t.Errorf("restored ciphertext differs from the source blob (%d vs %d bytes)", len(restoredCipher), len(srcCipher))
	}

	// ---- the actual proof: it still decrypts, byte-identical ---------------
	plain, mime, name, err := decryptAttachment(ctx, target, userB, att.ID)
	if err != nil {
		t.Fatalf("decrypt restored attachment: %v", err)
	}
	if mime != "image/png" || name != "hoa-don-dien-may-xanh.png" {
		t.Errorf("restored mime/name = %s/%s", mime, name)
	}
	if !bytes.Equal(plain, srcPlain) {
		t.Fatalf("restored plaintext (%d bytes) != source plaintext (%d bytes)", len(plain), len(srcPlain))
	}
	if !bytes.Equal(plain, original) {
		t.Fatalf("restored plaintext != the originally uploaded bytes")
	}
	t.Logf("round trip OK: %d plaintext bytes identical, ciphertext %d bytes identical", len(plain), len(restoredCipher))

	// A different master key must NOT open these bytes: that is why the archive
	// keeps warning about FILE_MASTER_KEY instead of claiming the backup is
	// self-sufficient.
	wrong, err := files.NewMasterKey([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatalf("wrong key: %v", err)
	}
	if _, err := files.Decrypt(restoredCipher, gotIV, gotKey, wrong); err == nil {
		t.Error("decryption with the wrong FILE_MASTER_KEY succeeded — the blobs are not key-dependent?")
	}

	// OpenStream (the download path) must work for the importing user too.
	_, _, body, size, err := OpenStream(ctx, target, userB, att.ID)
	if err != nil {
		t.Fatalf("OpenStream on restored attachment: %v", err)
	}
	streamed, _ := io.ReadAll(body)
	_ = body.Close()
	if size != int64(len(srcPlain)) || !bytes.Equal(streamed, srcPlain) {
		t.Errorf("OpenStream returned %d bytes (size %d), want %d identical bytes", len(streamed), size, len(srcPlain))
	}

	// The archive's data.json is the v6 envelope.
	for _, f := range zr.File {
		if f.Name != "data.json" {
			continue
		}
		rc, _ := f.Open()
		rawManifest, _ := io.ReadAll(rc)
		_ = rc.Close()
		if !bytes.Contains(rawManifest, []byte(`"includesAttachmentBytes": true`)) {
			t.Errorf("data.json does not declare includesAttachmentBytes=true")
		}
		if !bytes.Contains(rawManifest, []byte(`"version": 6`)) {
			t.Errorf("data.json is not version 6")
		}
	}
}

// The metadata-only JSON export must stay exactly what it was (version 5,
// includesAttachmentBytes=false), and importing it must still restore the rows
// (without bytes) — that is the compatibility promise of the version bump.
func TestMetadataOnlyExportStaysV5AndImportsIntoCleanDatabase(t *testing.T) {
	sourceDSN := testDatabaseURL(t)
	gooseUp(t, sourceDSN)
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir())
	t.Setenv("FILE_MASTER_KEY", testMasterKeyB64)

	// viCtx: same reason as TestBackupWithBlobsRoundTripToCleanDatabase — the
	// assertion below is against the Vietnamese source text of the note.
	ctx := viCtx()
	source, err := pgxpool.New(ctx, sourceDSN)
	if err != nil {
		t.Fatalf("connect source: %v", err)
	}
	t.Cleanup(source.Close)

	const (
		userA   = "zz_test_json_roundtrip_a"
		deviceA = "zz_test_json_roundtrip_dev"
	)
	if _, err := source.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userA, userA+"@example.invalid"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = source.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userA)
	})
	if _, err := source.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Máy giặt LG', 'WASHING', '2025-02-01', 12000000, NOW())
		 ON CONFLICT (id) DO NOTHING`, deviceA, userA); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	if _, err := Upload(ctx, source, userA, UploadAttachmentInput{
		DeviceID: deviceA, FileName: "hoa-don.png", DeclaredCT: "image/png", Body: tinyPNG(t),
	}); err != nil {
		t.Fatalf("Upload: %v", err)
	}

	payload, err := ExportBackup(ctx, source, userA)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	if payload.Version != MetadataOnlyBackupVersion {
		t.Errorf("JSON export version = %d, want %d (the JSON document itself did not change)", payload.Version, MetadataOnlyBackupVersion)
	}
	if payload.IncludesAttachmentBytes {
		t.Error("JSON export claims to include attachment bytes")
	}
	if payload.AttachmentBytesNote != AttachmentBytesNoteVN {
		t.Errorf("JSON export note = %q, want %q", payload.AttachmentBytesNote, AttachmentBytesNoteVN)
	}

	targetDSN := createScratchDatabase(t, sourceDSN)
	gooseUp(t, targetDSN)
	target, err := pgxpool.New(ctx, targetDSN)
	if err != nil {
		t.Fatalf("connect target: %v", err)
	}
	t.Cleanup(target.Close)

	const userB = "zz_test_json_roundtrip_b"
	if _, err := target.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`,
		userB, userB+"@example.invalid"); err != nil {
		t.Fatalf("insert target user: %v", err)
	}

	res, err := ImportBackup(ctx, target, userB, payload, ImportMerge)
	if err != nil {
		t.Fatalf("ImportBackup(json v5) into clean DB: %v", err)
	}
	if res.Imported != 1 {
		t.Errorf("imported = %d, want 1", res.Imported)
	}
	if res.AttachmentsImported != 0 {
		t.Errorf("attachmentsImported = %d, want 0 for a metadata-only import", res.AttachmentsImported)
	}
	var attCount int
	if err := target.QueryRow(ctx, `SELECT COUNT(*) FROM "Attachment"`).Scan(&attCount); err != nil {
		t.Fatalf("count attachments: %v", err)
	}
	if attCount != 1 {
		t.Errorf("attachment rows = %d, want 1 (metadata is restored even without bytes)", attCount)
	}
}

// A v5 payload (the version every existing user file carries) must keep
// importing — the whole point of the range check. Device fields added in later
// versions stay optional.
func TestV5PayloadStillImportsAfterVersionBump(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_v5_compat"
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	// Hand-written v5 document: no soldAt/soldPrice, no honesty fields (older
	// exports predate them).
	const v5 = `{
	  "version": 5,
	  "exportedAt": "2025-01-01T00:00:00Z",
	  "subscriptions": [],
	  "wishlist": [],
	  "devices": [{
	    "id": "zz_test_v5_device",
	    "name": "iPhone 14",
	    "category": "PHONE",
	    "purchaseDate": "2024-01-01T00:00:00Z",
	    "purchasePrice": 20000000,
	    "status": "ACTIVE",
	    "createdAt": "2024-01-01T00:00:00Z",
	    "updatedAt": "2024-01-01T00:00:00Z",
	    "warranties": [],
	    "attachments": []
	  }]
	}`
	var payload BackupExport
	if err := json.Unmarshal([]byte(v5), &payload); err != nil {
		t.Fatalf("decode v5 payload: %v", err)
	}
	if payload.Version != 5 {
		t.Fatalf("fixture version = %d", payload.Version)
	}
	res, err := ImportBackup(ctx, pool, userID, &payload, ImportMerge)
	if err != nil {
		t.Fatalf("ImportBackup(v5) = %v, want success — a version bump must not invalidate existing files", err)
	}
	if res.Imported != 1 {
		t.Errorf("imported = %d, want 1", res.Imported)
	}
}

// The blob archive is self-describing about a missing file instead of quietly
// shipping a smaller backup, and the import tolerates exactly that.
func TestBlobExportRecordsMissingBlob(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	root := t.TempDir()
	t.Setenv("PRIVATE_UPLOAD_ROOT", root)
	t.Setenv("FILE_MASTER_KEY", testMasterKeyB64)

	// viCtx, not context.Background(): the note this test asserts below
	// ("không còn trên đĩa") is Vietnamese and the product default is English —
	// the language is pinned, the assertion is unchanged (docs/I18N_PLAN.md §4.3).
	// The English note, singular and plural, is pinned in backup_i18n_test.go.
	ctx := viCtx()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const (
		userID   = "zz_test_missing_blob_a"
		deviceID = "zz_test_missing_blob_dev"
	)
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
		 ON CONFLICT (id) DO NOTHING`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
		 VALUES ($1, $2, 'Loa JBL', 'SPEAKER', '2025-03-01', 2000000, NOW())
		 ON CONFLICT (id) DO NOTHING`, deviceID, userID); err != nil {
		t.Fatalf("insert device: %v", err)
	}
	att, err := Upload(ctx, pool, userID, UploadAttachmentInput{
		DeviceID: deviceID, FileName: "hoa-don.png", DeclaredCT: "image/png", Body: tinyPNG(t),
	})
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}
	// Simulate the blob being gone (volume restored without the files).
	if err := files.DeleteEncrypted(root, att.StoragePath); err != nil {
		t.Fatalf("delete blob: %v", err)
	}

	var archive bytes.Buffer
	envelope, err := WriteBackupZip(ctx, pool, userID, &archive)
	if err != nil {
		t.Fatalf("WriteBackupZip: %v", err)
	}
	if len(envelope.MissingAttachmentIds) != 1 || envelope.MissingAttachmentIds[0] != att.ID {
		t.Fatalf("missingAttachmentIds = %v, want [%s]", envelope.MissingAttachmentIds, att.ID)
	}
	if !bytes.Contains([]byte(envelope.AttachmentBytesNote), []byte("không còn trên đĩa")) {
		t.Errorf("note %q does not tell the user about the missing file", envelope.AttachmentBytesNote)
	}

	// Importing that archive must still succeed and restore the row.
	targetDSN := createScratchDatabase(t, dsn)
	gooseUp(t, targetDSN)
	target, err := pgxpool.New(ctx, targetDSN)
	if err != nil {
		t.Fatalf("connect target: %v", err)
	}
	t.Cleanup(target.Close)
	const userB = "zz_test_missing_blob_b"
	if _, err := target.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`,
		userB, userB+"@example.invalid"); err != nil {
		t.Fatalf("insert target user: %v", err)
	}
	res, err := ImportBackupZip(ctx, target, userB, archive.Bytes(), ImportMerge)
	if err != nil {
		t.Fatalf("ImportBackupZip: %v", err)
	}
	if res.AttachmentsImported != 0 || res.AttachmentsUnreadable != 1 {
		t.Errorf("result = imported %d / unreadable %d, want 0 / 1", res.AttachmentsImported, res.AttachmentsUnreadable)
	}
	var rowCount int
	if err := target.QueryRow(ctx, `SELECT COUNT(*) FROM "Attachment"`).Scan(&rowCount); err != nil {
		t.Fatalf("count: %v", err)
	}
	if rowCount != 1 {
		t.Errorf("attachment rows = %d, want 1 (row restored without bytes)", rowCount)
	}
	if _, err := os.Stat(filepath.Join(root, att.StoragePath)); !os.IsNotExist(err) {
		t.Errorf("no blob should have been written for a missing attachment (stat err = %v)", err)
	}

	// A truncated archive (blob entry removed but not declared) must be refused.
	truncated := &BackupExport{
		Version:                 BackupVersion,
		ExportedAt:              "2025-01-01T00:00:00Z",
		IncludesAttachmentBytes: true,
		AttachmentBytesNote:     BlobAttachmentBytesNoteVN,
		Subscriptions:           []BackupSubscription{},
		Wishlist:                []BackupWishlistItem{},
		Devices: []BackupDevice{{
			ID: "zz_test_tampered_dev", Name: "Thiết bị", Category: "PHONE",
			PurchaseDate: "2025-01-01T00:00:00Z", PurchasePrice: 1, Status: "ACTIVE",
			CreatedAt: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z",
			Warranties: []BackupWarranty{},
			Attachments: []BackupAttachment{{
				ID: "zz_test_tampered_att", FileName: "f.png",
				StoragePath: "zz_test_tampered_dev/abc.enc", FileType: "image/png", FileSize: 10,
				IV:         base64.StdEncoding.EncodeToString(make([]byte, 12)),
				WrappedKey: base64.StdEncoding.EncodeToString(make([]byte, 32)),
				UploadedAt: "2025-01-01T00:00:00Z",
			}},
		}},
	}
	var tampered bytes.Buffer
	tw := zip.NewWriter(&tampered)
	manifest, _ := tw.Create("data.json")
	rawManifest, _ := json.Marshal(truncated)
	_, _ = manifest.Write(rawManifest)
	_ = tw.Close()
	if _, err := ImportBackupZip(ctx, target, userB, tampered.Bytes(), ImportMerge); err == nil {
		t.Error("ImportBackupZip accepted an archive whose declared blob entry is missing")
	} else if svc, ok := As(err); !ok || svc.Code != "VALIDATION" {
		t.Errorf("truncated archive error = %v, want VALIDATION", err)
	}
}

// Importing the manifest of a blob archive on its own must be refused with a
// pointer at the .zip, not silently accepted as a metadata-only restore.
func TestImportingBlobManifestAloneIsRefused(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	iv := base64.StdEncoding.EncodeToString(make([]byte, 12))
	wk := base64.StdEncoding.EncodeToString(make([]byte, 32))
	payload := &BackupExport{
		Version:                 BackupVersion,
		ExportedAt:              "2025-01-01T00:00:00Z",
		IncludesAttachmentBytes: true,
		AttachmentBytesNote:     BlobAttachmentBytesNoteVN,
		Subscriptions:           []BackupSubscription{},
		Wishlist:                []BackupWishlistItem{},
		Devices: []BackupDevice{{
			ID: "zz_test_manifest_dev", Name: "Thiết bị", Category: "PHONE",
			PurchaseDate: "2025-01-01T00:00:00Z", PurchasePrice: 1, Status: "ACTIVE",
			CreatedAt: "2025-01-01T00:00:00Z", UpdatedAt: "2025-01-01T00:00:00Z",
			Warranties: []BackupWarranty{},
			Attachments: []BackupAttachment{{
				ID: "zz_test_manifest_att", FileName: "f.png",
				StoragePath: "zz_test_manifest_dev/abc.enc", FileType: "image/png", FileSize: 10,
				IV: iv, WrappedKey: wk, UploadedAt: "2025-01-01T00:00:00Z",
			}},
		}},
	}
	_, err = ImportBackup(ctx, pool, "zz_test_manifest_user", payload, ImportMerge)
	if err == nil {
		t.Fatal("ImportBackup(blob manifest alone) = nil, want VALIDATION pointing at the .zip")
	}
	svc, ok := As(err)
	if !ok || svc.Code != "VALIDATION" {
		t.Fatalf("error = %v, want VALIDATION", err)
	}
	if !strings.Contains(svc.Message, ".zip") {
		t.Errorf("message %q does not tell the user to import the .zip", svc.Message)
	}

	// A v6 envelope WITHOUT attachments has nothing to lose and stays importable
	// (defensive: a future format might bump the version for other reasons).
	empty := &BackupExport{
		Version: BackupVersion, ExportedAt: "2025-01-01T00:00:00Z", IncludesAttachmentBytes: true,
		Subscriptions: []BackupSubscription{}, Wishlist: []BackupWishlistItem{}, Devices: []BackupDevice{},
	}
	if _, err := ImportBackup(ctx, pool, "zz_test_manifest_user", empty, ImportMerge); err != nil {
		t.Errorf("ImportBackup(v6, no attachments) = %v, want success", err)
	}
}
