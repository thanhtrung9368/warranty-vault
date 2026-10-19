package pdfpack

import "fmt"

// All user-facing copy of the document lives here, in Vietnamese, next to the
// builder. These strings are deliberately NOT i18n catalog entries: the insurance
// pack is an artifact that always leaves the app in Vietnamese, even when the
// HTTP request asked for `?lang=en`. Putting them in the catalog would make the
// document follow the caller's language, which is the one behaviour the artifact
// rule forbids.
const (
	docTitle       = "Bảng kê tài sản được bảo vệ"
	docSubtitle    = "Tài liệu cung cấp cho công ty bảo hiểm hoặc đơn vị giám định"
	docOwner       = "Chủ tài sản"
	docEmail       = "Email"
	docGeneratedAt = "Thời điểm tạo"
	docTimezone    = "GMT+7"
	docProvenance  = "Tài liệu này được Warrly tạo tự động từ chính dữ liệu người dùng đã nhập. Đây không phải hoá đơn và không thay thế chứng từ gốc; người dùng chịu trách nhiệm về tính đầy đủ và chính xác của dữ liệu."
	docDisclaimer  = "Các ảnh chứng từ được nhúng nguyên trạng sau khi giải mã từ kho lưu trữ của Warrly. Tệp không nhúng được vẫn xuất hiện trong bảng kê tệp đính kèm kèm lý do."

	emptyTitle = "Không có thiết bị nào để kê khai"
	emptyBody  = "Tài khoản này hiện không có thiết bị nào phù hợp với phạm vi của tài liệu (hoặc chỉ có thiết bị đã bán và tài liệu được yêu cầu loại trừ chúng). Hãy thêm thiết bị trong Warrly rồi tạo lại tài liệu."

	sectionSchedule   = "Danh mục thiết bị"
	sectionDevice     = "Chi tiết thiết bị"
	sectionManifest   = "Bảng kê tệp đính kèm"
	sectionWarranty   = "Gói bảo hành"
	sectionClaims     = "Yêu cầu bảo hành"
	sectionImages     = "Ảnh chứng từ"
	sectionFacts      = "Thông tin thiết bị"
	scheduleIntro     = "Giá mua và tổng được quy đổi sang VND theo tỷ giá đã khoá khi nhập thiết bị. Thiết bị không có tỷ giá không được cộng vào tổng."
	scheduleTotalName = "Tổng cộng"
	manifestIntro     = "Mọi tệp đính kèm của các thiết bị trong tài liệu đều có mặt dưới đây, kể cả tệp không nhúng được. Tệp không nhúng được ghi rõ lý do để ảnh thiếu không bị hiểu là không có."
	manifestEmpty     = "Không có tệp đính kèm nào cho các thiết bị trong tài liệu."
	manifestFootnote  = "Ảnh được nhúng tối đa 2 ảnh/thiết bị, tổng tối đa 100 ảnh/tài liệu, cạnh dài tối đa 1200 px và được nén JPEG. HEIC và PDF không nhúng được vào PDF; chúng chỉ được liệt kê ở bảng trên."
	noWarranty        = "Không có gói bảo hành nào được ghi."
	noClaims          = "Không có yêu cầu bảo hành nào được ghi."
	noImages          = "Không có ảnh nào được nhúng cho thiết bị này."
	noAttachments     = "Thiết bị này không có tệp đính kèm nào."
	noImagesHint      = "Các tệp đính kèm không nhúng được (HEIC, PDF, hoặc vượt giới hạn ảnh) vẫn được liệt kê ở bảng kê tệp đính kèm ở cuối tài liệu."
	notRecorded       = "Không ghi"
	notKnown          = "Không xác định"
	noWarrantyEnd     = "Không có"
	noVND             = "Không xác định"
	footerTitle       = "Warrly · Bảng kê tài sản được bảo vệ"
	continueLabel     = "tiếp theo"
)

var (
	scheduleHeaders = []string{"STT", "Thiết bị", "Hãng", "Model", "Số serial", "Ngày mua", "Giá mua", "Giá mua (VND)", "Bảo hành đến", "Tình trạng"}
	manifestHeaders = []string{"STT", "Thiết bị", "Tên tệp", "Loại", "Trạng thái"}
)

func warrantyTypeLabel(v string) string {
	switch v {
	case "STANDARD":
		return "Bảo hành tiêu chuẩn"
	case "EXTENDED":
		return "Bảo hành mở rộng"
	case "THIRD_PARTY":
		return "Bảo hành bên thứ ba"
	case "":
		return "Không rõ loại"
	default:
		return v
	}
}

func deviceStatusLabel(v string) string {
	switch v {
	case "ACTIVE":
		return "Đang sở hữu"
	case "EXPIRED":
		return "Hết bảo hành"
	case "SOLD":
		return "Đã bán"
	case "BROKEN":
		return "Đang hỏng"
	case "LOST":
		return "Đã mất"
	case "":
		return "Không rõ"
	default:
		return v
	}
}

func claimStatusLabel(v string) string {
	switch v {
	case "OPEN":
		return "Đang mở"
	case "IN_REPAIR":
		return "Đang sửa"
	case "RESOLVED":
		return "Đã xử lý"
	case "REJECTED":
		return "Bị từ chối"
	case "CANCELLED":
		return "Đã huỷ"
	case "":
		return "Không rõ"
	default:
		return v
	}
}

func yesNoUnknown(v *bool) string {
	if v == nil {
		return "Không ghi"
	}
	if *v {
		return "Có"
	}
	return "Không"
}

func coveredLabel(v *bool) string {
	if v == nil {
		return "Chưa biết"
	}
	if *v {
		return "Bảo hành trả"
	}
	return "Người dùng tự trả"
}

func manifestStatusText(status ManifestStatus, fileType string) string {
	switch status {
	case ManifestEmbedded:
		return "Đã nhúng ảnh trong tài liệu"
	case ManifestNotEmbeddable:
		switch fileType {
		case "image/heic":
			return "Chỉ liệt kê — HEIC không nhúng được vào PDF"
		case "application/pdf":
			return "Chỉ liệt kê — tệp PDF không nhúng được dưới dạng ảnh"
		default:
			return "Chỉ liệt kê — định dạng này không nhúng được"
		}
	case ManifestImageLimit:
		return fmt.Sprintf("Chỉ liệt kê — vượt giới hạn %d ảnh/thiết bị", MaxImagesPerDevice)
	case ManifestDocumentLimit:
		return fmt.Sprintf("Chỉ liệt kê — tài liệu đã đạt giới hạn %d ảnh", MaxImagesPerDocument)
	case ManifestUnreadable:
		return "Không đọc được — tệp thiếu hoặc không giải mã được"
	default:
		return "Chỉ liệt kê"
	}
}
