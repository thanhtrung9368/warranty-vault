package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Capture-first inbox (roadmap #12 / migration 0018). These tests run only with
// WV_TEST_DATABASE_URL pointing at a throwaway Postgres; they use the real
// encryption pipeline and a temp PRIVATE_UPLOAD_ROOT, so "the blob moved with the
// row" is asserted on disk rather than inferred.
//
// One user in these tests has NO inbox items for the specific purpose of proving
// the old device-only flow is unchanged (rules: "no behavioural change on every
// existing endpoint") — see TestDeviceAttachmentFlowUnchangedWithoutInboxRows.

type inboxTestEnv struct {
	pool          *pgxpool.Pool
	dsn           string
	userID        string
	otherUserID   string
	deviceID      string
	device2ID     string
	otherDeviceID string
}

func setupInboxTestEnv(t *testing.T) *inboxTestEnv {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir())
	t.Setenv("FILE_MASTER_KEY", testMasterKeyB64)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	// Unique ids: these tests share one database with the rest of the package, so
	// a fixed fixture name would collide with a previous failed run.
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	env := &inboxTestEnv{
		pool:          pool,
		dsn:           dsn,
		userID:        "zz_inbox_user_" + suffix,
		otherUserID:   "zz_inbox_other_" + suffix,
		deviceID:      "zz_inbox_dev_" + suffix,
		device2ID:     "zz_inbox_dev2_" + suffix,
		otherDeviceID: "zz_inbox_other_dev_" + suffix,
	}
	for _, u := range []string{env.userID, env.otherUserID} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())
			 ON CONFLICT (id) DO NOTHING`, u, u+"@example.invalid"); err != nil {
			t.Fatalf("insert user %s: %v", u, err)
		}
	}
	for _, d := range []struct{ id, user string }{
		{env.deviceID, env.userID},
		{env.device2ID, env.userID},
		{env.otherDeviceID, env.otherUserID},
	} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", "updatedAt")
			 VALUES ($1, $2, 'Thiết bị test', 'PHONE', NOW(), 0, NOW())`, d.id, d.user); err != nil {
			t.Fatalf("insert device %s: %v", d.id, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`,
			[]string{env.userID, env.otherUserID})
	})
	return env
}

// uploadForTest drives the real pipeline. A nil deviceID is an inbox upload.
func uploadForTest(t *testing.T, e *inboxTestEnv, userID string, deviceID *string, body []byte) store.Attachment {
	t.Helper()
	att, err := Upload(context.Background(), e.pool, userID, UploadAttachmentInput{
		DeviceID:   deviceID,
		FileName:   "hoa-don.png",
		DeclaredCT: "image/png",
		Body:       body,
	})
	if err != nil {
		t.Fatalf("Upload(deviceID=%v): %v", deviceID, err)
	}
	return att
}

func countForDevice(t *testing.T, e *inboxTestEnv, deviceID string) int64 {
	t.Helper()
	n, err := store.New(e.pool).CountAttachmentsByDevice(context.Background(), &deviceID)
	if err != nil {
		t.Fatalf("count attachments for %s: %v", deviceID, err)
	}
	return n
}

func blobPath(t *testing.T, att store.Attachment) string {
	t.Helper()
	return filepath.Join(files.PrivateUploadRoot(), att.StoragePath)
}

func streamBytes(t *testing.T, e *inboxTestEnv, userID, attachmentID string) []byte {
	t.Helper()
	_, _, rc, _, err := OpenStream(context.Background(), e.pool, userID, attachmentID)
	if err != nil {
		t.Fatalf("OpenStream(%s): %v", attachmentID, err)
	}
	defer func() { _ = rc.Close() }()
	b, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	return b
}

// ── 1. The lifecycle: create in the inbox, read it, file it, return it, delete it.

func TestInboxAttachmentLifecycleAgainstRealPostgres(t *testing.T) {
	e := setupInboxTestEnv(t)
	ctx := viCtx()

	deviceBody := tinyPNG(t)
	deviceAtt := uploadForTest(t, e, e.userID, &e.deviceID, deviceBody)
	if deviceAtt.DeviceId == nil || *deviceAtt.DeviceId != e.deviceID {
		t.Fatalf("device upload landed on %v, want %s", deviceAtt.DeviceId, e.deviceID)
	}
	if deviceAtt.UserId != e.userID {
		t.Errorf("device upload owner = %q, want %q", deviceAtt.UserId, e.userID)
	}
	if !strings.HasPrefix(deviceAtt.StoragePath, e.deviceID+"/") {
		t.Errorf("device storagePath = %q, want prefix %q", deviceAtt.StoragePath, e.deviceID+"/")
	}

	inboxBody := tinyPNG(t)
	inboxAtt := uploadForTest(t, e, e.userID, nil, inboxBody)
	if inboxAtt.DeviceId != nil {
		t.Fatalf("inbox upload has deviceId %v, want nil", *inboxAtt.DeviceId)
	}
	if inboxAtt.UserId != e.userID {
		t.Errorf("inbox upload owner = %q, want %q", inboxAtt.UserId, e.userID)
	}
	if !strings.HasPrefix(inboxAtt.StoragePath, InboxStorageSegment+"/") {
		t.Errorf("inbox storagePath = %q, want prefix %q", inboxAtt.StoragePath, InboxStorageSegment+"/")
	}
	if _, err := os.Stat(blobPath(t, inboxAtt)); err != nil {
		t.Fatalf("inbox blob missing after upload: %v", err)
	}

	// The same upload gates apply to an inbox item: an unsupported MIME and an
	// oversized body are refused before anything is written.
	if _, err := Upload(ctx, e.pool, e.userID, UploadAttachmentInput{
		FileName: "notes.txt", DeclaredCT: "text/plain", Body: []byte("just some text"),
	}); err == nil {
		t.Fatal("inbox upload of text/plain = nil, want bad_input")
	} else if ae, ok := AsAttachmentError(err); !ok || ae.Code != "bad_input" {
		t.Errorf("inbox upload of text/plain = %v, want bad_input", err)
	}
	if _, err := Upload(ctx, e.pool, e.userID, UploadAttachmentInput{
		FileName: "huge.png", DeclaredCT: "image/png", Body: make([]byte, MaxAttachmentBytes+1),
	}); err == nil {
		t.Fatal("inbox upload over 5 MB = nil, want bad_input")
	} else if ae, ok := AsAttachmentError(err); !ok || ae.Code != "bad_input" {
		t.Errorf("inbox upload over 5 MB = %v, want bad_input", err)
	}

	// Returning an already-inbox item to the inbox is a no-op, not an error and
	// not a slot change (the endpoint must be safe to retry).
	if same, err := FileAttachment(ctx, e.pool, e.userID, inboxAtt.ID, nil); err != nil {
		t.Fatalf("FileAttachment(nil) on an inbox item: %v", err)
	} else if same.DeviceId != nil || same.StoragePath != inboxAtt.StoragePath {
		t.Errorf("inbox no-op changed the row: %+v", same)
	}

	// Missing attachment and malformed device id are the two 4xx shapes.
	if _, err := FileAttachment(ctx, e.pool, e.userID, "zz_inbox_missing_attachment", nil); err == nil {
		t.Fatal("FileAttachment(missing) = nil, want not_found")
	} else if ae, ok := AsAttachmentError(err); !ok || ae.Code != "not_found" {
		t.Errorf("FileAttachment(missing) = %v, want not_found", err)
	}
	if _, err := FileAttachment(ctx, e.pool, e.userID, inboxAtt.ID, strp("../etc/passwd")); err == nil {
		t.Fatal("FileAttachment(unsafe device) = nil, want bad_input")
	} else if ae, ok := AsAttachmentError(err); !ok || ae.Code != "bad_input" {
		t.Errorf("FileAttachment(unsafe device) = %v, want bad_input", err)
	}

	// 3. GET /api/v1/inbox is owner-scoped and excludes device-filed rows.
	inbox, err := ListInbox(ctx, e.pool, e.userID)
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if len(inbox) != 1 || inbox[0].ID != inboxAtt.ID {
		t.Fatalf("ListInbox = %d rows, want the one inbox item", len(inbox))
	}
	otherInbox, err := ListInbox(ctx, e.pool, e.otherUserID)
	if err != nil {
		t.Fatalf("ListInbox(other): %v", err)
	}
	if len(otherInbox) != 0 {
		t.Errorf("other user's inbox = %d rows, want 0", len(otherInbox))
	}

	// The device list still returns only that device's rows.
	byDevice, err := ListAttachmentsByDevice(ctx, e.pool, e.userID, e.deviceID)
	if err != nil {
		t.Fatalf("ListAttachmentsByDevice: %v", err)
	}
	if len(byDevice) != 1 || byDevice[0].ID != deviceAtt.ID {
		t.Fatalf("device list = %d rows, want only the device item", len(byDevice))
	}

	// Rule 6 in its simplest form: the inbox item is not on the device's count.
	if got := countForDevice(t, e, e.deviceID); got != 1 {
		t.Errorf("CountAttachmentsByDevice = %d, want 1 (inbox item must not count)", got)
	}

	// The 100 MB ceiling still counts everything.
	sum, err := store.New(e.pool).SumAttachmentBytesByUser(ctx, e.userID)
	if err != nil {
		t.Fatalf("SumAttachmentBytesByUser: %v", err)
	}
	if want := int64(deviceAtt.FileSize) + int64(inboxAtt.FileSize); sum != want {
		t.Errorf("SumAttachmentBytesByUser = %d, want %d (inbox items count)", sum, want)
	}

	// Inbox ownership is a real boundary: another user's lookup is a 404-mapped
	// not_found, never a success and never a 403.
	if _, err := GetAttachmentForUser(ctx, e.pool, e.otherUserID, inboxAtt.ID); err == nil {
		t.Fatal("GetAttachmentForUser(other) = nil, want not_found")
	} else if ae, ok := AsAttachmentError(err); !ok || ae.Code != "not_found" {
		t.Errorf("GetAttachmentForUser(other) = %v, want AttachmentError{not_found}", err)
	}

	// The inbox blob is a normal attachment as far as GET /api/files is concerned.
	if got := streamBytes(t, e, e.userID, inboxAtt.ID); !bytes.Equal(got, inboxBody) {
		t.Errorf("streamed inbox bytes differ from the upload (%d vs %d bytes)", len(got), len(inboxBody))
	}

	// PATCH still edits description only, and now works on an inbox item.
	desc := "Hoá đơn chờ gán"
	patched, err := UpdateDescription(ctx, e.pool, e.userID, inboxAtt.ID, &desc)
	if err != nil {
		t.Fatalf("UpdateDescription(inbox): %v", err)
	}
	if patched.Description == nil || *patched.Description != desc {
		t.Errorf("description = %v, want %q", patched.Description, desc)
	}

	// 4. File it to the device. The blob follows the row.
	filed, err := FileAttachment(ctx, e.pool, e.userID, inboxAtt.ID, &e.deviceID)
	if err != nil {
		t.Fatalf("FileAttachment: %v", err)
	}
	if filed.DeviceId == nil || *filed.DeviceId != e.deviceID {
		t.Fatalf("filed.DeviceId = %v, want %s", filed.DeviceId, e.deviceID)
	}
	if !strings.HasPrefix(filed.StoragePath, e.deviceID+"/") {
		t.Errorf("filed storagePath = %q, want prefix %q", filed.StoragePath, e.deviceID+"/")
	}
	if _, err := os.Stat(blobPath(t, inboxAtt)); !os.IsNotExist(err) {
		t.Errorf("old inbox blob still exists at %s; filing should move it", inboxAtt.StoragePath)
	}
	if _, err := os.Stat(blobPath(t, filed)); err != nil {
		t.Errorf("filed blob missing at %s: %v", filed.StoragePath, err)
	}
	if got := streamBytes(t, e, e.userID, inboxAtt.ID); !bytes.Equal(got, inboxBody) {
		t.Error("filed attachment no longer decrypts to the original bytes")
	}
	if got := countForDevice(t, e, e.deviceID); got != 2 {
		t.Errorf("device count after filing = %d, want 2", got)
	}
	if inbox, _ := ListInbox(ctx, e.pool, e.userID); len(inbox) != 0 {
		t.Errorf("inbox after filing = %d rows, want 0", len(inbox))
	}

	// Re-filing to the same device is an idempotent no-op, not a sixth slot.
	if _, err := FileAttachment(ctx, e.pool, e.userID, inboxAtt.ID, &e.deviceID); err != nil {
		t.Fatalf("re-file to the same device: %v", err)
	}
	if got := countForDevice(t, e, e.deviceID); got != 2 {
		t.Errorf("count after idempotent re-file = %d, want 2", got)
	}

	// deviceId: null returns it to the inbox (and moves the blob back).
	unfiled, err := FileAttachment(ctx, e.pool, e.userID, inboxAtt.ID, nil)
	if err != nil {
		t.Fatalf("FileAttachment(nil): %v", err)
	}
	if unfiled.DeviceId != nil {
		t.Errorf("unfiled.DeviceId = %v, want nil", unfiled.DeviceId)
	}
	if !strings.HasPrefix(unfiled.StoragePath, InboxStorageSegment+"/") {
		t.Errorf("unfiled storagePath = %q, want inbox segment", unfiled.StoragePath)
	}
	if _, err := os.Stat(blobPath(t, unfiled)); err != nil {
		t.Errorf("blob missing after unfiling: %v", err)
	}
	if inbox, _ := ListInbox(ctx, e.pool, e.userID); len(inbox) != 1 {
		t.Errorf("inbox after unfiling = %d rows, want 1", len(inbox))
	}
	if got := countForDevice(t, e, e.deviceID); got != 1 {
		t.Errorf("device count after unfiling = %d, want 1", got)
	}

	// 404s: another user cannot file it, and the owner cannot file it onto
	// another user's device.
	if _, err := FileAttachment(ctx, e.pool, e.otherUserID, inboxAtt.ID, &e.otherDeviceID); err == nil {
		t.Fatal("FileAttachment(other user, other device) = nil, want not_found")
	} else if ae, ok := AsAttachmentError(err); !ok || ae.Code != "not_found" {
		t.Errorf("cross-user FileAttachment = %v, want not_found", err)
	}
	if _, err := FileAttachment(ctx, e.pool, e.userID, inboxAtt.ID, &e.otherDeviceID); err == nil {
		t.Fatal("FileAttachment(owner, foreign device) = nil, want not_found")
	} else if ae, ok := AsAttachmentError(err); !ok || ae.Code != "not_found" {
		t.Errorf("foreign-device FileAttachment = %v, want not_found", err)
	}

	// 7. DELETE removes an inbox item AND its blob.
	deletePath := unfiled.StoragePath
	if err := Delete(ctx, e.pool, e.userID, unfiled.ID); err != nil {
		t.Fatalf("Delete(inbox): %v", err)
	}
	if _, err := GetAttachmentForUser(ctx, e.pool, e.userID, unfiled.ID); err == nil {
		t.Error("deleted inbox item is still readable")
	}
	if _, err := os.Stat(filepath.Join(files.PrivateUploadRoot(), deletePath)); !os.IsNotExist(err) {
		t.Errorf("inbox blob still on disk after DELETE: %v", err)
	}
}

// ── 2. The per-device cap counts filed attachments only.

func TestInboxItemDoesNotConsumeDeviceCapAndFilingAtCapIs409(t *testing.T) {
	e := setupInboxTestEnv(t)
	ctx := viCtx()

	for i := 0; i < 4; i++ {
		uploadForTest(t, e, e.userID, &e.deviceID, tinyPNG(t))
	}
	if got := countForDevice(t, e, e.deviceID); got != 4 {
		t.Fatalf("setup count = %d, want 4", got)
	}

	first := uploadForTest(t, e, e.userID, nil, tinyPNG(t))
	if got := countForDevice(t, e, e.deviceID); got != 4 {
		t.Errorf("inbox upload changed the device count to %d, want 4", got)
	}

	filed, err := FileAttachment(ctx, e.pool, e.userID, first.ID, &e.deviceID)
	if err != nil {
		t.Fatalf("filing the 5th slot: %v", err)
	}
	if filed.DeviceId == nil || *filed.DeviceId != e.deviceID {
		t.Fatalf("filed.DeviceId = %v, want %s", filed.DeviceId, e.deviceID)
	}
	if got := countForDevice(t, e, e.deviceID); got != 5 {
		t.Fatalf("count after filing = %d, want 5", got)
	}

	second := uploadForTest(t, e, e.userID, nil, tinyPNG(t))
	if got := countForDevice(t, e, e.deviceID); got != 5 {
		t.Errorf("creating another inbox item changed the count to %d, want 5", got)
	}

	_, err = FileAttachment(ctx, e.pool, e.userID, second.ID, &e.deviceID)
	if err == nil {
		t.Fatal("filing at the cap = nil, want LIMIT_REACHED")
	}
	svc, ok := As(err)
	if !ok || svc.Code != "LIMIT_REACHED" {
		t.Fatalf("filing at the cap = %#v, want *Error{LIMIT_REACHED}", err)
	}
	if got := svc.HTTPStatus(); got != 409 {
		t.Errorf("LIMIT_REACHED status = %d, want 409", got)
	}
	if svc.Message != "Tối đa 5 file/thiết bị" {
		t.Errorf("message = %q, want the existing ceiling sentence", svc.Message)
	}

	// A refused item stays in the inbox; nothing was moved or lost.
	inbox, err := ListInbox(ctx, e.pool, e.userID)
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if len(inbox) != 1 || inbox[0].ID != second.ID || inbox[0].DeviceId != nil {
		t.Fatalf("inbox after the 409 = %+v, want the refused item untouched", inbox)
	}

	// …and re-filing the item already on the full device does NOT 409: it is one
	// of the five, not a sixth.
	if _, err := FileAttachment(ctx, e.pool, e.userID, first.ID, &e.deviceID); err != nil {
		t.Errorf("re-filing an item to its own full device = %v, want success", err)
	}

	// The 100 MB per-user ceiling is about bytes on disk, so an inbox item DOES
	// count. Seed an inbox row that already fills the allowance (no blob needed:
	// the cap is arithmetic on fileSize) and assert the next inbox upload is
	// refused. This is the other half of rule 6.
	if _, err := e.pool.Exec(ctx,
		`INSERT INTO "Attachment" (id, "userId", "deviceId", "fileName", "storagePath", "fileType", "fileSize", iv, "wrappedKey", "uploadedAt")
		 VALUES ('zz_inbox_big_' || $1, $2, NULL, 'big.bin', '_inbox/big.enc', 'image/png', $3, '\x00'::bytea, '\x00'::bytea, NOW())`,
		e.userID, e.userID, int32(MaxUploadBytesPerUser)); err != nil {
		t.Fatalf("seed inbox row at the per-user ceiling: %v", err)
	}
	_, err = Upload(ctx, e.pool, e.userID, UploadAttachmentInput{
		FileName: "hoa-don.png", DeclaredCT: "image/png", Body: tinyPNG(t),
	})
	if err == nil {
		t.Fatal("inbox upload with a full 100 MB inbox = nil, want limit_reached")
	}
	ae, ok := AsAttachmentError(err)
	if !ok || ae.Code != "limit_reached" {
		t.Fatalf("per-user cap error = %#v, want AttachmentError{limit_reached}", err)
	}
	if !strings.Contains(ae.Message, "100MB") {
		t.Errorf("per-user cap message = %q, want the 100 MB sentence", ae.Message)
	}
}

// ── 3. Moving an already-filed attachment is allowed and counts the TARGET cap.

func TestRefilingToDifferentDeviceCountsTargetCap(t *testing.T) {
	e := setupInboxTestEnv(t)
	ctx := viCtx()

	var aIDs []string
	for i := 0; i < 5; i++ {
		aIDs = append(aIDs, uploadForTest(t, e, e.userID, &e.deviceID, tinyPNG(t)).ID)
	}

	// A → B (B was empty) is a real correction and succeeds.
	moved, err := FileAttachment(ctx, e.pool, e.userID, aIDs[0], &e.device2ID)
	if err != nil {
		t.Fatalf("move A→B: %v", err)
	}
	if got := countForDevice(t, e, e.deviceID); got != 4 {
		t.Errorf("A count = %d, want 4", got)
	}
	if got := countForDevice(t, e, e.device2ID); got != 1 {
		t.Errorf("B count = %d, want 1", got)
	}

	// Fill B.
	for i := 0; i < 4; i++ {
		uploadForTest(t, e, e.userID, &e.device2ID, tinyPNG(t))
	}
	if got := countForDevice(t, e, e.device2ID); got != 5 {
		t.Fatalf("B count = %d, want 5", got)
	}

	// A second move A→B must be refused by the TARGET's cap.
	_, err = FileAttachment(ctx, e.pool, e.userID, aIDs[1], &e.device2ID)
	if err == nil {
		t.Fatal("move A→B at B's cap = nil, want LIMIT_REACHED")
	}
	svc, ok := As(err)
	if !ok || svc.Code != "LIMIT_REACHED" || svc.HTTPStatus() != 409 {
		t.Fatalf("move A→B at cap = %#v, want 409 LIMIT_REACHED", err)
	}
	stillA, err := GetAttachmentForUser(ctx, e.pool, e.userID, aIDs[1])
	if err != nil {
		t.Fatalf("get refused attachment: %v", err)
	}
	if stillA.DeviceId == nil || *stillA.DeviceId != e.deviceID {
		t.Errorf("refused attachment moved to %v, want it to stay on A", stillA.DeviceId)
	}

	// Moving back B→A is allowed (A has room) and frees a B slot.
	if _, err := FileAttachment(ctx, e.pool, e.userID, moved.ID, &e.deviceID); err != nil {
		t.Fatalf("move B→A: %v", err)
	}
	if got := countForDevice(t, e, e.deviceID); got != 5 {
		t.Errorf("A count after B→A = %d, want 5", got)
	}
	if got := countForDevice(t, e, e.device2ID); got != 4 {
		t.Errorf("B count after B→A = %d, want 4", got)
	}
}

// ── 4. No inbox items ⇒ the old flow is byte-identical (and old payloads import).

func TestDeviceAttachmentFlowUnchangedWithoutInboxRows(t *testing.T) {
	e := setupInboxTestEnv(t)
	ctx := viCtx()

	var last store.Attachment
	for i := 0; i < 5; i++ {
		last = uploadForTest(t, e, e.userID, &e.deviceID, tinyPNG(t))
	}

	// The upload path's ceiling is still AttachmentError{limit_reached}, which the
	// handler maps to 400 (NOT the new filing endpoint's 409).
	_, err := Upload(ctx, e.pool, e.userID, UploadAttachmentInput{
		DeviceID: &e.deviceID, FileName: "hoa-don.png", DeclaredCT: "image/png", Body: tinyPNG(t),
	})
	if err == nil {
		t.Fatal("6th device upload = nil, want limit_reached")
	}
	ae, ok := AsAttachmentError(err)
	if !ok || ae.Code != "limit_reached" {
		t.Fatalf("6th device upload = %#v, want AttachmentError{limit_reached}", err)
	}
	if ae.Message != "Tối đa 5 file/thiết bị" {
		t.Errorf("message = %q", ae.Message)
	}

	if inbox, _ := ListInbox(ctx, e.pool, e.userID); len(inbox) != 0 {
		t.Errorf("user without inbox uploads has %d inbox rows, want 0", len(inbox))
	}
	if got := countForDevice(t, e, e.deviceID); got != 5 {
		t.Errorf("device count = %d, want 5", got)
	}
	rows, err := ListAttachmentsByDevice(ctx, e.pool, e.userID, e.deviceID)
	if err != nil || len(rows) != 5 {
		t.Fatalf("ListAttachmentsByDevice = %d rows, err=%v; want 5", len(rows), err)
	}
	sum, _ := store.New(e.pool).SumAttachmentBytesByUser(ctx, e.userID)
	var wantSum int64
	for _, r := range rows {
		wantSum += int64(r.FileSize)
	}
	if sum != wantSum {
		t.Errorf("SumAttachmentBytesByUser = %d, want %d", sum, wantSum)
	}

	// PATCH-by-description and download still behave.
	desc := "Hoá đơn FPT Shop"
	if _, err := UpdateDescription(ctx, e.pool, e.userID, last.ID, &desc); err != nil {
		t.Fatalf("UpdateDescription: %v", err)
	}
	if got := streamBytes(t, e, e.userID, last.ID); len(got) == 0 {
		t.Error("device attachment stream is empty")
	}

	// The v5 export for a user with no inbox items is byte-identical to before:
	// `inboxAttachments` is omitted entirely.
	payload, err := ExportBackup(ctx, e.pool, e.userID)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	if payload.InboxAttachments != nil {
		t.Errorf("InboxAttachments = %v, want nil", payload.InboxAttachments)
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	if strings.Contains(string(raw), "inboxAttachments") {
		t.Error("v5 JSON contains inboxAttachments for a user with no inbox items")
	}

	// Old-shaped payload (no `inboxAttachments` key at all) still imports. The
	// target is a clean database with the SAME user id, which is how a real
	// restore works (rows are restored under the importing account's id).
	targetDSN := createScratchDatabase(t, e.dsn)
	gooseUp(t, targetDSN)
	target, err := pgxpool.New(context.Background(), targetDSN)
	if err != nil {
		t.Fatalf("connect import target: %v", err)
	}
	t.Cleanup(target.Close)
	if _, err := target.Exec(context.Background(),
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`,
		e.userID, e.userID+"@import.invalid"); err != nil {
		t.Fatalf("insert import user: %v", err)
	}
	if _, err := ImportBackup(context.Background(), target, e.userID, payload, ImportReplace); err != nil {
		t.Fatalf("ImportBackup(old-shaped v5): %v", err)
	}
	imported, err := ListAttachmentsByDevice(context.Background(), target, e.userID, e.deviceID)
	if err != nil || len(imported) != 5 {
		t.Fatalf("imported device attachments = %d, err=%v; want 5", len(imported), err)
	}
	if inbox, _ := ListInbox(context.Background(), target, e.userID); len(inbox) != 0 {
		t.Errorf("imported old payload produced %d inbox rows, want 0", len(inbox))
	}

	// DELETE still removes the device row's blob.
	path := blobPath(t, last)
	if err := Delete(ctx, e.pool, e.userID, last.ID); err != nil {
		t.Fatalf("Delete(device attachment): %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("device blob still on disk after DELETE: %v", err)
	}
}

// ── 5. Backup: inbox items travel (metadata and, for the ZIP, bytes).

func TestBackupInboxAttachmentsRoundTrip(t *testing.T) {
	e := setupInboxTestEnv(t)
	ctx := context.Background()
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir()) // fresh source root

	deviceBody := tinyPNG(t)
	uploadForTest(t, e, e.userID, &e.deviceID, deviceBody)
	inboxBody := tinyPNG(t)
	inboxAtt := uploadForTest(t, e, e.userID, nil, inboxBody)

	payload, err := ExportBackup(ctx, e.pool, e.userID)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	if len(payload.InboxAttachments) != 1 {
		t.Fatalf("InboxAttachments = %d, want 1", len(payload.InboxAttachments))
	}
	if payload.InboxAttachments[0].ID != inboxAtt.ID {
		t.Errorf("exported inbox id = %q, want %q", payload.InboxAttachments[0].ID, inboxAtt.ID)
	}
	if !strings.HasPrefix(payload.InboxAttachments[0].StoragePath, InboxStorageSegment+"/") {
		t.Errorf("exported inbox path = %q, want the reserved segment", payload.InboxAttachments[0].StoragePath)
	}
	// The fixture user owns two devices; only one carries the uploaded receipt.
	attachmentsInDevices := 0
	for _, d := range payload.Devices {
		attachmentsInDevices += len(d.Attachments)
	}
	if len(payload.Devices) != 2 || attachmentsInDevices != 1 {
		t.Fatalf("device section = %d devices / %d attachments, want 2/1",
			len(payload.Devices), attachmentsInDevices)
	}
	raw, _ := json.Marshal(payload)
	if !strings.Contains(string(raw), `"inboxAttachments"`) {
		t.Error("v5 JSON is missing inboxAttachments when the user has an inbox item")
	}

	// Metadata import (JSON path): the row is restored as an inbox item owned by
	// the importing account, with no device.
	metaDSN := createScratchDatabase(t, e.dsn)
	gooseUp(t, metaDSN)
	metaPool, err := pgxpool.New(ctx, metaDSN)
	if err != nil {
		t.Fatalf("connect metadata target: %v", err)
	}
	t.Cleanup(metaPool.Close)
	if _, err := metaPool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`,
		e.userID, e.userID+"@meta.invalid"); err != nil {
		t.Fatalf("insert metadata import user: %v", err)
	}
	if _, err := ImportBackup(ctx, metaPool, e.userID, payload, ImportReplace); err != nil {
		t.Fatalf("ImportBackup: %v", err)
	}
	metaInbox, err := ListInbox(ctx, metaPool, e.userID)
	if err != nil || len(metaInbox) != 1 {
		t.Fatalf("imported metadata inbox = %d rows, err=%v; want 1", len(metaInbox), err)
	}
	if metaInbox[0].ID != inboxAtt.ID || metaInbox[0].DeviceId != nil || metaInbox[0].UserId != e.userID {
		t.Errorf("imported metadata row = %+v", metaInbox[0])
	}

	// ZIP path: the encrypted bytes of an inbox item travel too, and decrypt on a
	// target whose PRIVATE_UPLOAD_ROOT is a different directory.
	var archive bytes.Buffer
	if _, err := WriteBackupZip(ctx, e.pool, e.userID, &archive); err != nil {
		t.Fatalf("WriteBackupZip: %v", err)
	}
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir())

	zipDSN := createScratchDatabase(t, e.dsn)
	gooseUp(t, zipDSN)
	zipPool, err := pgxpool.New(ctx, zipDSN)
	if err != nil {
		t.Fatalf("connect zip target: %v", err)
	}
	t.Cleanup(zipPool.Close)
	if _, err := zipPool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt") VALUES ($1, $2, 'x', NOW())`,
		e.userID, e.userID+"@zip.invalid"); err != nil {
		t.Fatalf("insert zip import user: %v", err)
	}
	res, err := ImportBackupZip(ctx, zipPool, e.userID, archive.Bytes(), ImportReplace)
	if err != nil {
		t.Fatalf("ImportBackupZip: %v", err)
	}
	if res.AttachmentsImported != 2 {
		t.Errorf("attachmentsImported = %d, want 2 (one device + one inbox)", res.AttachmentsImported)
	}
	zipInbox, err := ListInbox(ctx, zipPool, e.userID)
	if err != nil || len(zipInbox) != 1 {
		t.Fatalf("restored inbox = %d rows, err=%v; want 1", len(zipInbox), err)
	}
	got := streamBytesFrom(t, zipPool, e.userID, zipInbox[0].ID)
	if !bytes.Equal(got, inboxBody) {
		t.Errorf("restored inbox blob differs from the original (%d vs %d bytes)", len(got), len(inboxBody))
	}
}

// streamBytesFrom is streamBytes for a pool that is not the fixture's.
func streamBytesFrom(t *testing.T, pool *pgxpool.Pool, userID, attachmentID string) []byte {
	t.Helper()
	_, _, rc, _, err := OpenStream(context.Background(), pool, userID, attachmentID)
	if err != nil {
		t.Fatalf("OpenStream(%s): %v", attachmentID, err)
	}
	defer func() { _ = rc.Close() }()
	b, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("read stream: %v", err)
	}
	return b
}
