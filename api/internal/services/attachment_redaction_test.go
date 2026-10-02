package services

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
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
		DeviceId:    "dev_1",
		FileName:    "hoa-don.pdf",
		StoragePath: "/data/private-uploads/dev_1/att_1.bin",
		FileType:    "application/pdf",
		FileSize:    2048,
		Iv:          []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12},
		WrappedKey:  []byte{9, 8, 7, 6, 5, 4, 3, 2},
		Description: &desc,
		UploadedAt:  pgtype.Timestamp{Time: time.Date(2026, 5, 1, 10, 30, 0, 0, time.UTC), Valid: true},
	}

	blob, err := json.Marshal(toAttachmentMeta(row))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got := string(blob)

	for _, forbidden := range []string{"storagePath", "wrappedKey", `"iv"`, "/data/", "private-uploads"} {
		if strings.Contains(got, forbidden) {
			t.Errorf("redacted JSON still contains %q:\n%s", forbidden, got)
		}
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
