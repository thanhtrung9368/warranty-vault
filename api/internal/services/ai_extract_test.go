package services

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/ai"
	store "github.com/thanhtrung9368/warranty-vault/api/internal/store/gen"
)

func strp(s string) *string { return &s }
func i64p(i int64) *int64   { return &i }
func intp(i int) *int       { return &i }

func testCatalog() *Catalog {
	return &Catalog{
		Categories: []CategoryOption{
			{Code: "PHONE", Name: "Điện thoại"},
			{Code: "LAPTOP", Name: "Laptop"},
		},
		Brands: []BrandOption{
			{ID: "brand_apple", Name: "Apple"},
			{ID: "brand_samsung", Name: "Samsung"},
		},
		Stores: []StoreOption{
			{ID: "store_tgdd", Name: "Thế Giới Di Động"},
			{ID: "store_dmx", Name: "Điện Máy Xanh"},
		},
	}
}

func TestBuildDraft_MapsCatalogDiacriticInsensitive(t *testing.T) {
	// Store name without diacritics (typical OCR output) must still bind.
	e := ai.ExtractedReceipt{
		Name:           strp("iPhone 15 Pro"),
		Brand:          strp("apple"),
		PurchasePlace:  strp("the gioi di dong"),
		PurchasePrice:  i64p(28990000),
		WarrantyMonths: intp(12),
		Category:       strp("Điện thoại"),
		Confidence:     strp("high"),
	}
	d := buildDraft(context.Background(), e, testCatalog())

	if d.BrandID == nil || *d.BrandID != "brand_apple" {
		t.Errorf("brand not mapped: %+v", d.BrandID)
	}
	if d.StoreID == nil || *d.StoreID != "store_tgdd" {
		t.Errorf("store not mapped: %+v", d.StoreID)
	}
	if d.Category == nil || *d.Category != "PHONE" {
		t.Errorf("category not mapped to code: %+v", d.Category)
	}
	if d.Confidence != "high" {
		t.Errorf("confidence = %q, want high", d.Confidence)
	}
	if d.PurchasePrice == nil || *d.PurchasePrice != 28990000 {
		t.Errorf("price passthrough failed: %+v", d.PurchasePrice)
	}
	if len(d.Unmatched) != 0 {
		t.Errorf("expected no unmatched, got %v", d.Unmatched)
	}
}

func TestBuildDraft_UnmatchedFreeText(t *testing.T) {
	e := ai.ExtractedReceipt{
		Brand:         strp("Xiaomi"),      // not in catalog
		PurchasePlace: strp("Cửa hàng lạ"), // not in catalog
	}
	d := buildDraft(context.Background(), e, testCatalog())

	if d.BrandID != nil {
		t.Errorf("expected no brand bind, got %v", *d.BrandID)
	}
	if d.Brand == nil || *d.Brand != "Xiaomi" {
		t.Errorf("expected raw brand kept, got %v", d.Brand)
	}
	if d.StoreID != nil {
		t.Errorf("expected no store bind, got %v", *d.StoreID)
	}
	if !contains(d.Unmatched, "brand") || !contains(d.Unmatched, "purchasePlace") {
		t.Errorf("expected brand+purchasePlace unmatched, got %v", d.Unmatched)
	}
}

func TestBuildDraft_DefaultConfidence(t *testing.T) {
	d := buildDraft(context.Background(), ai.ExtractedReceipt{Name: strp("X")}, testCatalog())
	if d.Confidence != "medium" {
		t.Errorf("default confidence = %q, want medium", d.Confidence)
	}
	if d.Unmatched == nil {
		t.Error("Unmatched should be non-nil empty slice for JSON []")
	}
}

// Roadmap #15: serial/IMEI + warranty months must reach the draft, and values
// the model gets wrong must be dropped rather than handed to the form.
func TestBuildDraft_SerialAndWarrantyMonths(t *testing.T) {
	e := ai.ExtractedReceipt{
		SerialNumber:   strp("  356789012345678 "), // OCR padding is trimmed
		WarrantyMonths: intp(24),
	}
	d := buildDraft(context.Background(), e, testCatalog())
	if d.SerialNumber == nil || *d.SerialNumber != "356789012345678" {
		t.Errorf("serialNumber = %v, want trimmed %q", d.SerialNumber, "356789012345678")
	}
	if d.WarrantyMonths == nil || *d.WarrantyMonths != 24 {
		t.Errorf("warrantyMonths = %v, want 24", d.WarrantyMonths)
	}
	if len(d.Unmatched) != 0 {
		t.Errorf("unmatched = %v, want none for in-range values", d.Unmatched)
	}
}

func TestBuildDraft_WarrantyMonthsBounds(t *testing.T) {
	for _, tc := range []struct {
		name       string
		months     *int
		wantNil    bool
		wantFlag   bool
		wantMonths int
	}{
		{name: "absent → null, not flagged", months: nil, wantNil: true},
		{name: "zero is valid (no warranty)", months: intp(0), wantMonths: 0},
		{name: "twelve", months: intp(12), wantMonths: 12},
		{name: "upper bound 120 accepted", months: intp(120), wantMonths: 120},
		{name: "121 dropped", months: intp(121), wantNil: true, wantFlag: true},
		{name: "1200 (OCR misread) dropped", months: intp(1200), wantNil: true, wantFlag: true},
		{name: "negative dropped", months: intp(-12), wantNil: true, wantFlag: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := buildDraft(context.Background(), ai.ExtractedReceipt{WarrantyMonths: tc.months}, testCatalog())
			if tc.wantNil {
				if d.WarrantyMonths != nil {
					t.Errorf("warrantyMonths = %d, want nil (out-of-range values must not reach the form)", *d.WarrantyMonths)
				}
			} else if d.WarrantyMonths == nil || *d.WarrantyMonths != tc.wantMonths {
				t.Errorf("warrantyMonths = %v, want %d", d.WarrantyMonths, tc.wantMonths)
			}
			if got := contains(d.Unmatched, "warrantyMonths"); got != tc.wantFlag {
				t.Errorf("unmatched contains warrantyMonths = %v, want %v (%v)", got, tc.wantFlag, d.Unmatched)
			}
		})
	}
}

func TestBuildDraft_SerialNumberSanitising(t *testing.T) {
	d := buildDraft(context.Background(), ai.ExtractedReceipt{SerialNumber: strp("   ")}, testCatalog())
	if d.SerialNumber != nil {
		t.Errorf("blank serialNumber = %q, want nil", *d.SerialNumber)
	}
	if contains(d.Unmatched, "serialNumber") {
		t.Errorf("a blank serial is \"not found\", not junk: unmatched = %v", d.Unmatched)
	}

	// Implausibly long value (junk OCR text) is dropped and flagged for manual entry.
	junk := strp(strings.Repeat("A", maxDraftSerialBytes+1))
	d = buildDraft(context.Background(), ai.ExtractedReceipt{SerialNumber: junk}, testCatalog())
	if d.SerialNumber != nil {
		t.Errorf("over-long serialNumber = %q, want nil", *d.SerialNumber)
	}
	if !contains(d.Unmatched, "serialNumber") {
		t.Errorf("unmatched = %v, want serialNumber flagged", d.Unmatched)
	}

	// Exactly at the cap is still accepted.
	ok := strp(strings.Repeat("B", maxDraftSerialBytes))
	d = buildDraft(context.Background(), ai.ExtractedReceipt{SerialNumber: ok}, testCatalog())
	if d.SerialNumber == nil || *d.SerialNumber != *ok {
		t.Errorf("serialNumber at the cap = %v, want passthrough", d.SerialNumber)
	}
}

// ---- normalizeExtractedText (DB-free) --------------------------------------

// The OCR transcript is user-visible data and a Postgres text value, so it is
// cleaned at exactly one boundary. These cases pin what "cleaned" means: no
// silent translation, no invented fallback, but also nothing that would make the
// INSERT fail or turn every attachment list into a multi-megabyte response.
func TestNormalizeExtractedText(t *testing.T) {
	for _, tc := range []struct {
		name string
		in   *string
		want *string
	}{
		{name: "nil stays nil", in: nil, want: nil},
		{name: "empty", in: strp(""), want: nil},
		{name: "whitespace only", in: strp(" \t\n\r "), want: nil},
		{name: "trimmed", in: strp("  Sạc nhanh 65W  "), want: strp("Sạc nhanh 65W")},
		{name: "CRLF normalised", in: strp("dòng 1\r\ndòng 2"), want: strp("dòng 1\ndòng 2")},
		// Postgres text cannot contain NUL; pgx would reject the whole write.
		{name: "NUL removed", in: strp("a\x00b"), want: strp("ab")},
		{name: "NUL-only", in: strp("\x00\x00"), want: nil},
		{name: "Vietnamese preserved verbatim", in: strp("Điện thoại / Tủ lạnh"), want: strp("Điện thoại / Tủ lạnh")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := normalizeExtractedText(tc.in)
			switch {
			case tc.want == nil && got != nil:
				t.Fatalf("normalize(%v) = %q, want nil", tc.in, *got)
			case tc.want != nil && got == nil:
				t.Fatalf("normalize(%v) = nil, want %q", tc.in, *tc.want)
			case tc.want != nil && *got != *tc.want:
				t.Fatalf("normalize(%v) = %q, want %q", tc.in, *got, *tc.want)
			}
		})
	}

	// The cap is counted in RUNES, not bytes: a Vietnamese transcript truncated
	// mid-rune would be invalid UTF-8, and byte-capping would cut a 3-byte 'ạ'
	// into garbage. The result must still be valid text of exactly the cap.
	long := strings.Repeat("ạ", MaxExtractedTextRunes+100)
	got := normalizeExtractedText(&long)
	if got == nil {
		t.Fatal("over-cap text was dropped, want truncation")
	}
	if n := utf8.RuneCountInString(*got); n != MaxExtractedTextRunes {
		t.Errorf("over-cap text = %d runes, want %d", n, MaxExtractedTextRunes)
	}
	if !utf8.ValidString(*got) {
		t.Error("truncated text is not valid UTF-8")
	}
}

// ---- real-database assertions ----------------------------------------------
//
// Runs only when WV_TEST_DATABASE_URL points at a throwaway Postgres (helpers
// from category_seed_test.go).

// ExtractReceipt is exercised end-to-end at the service layer with a fake
// extractor: no network, no Anthropic key, no encrypted blobs. The direct-upload
// branch (`in.Body`) is used, which is exactly what the multipart handler feeds
// after its own MIME validation.
func TestExtractReceiptAgainstRealPostgres(t *testing.T) {
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	const userID = "zz_test_ocr_user"
	if _, err := pool.Exec(ctx,
		`INSERT INTO "User" (id, email, "passwordHash", "updatedAt", "aiOptIn") VALUES ($1, $2, 'x', NOW(), true)
		 ON CONFLICT (id) DO UPDATE SET "aiOptIn" = true`, userID, userID+"@example.invalid"); err != nil {
		t.Fatalf("insert test user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, userID)
	})

	// 1. Types with no Messages-API block are refused with bad_input BEFORE the
	//    extractor is called. PDF used to be in this list; as of roadmap #15 it is
	//    supported (step 1b), so only GIF/HEIC remain — they are accepted as
	//    attachments but cannot be sent as an image or document block.
	for _, mt := range []string{"image/gif", "image/heic"} {
		fake := &fakeExtractor{result: ai.ExtractedReceipt{Name: strp("must not be used")}}
		_, err := ExtractReceipt(ctx, pool, fake, userID, ExtractInput{
			Body:      []byte("not an image"),
			MediaType: mt,
		})
		ae, ok := AsAttachmentError(err)
		if !ok || ae.Code != "bad_input" {
			t.Errorf("ExtractReceipt(mediaType=%q) error = %v, want bad_input", mt, err)
			continue
		}
		if fake.calls != 0 {
			t.Errorf("ExtractReceipt(mediaType=%q) called the extractor %d times, want 0", mt, fake.calls)
		}
	}

	// 1b. PDF IS accepted now and reaches the extractor as application/pdf.
	pdfFake := &fakeExtractor{result: ai.ExtractedReceipt{Name: strp("Hoá đơn PDF")}}
	pdfDraft, err := ExtractReceipt(ctx, pool, pdfFake, userID, ExtractInput{
		Body:      []byte("%PDF-1.4 fake"),
		MediaType: "application/pdf",
	})
	if err != nil {
		t.Fatalf("ExtractReceipt(application/pdf) = %v, want it accepted", err)
	}
	if pdfFake.calls != 1 {
		t.Errorf("PDF called the extractor %d times, want 1", pdfFake.calls)
	}
	if pdfFake.lastMediaType != "application/pdf" {
		t.Errorf("extractor saw media type %q, want application/pdf", pdfFake.lastMediaType)
	}
	if pdfDraft.Name == nil || *pdfDraft.Name != "Hoá đơn PDF" {
		t.Errorf("PDF draft name = %v, want the extractor's value", pdfDraft.Name)
	}

	// 2. A supported image flows through, and the OCR fields reach the draft with
	//    the sanity bounds applied (9999 months → null + flagged).
	fake := &fakeExtractor{result: ai.ExtractedReceipt{
		Name:           strp("iPhone 15 Pro"),
		Brand:          strp("Apple"),
		SerialNumber:   strp(" 356789012345678 "),
		WarrantyMonths: intp(9999),
		Confidence:     strp("high"),
		ExtractedText:  strp("iPhone 15 Pro 256GB\nGiá: 28.990.000đ"),
	}}
	draft, err := ExtractReceipt(ctx, pool, fake, userID, ExtractInput{
		Body:      []byte{0xFF, 0xD8, 0xFF, 0xE0},
		MediaType: "image/jpeg",
	})
	if err != nil {
		t.Fatalf("ExtractReceipt(image/jpeg): %v", err)
	}
	if fake.calls != 1 {
		t.Errorf("extractor calls = %d, want 1", fake.calls)
	}
	if draft.SerialNumber == nil || *draft.SerialNumber != "356789012345678" {
		t.Errorf("draft.serialNumber = %v, want trimmed %q", draft.SerialNumber, "356789012345678")
	}
	if draft.WarrantyMonths != nil {
		t.Errorf("draft.warrantyMonths = %d, want nil (9999 is out of range)", *draft.WarrantyMonths)
	}
	if !contains(draft.Unmatched, "warrantyMonths") {
		t.Errorf("draft.unmatched = %v, want warrantyMonths flagged", draft.Unmatched)
	}
	// The direct-upload branch has no attachment to own the text: it is returned
	// to the caller, but not persisted (and the response says so explicitly).
	if draft.ExtractedText == nil || *draft.ExtractedText != "iPhone 15 Pro 256GB\nGiá: 28.990.000đ" {
		t.Errorf("draft.extractedText = %v, want the transcript returned", draft.ExtractedText)
	}
	if draft.ExtractedTextStored {
		t.Error("direct-upload draft.extractedTextStored = true, but there is no attachment to store it on")
	}
}

// TestExtractReceiptPersistsOCRTextAgainstRealPostgres is the roadmap #13
// end-to-end proof: OCR on an EXISTING attachment stores the transcript on that
// attachment (migration 0019), and GET /api/v1/search's `attachments` group finds
// it diacritic-insensitively, owner-scoped, with the inbox/file distinction
// carried by `deviceId`.
//
// It runs against a real Postgres because none of that is true without the
// trigram/unaccent index and the generated query. The database must be UTF-8
// encoded — a non-UTF-8 cluster stores no Vietnamese characters at all, so the
// test skips with an explanation instead of pretending the ASCII path proved
// anything.
func TestExtractReceiptPersistsOCRTextAgainstRealPostgres(t *testing.T) {
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

	var encoding string
	if err := pool.QueryRow(ctx, `SHOW server_encoding`).Scan(&encoding); err != nil {
		t.Fatalf("read server_encoding: %v", err)
	}
	if encoding != "UTF8" {
		t.Skipf("test database encoding is %s, not UTF8: Vietnamese OCR text cannot be stored/searched here", encoding)
	}

	const (
		userID = "zz_test_ocr_persist_user"
		other  = "zz_test_ocr_persist_other"
		// Deliberately accented, multi-line, and containing the exact phrases the
		// feature exists for: a charger and an extended-care plan.
		ocrText = "Sạc nhanh 65W\nGói bảo hành mở rộng 12 tháng\nHoá đơn điện tử"
	)
	for _, u := range []string{userID, other} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO "User" (id, email, "passwordHash", "updatedAt", "aiOptIn")
			 VALUES ($1, $2, 'x', NOW(), true)
			 ON CONFLICT (id) DO UPDATE SET "aiOptIn" = true`, u, u+"@example.invalid"); err != nil {
			t.Fatalf("insert user %s: %v", u, err)
		}
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = ANY($1)`, []string{userID, other})
	})

	// A real attachment row + encrypted blob, so ExtractReceipt's attachmentId
	// branch exercises the same decrypt pipeline as production.
	att, err := Upload(ctx, pool, userID, UploadAttachmentInput{
		FileName:   "hoa-don.png",
		DeclaredCT: "image/png",
		Body:       tinyPNG(t),
	})
	if err != nil {
		t.Fatalf("Upload: %v", err)
	}

	fake := &fakeExtractor{result: ai.ExtractedReceipt{
		Name:          strp("Củ sạc 65W"),
		ExtractedText: strp("  " + ocrText + "  "), // service trims it
	}}
	draft, err := ExtractReceipt(ctx, pool, fake, userID, ExtractInput{AttachmentID: att.ID})
	if err != nil {
		t.Fatalf("ExtractReceipt(attachmentId): %v", err)
	}
	if draft.ExtractedText == nil || *draft.ExtractedText != ocrText {
		t.Fatalf("draft.extractedText = %v, want the trimmed transcript", draft.ExtractedText)
	}
	if !draft.ExtractedTextStored {
		t.Fatal("draft.extractedTextStored = false, want true on the attachmentId branch")
	}

	row, err := store.New(pool).GetAttachmentByID(ctx, store.GetAttachmentByIDParams{ID: att.ID, UserId: userID})
	if err != nil {
		t.Fatalf("read stored attachment: %v", err)
	}
	if row.ExtractedText == nil || *row.ExtractedText != ocrText {
		t.Errorf("stored extractedText = %v, want %q", row.ExtractedText, ocrText)
	}

	// Backup decision (roadmap #13): the transcript is a derived search
	// projection and deliberately does NOT travel in the export, so a backup file
	// never becomes a second plaintext copy of the receipt. The attachment
	// metadata still does. This pins that choice against a future "helpful"
	// addition to BackupAttachment.
	payload, err := ExportBackup(ctx, pool, userID)
	if err != nil {
		t.Fatalf("ExportBackup: %v", err)
	}
	rawBackup, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal backup: %v", err)
	}
	if strings.Contains(string(rawBackup), "extractedText") {
		t.Errorf("backup payload carries an extractedText key:\n%s", rawBackup)
	}
	if strings.Contains(string(rawBackup), "Sạc nhanh 65W") {
		t.Errorf("backup payload carries the OCR transcript text:\n%s", rawBackup)
	}
	if !strings.Contains(string(rawBackup), `"fileName":"hoa-don.png"`) {
		t.Errorf("backup lost the attachment metadata while omitting its text:\n%s", rawBackup)
	}

	// Search is the actual feature: unaccented, lower-case input must find the
	// accented, mixed-case transcript. Each query hits a different part of it.
	for _, q := range []string{"sac nhanh", "SẠC NHANH", "goi bao hanh mo rong", "65w", "hoa don dien tu"} {
		res, serr := Search(ctx, pool, userID, q, 20)
		if serr != nil {
			t.Fatalf("Search(%q): %v", q, serr)
		}
		if len(res.Attachments) != 1 {
			t.Errorf("Search(%q) attachments = %d, want 1 (%+v)", q, len(res.Attachments), res.Attachments)
			continue
		}
		hit := res.Attachments[0]
		if hit.ID != att.ID {
			t.Errorf("Search(%q) hit id = %q, want %q", q, hit.ID, att.ID)
		}
		// Upload with no deviceId creates an inbox item; a search hit must say so
		// with deviceId null rather than omitting the field.
		if hit.DeviceID != nil {
			t.Errorf("Search(%q) deviceId = %q, want nil for an inbox item", q, *hit.DeviceID)
		}
		if hit.ExtractedText == nil || *hit.ExtractedText != ocrText {
			t.Errorf("Search(%q) hit extractedText = %v, want the transcript", q, hit.ExtractedText)
		}
	}

	// Another account's identical text is never visible to this one.
	if _, err := pool.Exec(ctx,
		`INSERT INTO "Attachment" (id, "userId", "fileName", "storagePath", "fileType", "fileSize", iv, "wrappedKey", "uploadedAt", "extractedText")
		 VALUES ('zz_ocr_persist_other_att', $1, 'hoa-don.png', '_inbox/zz_ocr_persist_other_att.enc', 'image/png', 10,
		         '\x000102030405060708090a0b'::bytea, '\x00'::bytea, NOW(), $2)`,
		other, ocrText); err != nil {
		t.Fatalf("insert other user's attachment: %v", err)
	}
	resOther, err := Search(ctx, pool, other, "sac nhanh", 20)
	if err != nil {
		t.Fatalf("Search(other): %v", err)
	}
	if len(resOther.Attachments) != 1 || resOther.Attachments[0].ID != "zz_ocr_persist_other_att" {
		t.Errorf("other user's search = %+v, want exactly their own hit", resOther.Attachments)
	}
	for _, hit := range resOther.Attachments {
		if hit.ID == att.ID {
			t.Error("cross-account leak: the first user's attachment appeared in the other user's search")
		}
	}

	// The write is owner-scoped: the other user cannot overwrite this attachment's
	// text by id.
	if err := SetAttachmentExtractedText(ctx, pool, other, att.ID, strp("hijacked")); err == nil {
		t.Error("SetAttachmentExtractedText(other user) = nil, want not_found")
	}
	row, _ = store.New(pool).GetAttachmentByID(ctx, store.GetAttachmentByIDParams{ID: att.ID, UserId: userID})
	if row.ExtractedText == nil || *row.ExtractedText != ocrText {
		t.Errorf("text changed after a cross-user write attempt: %v", row.ExtractedText)
	}

	// An OCR that finds no text must NOT wipe a transcript stored earlier: a
	// failed/blank re-scan is not evidence that the receipt no longer says
	// anything, and silently losing the search text would be worse than keeping
	// stale-but-correct text. Nothing is written, so the row keeps its value.
	empty := &fakeExtractor{result: ai.ExtractedReceipt{Name: strp("Không chữ")}}
	draft, err = ExtractReceipt(ctx, pool, empty, userID, ExtractInput{AttachmentID: att.ID})
	if err != nil {
		t.Fatalf("ExtractReceipt(empty text): %v", err)
	}
	if draft.ExtractedTextStored {
		t.Error("empty transcript reported as stored")
	}
	row, _ = store.New(pool).GetAttachmentByID(ctx, store.GetAttachmentByIDParams{ID: att.ID, UserId: userID})
	if row.ExtractedText == nil || *row.ExtractedText != ocrText {
		t.Errorf("stored extractedText = %v after an empty re-scan, want the previous transcript preserved", row.ExtractedText)
	}
}

// fakeExtractor satisfies ReceiptExtractor with no network and no DB.
type fakeExtractor struct {
	calls         int
	lastMediaType string
	result        ai.ExtractedReceipt
	err           error
}

func (f *fakeExtractor) Enabled() bool { return true }

func (f *fakeExtractor) ExtractReceipt(_ context.Context, _ []byte, mediaType string) (ai.ExtractedReceipt, error) {
	f.calls++
	f.lastMediaType = mediaType
	return f.result, f.err
}

func contains(ss []string, s string) bool {
	for _, x := range ss {
		if x == s {
			return true
		}
	}
	return false
}
