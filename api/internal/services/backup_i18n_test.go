package services

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
	"github.com/thanhtrung9368/warranty-vault/api/internal/i18n"
)

// Service-level i18n tests for the backup + attachments + files slice (wave 3 of
// docs/I18N_PLAN.md §3.1).
//
// Everything here is DB-free on purpose: the refusals asserted below are decided
// from the payload alone (that is the whole point of validateBackupPayload — a
// tampered file must be rejected before anything is written), so a nil pool is
// safe and the test does not need Postgres. The HTTP surface, the .zip round trip
// and the multipart upload are covered in
// internal/handlers/backup_i18n_test.go.
//
// Every case pins the language (`tagCtx`, or `viCtx` from the devices quota test
// for the Vietnamese-only assertions) rather than relying on the machine or the
// product default, so no assertion here can pass by accident
// (docs/I18N_PLAN.md §4.3).

// ── 1. The honesty notes ─────────────────────────────────────────────────────

// The two notes are the reason this domain is honesty-critical: one says the JSON
// backup does NOT carry the invoice images, the other says the .zip DOES and
// still needs FILE_MASTER_KEY. Both must move with the language WITHOUT losing
// their meaning, so they are asserted in full, as copy — not with a substring
// check that a softened translation would also pass.
func TestBackupHonestyNotesFollowTheLanguage(t *testing.T) {
	const (
		wantVIJSON = "Bản sao lưu này KHÔNG chứa nội dung ảnh/hoá đơn đính kèm (chỉ có tên file, loại file và kích thước). Khôi phục sang một máy chủ khác sẽ không khôi phục được ảnh."
		wantENJSON = "This backup does NOT contain the contents of the attached images/invoices (only the file name, file type and size). Restoring it onto a different server will not bring those images back."
		wantVIZip  = "Bản sao lưu này CÓ chứa nội dung ảnh/hoá đơn đính kèm (đã mã hoá AES-256-GCM). Cần đúng FILE_MASTER_KEY của máy chủ đã xuất bản sao lưu thì mới giải mã được; thiếu hoặc sai khoá thì file vẫn được khôi phục nhưng không mở được."
		wantENZip  = "This backup DOES contain the contents of the attached images/invoices (encrypted with AES-256-GCM). You need the exact FILE_MASTER_KEY of the server that exported it in order to decrypt them; with a missing or wrong key the files are still restored but cannot be opened."
	)

	for _, tc := range []struct {
		name   string
		json   bool // true → the metadata-only v5 envelope, false → the v6 .zip one
		vi, en string
	}{
		{"JSON envelope (v5, metadata only)", true, wantVIJSON, wantENJSON},
		{"ZIP envelope (v6, carries the blobs)", false, wantVIZip, wantENZip},
	} {
		t.Run(tc.name, func(t *testing.T) {
			viEnv := newBackupEnvelopeForTest(t, tc.json, i18n.VI)
			enEnv := newBackupEnvelopeForTest(t, tc.json, i18n.EN)

			if viEnv.AttachmentBytesNote != tc.vi {
				t.Errorf("vi note = %q, want %q", viEnv.AttachmentBytesNote, tc.vi)
			}
			if enEnv.AttachmentBytesNote != tc.en {
				t.Errorf("en note = %q, want %q", enEnv.AttachmentBytesNote, tc.en)
			}
			// The warning is only useful if it still says the hard part: the
			// NEGATIVE in the JSON note ("does NOT contain"), the POSITIVE plus the
			// key requirement in the .zip one. The equality above already pins the
			// text; this is the assertion a future edit has to argue with instead of
			// quietly softening the sentence and updating the literal.
			if tc.json {
				if !strings.Contains(tc.en, "does NOT contain") {
					t.Errorf("en JSON note %q no longer states the negative", tc.en)
				}
			} else if !strings.Contains(tc.en, "DOES contain") || !strings.Contains(tc.en, "FILE_MASTER_KEY") {
				t.Errorf("en .zip note %q no longer states the positive and the key requirement", tc.en)
			}
			// The honesty FLAGS are language-independent contract.
			if tc.json {
				if viEnv.IncludesAttachmentBytes || enEnv.IncludesAttachmentBytes {
					t.Error("includesAttachmentBytes = true for the metadata-only envelope, in some language")
				}
				if viEnv.Version != MetadataOnlyBackupVersion || enEnv.Version != MetadataOnlyBackupVersion {
					t.Errorf("versions = %d/%d, want %d", viEnv.Version, enEnv.Version, MetadataOnlyBackupVersion)
				}
			} else {
				if !viEnv.IncludesAttachmentBytes || !enEnv.IncludesAttachmentBytes {
					t.Error("includesAttachmentBytes = false for the .zip envelope, in some language")
				}
				if viEnv.Version != BackupVersion || enEnv.Version != BackupVersion {
					t.Errorf("versions = %d/%d, want %d", viEnv.Version, enEnv.Version, BackupVersion)
				}
			}
		})
	}

	// The Vietnamese side is the ORIGINAL: it must remain byte-for-byte the
	// constant the package exports and the pre-i18n endpoints sent.
	if got := i18n.Text(viCtx(), AttachmentBytesNoteVN); got != AttachmentBytesNoteVN {
		t.Errorf("the Vietnamese metadata-only note changed: %q", got)
	}
	if got := i18n.Text(viCtx(), BlobAttachmentBytesNoteVN); got != BlobAttachmentBytesNoteVN {
		t.Errorf("the Vietnamese .zip note changed: %q", got)
	}
}

// newBackupEnvelopeForTest builds one of the two envelopes in `lang`. Split out
// because the constructors take a context and this test wants a plain tag.
func newBackupEnvelopeForTest(t *testing.T, metadataOnly bool, lang i18n.Tag) *BackupExport {
	t.Helper()
	ctx := tagCtx(lang)
	if metadataOnly {
		return newBackupExport(ctx, 0, 0, 0)
	}
	return newBlobBackupExport(ctx, 0, 0, 0)
}

// ── 2. The one count-bearing sentence ────────────────────────────────────────

// The .zip "N attachments were no longer on disk" warning is this wave's
// singular/plural pair, and the count is reachable at BOTH 1 and 3 — so both
// forms are driven explicitly, with their own argument lists, in both languages.
//
// This is the bug class wave 0 shipped (`... expires in 1 day%!(EXTRA int=7)`):
// the singular template has no `%d` slot, so handing it the plural's argument
// list renders fmt's complaint into a user-facing string. Hence the `%!` check.
func TestBackupMissingBlobNotePluralPair(t *testing.T) {
	const baseVI = BlobAttachmentBytesNoteVN
	const baseEN = "This backup DOES contain the contents of the attached images/invoices (encrypted with AES-256-GCM). You need the exact FILE_MASTER_KEY of the server that exported it in order to decrypt them; with a missing or wrong key the files are still restored but cannot be opened."

	for _, tc := range []struct {
		name string
		tag  i18n.Tag
		base string
		n    int
		want string
	}{
		{
			"plural, vi",
			i18n.VI, baseVI, 3,
			baseVI + " LƯU Ý: 3 file đính kèm không còn trên đĩa nên KHÔNG có trong bản sao lưu này (xem missingAttachmentIds).",
		},
		{
			"singular, vi",
			i18n.VI, baseVI, 1,
			baseVI + " LƯU Ý: 1 file đính kèm không còn trên đĩa nên KHÔNG có trong bản sao lưu này (xem missingAttachmentIds).",
		},
		{
			"plural, en",
			i18n.EN, baseEN, 3,
			baseEN + " NOTE: 3 attachments were no longer on disk, so they are NOT in this backup (see missingAttachmentIds).",
		},
		{
			"singular, en",
			i18n.EN, baseEN, 1,
			baseEN + " NOTE: 1 attachment was no longer on disk, so it is NOT in this backup (see missingAttachmentIds).",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := missingBlobNote(tc.tag, tc.base, tc.n)
			if got != tc.want {
				t.Errorf("missingBlobNote = %q, want %q", got, tc.want)
			}
			if strings.Contains(got, "%!") {
				t.Errorf("rendered %q — a template was given an argument list it has no verbs for", got)
			}
		})
	}

	// The singular form must not carry the count at all: if someone "fixes" it by
	// re-adding `%d`, the English reads "1 attachments" and this fails.
	singular := missingBlobNote(i18n.EN, baseEN, 1)
	if strings.Contains(singular, "attachments") {
		t.Errorf("the English singular still pluralises the noun: %q", singular)
	}
}

// ── 3. The import refusals ───────────────────────────────────────────────────

// Every DB-free refusal of the import path, in both languages. The CODE and the
// message's identifying detail (the version, the id, the count) must survive the
// translation — that is what makes the message useful rather than merely
// translated.
func TestBackupImportRefusalsAreTranslated(t *testing.T) {
	attachment := func(n int) []BackupAttachment {
		out := make([]BackupAttachment, 0, n)
		for i := 0; i < n; i++ {
			out = append(out, BackupAttachment{
				ID:          "att_ok",
				FileName:    "hoa-don.png",
				StoragePath: "zz_dev/00000000-0000-0000-0000-000000000000.enc",
				FileType:    "image/png",
				FileSize:    100,
				IV:          "AAAAAAAAAAAAAAAA",                         // 12 zero bytes, base64
				WrappedKey:  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // 32 zero bytes, base64
			})
		}
		return out
	}

	for _, tc := range []struct {
		name   string
		vi, en string
		run    func(lang i18n.Tag) error
		code   string
	}{
		{
			name: "nil payload",
			vi:   "File JSON không hợp lệ",
			en:   "Invalid JSON file",
			code: "VALIDATION",
			run: func(lang i18n.Tag) error {
				return validateBackupPayload(tagCtx(lang), nil)
			},
		},
		{
			name: "version from the future",
			vi:   "Bản sao lưu phiên bản 99 mới hơn phiên bản ứng dụng hỗ trợ (6). Cập nhật ứng dụng rồi thử lại.",
			en:   "This backup is version 99, newer than this app supports (6). Update the app and try again.",
			code: "VALIDATION",
			run: func(lang i18n.Tag) error {
				return validateBackupPayload(tagCtx(lang), &BackupExport{Version: 99})
			},
		},
		{
			name: "version too old",
			vi:   "Bản sao lưu phiên bản 4 quá cũ, phiên bản được hỗ trợ: 5-6.",
			en:   "This backup is version 4, which is too old; supported versions: 5-6.",
			code: "VALIDATION",
			run: func(lang i18n.Tag) error {
				return validateBackupPayload(tagCtx(lang), &BackupExport{Version: 4})
			},
		},
		{
			name: "unsafe device id",
			vi:   "ID thiết bị không hợp lệ: ../etc/passwd",
			en:   "Invalid device id: ../etc/passwd",
			code: "VALIDATION",
			run: func(lang i18n.Tag) error {
				return validateBackupPayload(tagCtx(lang), &BackupExport{
					Version: MetadataOnlyBackupVersion,
					Devices: []BackupDevice{{ID: "../etc/passwd"}},
				})
			},
		},
		{
			// The count can only ever be > MaxAttachmentsPerDevice here, which is
			// why the sentence has no singular form (see the catalog comment).
			name: "attachment count over the per-device ceiling",
			vi:   "Thiết bị \"Máy ảnh Canon\" có 6 file đính kèm, vượt giới hạn 5 file/thiết bị.",
			en:   "Device \"Máy ảnh Canon\" has 6 attachments, over the limit of 5 per device.",
			code: "VALIDATION",
			run: func(lang i18n.Tag) error {
				return validateBackupPayload(tagCtx(lang), &BackupExport{
					Version: MetadataOnlyBackupVersion,
					Devices: []BackupDevice{{
						ID: "zz_dev", Name: "Máy ảnh Canon",
						Attachments: attachment(MaxAttachmentsPerDevice + 1),
					}},
				})
			},
		},
		{
			name: "storage path escaping the device folder",
			vi:   "Đường dẫn file không hợp lệ trong \"Máy ảnh Canon\". File backup có thể đã bị sửa.",
			en:   "Invalid file path in \"Máy ảnh Canon\". This backup file may have been tampered with.",
			code: "VALIDATION",
			run: func(lang i18n.Tag) error {
				atts := attachment(1)
				atts[0].StoragePath = "../other-device/evil.enc"
				return validateBackupPayload(tagCtx(lang), &BackupExport{
					Version: MetadataOnlyBackupVersion,
					Devices: []BackupDevice{{ID: "zz_dev", Name: "Máy ảnh Canon", Attachments: atts}},
				})
			},
		},
		{
			name: "corrupt file key",
			vi:   "Khoá file hỏng trong \"Máy ảnh Canon\".",
			en:   "Corrupt file key in \"Máy ảnh Canon\".",
			code: "VALIDATION",
			run: func(lang i18n.Tag) error {
				atts := attachment(1)
				atts[0].WrappedKey = "AAAA" // too short to be a wrapped key
				return validateBackupPayload(tagCtx(lang), &BackupExport{
					Version: MetadataOnlyBackupVersion,
					Devices: []BackupDevice{{ID: "zz_dev", Name: "Máy ảnh Canon", Attachments: atts}},
				})
			},
		},
		{
			// The "you picked data.json out of a .zip" refusal: a v6 manifest that
			// declares bytes, with attachments, offered as a bare JSON document.
			name: "data.json of a .zip backup",
			vi:   "File data.json này là phần dữ liệu của một bản sao lưu .zip có kèm nội dung ảnh. Hãy chọn chính file .zip để khôi phục — import riêng data.json sẽ mất toàn bộ ảnh/hoá đơn.",
			en:   "This data.json is the data half of a .zip backup that carries the invoice images. Choose the .zip file itself to restore — importing data.json on its own loses every image/invoice.",
			code: "VALIDATION",
			run: func(lang i18n.Tag) error {
				// Nil pool: the refusal happens before any query.
				_, err := ImportBackup(tagCtx(lang), nil, "u", &BackupExport{
					Version:                 BackupVersion,
					IncludesAttachmentBytes: true,
					Devices: []BackupDevice{{
						ID: "zz_dev", Name: "Máy ảnh Canon", Attachments: attachment(1),
					}},
				}, ImportMerge)
				return err
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, want := range []struct {
				lang string
				text string
			}{{"vi", tc.vi}, {"en", tc.en}} {
				err := tc.run(i18n.Tag(want.lang))
				if err == nil {
					t.Fatalf("lang=%s: no error, want %q", want.lang, want.text)
				}
				svc, ok := As(err)
				if !ok {
					t.Fatalf("lang=%s: %v is not a *services.Error", want.lang, err)
				}
				if svc.Code != tc.code {
					t.Errorf("lang=%s: code = %q, want %q — the code is contract and must not move with the language",
						want.lang, svc.Code, tc.code)
				}
				if svc.HTTPStatus() != 400 {
					t.Errorf("lang=%s: status = %d, want 400", want.lang, svc.HTTPStatus())
				}
				if svc.Message != want.text {
					t.Errorf("lang=%s: message = %q, want %q", want.lang, svc.Message, want.text)
				}
				// The two languages must actually differ, or "translated" is a
				// claim about the catalog rather than about the response. (Except
				// where the sentence legitimately shares its words — none of the
				// cases above do.)
				if want.lang == "en" && svc.Message == tc.vi {
					t.Errorf("en message is still the Vietnamese source: %q", svc.Message)
				}
			}
		})
	}
}

// ── 4. The attachment pipeline's copy ────────────────────────────────────────

// The three Upload refusals that need no database, plus the two messages that
// come out of internal/files. The CODES are pinned here because that is exactly
// what a careless i18n conversion changes: services.Error has keyed constructors
// that set a different code, and AttachmentError's codes are what the handler
// maps to statuses.
func TestAttachmentMessagesAreTranslated(t *testing.T) {
	for _, tc := range []struct {
		name   string
		vi, en string
		code   string
		in     UploadAttachmentInput
	}{
		{
			name: "unsafe device id",
			vi:   "Device không hợp lệ",
			en:   "Invalid device",
			code: "bad_input",
			in:   UploadAttachmentInput{DeviceID: "../etc/passwd", Body: []byte("x")},
		},
		{
			name: "empty file",
			vi:   "File trống",
			en:   "File is empty",
			code: "bad_input",
			in:   UploadAttachmentInput{DeviceID: "zz_dev", Body: nil},
		},
		{
			name: "file over the per-file cap",
			vi:   "File vượt quá 5MB",
			en:   "File is larger than 5 MB",
			code: "bad_input",
			in:   UploadAttachmentInput{DeviceID: "zz_dev", Body: make([]byte, MaxAttachmentBytes+1)},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, want := range []struct{ lang, text string }{{"vi", tc.vi}, {"en", tc.en}} {
				// A nil pool is safe: all three refusals happen before the first
				// query (that is the point of checking the cheap things first).
				_, err := Upload(tagCtx(i18n.Tag(want.lang)), nil, "u", tc.in)
				if err == nil {
					t.Fatalf("lang=%s: no error, want %q", want.lang, want.text)
				}
				ae, ok := AsAttachmentError(err)
				if !ok {
					t.Fatalf("lang=%s: %v is not an *AttachmentError", want.lang, err)
				}
				if ae.Code != tc.code {
					t.Errorf("lang=%s: code = %q, want %q", want.lang, ae.Code, tc.code)
				}
				if ae.Message != want.text {
					t.Errorf("lang=%s: message = %q, want %q", want.lang, ae.Message, want.text)
				}
			}
		})
	}
}

// internal/files emits Vietnamese source text and has no request context; the
// attachment pipeline renders it through `filesText`. This walks the real error
// the package produces (not a hardcoded key) so the catalog entry and the emitted
// sentence cannot drift apart.
func TestFilesPackageMessagesAreTranslatedAtTheCallSite(t *testing.T) {
	// 1. Unsupported type.
	_, err := files.DetectAndValidate([]byte("this is not an image at all"), "")
	if err == nil {
		t.Fatal("DetectAndValidate(text) = nil error")
	}
	if got := filesText(tagCtx(i18n.VI), err); got != "Chỉ chấp nhận JPG/PNG/WEBP/GIF/HEIC hoặc PDF" {
		t.Errorf("vi = %q", got)
	}
	if got := filesText(tagCtx(i18n.EN), err); got != "Only JPG/PNG/WEBP/GIF/HEIC or PDF files are accepted" {
		t.Errorf("en = %q", got)
	}

	// 2. Magic bytes that disagree with the declared Content-Type.
	_, err = files.DetectAndValidate(tinyPNG(t), "application/pdf")
	if err == nil {
		t.Fatal("DetectAndValidate(png, application/pdf) = nil error")
	}
	if got := filesText(tagCtx(i18n.VI), err); got != "Nội dung file không khớp định dạng khai báo" {
		t.Errorf("vi = %q", got)
	}
	if got := filesText(tagCtx(i18n.EN), err); got != "The file contents do not match the declared format" {
		t.Errorf("en = %q", got)
	}

	// 3. An error the catalog does not know must degrade to its own text, never to
	// an empty string or a bare identifier: that is what keeps an unconverted
	// caller (handlers/ai.go passes err.Error() verbatim) byte-for-byte identical.
	opaque := errors.New("some internal failure")
	if got := filesText(tagCtx(i18n.EN), opaque); got != "some internal failure" {
		t.Errorf("unknown error = %q, want the original text", got)
	}

	// 4. The two FILE_MASTER_KEY sentences are asserted as catalog entries: the
	// production path is internalErr(filesText(ctx, err)), and the message is
	// produced inside internal/files/encrypt.go.
	for key, want := range map[string]string{
		"FILE_MASTER_KEY chưa được cấu hình":                                 "FILE_MASTER_KEY is not configured",
		"FILE_MASTER_KEY phải decode được (base64 hoặc hex) thành ≥ 32 byte": "FILE_MASTER_KEY must decode (base64 or hex) to at least 32 bytes",
	} {
		if got := i18n.Text(tagCtx(i18n.EN), key); got != want {
			t.Errorf("en %q = %q, want %q", key, got, want)
		}
		if got := i18n.Text(tagCtx(i18n.VI), key); got != key {
			t.Errorf("vi %q = %q, want the source text", key, got)
		}
	}
}

// tagCtx pins a language on a bare context — the shape a service call has when
// there is no request to carry `?lang=`. Named separately from the wave-2
// ctxForTest helper so these tests read as "this is the language of THIS call"
// rather than borrowing a neighbour's fixture.
func tagCtx(lang i18n.Tag) context.Context {
	return i18n.WithTag(context.Background(), lang)
}
