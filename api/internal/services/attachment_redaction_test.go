package services

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
	"github.com/thanhtrung9368/warranty-vault/api/internal/wire"
)

// A store.Attachment carries internal columns that must never leave the
// server: StoragePath (on-disk layout) and Iv/WrappedKey (per-file key
// material). The device-detail endpoint used to serialise the raw row, so the
// web shipped a type comment acknowledging "internal encryption fields —
// included by Go but unused by the web UI".
//
// This test fails if any of those keys reappear on the wire.
func TestAttachmentMetaDoesNotLeakInternalColumns(t *testing.T) {
	desc := "hoá đơn"
	row := store.Attachment{
		ID:          "att_1",
		DeviceId:    strp("dev_1"),
		FileName:    "hoa-don.pdf",
		StoragePath: "/data/private-uploads/dev_1/att_1.bin",
		FileType:    "application/pdf",
		FileSize:    2048,
		Iv:          []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12},
		WrappedKey:  []byte{9, 8, 7, 6, 5, 4, 3, 2},
		Description: &desc,
		UploadedAt:  wire.At(time.Date(2026, 5, 1, 10, 30, 0, 0, time.UTC)),
	}

	blob, err := json.Marshal(toAttachmentMeta(row))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(blob)

	for _, forbidden := range []string{"storagePath", "wrappedKey", `"iv"`, "userId", "/data/", "private-uploads"} {
		if strings.Contains(got, forbidden) {
			t.Errorf("redacted JSON still contains %q:\n%s", forbidden, got)
		}
	}
	// Extraction text is omitted when it was never populated: an account that
	// never runs OCR must keep the exact pre-0019 attachment payload.
	if strings.Contains(got, "extractedText") {
		t.Errorf("an attachment with no OCR text still serialised extractedText:\n%s", got)
	}

	// The fields clients actually rely on must survive.
	for _, want := range []string{
		`"id":"att_1"`,
		`"fileName":"hoa-don.pdf"`,
		`"fileType":"application/pdf"`,
		`"fileSize":2048`,
		`"description":"hoá đơn"`,
		`"uploadedAt":"2026-05-01T10:30:00Z"`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("redacted JSON is missing %s:\n%s", want, got)
		}
	}
}

// The OCR transcript IS exposed (migration 0019) — it is the user's own receipt
// text and the client needs it to show/highlight a search hit. This pins that it
// survives redaction while the encryption internals still do not.
func TestAttachmentMetaExposesExtractedTextOnlyWhenPresent(t *testing.T) {
	text := "Sạc nhanh 65W\nGói bảo hành mở rộng"
	blob, err := json.Marshal(toAttachmentMeta(store.Attachment{
		ID:            "att_1",
		StoragePath:   "/data/private-uploads/dev_1/att_1.bin",
		Iv:            []byte{1},
		WrappedKey:    []byte{2},
		FileName:      "hoa-don.png",
		FileType:      "image/png",
		FileSize:      10,
		ExtractedText: &text,
		UploadedAt:    wire.At(time.Date(2026, 5, 1, 10, 30, 0, 0, time.UTC)),
	}))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(blob)
	if !strings.Contains(got, `"extractedText":"Sạc nhanh 65W\nGói bảo hành mở rộng"`) {
		t.Errorf("extractedText missing from the public shape:\n%s", got)
	}
	for _, forbidden := range []string{"storagePath", "wrappedKey", `"iv"`, "private-uploads"} {
		if strings.Contains(got, forbidden) {
			t.Errorf("JSON exposes %q alongside the text:\n%s", forbidden, got)
		}
	}
}

// Proof that the mapper above is load-bearing rather than decorative: this
// marshals the RAW store row and asserts the internal columns genuinely do
// appear. If a future change made store.Attachment safe to expose directly,
// this test would fail and the mapper could be reconsidered; until then it
// documents exactly what the redaction is preventing.
func TestRawStoreAttachmentWouldLeak(t *testing.T) {
	raw := store.Attachment{
		ID:          "att_1",
		StoragePath: "/data/private-uploads/att_1.bin",
		Iv:          []byte{1},
		WrappedKey:  []byte{2},
	}

	blob, err := json.Marshal(raw)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(blob)

	for _, leaked := range []string{"storagePath", "wrappedKey", `"iv"`} {
		if !strings.Contains(got, leaked) {
			t.Errorf("expected the raw store row to expose %q (so the mapper is needed), got:\n%s", leaked, got)
		}
	}
}

// The device-detail payload as a whole must stay clean, not just the element
// mapper — a future refactor could reintroduce the raw slice on the struct.
func TestDeviceDetailAttachmentsAreRedacted(t *testing.T) {
	detail := DeviceDetail{
		Attachments: []AttachmentMeta{
			toAttachmentMeta(store.Attachment{
				ID:          "att_1",
				StoragePath: "/data/private-uploads/att_1.bin",
				FileName:    "a.png",
				FileType:    "image/png",
				FileSize:    10,
				Iv:          []byte{1},
				WrappedKey:  []byte{2},
			}),
		},
	}

	blob, err := json.Marshal(detail)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(blob)

	for _, forbidden := range []string{"storagePath", "wrappedKey", `"iv"`, "private-uploads"} {
		if strings.Contains(got, forbidden) {
			t.Errorf("DeviceDetail JSON still contains %q:\n%s", forbidden, got)
		}
	}
	if !strings.Contains(got, `"attachments":[{"id":"att_1"`) {
		t.Errorf("attachments not serialised as expected:\n%s", got)
	}
}
