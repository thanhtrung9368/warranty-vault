package services

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/thanhtrung9368/warranty-vault/api/internal/files"
	"github.com/thanhtrung9368/warranty-vault/api/internal/pdfpack"
	"github.com/thanhtrung9368/warranty-vault/api/internal/pdfpack/pdftext"
)

// Insurance-pack tests. The database-backed cases run only when
// WV_TEST_DATABASE_URL points at a throwaway Postgres; TestParseInsuranceDeviceIDs
// is pure and runs everywhere.
//
// The assertions deliberately check the EXTRACTED TEXT, not just the PDF header:
// the point of the feature is that an adjuster can read the Vietnamese document,
// so "PDF exists" would not prove anything.

var insuranceSeq atomic.Int64

func insuranceID(prefix string) string {
	return fmt.Sprintf("zz_ins_%s_%d", prefix, insuranceSeq.Add(1))
}

type insuranceEnv struct {
	pool        *pgxpool.Pool
	userID      string
	otherUserID string
	deviceA     string
	deviceB     string
	deviceSold  string
	otherDevice string
}

func insertInsuranceUser(t *testing.T, pool *pgxpool.Pool, id, email, name string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO "User" (id, email, name, "passwordHash", "updatedAt")
		 VALUES ($1, $2, $3, 'x', NOW()) ON CONFLICT (id) DO NOTHING`, id, email, name); err != nil {
		t.Fatalf("insert user %s: %v", id, err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM "User" WHERE id = $1`, id)
	})
}

func execInsurance(t *testing.T, pool *pgxpool.Pool, q string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), q, args...); err != nil {
		t.Fatalf("exec %q: %v", q, err)
	}
}

func newInsuranceEnv(t *testing.T) *insuranceEnv {
	t.Helper()
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)

	e := &insuranceEnv{
		pool:        pool,
		userID:      insuranceID("user"),
		otherUserID: insuranceID("other"),
		deviceA:     insuranceID("dev_a"),
		deviceB:     insuranceID("dev_b"),
		deviceSold:  insuranceID("dev_sold"),
		otherDevice: insuranceID("dev_other"),
	}
	insertInsuranceUser(t, pool, e.userID, e.userID+"@insurance.invalid", "Nguyễn Thị Bích Phượng")
	insertInsuranceUser(t, pool, e.otherUserID, e.otherUserID+"@insurance.invalid", "Người khác")

	execInsurance(t, pool,
		`INSERT INTO "Device" (id, "userId", name, category, brand, model, "serialNumber",
		 "purchaseDate", "purchasePrice", status, currency, "updatedAt")
		 VALUES ($1, $2, $3, 'PHONE', 'Apple', 'iPhone 15 Pro', 'SN-Ệ-001', '2025-01-15', 25000000, 'ACTIVE', 'VND', NOW())`,
		e.deviceA, e.userID, "Điện thoại của chị Nguyễn Thị Bích Phượng")
	execInsurance(t, pool,
		`INSERT INTO "Device" (id, "userId", name, category, brand, model, "purchaseDate",
		 "purchasePrice", status, currency, "fxRate", "updatedAt")
		 VALUES ($1, $2, 'Máy ảnh Sony', 'CAMERA', 'Sony', 'A7C', '2024-06-01', 999, 'ACTIVE', 'USD', 26100, NOW())`,
		e.deviceB, e.userID)
	execInsurance(t, pool,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice",
		 status, currency, "soldAt", "soldPrice", "updatedAt")
		 VALUES ($1, $2, 'Máy tính đã bán', 'LAPTOP', '2022-01-10', 18000000, 'SOLD', 'VND', '2026-01-02', 18000000, NOW())`,
		e.deviceSold, e.userID)
	execInsurance(t, pool,
		`INSERT INTO "Device" (id, "userId", name, category, "purchaseDate", "purchasePrice", status, "updatedAt")
		 VALUES ($1, $2, 'Thiết bị của người khác', 'PHONE', '2025-01-01', 1000000, 'ACTIVE', NOW())`,
		e.otherDevice, e.otherUserID)

	execInsurance(t, pool,
		`INSERT INTO "Warranty" (id, "deviceId", type, provider, "startDate", "endDate", months,
		 component, scope, cap, deductible, exclusions, region, transferable, "claimsAllowed", "claimsUsed", "updatedAt")
		 VALUES ($1, $2, 'STANDARD', 'Apple Việt Nam', '2025-01-15', '2027-01-15', 24,
		 'Toàn bộ thiết bị', 'Lỗi kỹ thuật từ nhà sản xuất.', 30000000, 500000,
		 'Rơi vỡ, ngấm nước, cháy nổ, hao mòn tự nhiên.', 'Việt Nam', true, 3, 1, NOW())`,
		insuranceID("war_a"), e.deviceA)
	execInsurance(t, pool,
		`INSERT INTO "Warranty" (id, "deviceId", type, "startDate", "endDate", months, scope, exclusions, "updatedAt")
		 VALUES ($1, $2, 'THIRD_PARTY', '2024-06-01', '2026-06-01', 24,
		 'Bảo hành mở rộng cho thân máy.', 'Loại trừ rơi vỡ, ngấm nước, hao mòn tự nhiên.', NOW())`,
		insuranceID("war_b"), e.deviceA)

	execInsurance(t, pool,
		`INSERT INTO "Claim" (id, "deviceId", status, "openedAt", "closedAt", "ticketNumber",
		 "serviceCenter", issue, diagnosis, outcome, cost, "coveredByWarranty", "updatedAt")
		 VALUES ($1, $2, 'RESOLVED', '2026-03-01', '2026-03-10', 'BV-2026-001',
		 'Trung tâm bảo hành Apple Quận 1', 'Màn hình bị sọc xanh sau khi cập nhật.',
		 'Lỗi màn hình được bảo hành.', 'Đã thay màn hình, không mất phí.', 0, true, NOW())`,
		insuranceID("claim_a"), e.deviceA)

	return e
}

func tinyInsurancePNG(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 12, 9))
	for x := 0; x < 12; x++ {
		for y := 0; y < 9; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 20), G: uint8(y * 25), B: 180, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

// insertInsuranceImage stores a real encrypted PNG blob and its Attachment row.
func insertInsuranceImage(t *testing.T, e *insuranceEnv, deviceID, attID, name string, uploadedAt time.Time) {
	t.Helper()
	master, err := files.LoadMasterKey()
	if err != nil {
		t.Fatalf("load master key: %v", err)
	}
	plain := tinyInsurancePNG(t)
	enc, err := files.Encrypt(plain, master)
	if err != nil {
		t.Fatalf("encrypt png: %v", err)
	}
	path, err := files.WriteEncrypted(files.PrivateUploadRoot(), deviceID, attID+".enc", enc.Ciphertext)
	if err != nil {
		t.Fatalf("write encrypted png: %v", err)
	}
	execInsurance(t, e.pool,
		`INSERT INTO "Attachment" (id, "userId", "deviceId", "fileName", "storagePath", "fileType",
		 "fileSize", iv, "wrappedKey", description, "uploadedAt")
		 VALUES ($1, $2, $3, $4, $5, 'image/png', $6, $7, $8, 'Ảnh chứng từ thực tế', $9)`,
		attID, e.userID, deviceID, name, path, len(plain), enc.IV, enc.WrappedKey, uploadedAt)
}

func insertInsuranceAttachment(t *testing.T, e *insuranceEnv, deviceID, attID, name, fileType, storagePath string, uploadedAt time.Time) {
	t.Helper()
	execInsurance(t, e.pool,
		`INSERT INTO "Attachment" (id, "userId", "deviceId", "fileName", "storagePath", "fileType",
		 "fileSize", iv, "wrappedKey", "uploadedAt")
		 VALUES ($1, $2, $3, $4, $5, $6, 123, '\x00'::bytea, '\x00'::bytea, $7)`,
		attID, e.userID, deviceID, name, storagePath, fileType, uploadedAt)
}

func buildInsuranceForTest(t *testing.T, e *insuranceEnv, opts InsurancePackOptions) (*InsurancePackResult, string) {
	t.Helper()
	if opts.GeneratedAt.IsZero() {
		opts.GeneratedAt = time.Date(2026, 10, 19, 9, 30, 0, 0, time.UTC)
	}
	res, err := BuildInsurancePack(viCtx(), e.pool, e.userID, opts)
	if err != nil {
		t.Fatalf("BuildInsurancePack: %v", err)
	}
	if !bytes.HasPrefix(res.PDF, []byte("%PDF-")) {
		t.Fatalf("not a PDF: %q", res.PDF[:minInt(len(res.PDF), 16)])
	}
	text, err := pdftext.Extract(res.PDF)
	if err != nil {
		t.Fatalf("extract text: %v", err)
	}
	return res, text
}

func TestInsurancePackBuildsVietnameseDocumentWithImagesAndManifest(t *testing.T) {
	root := t.TempDir()
	t.Setenv("PRIVATE_UPLOAD_ROOT", root)
	t.Setenv("FILE_MASTER_KEY", testMasterKeyB64)

	e := newInsuranceEnv(t)
	insertInsuranceImage(t, e, e.deviceA, insuranceID("att_img"), "hoa-don.png", time.Now().Add(-2*time.Minute))
	insertInsuranceAttachment(t, e, e.deviceA, insuranceID("att_pdf"), "hop-dong.pdf", "application/pdf", "missing/hop-dong.enc", time.Now().Add(-3*time.Minute))
	insertInsuranceAttachment(t, e, e.deviceA, insuranceID("att_heic"), "anh-may.heic", "image/heic", "missing/anh-may.enc", time.Now().Add(-4*time.Minute))

	res, text := buildInsuranceForTest(t, e, InsurancePackOptions{})
	if res.DeviceCount != 2 {
		t.Fatalf("DeviceCount = %d, want the two active devices (sold and foreign excluded)", res.DeviceCount)
	}
	if res.EmbeddedImages != 1 {
		t.Errorf("EmbeddedImages = %d, want 1", res.EmbeddedImages)
	}
	if res.AttachmentCount != 3 {
		t.Errorf("AttachmentCount = %d, want 3", res.AttachmentCount)
	}
	for _, want := range []string{
		"Bảng kê tài sản được bảo vệ",
		"Nguyễn Thị Bích Phượng",
		"Điện thoại của chị Nguyễn Thị Bích Phượng",
		"SN-Ệ-001",
		"Apple Việt Nam",
		"Rơi vỡ, ngấm nước, cháy nổ",
		"BV-2026-001",
		"Đã thay màn hình, không mất phí.",
		"hoa-don.png",
		"Đã nhúng ảnh trong tài liệu",
		"hop-dong.pdf",
		"PDF không nhúng được dưới dạng ảnh",
		"anh-may.heic",
		"HEIC không nhúng được vào PDF",
		"51.073.900 VND", // 25.000.000 VND + 999 USD × 26.100
		"26.073.900 VND",
		"Bảng kê tệp đính kèm",
		"Tổng cộng",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("document text missing %q\n--- text ---\n%s", want, text)
		}
	}
	if strings.Contains(text, "Thiết bị của người khác") {
		t.Error("another user's device leaked into the document")
	}
	if strings.Contains(text, "Máy tính đã bán") {
		t.Error("a sold device was included without includeSold=true")
	}
	if !bytes.Contains(res.PDF, []byte("/Subtype /Image")) {
		t.Error("the encrypted PNG was not embedded as an image XObject")
	}
}

func TestInsurancePackSoldDeviceAndDeviceIDFilter(t *testing.T) {
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir())
	t.Setenv("FILE_MASTER_KEY", testMasterKeyB64)
	e := newInsuranceEnv(t)

	// includeSold=true must add the sold device and print its resale fields.
	res, text := buildInsuranceForTest(t, e, InsurancePackOptions{IncludeSold: true})
	if res.DeviceCount != 3 {
		t.Fatalf("includeSold DeviceCount = %d, want 3", res.DeviceCount)
	}
	for _, want := range []string{"Máy tính đã bán", "Đã bán", "02/01/2026", "18.000.000 VND"} {
		if !strings.Contains(text, want) {
			t.Errorf("includeSold text missing %q\n--- text ---\n%s", want, text)
		}
	}

	// A requested id that belongs to the caller selects only that device.
	res, text = buildInsuranceForTest(t, e, InsurancePackOptions{DeviceIDs: []string{e.deviceB}})
	if res.DeviceCount != 1 || !strings.Contains(text, "Máy ảnh Sony") {
		t.Fatalf("deviceIds filter: count=%d, text has deviceB=%v", res.DeviceCount, strings.Contains(text, "Máy ảnh Sony"))
	}
	if strings.Contains(text, "Điện thoại của chị Nguyễn Thị Bích Phượng") {
		t.Error("deviceIds filter still included an unrequested device")
	}

	// A requested id that belongs to ANOTHER USER must select nothing, never that
	// user's device. This is the ownership pin for the endpoint.
	res, text = buildInsuranceForTest(t, e, InsurancePackOptions{DeviceIDs: []string{e.otherDevice}})
	if res.DeviceCount != 0 {
		t.Errorf("foreign deviceIds selected %d devices, want 0", res.DeviceCount)
	}
	if strings.Contains(text, "Thiết bị của người khác") {
		t.Error("another user's device appeared when its id was passed in deviceIds")
	}
	if !strings.Contains(text, "Không có thiết bị nào để kê khai") {
		t.Error("a filter that matches nothing should produce the empty-account notice")
	}

	// A sold id without includeSold selects nothing.
	res, _ = buildInsuranceForTest(t, e, InsurancePackOptions{DeviceIDs: []string{e.deviceSold}})
	if res.DeviceCount != 0 {
		t.Errorf("sold device selected without includeSold: count=%d", res.DeviceCount)
	}
}

func TestInsurancePackImageLimitsAndUnreadableAttachment(t *testing.T) {
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir())
	t.Setenv("FILE_MASTER_KEY", testMasterKeyB64)
	e := newInsuranceEnv(t)

	// Newest first: a missing blob (unreadable), then three real PNGs. The first
	// two real images are embedded; the third is over the 2/device budget.
	device := e.deviceB
	base := time.Now()
	insertInsuranceAttachment(t, e, device, insuranceID("att_missing"), "anh-bi-mat.jpg", "image/jpeg", "missing/khong-con.enc", base)
	insertInsuranceImage(t, e, device, insuranceID("att_img1"), "anh-1.png", base.Add(-1*time.Minute))
	insertInsuranceImage(t, e, device, insuranceID("att_img2"), "anh-2.png", base.Add(-2*time.Minute))
	insertInsuranceImage(t, e, device, insuranceID("att_img3"), "anh-3.png", base.Add(-3*time.Minute))
	insertInsuranceAttachment(t, e, device, insuranceID("att_pdf2"), "bien-ban.pdf", "application/pdf", "missing/bien-ban.enc", base.Add(-4*time.Minute))

	res, text := buildInsuranceForTest(t, e, InsurancePackOptions{DeviceIDs: []string{device}})
	if res.EmbeddedImages != 2 {
		t.Errorf("EmbeddedImages = %d, want the per-device cap of 2", res.EmbeddedImages)
	}
	for _, want := range []string{
		"Không đọc được — tệp thiếu hoặc không giải mã được",
		"vượt giới hạn 2 ảnh/thiết bị",
		"PDF không nhúng được dưới dạng ảnh",
		"anh-bi-mat.jpg",
		"anh-3.png",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("manifest missing %q\n--- text ---\n%s", want, text)
		}
	}
	if !bytes.Contains(res.PDF, []byte("/Subtype /Image")) {
		t.Error("two valid images were reported embedded but the PDF contains no image XObject")
	}
}

func TestInsurancePackEmptyAccountIsOnePage(t *testing.T) {
	t.Setenv("PRIVATE_UPLOAD_ROOT", t.TempDir())
	t.Setenv("FILE_MASTER_KEY", testMasterKeyB64)
	dsn := testDatabaseURL(t)
	gooseUp(t, dsn)
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	userID := insuranceID("empty_user")
	insertInsuranceUser(t, pool, userID, userID+"@insurance.invalid", "Tài khoản rỗng")

	res, err := BuildInsurancePack(viCtx(), pool, userID, InsurancePackOptions{
		GeneratedAt: time.Date(2026, 10, 19, 9, 30, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("BuildInsurancePack: %v", err)
	}
	pages, err := pdftext.Pages(res.PDF)
	if err != nil {
		t.Fatalf("count pages: %v", err)
	}
	if pages != 1 {
		t.Errorf("empty account produced %d pages, want 1", pages)
	}
	text, err := pdftext.Extract(res.PDF)
	if err != nil {
		t.Fatalf("extract: %v", err)
	}
	if !strings.Contains(text, "Không có thiết bị nào để kê khai") {
		t.Errorf("empty account notice missing:\n%s", text)
	}
	if strings.Contains(text, "Bảng kê tệp đính kèm") {
		t.Error("empty account still emitted the attachment manifest section")
	}
}

func TestParseInsuranceDeviceIDs(t *testing.T) {
	got := ParseInsuranceDeviceIDs(" a , b,,a, c ")
	want := []string{"a", "b", "c"}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("ParseInsuranceDeviceIDs = %v, want %v", got, want)
	}
	if got := ParseInsuranceDeviceIDs("   "); got != nil {
		t.Errorf("blank deviceIds = %v, want nil", got)
	}
	long := strings.Repeat("x", 200)
	if got := ParseInsuranceDeviceIDs(long); len(got) != 0 {
		t.Errorf("overlong id was accepted: %v", got)
	}
	many := make([]string, 0, MaxInsuranceDeviceIDs+20)
	for i := 0; i < MaxInsuranceDeviceIDs+20; i++ {
		many = append(many, fmt.Sprintf("id%d", i))
	}
	if got := ParseInsuranceDeviceIDs(strings.Join(many, ",")); len(got) != MaxInsuranceDeviceIDs {
		t.Errorf("id list was not capped: got %d, want %d", len(got), MaxInsuranceDeviceIDs)
	}
}

func TestInsuranceLimitsMatchDocumentPackage(t *testing.T) {
	if MaxInsuranceImagesPerDevice != pdfpack.MaxImagesPerDevice ||
		MaxInsuranceImageDimension != pdfpack.MaxImageDimension ||
		MaxInsuranceImagesPerDocument != pdfpack.MaxImagesPerDocument {
		t.Fatal("services limits drifted from pdfpack")
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
