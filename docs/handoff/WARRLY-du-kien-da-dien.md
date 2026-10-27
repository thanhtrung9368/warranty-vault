# Dữ kiện pháp lý — bản đã điền (2026-10-27)

Nguồn: `~/Downloads/WARRLY-blockers-va-du-kien-can-dien-DA-DIEN.docx` (chủ sản phẩm điền).
Đây là bản ghi để không phải mở lại file Word. Mọi giá trị dưới đây là dữ kiện **chủ sản phẩm
cung cấp**, không phải agent suy ra.

## A · Pháp nhân và liên hệ

- **A1** — Cá nhân: **Trung Lê Thành**, Việt Nam, bán toàn cầu, **không có công ty đứng sau**.
  - Địa chỉ đăng ký: **CHƯA CÓ** — còn `[CẦN XÁC NHẬN: số nhà, đường, phường/xã, quận/huyện, tỉnh/thành]`.
  - Đại diện EU/UK: **KHÔNG CÓ**. Chủ sản phẩm ghi rõ: nếu EU/UK là thị trường trọng điểm thì
    phải bổ sung đại diện theo **Điều 27 GDPR / UK GDPR**.
- **A2** — **privacy@warrly.com** (một hộp thư cho cả quyền riêng tư và hỗ trợ). Không có DPO
  riêng; người chịu trách nhiệm là chủ sản phẩm.

## A3–A6 · Nhà cung cấp quảng cáo

- **A3** — **Google AdMob**: Google LLC (Mỹ) + Google Ireland Ltd (EU). Với dữ liệu quảng cáo,
  Google là **bên kiểm soát độc lập**; Warrly là bên kiểm soát dữ liệu tài khoản và bên xử lý
  với dữ liệu vận hành.
- **A4** — Nhận: **IDFA** (iOS), **GAID** (Android), thông tin thiết bị tối thiểu (loại máy,
  phiên bản OS, khu vực chung), sự kiện hiển thị/nhấp. **Mặc định KHÔNG cá nhân hoá**; chỉ cá
  nhân hoá sau khi đồng ý — **ATT trên iOS** + **hộp đồng ý Google UMP** cho EU/UK/Thuỵ Sĩ.
  **Có** chia sẻ dữ liệu với Google để phục vụ và đo lường quảng cáo.
- **A5** — Định danh do Google đặt: IDFA, GAID, cookie/ID quảng cáo của Google (ví dụ NID, IDE
  tuỳ sản phẩm). Mục đích: phân phối và đo lường quảng cáo. Thời hạn: **theo chính sách của
  Google** — không đặt con số riêng cho Warrly.
- **A6** — Theo chính sách lưu trữ của Google Ads/AdMob. **Warrly không lưu dữ liệu quảng cáo**
  trên hệ thống của mình; chỉ giữ trạng thái đồng ý (consent) trên thiết bị.

## B · Quyết định mô hình

- **B1** — Quảng cáo ở **cả app iOS/Android** (và web nếu sau này bật ads trên web).
- **B2** — **Theo ngữ cảnh (non-personalised) làm mặc định**; chỉ cá nhân hoá khi có đồng ý.
- **B3** — **Google AdMob**, dùng **Google UMP** làm CMP được chứng nhận **TCF v2.2**.
- **B4** — **Chưa có giá**. Copy tiếp tục nói "chưa mở bán", không bịa giá.

## E · Deploy

- **Deploy ngay**, để câu "không quảng cáo" biến mất hôm nay.

## Hệ quả kỹ thuật — chưa làm

Vì B1 = ads **trong app** và B2 = **có** đường cá nhân hoá:

| | cần | ghi chú |
|---|---|---|
| C1 | `NSPrivacyTracking` → **true** + `NSPrivacyTrackingDomains` | cả 4 manifest, khi bật AdMob |
| C2 | `NSUserTrackingUsageDescription` + **ATT prompt** | **bắt buộc**: B2 cho phép cá nhân hoá, mà cá nhân hoá trên iOS nghĩa là đọc IDFA, và đọc IDFA cần ATT. Consent GDPR **không** thay thế ATT — hai hệ thống khác nhau |
| C3 | Android `com.google.android.gms.permission.AD_ID` + form Data Safety | Play Console, khai báo thủ công |
| — | Google UMP SDK (iOS + Android) | CMP TCF v2.2 cho EU/UK; cần ad unit ID thật để test |

Hmm — **lưu ý**: banner consent tự viết trên **web** vẫn dùng được cho web, nhưng nếu web bật ads
sau này thì phải chuyển sang **Google UMP cho web**, không dùng banner tự viết.
