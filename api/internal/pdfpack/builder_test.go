package pdfpack

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"strings"
	"testing"
	"time"

	"github.com/thanhtrung9368/warranty-vault/api/internal/pdfpack/pdftext"
)

// These tests pin the document contract that can be checked without a human
// looking at the page: the PDF header, the Vietnamese text layer, the visible
// manifest notes, and that a pathological amount of text still produces a
// multi-page PDF instead of an error. Layout aesthetics are NOT asserted here.
//
// Every expected string is Vietnamese: the pack is always Vietnamese, including
// when the request carried ?lang=en (the service test covers that flag).

func fixedTime() time.Time {
	return time.Date(2026, 10, 19, 9, 30, 0, 0, time.UTC)
}

func day(y int, m time.Month, d int) *time.Time {
	t := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	return &t
}

func i32(v int32) *int32 { return &v }
func i64(v int64) *int64 { return &v }

func buildOrFail(t *testing.T, doc Document) ([]byte, string, int) {
	t.Helper()
	raw, err := Build(doc)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if !bytes.HasPrefix(raw, []byte("%PDF-")) {
		t.Fatalf("output does not start with %%PDF-: %q", raw[:min(len(raw), 16)])
	}
	text, err := pdftext.Extract(raw)
	if err != nil {
		t.Fatalf("extract text: %v", err)
	}
	pages, err := pdftext.Pages(raw)
	if err != nil {
		t.Fatalf("count pages: %v", err)
	}
	return raw, text, pages
}

func TestBuildEmptyAccountIsOnePage(t *testing.T) {
	raw, text, pages := buildOrFail(t, Document{
		GeneratedAt: fixedTime(),
		Account:     Account{DisplayName: "Nguyễn Thị Bích Phượng", Email: "phuong@example.invalid"},
	})
	if pages != 1 {
		t.Fatalf("empty account produced %d pages, want exactly 1", pages)
	}
	for _, want := range []string{
		"Bảng kê tài sản được bảo vệ",
		"Nguyễn Thị Bích Phượng",
		"phuong@example.invalid",
		"Không có thiết bị nào để kê khai",
		"Thời điểm tạo",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("empty-account text missing %q\n--- text ---\n%s", want, text)
		}
	}
	if len(raw) < 1000 {
		t.Errorf("PDF suspiciously small: %d bytes", len(raw))
	}
}

func TestBuildScheduleAndDeviceDetail(t *testing.T) {
	doc := Document{
		GeneratedAt: fixedTime(),
		Account:     Account{DisplayName: "Nguyễn Thị Bích Phượng", Email: "phuong@example.invalid"},
		Devices: []Device{{
			Name:                 "Điện thoại của chị Nguyễn Thị Bích Phượng",
			Brand:                "Apple",
			Model:                "iPhone 15 Pro",
			SerialNumber:         "SN-Ệ-001",
			PurchaseDate:         day(2025, time.January, 15),
			PurchasePrice:        25_000_000,
			Currency:             "VND",
			PurchasePriceVND:     i64(25_000_000),
			EffectiveWarrantyEnd: day(2027, time.January, 15),
			Status:               "ACTIVE",
			Warranties: []Warranty{{
				Type:          "STANDARD",
				Provider:      "Apple Việt Nam",
				StartDate:     day(2025, time.January, 15),
				EndDate:       day(2027, time.January, 15),
				Months:        24,
				Component:     "Toàn bộ thiết bị",
				Scope:         "Lỗi kỹ thuật từ nhà sản xuất.",
				Cap:           i32(30_000_000),
				Deductible:    i32(500_000),
				Exclusions:    "Rơi vỡ, ngấm nước, cháy nổ, hao mòn tự nhiên.",
				ClaimsAllowed: i32(3),
				ClaimsUsed:    1,
			}},
			Claims: []Claim{{
				Status:            "RESOLVED",
				OpenedAt:          day(2026, time.March, 1),
				ClosedAt:          day(2026, time.March, 10),
				TicketNumber:      "BV-2026-001",
				ServiceCenter:     "Trung tâm bảo hành Apple Quận 1",
				Issue:             "Màn hình bị sọc xanh sau khi cập nhật.",
				Diagnosis:         "Lỗi màn hình được bảo hành.",
				Outcome:           "Đã thay màn hình, không mất phí.",
				Cost:              i32(0),
				CoveredByWarranty: boolPtr(true),
			}},
			Attachments: []Attachment{
				{FileName: "hoa-don.pdf", FileType: "application/pdf", Status: ManifestNotEmbeddable},
				{FileName: "anh-hop.png", FileType: "image/png", Status: ManifestImageLimit},
			},
		}},
	}
	_, text, pages := buildOrFail(t, doc)
	if pages < 2 {
		t.Fatalf("device pack produced %d pages, want the cover plus detail pages", pages)
	}
	for _, want := range []string{
		"Bảng kê tài sản được bảo vệ",
		"Nguyễn Thị Bích Phượng",
		"SN-Ệ-001",
		"Điện thoại của chị Nguyễn Thị Bích Phượng",
		"Bảo hành tiêu chuẩn",
		"Điều khoản loại trừ",
		"Rơi vỡ, ngấm nước",
		"Yêu cầu bảo hành",
		"Đã xử lý",
		"Đã thay màn hình, không mất phí.",
		"Bảng kê tệp đính kèm",
		"hoa-don.pdf",
		"anh-hop.png",
		"PDF không nhúng được dưới dạng ảnh",
		"Tổng cộng",
		"25.000.000 VND",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("device detail text missing %q\n--- text ---\n%s", want, text)
		}
	}
	// The title itself must survive as Vietnamese, not WinAnsi mojibake.
	if !strings.Contains(text, "được bảo vệ") {
		t.Errorf("Vietnamese diacritics did not survive extraction:\n%s", text)
	}
}

func TestBuildLongWarrantiesDoNotBreakPagination(t *testing.T) {
	long := strings.Repeat("Loại trừ rơi vỡ, ngấm nước, cháy nổ, hao mòn tự nhiên, sửa chữa bên ngoài, mất cắp. ", 6)
	warranties := make([]Warranty, 0, 5)
	for i := 0; i < 5; i++ {
		warranties = append(warranties, Warranty{
			Type:       "THIRD_PARTY",
			StartDate:  day(2025, time.January, 1),
			EndDate:    day(2030+i, time.January, 1),
			Months:     60,
			Scope:      long,
			Exclusions: long + " — gói số " + string(rune('1'+i)),
		})
	}
	doc := Document{
		GeneratedAt: fixedTime(),
		Account:     Account{DisplayName: "Chủ hộ", Email: "owner@example.invalid"},
		Devices: []Device{{
			Name:             "Tủ lạnh Samsung Inverter " + strings.Repeat("rất dài ", 40),
			Brand:            "Samsung",
			PurchaseDate:     day(2024, time.June, 1),
			PurchasePrice:    30_000_000,
			Currency:         "VND",
			PurchasePriceVND: i64(30_000_000),
			Status:           "ACTIVE",
			Warranties:       warranties,
		}},
	}
	_, text, pages := buildOrFail(t, doc)
	if pages < 4 {
		t.Fatalf("five long warranties produced %d pages, want them to span several pages", pages)
	}
	if !strings.Contains(text, "gói số 5") {
		t.Errorf("the last warranty was truncated away entirely (missing 'gói số 5')\n--- text ---\n%s", text)
	}
	if !strings.Contains(text, "…") {
		t.Error("the very long device name was not visibly truncated anywhere")
	}
}

func TestBuildManifestListsNonEmbeddableFilesAndNoImages(t *testing.T) {
	doc := Document{
		GeneratedAt: fixedTime(),
		Account:     Account{DisplayName: "Trần Văn An", Email: "an@example.invalid"},
		Devices: []Device{{
			Name:             "Máy ảnh không có ảnh",
			PurchaseDate:     day(2023, time.May, 4),
			PurchasePrice:    10_000_000,
			Currency:         "VND",
			PurchasePriceVND: i64(10_000_000),
			Status:           "ACTIVE",
			Attachments: []Attachment{
				{FileName: "hop-dong.heic", FileType: "image/heic", Status: ManifestNotEmbeddable},
				{FileName: "bien-ban.pdf", FileType: "application/pdf", Status: ManifestNotEmbeddable},
				{FileName: "anh-them.png", FileType: "image/png", Status: ManifestImageLimit},
			},
		}},
	}
	_, text, _ := buildOrFail(t, doc)
	for _, want := range []string{
		"Không có ảnh nào được nhúng cho thiết bị này.",
		"hop-dong.heic",
		"HEIC không nhúng được vào PDF",
		"bien-ban.pdf",
		"PDF không nhúng được dưới dạng ảnh",
		"anh-them.png",
		"vượt giới hạn 2 ảnh/thiết bị",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("manifest text missing %q\n--- text ---\n%s", want, text)
		}
	}
}

func TestBuildNeverPanicsOnControlCharacters(t *testing.T) {
	doc := Document{
		GeneratedAt: fixedTime(),
		Account:     Account{DisplayName: "A\x00B\tC", Email: "x@example.invalid"},
		Devices: []Device{{
			Name:         "Thiết bị\x01\x02 có ký tự điều khiển",
			Currency:     "VND",
			PurchaseDate: day(2025, time.January, 1),
			Warranties: []Warranty{{
				Type:       "STANDARD",
				Exclusions: "Dòng một\nDòng hai\x03 với ký tự điều khiển",
			}},
		}},
	}
	_, text, _ := buildOrFail(t, doc)
	if strings.ContainsRune(text, '\x00') || strings.ContainsRune(text, '\x01') {
		t.Errorf("control characters leaked into the text layer: %q", text)
	}
	if !strings.Contains(text, "Dòng một") || !strings.Contains(text, "Dòng hai") {
		t.Errorf("newlines/control sanitisation lost real content:\n%s", text)
	}
}

func TestFormatThousands(t *testing.T) {
	cases := map[int64]string{
		0:                     "0",
		999:                   "999",
		1000:                  "1.000",
		25_000_000:            "25.000.000",
		-1_500_000:            "-1.500.000",
		1_234_567_890:         "1.234.567.890",
		9_007_199_254_740_993: "9.007.199.254.740.993",
	}
	for in, want := range cases {
		if got := formatThousands(in); got != want {
			t.Errorf("formatThousands(%d) = %q, want %q", in, got, want)
		}
	}
}

func boolPtr(v bool) *bool { return &v }

func TestEmbeddedImageIsRendered(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 40, 30))
	for x := 0; x < 40; x++ {
		for y := 0; y < 30; y++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 6), G: uint8(y * 8), B: 120, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	doc := Document{
		GeneratedAt: fixedTime(),
		Account:     Account{DisplayName: "Có ảnh", Email: "img@example.invalid"},
		Devices: []Device{{
			Name:         "Thiết bị có ảnh",
			Currency:     "VND",
			PurchaseDate: day(2025, time.January, 1),
			Status:       "ACTIVE",
			Images: []Image{{
				FileName:    "hoa-don.jpg",
				Description: "Hoá đơn mua hàng",
				Data:        buf.Bytes(),
				Width:       40,
				Height:      30,
			}},
			Attachments: []Attachment{
				{FileName: "hoa-don.jpg", FileType: "image/jpeg", Status: ManifestEmbedded},
			},
		}},
	}
	raw, text, _ := buildOrFail(t, doc)
	if !bytes.Contains(raw, []byte("/Subtype /Image")) {
		t.Error("embedded image produced no /Subtype /Image object")
	}
	for _, want := range []string{"Ảnh 1: hoa-don.jpg", "Hoá đơn mua hàng"} {
		if !strings.Contains(text, want) {
			t.Errorf("image caption missing %q\n--- text ---\n%s", want, text)
		}
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
