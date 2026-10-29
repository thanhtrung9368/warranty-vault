# iOS — kết quả research (2026-10-29)

Sáu agent, read-only. **Hai chỗ brief của tao sai**, ghi lại để không ai lặp lại.

## Brief sai ở đâu

**Sai 1 — "design system gần như không có".** Sai. `App/DesignSystem/Theme.swift` đã có
`WVColor.brand` (coral `#FF6B45`), `WVRadius` (:88), `WVSpacing` (:98), và
`Components.swift` là **thư viện component 887 dòng** (`WVGroup`, `WVRow`, `WVEmpty`,
`WVCard`, `WVWidget`, `WarrantyPill`, `WVSegmented`).

**Thứ thật sự thiếu là typography:** **663 chỗ hardcode `.system(size:)`** trên 49 file,
**0** semantic text style (`.font(.body)`), **0** `dynamicTypeSize`, **0**
`minimumScaleFactor`. Đó là lý do UI "được thiết kế một lần ở 390×844" và không reflow.

**Sai 2 — "loading viết tay ở 29 file".** Sai. `"Đang tải"` chỉ ở **10 chỗ / 9 file**, và
**Reminders, Sessions, PushDevices, Stats đã có `.redacted` skeleton đúng chuẩn**.

## Defect loading thật sự

Không phải "thiếu skeleton" — mà là **hai màn hình được ghé nhiều nhất bỏ qua chính cái
machinery đó và hiện trạng thái SAI**:

| | |
|---|---|
| `DevicesScreen` | **không đọc `store.state`** dù `DevicesStore` có enum 4 trạng thái. Tài khoản 40 thiết bị lúc cold launch được báo **"Chưa có thiết bị nào"** + 3 CTA |
| `DashboardView` | `"Tất cả đều ngon / Không có gói nào sắp hết trong 30 ngày"` hiện cả khi `.idle` và `.loading` |
| `DashboardView:174`, `StatsView:70` | **`ProgressView` làm đích điều hướng** — push một màn trắng. Đây đúng nghĩa "người dùng không hiểu chuyện gì đang xảy ra" |
| `DeviceDetailView:416, :355` | `File đính kèm (0/5)`, `Bảo hành (0/5)` đếm số 0 trước khi detail load xong |

Đây là lỗi **trung thực**, không phải lỗi thẩm mỹ: một sản phẩm hứa "bạn được bảo vệ" mà
báo "không có gì cả" khi mạng đang chạy là nói sai.

## Năm chỗ API đã có mà không client nào dùng

1. **`inboxAddress`** — `GET /auth/me` trả về địa chỉ email riêng của từng user (migration
   0020, token 122-bit). `POST /api/v1/inbox/email` nhận thư và tự đưa tệp vào hộp thư.
   `openapi.yaml:3504` ghi rõ "Client hiển thị nó ở Cài đặt". **`grep inboxAddress` trên cả
   ba client = 0.** Đây là luồng lao động nặng nhất trong app (chụp → upload → gán thiết bị)
   có một đường **0 chạm** chưa từng xuất hiện trên màn hình.
2. **`Claim.cost`** — lưu cho từng claim, **không tổng hợp ở đâu**. Stats cộng giá mua, phí
   bảo hành, subscription, forecast — trừ tiền sửa chữa.
3. **`openedAt`/`closedAt` trên claim** — đủ để tính "bảo hành được cộng bù bao nhiêu ngày
   sửa chữa". Điều 30.2.c Luật 19/2023: *thời gian sửa chữa không tính vào hạn bảo hành* —
   app đang **báo hạn sớm hơn quyền của người dùng**.
4. **`returnWindowDays`/`receivedAt`** (migration 0010) — API **đã** có action
   `RETURN_WINDOW_UNKNOWN` với câu *"chưa ghi hạn đổi trả, nên app không thể nhắc bạn"*,
   iOS hiện action đó ✅ — nhưng `DeviceFormView` **không có ô nào để ghi**
   (`DeviceReturnWindow.swift:21`: "deliberately **no** input"). Queue nhắc, bấm vào, không có gì để điền.
5. **`GET /api/v1/claims`** (không filter) — chết trên cả ba client; iOS chỉ gọi có filter.

## Lỗi trung thực khác

- **`RegisterView:76`** nói *"Không thẻ tín dụng, không quảng cáo"* — trong khi tab Devices
  gắn banner AdMob. Web ghi ngược lại. Đây là guideline **2.3.1** và là câu một khiếu nại
  hoàn tiền sẽ trích dẫn.
- **`WVNotificationDelegate.didReceive` là no-op** (`AppDelegate.swift:49`) → mọi thông báo
  mở app ở tab cuối, không mở đúng thiết bị. Payload **đã có** `url: /devices/{id}`
  (`cron/run.go:408`) và `apns.go` đã gửi nó — iOS chỉ không đọc.
- **Quyền thông báo chỉ xin được trong Settings** (`SettingsView:495`) → người không mở
  Settings đang dùng một app nhắc việc **không nhắc**.
- **`WarrantyFormView:69-70`**: `startDate` mặc định **hôm nay**, `months` = **12** — nên
  một chiếc điện thoại mua Tết năm ngoái có hạn bảo hành **muộn hơn một năm**.
- **Paid tier là một `UserDefaults` bool** (`wv.adsRemoved`) → không sync được, mất khi cài
  lại. Nghĩa là "đồng bộ nhiều máy" — thứ mọi người chờ đợi nhất ở gói trả phí — là thứ
  duy nhất **không** sync.

## Cái không nên làm

Warranty health score · streak/gamification · "tổng tài sản" trên home · countdown đến
giờ/phút · shimmer động (4 màn đã dùng `.redacted` tĩnh — giữ tĩnh) · onboarding carousel ·
ring chart · fake urgency trên paywall · push doạ ("hết hạn đêm nay" khi còn một tuần) ·
meter/watermark bản export của chính người dùng (GDPR Art. 20) · ads giả dạng hàng thiết bị.
