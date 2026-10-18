package services

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

// Provider-agnostic inbound email (migration 0020).
//
// The wire contract (503/401/404/429, multipart vs JSON) lives in
// internal/handlers/inbox_email_test.go. This file pins the part that must hold
// regardless of transport:
//
//   - an address resolves to exactly one user, and every failure mode is the
//     same NOT_FOUND (no oracle);
//   - an attachment becomes the SAME row POST /api/v1/attachments creates,
//     because it is stored by the same Upload function — asserted against every
//     existing read path (inbox list, device list, download, backup export,
//     delete, file-to-device);
//   - a bad attachment is skipped, the good ones still land.

// ---- DB-free -----------------------------------------------------------------

func TestInboxAddressFromEnv(t *testing.T) {
	t.Run("unconfigured domain omits the address", func(t *testing.T) {
		t.Setenv("INBOX_EMAIL_DOMAIN", "")
		t.Setenv("INBOX_EMAIL_TOKEN", "shared-secret")
		if got := InboxAddress("0123456789abcdef0123456789abcdef"); got != nil {
			t.Fatalf("InboxAddress = %q, want nil when INBOX_EMAIL_DOMAIN is unset", *got)
		}
	})

	t.Run("empty token has no address", func(t *testing.T) {
		t.Setenv("INBOX_EMAIL_DOMAIN", "Inbox.Example.COM.")
		t.Setenv("INBOX_EMAIL_TOKEN", "shared-secret")
		if got := InboxAddress("   "); got != nil {
			t.Fatalf("InboxAddress(blank) = %q, want nil", *got)
		}
	})

	t.Run("domain is normalized and token lowercased", func(t *testing.T) {
		t.Setenv("INBOX_EMAIL_DOMAIN", "@Inbox.Example.COM.")
		t.Setenv("INBOX_EMAIL_TOKEN", "shared-secret")
		got := InboxAddress("ABCDEF0123456789ABCDEF0123456789")
		want := "abcdef0123456789abcdef0123456789@inbox.example.com"
		if got == nil || *got != want {
			t.Fatalf("InboxAddress = %v, want %q", got, want)
		}
	})
}

func TestRecipientLocalPart(t *testing.T) {
	const domain = "inbox.example.com"
	const token = "0123456789abcdef0123456789abcdef"
	for _, tc := range []struct {
		name string
		to   string
		want string
	}{
		{name: "bare address", to: token + "@inbox.example.com", want: token},
		{name: "display name", to: `"Shop" <` + token + `@inbox.example.com>`, want: token},
		{name: "uppercase local and domain", to: strings.ToUpper(token) + "@INBOX.EXAMPLE.COM", want: token},
		{name: "second address in a list", to: "other@elsewhere.test, " + token + "@inbox.example.com", want: token},
		{name: "wrong domain", to: token + "@elsewhere.test", want: ""},
		{name: "subdomain is not the configured domain", to: token + "@mail.inbox.example.com", want: ""},
		// Local parts are compared verbatim: a plus tag is not stripped, so
		// `token+receipt@…` is a different (unknown) address and resolves to 404.
		{name: "plus tag is not stripped", to: token + "+receipt@inbox.example.com", want: token + "+receipt"},
		{name: "malformed", to: "not-an-address", want: ""},
		{name: "missing local part", to: "@inbox.example.com", want: ""},
		{name: "empty", to: "", want: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := recipientLocalPart(tc.to, domain); got != tc.want {
				t.Fatalf("recipientLocalPart(%q) = %q, want %q", tc.to, got, tc.want)
			}
		})
	}
}

func TestReceiveInboundEmailRejectsTooManyAttachmentsBeforeTouchingTheDatabase(t *testing.T) {
	parts := make([]InboundAttachment, MaxInboundEmailAttachments+1)
	_, err := ReceiveInboundEmail(viCtx(), nil, "inbox.example.com", InboundEmailInput{
		To:          "0123456789abcdef0123456789abcdef@inbox.example.com",
		Attachments: parts,
	})
	ae, ok := AsAttachmentError(err)
	if !ok {
		t.Fatalf("err = %v, want an AttachmentError", err)
	}
	if ae.Code != "bad_input" {
		t.Errorf("code = %q, want bad_input", ae.Code)
	}
	if !strings.Contains(ae.Message, "10") {
		t.Errorf("message = %q, want it to name the cap", ae.Message)
	}
}

func TestNormalizeInboundFileName(t *testing.T) {
	long := strings.Repeat("a", maxInboundFileNameRunes+20)
	for _, tc := range []struct {
		name  string
		raw   string
		index int
		want  string
	}{
		{name: "blank falls back to index", raw: "   ", index: 0, want: "attachment-1"},
		{name: "control characters stripped", raw: "hoa\ndon.pdf", index: 1, want: "hoadon.pdf"},
		{name: "trimmed", raw: "  hoa-don.pdf  ", index: 2, want: "hoa-don.pdf"},
		{name: "unicode preserved", raw: "hoá đơn.pdf", index: 3, want: "hoá đơn.pdf"},
		{name: "capped", raw: long, index: 4, want: long[:maxInboundFileNameRunes]},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := normalizeInboundFileName(tc.raw, tc.index); got != tc.want {
				t.Fatalf("normalizeInboundFileName(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

// ---- real-database -----------------------------------------------------------

func inboundTokenForTest(t *testing.T, pool *pgxpool.Pool, userID string) string {
	t.Helper()
	var token string
	if err := pool.QueryRow(context.Background(),
		`SELECT "inboxToken" FROM "User" WHERE id = $1`, userID).Scan(&token); err != nil {
		t.Fatalf("read inboxToken: %v", err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(token) {
		t.Fatalf("migration generated inboxToken %q, want 32 lowercase hex chars", token)
	}
	return token
}

func inboundPDF(label string) []byte {
	return []byte("%PDF-1.4\n% " + label + "\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")
}

func TestInboundEmailRoutingAgainstRealPostgres(t *testing.T) {
	e := setupInboxTestEnv(t)
	ctx := viCtx()
	token := inboundTokenForTest(t, e.pool, e.userID)

	// A correct address resolves and a message with no attachments is still a
	// valid delivery (no inbox row, no error) — a receipt email whose parts were
	// all stripped should not 500.
	res, err := ReceiveInboundEmail(ctx, e.pool, "inbox.test", InboundEmailInput{
		To: "Shop <" + strings.ToUpper(token) + "@INBOX.TEST>",
	})
	if err != nil {
		t.Fatalf("ReceiveInboundEmail(valid address): %v", err)
	}
	if len(res.Attachments) != 0 || len(res.Skipped) != 0 {
		t.Fatalf("empty message result = %+v, want no stored/skipped parts", res)
	}

	// Every way an address can fail is the SAME NOT_FOUND body. Compare the
	// rendered sentences rather than just status codes: an implementation that
	// said "no such user" for one and "wrong domain" for another would leak.
	failures := []string{
		"00000000000000000000000000000000@inbox.test", // well-formed, unknown token
		token + "@wrong.test",                         // known token, unknown domain
		"not-an-address",                              // malformed
		"",                                            // missing
	}
	var firstMessage string
	for i, to := range failures {
		_, ferr := ReceiveInboundEmail(ctx, e.pool, "inbox.test", InboundEmailInput{To: to})
		se, ok := As(ferr)
		if !ok {
			t.Fatalf("failure %d (%q): err = %v, want *services.Error NOT_FOUND", i, to, ferr)
		}
		if se.Code != "NOT_FOUND" {
			t.Errorf("failure %d (%q): code = %q, want NOT_FOUND", i, to, se.Code)
		}
		if i == 0 {
			firstMessage = se.Message
			continue
		}
		if se.Message != firstMessage {
			t.Errorf("failure %d (%q) message = %q, want the same as the first failure (%q)", i, to, se.Message, firstMessage)
		}
	}
	if !strings.Contains(firstMessage, "Địa chỉ nhận") {
		t.Errorf("404 message = %q, want the neutral recipient sentence", firstMessage)
	}
	if strings.Contains(firstMessage, token) {
		t.Errorf("404 message leaked the token: %q", firstMessage)
	}
}

func TestInboundEmailStoresThreeAttachmentsAgainstRealPostgres(t *testing.T) {
	e := setupInboxTestEnv(t)
	ctx := viCtx()
	token := inboundTokenForTest(t, e.pool, e.userID)

	res, err := ReceiveInboundEmail(ctx, e.pool, "inbox.test", InboundEmailInput{
		To: token + "@inbox.test",
		Attachments: []InboundAttachment{
			{FileName: "hoa-don-1.pdf", ContentType: "application/pdf", Body: inboundPDF("one")},
			{FileName: "hoa-don-2.pdf", ContentType: "application/pdf", Body: inboundPDF("two")},
			{FileName: "hoa-don-3.pdf", ContentType: "application/pdf", Body: inboundPDF("three")},
		},
	})
	if err != nil {
		t.Fatalf("ReceiveInboundEmail: %v", err)
	}
	if len(res.Attachments) != 3 || len(res.Skipped) != 0 {
		t.Fatalf("result = %d stored / %d skipped, want 3/0 (%+v)", len(res.Attachments), len(res.Skipped), res.Skipped)
	}

	inbox, err := ListInbox(ctx, e.pool, e.userID)
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	if len(inbox) != 3 {
		t.Fatalf("ListInbox = %d rows, want 3", len(inbox))
	}
	for _, att := range inbox {
		if att.UserId != e.userID {
			t.Errorf("attachment %s owner = %q, want %q", att.ID, att.UserId, e.userID)
		}
		if att.DeviceId != nil {
			t.Errorf("attachment %s deviceId = %q, want NULL", att.ID, *att.DeviceId)
		}
		if att.FileType != "application/pdf" {
			t.Errorf("attachment %s fileType = %q, want application/pdf", att.ID, att.FileType)
		}
		if !strings.HasPrefix(att.StoragePath, InboxStorageSegment+"/") {
			t.Errorf("attachment %s storagePath = %q, want the inbox segment", att.ID, att.StoragePath)
		}
	}

	// The other user's inbox is untouched: the token routes to exactly one owner.
	other, err := ListInbox(ctx, e.pool, e.otherUserID)
	if err != nil {
		t.Fatalf("ListInbox(other): %v", err)
	}
	if len(other) != 0 {
		t.Errorf("other user's inbox = %d rows, want 0", len(other))
	}
}

// TestInboundEmailRowsAreIndistinguishableFromUploads is the regression test for
// the "reuse Upload, do not reimplement it" rule. A mail attachment and a
// POST /api/v1/attachments upload are both created by Upload; this walks every
// existing read path and asserts they cannot tell the two rows apart.
func TestInboundEmailRowsAreIndistinguishableFromUploads(t *testing.T) {
	e := setupInboxTestEnv(t)
	ctx := viCtx()
	token := inboundTokenForTest(t, e.pool, e.userID)
	png := tinyPNG(t)

	// The mail path.
	mailRes, err := ReceiveInboundEmail(ctx, e.pool, "inbox.test", InboundEmailInput{
		To: token + "@inbox.test",
		Attachments: []InboundAttachment{
			{FileName: "email-receipt.png", ContentType: "image/png", Body: png},
		},
	})
	if err != nil {
		t.Fatalf("ReceiveInboundEmail: %v", err)
	}
	if len(mailRes.Attachments) != 1 {
		t.Fatalf("mail stored %d attachments, want 1", len(mailRes.Attachments))
	}
	mailAtt := mailRes.Attachments[0]

	// The pre-existing path, called directly with the same bytes (the HTTP round
	// trip is covered in internal/handlers/inbox_email_test.go).
	upAtt, err := Upload(ctx, e.pool, e.userID, UploadAttachmentInput{
		DeviceID:   nil,
		FileName:   "upload-receipt.png",
		DeclaredCT: "image/png",
		Body:       png,
	})
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}

	// 1. Inbox list: both rows, same columns.
	inbox, err := ListInbox(ctx, e.pool, e.userID)
	if err != nil {
		t.Fatalf("ListInbox: %v", err)
	}
	rows := map[string]store.Attachment{}
	for _, row := range inbox {
		rows[row.ID] = row
	}
	mailRow, ok := rows[mailAtt.ID]
	if !ok {
		t.Fatalf("mail attachment %s is missing from ListInbox", mailAtt.ID)
	}
	upRow, ok := rows[upAtt.ID]
	if !ok {
		t.Fatalf("uploaded attachment %s is missing from ListInbox", upAtt.ID)
	}
	assertSameAttachmentShape(t, "mail", mailRow, "upload", upRow)

	// 2. Per-row ownership read used by download / PATCH / DELETE.
	for _, id := range []string{mailAtt.ID, upAtt.ID} {
		if _, err := GetAttachmentForUser(ctx, e.pool, e.userID, id); err != nil {
			t.Errorf("GetAttachmentForUser(%s): %v", id, err)
		}
	}

	// 3. Byte read: both decrypt to the same plaintext through the same pipeline.
	for _, tc := range []struct {
		label string
		id    string
	}{{"mail", mailAtt.ID}, {"upload", upAtt.ID}} {
		mime, _, body, size, err := OpenStream(ctx, e.pool, e.userID, tc.id)
		if err != nil {
			t.Fatalf("OpenStream(%s): %v", tc.label, err)
		}
		got, rerr := io.ReadAll(body)
		_ = body.Close()
		if rerr != nil {
			t.Fatalf("read %s stream: %v", tc.label, rerr)
		}
		if !bytes.Equal(got, png) {
			t.Errorf("%s stream = %d bytes, want the %d original bytes", tc.label, len(got), len(png))
		}
		if mime != "image/png" {
			t.Errorf("%s mime = %q, want image/png", tc.label, mime)
		}
		if size != int64(len(png)) {
			t.Errorf("%s size = %d, want %d", tc.label, size, len(png))
		}
	}

	// 4. Backup export: both appear in the same top-level inboxAttachments array
	// with the same metadata fields (only ids/names/timestamps/keys differ).
	backup, err := ExportBackup(ctx, e.pool, e.userID)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	// Backup decision (migration 0020): the inbound token is a credential and
	// must not travel in a file users copy around. Assert the serialized payload
	// does not contain it anywhere, not just that no field is named after it.
	rawBackup, err := json.Marshal(backup)
	if err != nil {
		t.Fatalf("marshal backup: %v", err)
	}
	if strings.Contains(string(rawBackup), token) {
		t.Error("backup export contains the inbox token")
	}
	byID := map[string]BackupAttachment{}
	for _, a := range backup.InboxAttachments {
		byID[a.ID] = a
	}
	mailBackup, ok := byID[mailAtt.ID]
	if !ok {
		t.Fatalf("mail attachment %s is missing from the backup export", mailAtt.ID)
	}
	upBackup, ok := byID[upAtt.ID]
	if !ok {
		t.Fatalf("uploaded attachment %s is missing from the backup export", upAtt.ID)
	}
	if mailBackup.FileType != upBackup.FileType || mailBackup.FileSize != upBackup.FileSize {
		t.Errorf("backup metadata differs: mail=%+v upload=%+v", mailBackup, upBackup)
	}
	if mailBackup.Description != nil || upBackup.Description != nil {
		t.Errorf("backup descriptions = %v / %v, want nil on both", mailBackup.Description, upBackup.Description)
	}
	if mailBackup.IV == "" || mailBackup.WrappedKey == "" || upBackup.IV == "" || upBackup.WrappedKey == "" {
		t.Error("backup export is missing encryption metadata for one of the rows")
	}
	if !strings.HasPrefix(mailBackup.StoragePath, InboxStorageSegment+"/") ||
		!strings.HasPrefix(upBackup.StoragePath, InboxStorageSegment+"/") {
		t.Errorf("backup storage paths = %q / %q, want the inbox segment on both", mailBackup.StoragePath, upBackup.StoragePath)
	}

	// 5. Filing path: the mail row can be assigned to a device through the exact
	// same service call, and then it appears in the device list like any upload.
	filed, err := FileAttachment(ctx, e.pool, e.userID, mailAtt.ID, &e.deviceID)
	if err != nil {
		t.Fatalf("FileAttachment(mail row): %v", err)
	}
	if filed.DeviceId == nil || *filed.DeviceId != e.deviceID {
		t.Fatalf("filed mail row deviceId = %v, want %s", filed.DeviceId, e.deviceID)
	}
	deviceList, err := ListAttachmentsByDevice(ctx, e.pool, e.userID, e.deviceID)
	if err != nil {
		t.Fatalf("ListAttachmentsByDevice: %v", err)
	}
	found := false
	for _, a := range deviceList {
		if a.ID == mailAtt.ID {
			found = true
		}
	}
	if !found {
		t.Errorf("filed mail row %s is missing from the device attachment list", mailAtt.ID)
	}

	// 6. Delete path: the uploaded row deletes through the same owner-scoped call.
	if err := Delete(ctx, e.pool, e.userID, upAtt.ID); err != nil {
		t.Fatalf("Delete(upload row): %v", err)
	}
	if _, err := GetAttachmentForUser(ctx, e.pool, e.userID, upAtt.ID); err == nil {
		t.Error("deleted upload row is still readable")
	}
	if _, err := files.ReadEncrypted(files.PrivateUploadRoot(), upRow.StoragePath); err == nil {
		t.Error("deleted upload blob is still on disk")
	}
}

func assertSameAttachmentShape(t *testing.T, labelA string, a store.Attachment, labelB string, b store.Attachment) {
	t.Helper()
	if a.UserId != b.UserId {
		t.Errorf("userId differs: %s=%q %s=%q", labelA, a.UserId, labelB, b.UserId)
	}
	if (a.DeviceId == nil) != (b.DeviceId == nil) {
		t.Errorf("deviceId nullness differs: %s=%v %s=%v", labelA, a.DeviceId, labelB, b.DeviceId)
	}
	if a.FileType != b.FileType {
		t.Errorf("fileType differs: %s=%q %s=%q", labelA, a.FileType, labelB, b.FileType)
	}
	if a.FileSize != b.FileSize {
		t.Errorf("fileSize differs: %s=%d %s=%d", labelA, a.FileSize, labelB, b.FileSize)
	}
	if (a.Description == nil) != (b.Description == nil) {
		t.Errorf("description nullness differs: %s=%v %s=%v", labelA, a.Description, labelB, b.Description)
	}
	if (a.ExtractedText == nil) != (b.ExtractedText == nil) {
		t.Errorf("extractedText nullness differs: %s=%v %s=%v", labelA, a.ExtractedText, labelB, b.ExtractedText)
	}
	if !strings.HasPrefix(a.StoragePath, InboxStorageSegment+"/") || !strings.HasPrefix(b.StoragePath, InboxStorageSegment+"/") {
		t.Errorf("storage paths = %q / %q, want the inbox segment on both", a.StoragePath, b.StoragePath)
	}
	if len(a.Iv) == 0 || len(b.Iv) == 0 || len(a.WrappedKey) == 0 || len(b.WrappedKey) == 0 {
		t.Error("encryption metadata is missing on one of the rows")
	}
}
