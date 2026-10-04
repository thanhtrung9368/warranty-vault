# Tính năng đề xuất (vòng 2)

> Tài liệu này là **đầu vào cho một vòng roadmap tiếp theo**, không phải roadmap. Nó tổng hợp ý tưởng từ
> 7 lăng kính khác nhau (đối thủ quốc tế, thị trường Việt Nam, retention, dữ liệu & insight, tự động hoá
> & tích hợp, chia sẻ & vòng đời thiết bị, AI nâng cao), đã lọc trùng, đã đối chiếu với danh sách
> "ĐÃ CÓ" và với `docs/FEATURE_ROADMAP.md` §5 "Đã cân nhắc và loại".
>
> Trạng thái repo **tại thời điểm viết** (đã lỗi thời, giữ làm mốc lịch sử): migration mới nhất là `0009`,
> 17 bảng, 54 endpoint. Hai agent khác đang sửa `api/internal/` và `docs/` cùng lúc, nên mọi con số về
> dòng code dưới đây lấy từ bản đọc tại thời điểm viết. **Số hiện tại** (xem banner ngay dưới):
> migration `0013`, **67 endpoint / 48 path** — `bash api/scripts/check_openapi_drift.sh`.

---

## 0. ⚠️ Trạng thái triển khai — đọc trước §2 (cập nhật 2026-10-03)

> **Danh sách 20 ý dưới đây KHÔNG còn là "20 việc đang chờ".** Phần lớn đã được build trong đợt
> 2026-10-02 → 10-03. §1–§5 giữ nguyên văn bản nghiên cứu ban đầu để làm lịch sử và **không đánh số lại**
> (số thứ tự được trích trong commit message và trong `api/migrations/0010`–`0013`). Cột "Trạng thái" ở
> bảng này là bản kiểm chứng mới nhất; cột "Khu vực" trong §2.0 là **phạm vi đề xuất ban đầu**, không
> phải phạm vi đã làm.
>
> **Ký hiệu:** ✅ xong · 🟡 xong một phần · ⬜ chưa bắt đầu.

| # | Tên | Trạng thái | Bằng chứng / còn thiếu gì |
|---|---|---|---|
| 1 | Hạn đổi trả ("1 đổi 1") | ✅ **xong cả 4 client** | `api/migrations/0010_return_window.sql`; web `lib/device-return-window.ts`, iOS `DeviceReturnWindowTests.swift`, Android `ui/screens/devices/DeviceReturnWindow.kt` (dùng ở `DeviceDetailScreen` + `AddDeviceSheet`) |
| 2 | Phiếu bàn giao + link chia sẻ | 🟡 **backend + web + Android xong; iOS đang được viết** | `0013_device_share.sql`, `services/shares.go`; web `components/device-shares.tsx`, Android `ShareLinks.kt` + `ShareCertificatesSection.kt`. iOS: `Sources/WarrantyVaultKit/ShareLinks.swift` (model + luật token dùng một lần) đã xong, và `ios/App/Features/Devices/ShareCertificatesSection.swift` **đang được viết** — ở thời điểm kiểm nó **chưa được gắn vào màn hình nào** (không file nào trong `ios/App/` tham chiếu tới nó). Mục này đang di chuyển; kiểm lại trước khi tin. |
| 3 | Hàng đợi "Việc cần xử lý" | ✅ **xong cả 4 client** | `0011_decision_snooze.sql`, `services/actions.go`; web `app/(app)/actions/`, iOS `ActionQueueScreen.swift`, Android `ActionQueueScreen.kt` |
| 4 | Soát subscription | ✅ **xong cả 4 client** | `services/subscription_audit.go` + `handlers/subscriptions.go`; web `lib/subscription-audit.ts`, iOS `SubscriptionAuditScreen.swift`, Android `SubscriptionAuditScreen.kt` |
| 5 | Xem & thu hồi phiên đăng nhập | ✅ **xong cả 4 client** | web `lib/__tests__/sessions.test.ts`, iOS `SessionsView.swift`, Android `SessionsScreen.kt` |
| 6 | Hậu kiểm nháp AI (IMEI Luhn + trùng serial) | ✅ | `services/serial_validation.go` + `handlers/devices_serial_test.go`; cảnh báo hiện ở cả 3 client (`DeviceWarnings`) |
| 7 | Chi phí sở hữu mỗi ngày | ✅ (đúng phạm vi "web") | `website/src/lib/stats-rollup.ts` (`perDay`), dùng ở `/stats` + `/devices` |
| 8 | Dự báo chi tiêu 12 tháng | ✅ **xong cả 4 client** | `services/forecast.go`; web `components/forecast-panel.tsx`, iOS `StatsView.swift`, Android `ui/screens/stats/ForecastFormat.kt` (dùng trong `StatsScreen`) |
| 9 | Sổ sự kiện + "Có gì mới" | ⬜ **chưa bắt đầu** | Không có bảng event log, không endpoint |
| 10 | Share sheet → wishlist | ⬜ **chưa bắt đầu** | `website/public/manifest.webmanifest` **không** có `share_target` |
| 11 | Hộp thư vào: forward hoá đơn → AI | ⬜ **chưa bắt đầu** | Không có inbound/webhook trong `api/internal/` |
| 12 | Tự động sao lưu định kỳ lên cloud | ⬜ **chưa bắt đầu** | Không có code iCloud/Drive. ⚠️ iOS `MoreScreen.swift:259` vẫn hiện row "Đồng bộ iCloud — Bật" **trang trí** (không nối vào đâu); đó là copy nói dối, không phải tính năng |
| 13 | Dán bảng để nhập nhiều thiết bị | ✅ (đúng phạm vi "web") | `website/src/lib/device-paste.ts` + `app/(app)/devices/import/page.tsx` |
| 14 | Thiết bị đã bán không chiếm suất 50 | ✅ | `services/devices.go`: `MaxDevicesPerUser = 50` đếm `status <> 'SOLD'`, cộng trần lưu trữ `MaxDevicesTotalPerUser = 500` |
| 15 | Danh bạ bảo hành theo hãng | ✅ **xong cả 4 client** | `0012_brand_service_info.sql`, `services/directory.go`; web `components/service-directory-card.tsx`, iOS `ServiceDirectoryInfo.swift`, Android `ServiceDirectorySection.kt` |
| 16 | Tìm chữ nằm trong ảnh hoá đơn | ⬜ **chưa bắt đầu** | Không có cột text OCR nào được lưu hay index |
| 17 | Tổng kết tháng | ⬜ **chưa bắt đầu** | Không có gì tên `monthlySummary` ở api/web/ios/android |
| 18 | Sổ linh kiện thay thế | ⬜ **chưa bắt đầu** | Không có bảng/model nào biểu diễn được |
| 19 | Đưa ngày hết hạn vào lịch (ICS) | ⬜ **chưa bắt đầu** | Không có `VCALENDAR`/`text/calendar` ngoài chính tài liệu này |
| 20 | Lối tắt ứng dụng + widget | ⬜ **chưa bắt đầu** (đúng phạm vi "ios + android") | Không có widget/App Intent. Ghi chú: PWA **web** đã có 2 shortcut trong `manifest.webmanifest`, nhưng đó không phải phạm vi đề xuất của mục này |

**Tóm lại:** **10/20 xong** (#1, #3, #4, #5, #6, #7, #8, #13, #14, #15), **1 xong một phần** (#2 — iOS thiếu UI),
**9 chưa bắt đầu** (#9, #10, #11, #12, #16, #17, #18, #19, #20).
Ngoài 20 ý này, đợt vừa rồi còn làm thêm **OCR hoá đơn PDF** (roadmap #15, không nằm trong danh sách 20)
— `api/internal/ai/extract.go::IsSupportedReceiptType` nay nhận `application/pdf` và gửi nó dưới dạng
`document` block.

---

## 1. Bối cảnh & cách chọn

### 1.1. Ba sự thật chi phối toàn bộ danh sách này

**(1) App không có bộ nhớ sự kiện.** `api/migrations/0001_initial.sql` có đúng 17 bảng, không bảng nào
ghi *chuyện gì đã xảy ra*. `cron.Run` gửi push nhưng chỉ để lại **dấu chống trùng**
(`Reminder.lastNotifiedAt`, `WishlistItem.lastNotifiedAt`, `Subscription.lastNotifiedRenewalAt`), còn
`Stats` được trả về rồi bị log và vứt. Hệ quả: một push bị vuốt mất là sự kiện biến mất vĩnh viễn —
kể cả tin "iCloud đã tự trừ 499.000đ".

**(2) App chỉ nhìn về phía trước, và chỉ nhìn một loại ngày.** `ListUpcomingReminders` lọc
`w."endDate" >= endDateFrom` (`api/internal/store/queries/warranties.sql:171`), nên **một gói bảo hành
hết hạn hôm qua không xuất hiện ở bất kỳ màn hình nào**. Và mọi trigger cron đều là cửa sổ ngày trên
một hàng cụ thể — user không có gì rơi vào cửa sổ thì nhận **0 liên lạc**.

**(3) App không có bề mặt nào ngoài chính nó, và chưa từng sinh ra một artifact cho người thứ ba.**
Không widget, không lịch, không trang in (`window.print`/`@media print` không tồn tại trong
`website/src`), không file nào rời khỏi app dưới dạng để đưa cho người khác xem.

### 1.2. Tiêu chí chọn

| Tiêu chí | Cách áp dụng |
|---|---|
| **Không trùng "ĐÃ CÓ"** | Đã grep chéo từng ý. Không có ý nào trong tài liệu này là bản sao của một tính năng đã có. Các trường hợp *gần trùng* (nâng cấp của một con số đã có) được ghi rõ là "nâng cấp", không giả vờ là mới. |
| **Không trùng roadmap §5** | Các mục roadmap đã loại (đồng bộ ngân hàng, scraping giá, chia sẻ tài khoản gia đình, phân trang, i18n…) **không được mở lại**. Chỗ nào ý mới *na ná* một mục đã loại thì tài liệu nói rõ khác nhau ở đâu. |
| **Hợp app cá nhân 1 người dùng** | Không đội nhóm, không phê duyệt, không phân quyền. Các ý đòi đổi mô hình dữ liệu sang nhiều chủ sở hữu bị loại (§4b). |
| **Có nỗi đau cụ thể hoặc bằng chứng** | Mỗi ý gắn với một `file:dòng` trong repo, một nguồn ngoài đã đọc, hoặc được đánh dấu `[suy luận]`. |
| **Giá trị thật / công sức** | Xếp hạng theo tỉ lệ đó, **không** theo độ "ngầu" của công nghệ. Nhiều ý AI xếp dưới các ý SQL thuần vì lý do này. |

### 1.3. Quy ước nhãn

- `[repo]` — kiểm chứng được từ code trong repo này (kèm `file:dòng`).
- `[ngoài]` — có nguồn bên ngoài (kèm link). Nguồn nào tôi **đọc trực tiếp** được ghi rõ; nguồn nào chỉ
  đến từ báo cáo của các lăng kính nghiên cứu thì ghi "chưa đọc lại trực tiếp".
- `[suy luận]` — tôi tự suy ra, không có bằng chứng trực tiếp.

### 1.4. Effort

`S` ≈ 1 buổi · `M` ≈ 1–3 ngày · `L` ≈ 1 tuần trở lên. Quy ước repo: sửa **một** client thường là `S`;
thêm field API là tối thiểu `M` vì phải sửa `openapi.yaml` + Go + web + iOS + Android.

---

## 2. Danh sách đề xuất

### 2.0. Bảng xếp hạng

| # | Tên | Khu vực | Impact | Effort | Nhãn | Vì sao đứng ở đây |
|---|---|---|---|---|---|---|
| 1 | Hạn đổi trả ("1 đổi 1") theo từng thiết bị | api + web | high | M | `[repo]` `[ngoài]` | Mốc ngắn nhất, tốn tiền nhất trong toàn app, và hiện **vô hình** |
| 2 | Phiếu bàn giao bảo hành + link chia sẻ có token | api + web | high | M | `[repo]` `[ngoài]` `[suy luận]` | Artifact hướng ra người thứ ba đầu tiên; dùng đúng lúc đứng ở quầy BH hoặc bán máy |
| 3 | Hàng đợi "Việc cần xử lý" (có nút hoãn) | api + web | high | M | `[repo]` | App biết đủ để hỏi nhưng không hỏi; mọi nhánh hành động ghi vào entity **đã có** |
| 4 | Soát subscription: gói bị bỏ quên / tăng giá / trùng nhau | api + web | high | M | `[repo]` `[suy luận]` | Tiền ra đều đặn mà không ai để ý; dữ liệu đã nằm sẵn trong bảng |
| 5 | Xem & thu hồi phiên đăng nhập theo từng thiết bị | api + web (+2 native) | high | M | `[repo]` | Bảng `Session` đã có đủ cột; đưa máy cho người nhà hiện là hành động một chiều |
| 6 | Hậu kiểm nháp AI: IMEI Luhn + trùng serial | api | medium | S | `[repo]` | Tỉ lệ giá trị/công sức cao nhất danh sách: 0 đồng token, bảo vệ ô dữ liệu quan trọng nhất |
| 7 | Chi phí sở hữu mỗi ngày (đ/ngày) | web | high | M | `[repo]` | Ba số hạng đã có, chưa bao giờ chia cho thời gian |
| 8 | Dự báo chi tiêu 12 tháng tới | api + web | high | M | `[repo]` | Toàn bộ app chỉ nhìn quá khứ; đây là câu hỏi người dùng tự hỏi nhiều nhất |
| 9 | Sổ sự kiện + "Có gì mới kể từ lần trước" | api + web | high | M | `[repo]` | Nền tảng cho pull-loop; biến push từ chịu tải thành tuỳ chọn |
| 10 | Share sheet → wishlist | web + android | high | M | `[repo]` `[ngoài]` | Khoảnh khắc nhập liệu tốn công nhất; nửa PWA làm được trong vài giờ |
| 11 | Hộp thư vào: forward hoá đơn → AI → nháp | api + ai + deploy | high | L | `[repo]` `[ngoài]` | Mức giảm công nhập liệu lớn nhất; hoá đơn điện tử vốn đã nằm trong hộp thư |
| 12 | Tự động sao lưu định kỳ lên cloud của chính người dùng | ios + android | medium | L | `[repo]` `[ngoài]` | Blob là ciphertext, ảnh hoá đơn không tạo lại được; mọi đường backup hiện là thao tác tay |
| 13 | Dán bảng để nhập nhiều thiết bị một lúc | web | medium | M | `[repo]` | Giải bài toán "10 món đồ cũ chưa từng nhập"; không đổi Go, không thêm dependency |
| 14 | Thiết bị đã bán không còn chiếm suất 50 | api | medium | S | `[repo]` | Mâu thuẫn tất yếu với người dùng sống 5–10 năm: muốn thêm máy phải xoá hồ sơ máy đã bán |
| 15 | Danh bạ bảo hành: hotline hãng + link TTBH uỷ quyền | api + web | medium | S | `[repo]` `[ngoài]` | Trả lời đúng câu hỏi của khoảnh khắc dùng thật: "giờ tôi mang máy đi đâu" |
| 16 | Tìm được theo chữ nằm trong ảnh hoá đơn | api + web | medium | M | `[repo]` `[ngoài]` | Nội dung file đính kèm hiện không được index ở đâu; OCR thứ đã nằm trong kho |
| 17 | Tổng kết tháng: một push + trang lưu trữ theo kỳ | api + web | medium | M | `[repo]` `[suy luận]` | 12 lần chạm/năm có nội dung thật; app chưa có so sánh kỳ-trước ở đâu cả |
| 18 | Sổ linh kiện thay thế có hạn bảo hành riêng | api + web | medium | M | `[repo]` `[ngoài]` | Có căn cứ luật (Điều 30.2.c); repo không có chỗ nào biểu diễn được |
| 19 | Đưa ngày hết hạn vào lịch (ICS + "Thêm vào Lịch") | api + web (+2 native) | medium | M | `[repo]` `[ngoài]` | Kênh duy nhất hiện nay là push, và push bị vuốt mất là mất vĩnh viễn |
| 20 | Lối tắt ứng dụng + widget "Sắp hết hạn" | ios + android | medium | S→L | `[repo]` `[ngoài]` | Bề mặt duy nhất hiện được cái ngày mà không cần mở app; phần rẻ làm được ngay |

---

### 2.1. Chi tiết từng ý

#### 1. Hạn đổi trả ("1 đổi 1") theo từng thiết bị + nhắc T-3 / T-1

**Khu vực:** api + web (mở rộng ra ios/android sau) · **Impact:** high · **Effort:** M
**Nhãn:** `[repo]` `[ngoài]` · **Loại:** tính năng mới

**Vì sao đáng làm**

Cron chỉ có đúng hai mốc bảo hành — `for _, days := range []int{7, 30}`
(`api/internal/cron/run.go:214`) — tính ngược từ `Warranty.endDate`. Với một gói bảo hành 12 tháng,
**thông báo duy nhất user nhận được rơi vào tháng thứ 11**, tức muộn khoảng 10 tháng so với hạn đổi trả.
Người dùng mất tiền vì một deadline mà app có đủ dữ liệu để tính nhưng không có chỗ để lưu.

Và hệ thống nhắc **không thể** biểu diễn mốc này về mặt schema: `Reminder."warrantyId"` là `NOT NULL`
(`api/migrations/0001_initial.sql:174-183`), nên mọi reminder đều buộc phải bám vào một gói bảo hành —
còn hạn đổi trả tính từ ngày mua và không thuộc gói nào.

**Bằng chứng ngoài — đã đọc trực tiếp toàn văn trang chính sách**

`https://fptshop.com.vn/ho-tro/chinh-sach-doi-san-pham` (hiệu lực 01/7/2024, tôi đã fetch và đọc):

- Sản phẩm ICT (điện thoại, máy tính bảng, laptop, PC đồng bộ/AIO, đồng hồ thông minh, màn hình), lỗi
  nhà sản xuất, **`0 – 30 ngày`** (tính từ ngày xuất hoá đơn) → **"1 ĐỔI 1 sản phẩm chính"**, phí khấu
  hao **0%**.
- **`31 – 365 ngày`** → chỉ còn "GỬI MÁY ĐI BẢO HÀNH THEO QUY ĐỊNH CỦA HÃNG" — hết đường đổi.
- Ghi chú nguyên văn: *"Trường hợp sản phẩm có hạn bảo hành hãng trên 365 ngày, từ ngày thứ 366 FPT
  Shop hỗ trợ gửi máy đi bảo hành và **không áp dụng đổi trả** theo nhu cầu hoặc bảo hành đổi mới."*
- Trả hàng theo nhu cầu: phí khấu hao **30% trong tháng đầu tiên, mỗi tháng tiếp theo +5%/tháng**, cộng
  phí vỏ hộp 2%, phí phụ kiện 5%/món. → **về muộn 2 tháng là mất thêm ~10% giá trị máy.**
- Nhóm gia dụng có điện, tivi, máy in, máy lọc nước, bếp: cũng `0 – 30 ngày` "Hư gì đổi nấy — 1 ĐỔI 1".
- Ngoại lệ đáng chú ý: tủ lạnh / tủ đông / máy giặt **chỉ hãng Casper** mới 1 đổi 1 trong 30 ngày; phụ
  kiện thì `0 – 365 ngày`; miếng dán màn hình thì không bảo hành, không đổi trả.
- Với đơn trả góp: *"Khách hàng phải thực hiện Hủy hợp đồng hoặc Tất toán hợp đồng trả góp **trước khi**
  đổi trả sản phẩm"* → hai deadline này khoá vào nhau.

**Hệ quả thiết kế: số ngày phải do NGƯỜI DÙNG nhập hoặc chọn preset, tuyệt đối không hardcode** — cửa sổ
khác nhau theo nhóm hàng (30 ngày cho ICT, 365 ngày cho phụ kiện, 0 ngày cho miếng dán màn hình, và với
tủ lạnh thì phụ thuộc hãng).

**Bước đầu tiên bắt tay được ngay**

1. Migration `0010`: thêm hai cột nullable vào `"Device"` — `returnWindowDays integer`,
   `receivedAt timestamp` (ngày nhận hàng, khác `purchaseDate` với đơn online). Validate ở
   `ValidateDeviceInput` theo đúng tiền lệ `soldAt`/`soldPrice` của migration `0006` (validate ở app,
   không ràng buộc DB, để dữ liệu cũ không bị từ chối).
2. Hàm thuần `returnDeadline(device)` = `(receivedAt ?? purchaseDate) + returnWindowDays` + test.
3. UI: một dòng đếm ngược trên trang chi tiết thiết bị, và một nhóm "Còn hạn đổi trả" **tách hẳn** khỏi
   nhóm "Sắp hết bảo hành" trên `/reminders`.
4. **Không** nhét vào bảng `Reminder` (xem cảnh báo ở ý #3).

---

#### 2. Phiếu bàn giao bảo hành + link chia sẻ có token

**Khu vực:** api + web (+ cấu hình header ở `deploy/`) · **Impact:** high · **Effort:** M
**Nhãn:** `[repo]` `[ngoài]` `[suy luận]` · **Loại:** tính năng mới (gộp 4 ý của 3 lăng kính)

**Vì sao đáng làm**

Khoảnh khắc app được dùng thật là lúc **đứng ở quầy bảo hành** hoặc **lúc bán máy** — cả hai lần đều cần
một thứ *gửi đi được*, không phải một danh sách CSV. Hiện tại repo chưa từng sinh ra artifact nào cho
người thứ ba:

- `GET /api/files/{id}` chỉ nhận bearer (`api/internal/handlers/attachments.go:52-56`) và web chỉ xem được
  qua proxy cần cookie phiên (`website/src/app/api/files/[id]/route.ts`) → cách duy nhất đưa hoá đơn cho
  người mua hiện nay là **chụp màn hình**.
- Không có `window.print` hay `@media print` nào trong `website/src` → chưa từng có bề mặt in.
- Cron chỉ nhắc thiết bị `status='ACTIVE'` (`api/internal/store/queries/warranties.sql:186,208`), nên đúng
  khoảnh khắc bạn đánh dấu SOLD, phần bảo hành còn lại — thứ người mua trả tiền để có — **không còn ai
  theo dõi**.

`[ngoài]` (nguồn đến từ báo cáo lăng kính, tôi chưa đọc lại trực tiếp): MyWrntee quảng cáo *"Share
beautifully formatted warranty cards via any app"*; Keepfolio: *"When something needs repair or you hand
an item over, open that record and take the originals with you"*; Itemtopia cho tạo "micro website" cho
từng món. Ba đối thủ coi đây là tính năng bán được, không phải phụ kiện.

**Nội dung**

- Một trang in được cho **một** thiết bị (print CSS → Lưu PDF): tên, hãng/model, serial/IMEI, ngày mua,
  nơi mua, từng gói bảo hành + hạn + hotline/địa chỉ trung tâm, ảnh hoá đơn nhúng. **Không** có giá mua,
  giá bán, lãi/lỗ.
- Link chỉ-đọc `/bh/<token>`: lưu **hash** token theo đúng khuôn `Session.tokenHash`
  (`api/internal/store/queries/sessions.sql:2`), hết hạn 30 ngày, thu hồi được, che giữa IMEI, mặc định
  ẩn giá. Kèm QR để mở ngay tại chỗ khi hai bên gặp nhau.
- Chỉ web cần UI tạo; iOS/Android chỉ cần mở link bằng trình duyệt hệ thống → **không phải sửa 3 client**,
  đây là lý do effort chỉ ở mức M.

**⚠️ Ba cảnh báo kỹ thuật phải xử lý (đây là chỗ dễ sinh IDOR nhất trong repo)**

1. Đây sẽ là chỗ **duy nhất** trong repo đọc dữ liệu người dùng mà không có bearer. Mọi handler đọc hiện
   nay đều `VerifyBearer` rồi lọc `userId`, còn `Warranty`/`Attachment`/`Reminder` **không có cột
   `userId`** nên quyền được suy qua JOIN `"Device"`. Handler share phải tự resolve `tokenHash` →
   device rồi tự kiểm — **không được tái dùng** `ListAttachmentsByDevice` / `GetDeviceByID` (chúng lọc
   theo `userId`), phải viết query song song và luôn kiểm `attachment."deviceId" = share."deviceId"`.
2. Ảnh là cạnh sắc nhất: muốn có ảnh trong trang share thì phải thêm **một route file công khai mới** xác
   thực bằng token. Đó mới là phần việc thật, không phải cái trang.
3. Trang này cần `noindex` và `Referrer-Policy: no-referrer` (chính sách chung hiện là
   `strict-origin-when-cross-origin`, `website/next.config.mjs:29`) vì token nằm trong path; rate-limit
   theo IP bằng helper có sẵn `CheckAuth`.

**Bước đầu tiên bắt tay được ngay**

Chốt "hợp đồng nội dung" của phiếu (danh sách trường + trường nào mặc định ẩn) rồi dựng **trang in
web-only** với print CSS, dữ liệu lấy từ `GET /api/v1/devices/{id}` đã có. Token và ảnh để giai đoạn sau —
giai đoạn 1 đã có giá trị dùng được (in ra giấy hoặc lưu PDF gửi qua Zalo).

---

#### 3. Hàng đợi "Việc cần xử lý" (có nút hoãn)

**Khu vực:** api + web · **Impact:** high · **Effort:** M
**Nhãn:** `[repo]` · **Loại:** tính năng mới (gộp cả "điểm sẵn sàng hồ sơ")

**Vì sao đáng làm**

App **biết đủ để hỏi nhưng không hỏi**:

- Gói bảo hành hết hạn hôm qua rơi khỏi mọi màn hình (`warranties.sql:171`).
- `Device.status` **không bao giờ tự chuyển** `EXPIRED` — không có writer nào tự set; `devices.go:24` chỉ
  là danh sách giá trị hợp lệ.
- `Reminder` không có trường thời gian nào để diễn đạt "hoãn 90 ngày" (`0001:174-183` chỉ có
  `isDismissed` + `createdAt`).
- Hệ quả kèm theo: `status = 'EXPIRED'` là giá trị **người dùng tự đặt**, nên bộ lọc `status=EXPIRED`
  trả về một tập khác với "bảo hành đã hết".

**Nội dung**

Một trang (và card trên dashboard) liệt kê việc app **không tự quyết được**, mỗi việc 2–3 nút một chạm
ghi thẳng vào entity **đã có**:

| Phát hiện | Hành động một chạm |
|---|---|
| BH vừa hết hạn | [Mua gói mở rộng] · [Đã bán — nhập giá] (điền `soldAt`+`soldPrice`, migration 0006) · [Để đó 90 ngày] |
| Thiết bị ACTIVE không có gói BH nào | [Thêm gói] · [Máy này không cần BH] |
| Thiếu `serialNumber` / `purchasePrice = 0` / không có ảnh hoá đơn | [Bổ sung] |
| `autoRenew = true` sắp tới hạn mà thiếu `cancelUrl` | [Dán link huỷ] · [Tắt tự gia hạn] |

Trạng thái hoãn lưu ở bảng riêng `DecisionSnooze(userId, itemKey, snoozedUntil)`.

**⚠️ CẢNH BÁO quan trọng nhất của tài liệu này: KHÔNG tái dùng bảng `Reminder`.**
`Reminder.isDismissed` đang là **CỔNG CHẶN PUSH**, không phải cờ UI: các query
`NOT EXISTS (SELECT 1 FROM "Reminder" r WHERE r."warrantyId" = w.id AND r."isDismissed" = true)` ở
`warranties.sql:189-192` và `:211-219` sẽ **chặn nhầm thông báo bảo hành thật** nếu nhét thêm loại việc
vào bảng đó. `docs/SPEC-MAINTENANCE-SCHEDULES.md` §2.3 đã chỉ ra đúng cái bẫy này.

**Bước đầu tiên bắt tay được ngay**

Một hàm Go duy nhất trả về danh sách `{itemKey, kind, deviceId, severity}` cho 4 luật rẻ nhất (BH hết hạn
≤ 90 ngày · ACTIVE không có gói BH · thiếu serial · thiếu ảnh hoá đơn), render **read-only** trước, gắn
nút hành động sau. Bảng `DecisionSnooze` chỉ cần khi đã có nút.

---

#### 4. Soát subscription: gói bị bỏ quên / tăng giá / trùng nhau

**Khu vực:** api + web · **Impact:** high · **Effort:** M (S nếu chỉ làm phần phát hiện)
**Nhãn:** `[repo]` `[suy luận]` · **Loại:** tính năng mới

**Vì sao đáng làm**

`Subscription` đã có `autoRenew`, `renewalDate`, `cancelUrl`
(`api/migrations/0001_initial.sql:185-226`) và `SubscriptionPayment` có `amount` + `paidAt`
(`0001:215-226`); cron thậm chí **auto-charge thật trong một transaction**
(`api/internal/cron/run.go:392-466`). Nhưng **không có luật nào đọc chuỗi thanh toán để suy ra gói bị bỏ
quên** — nhắc nhở hiện tại chỉ là "gói này sắp tới hạn", giống hệt nhau cho mọi gói. Đây là dạng lãng phí
âm thầm: tiền ra đều đặn, không ai để ý.

**Nội dung**

Mục mới trên `/subscriptions` + một section trên dashboard, liệt kê gói thoả **đồng thời**: `status =
ACTIVE` · `autoRenew = true` · `billingCycle ≠ LIFETIME` · `renewalDate` trong 14 ngày tới · khoảng cách
từ lần thanh toán gần nhất (`max(SubscriptionPayment.paidAt)`) tới nay ≥ 2 chu kỳ. Mỗi dòng: tên, giá,
ngày sẽ bị trừ, "~X/tháng", nút **[Huỷ gia hạn]** (`autoRenew = false`) và **[Tôi vẫn dùng]** (đặt lại
mốc). Gộp thành một con số ở đầu trang: *"Tháng này tự động trừ X đ cho N gói ít dùng"*.

Thêm hai luật rẻ lấy từ cùng dữ liệu: **giá đổi giữa hai payment liên tiếp** và **≥ 2 gói cùng
category/brand**.

**Trung thực về giới hạn (đừng hứa quá)**

- KHÔNG hứa "số ngày kể từ lần trả cuối = số ngày không dùng": nhiều gói bị trừ tự động và người dùng
  không log payment nữa. Gọi đúng tên là *"lâu rồi không thấy ghi nhận gì"*, và nút **[Tôi vẫn dùng]**
  chính là để người dùng phủ nhận cảnh báo.
- KHÔNG hứa "tự phát hiện mọi subscription". App không đọc được giao dịch ngân hàng — roadmap §5 đã loại
  vì **không tìm được API tiêu dùng công khai nào**. Tính năng này chỉ soát kỹ **những gì người dùng đã
  ghi**.

**Bước đầu tiên bắt tay được ngay**

`ListPaymentsBySubscription` đã có (`subscriptions.sql:105`) → thêm một hàm Go **thuần** nhận danh
sách sub + payments và trả về danh sách "nghi bỏ quên"; render trên `/subscriptions`. **Không cần
migration, không cần AI.**

---

#### 5. Xem & thu hồi phiên đăng nhập theo từng thiết bị

**Khu vực:** api + web (+ ios + android) · **Impact:** high · **Effort:** M (S cho api + web)
**Nhãn:** `[repo]` · **Loại:** tính năng mới

**Vì sao đáng làm**

Bảng `Session` **đã có đủ** `deviceLabel`, `platform`, `lastSeenAt`, `revokedAt`
(`api/migrations/0001_initial.sql:34-46`) và login đã ghi nhãn. Nhưng chỉ có đúng hai đường thu hồi:
`RevokeSessionByTokenHash` (đúng token đang gửi lên) và `RevokeAllSessionsForUser` (thu hồi **tất cả**,
chỉ chạy khi reset mật khẩu / đổi email). TTL trượt 7 ngày nghĩa là chỉ cần mở app mỗi tuần thì một phiên
**không bao giờ hết hạn**. Nói cách khác: đưa máy cho người nhà xem là hành động **một chiều, âm thầm,
không quan sát được** — và đường thoát duy nhất hiện nay (đổi mật khẩu) lại đá luôn máy của chính bạn.

**Nội dung**

Mục "Thiết bị đang đăng nhập" trong Cài đặt: mỗi phiên một dòng (nền tảng, nhãn máy, hoạt động cuối, ngày
tạo), đánh dấu phiên hiện tại, nút **[Đăng xuất khỏi thiết bị này]** cho từng phiên khác và **[Đăng xuất
tất cả thiết bị khác]**. **Không cần migration.**

**⚠️ Hai cảnh báo**

1. Đây **KHÔNG** phải mục "Quản lý thiết bị nhận push" đã có (đó là `PushSubscription` — đích nhận thông
   báo; xoá thì chỉ ngừng nhận push, không thu hồi quyền truy cập dữ liệu).
2. **Đừng** gắn cờ "chỉ xem" vào `Session` ở bước này. Repo **không có middleware**: mỗi handler tự gọi
   `VerifyBearer` rồi tự lọc `userId`, nên một cờ phân quyền phải được kiểm ở ~40 handler — sót một chỗ là
   cấp quyền ghi mà không ai phát hiện. Thu hồi phiên là đủ và an toàn.

**Việc nhỏ bắt buộc kèm theo:** web gọi login mà không truyền `deviceLabel`
(`website/src/app/actions/auth.ts:88`) → phiên web có nhãn `NULL`. Phải truyền nhãn suy từ User-Agent
hoặc fallback "Trình duyệt web", nếu không danh sách sẽ toàn dòng trống.

**Bước đầu tiên bắt tay được ngay**

Thêm 2 query vào `api/internal/store/queries/sessions.sql` — `ListSessionsForUser` và
`RevokeSessionByID` (kèm `AND "userId" = $2 AND "revokedAt" IS NULL`) — rồi 2 route + mục `openapi.yaml`
+ UI Cài đặt trên web. iOS/Android dùng lại đúng 2 endpoint đó ở vòng sau.

---

#### 6. Hậu kiểm nháp AI: IMEI Luhn + trùng serial

**Khu vực:** api · **Impact:** medium (đòn bẩy cao) · **Effort:** S
**Nhãn:** `[repo]` · **Loại:** tính năng mới

**Vì sao đáng làm**

**0 đồng token** (không gọi thêm AI) nhưng bảo vệ đúng thứ quan trọng nhất trong miền nghiệp vụ này: bảo
hành điện tử ở VN lưu theo IMEI/serial, **sai một ký tự là trung tâm từ chối** — hỏng đúng lúc người dùng
cần app nhất. Hiện tại toàn bộ "kiểm tra" của đường AI chỉ là độ dài (>120 byte thì bỏ) và biên 0–120
tháng, tức một IMEI 14 số hoặc một serial gõ lệch vẫn vào thẳng DB. Rủi ro trùng lặp cũng có thật:
`Device."serialNumber"` **không có unique index** ở bất kỳ đâu (`0001_initial.sql:121`).

**Nội dung**

Chạy kiểm tra **tất định** ngay trước khi trả draft (và lần nữa trước khi lưu thiết bị):

- checksum **Luhn** cho IMEI 15 số;
- cảnh báo nếu serial đã tồn tại ở thiết bị khác **của cùng người dùng**;
- `purchaseDate` không ở tương lai;
- giá hoặc số tháng bảo hành lệch bất thường so với các thiết bị cùng loại.

Trả thêm mảng `warnings` để form hiện cảnh báo vàng — **không chặn lưu**, vì người dùng vẫn có thể đúng.

**Bước đầu tiên bắt tay được ngay**

Một hàm thuần `ValidateDraftIntegrity(draft DraftDevice, existingSerials []string) []Warning` + bảng test
(case IMEI đúng, IMEI sai 1 số, IMEI 14 số, serial trùng, ngày tương lai). Gọi ở cuối `ExtractReceipt`.
Đây là tầng tin cậy cho **mọi** đường nhập bằng AI, không chỉ OCR.

---

#### 7. Chi phí sở hữu mỗi ngày (đ/ngày)

**Khu vực:** web (api nếu muốn có trên mobile) · **Impact:** high · **Effort:** M (S cho web-only)
**Nhãn:** `[repo]` · **Loại:** chỉ số mới

**Vì sao đáng làm**

Repo **đã có đủ ba số hạng** — `Device.purchasePrice`, `Warranty.cost`, `Device.soldPrice` — nhưng **chưa
bao giờ chia cho thời gian**. Mọi rollup hiện tại là tổng luỹ kế theo năm/loại/tháng
(`website/src/lib/stats-rollup.ts`: `buildSpendEntries`, `monthlySpendBuckets`, `yearlySpend`,
`spendByCategoryRollup`, `allTimeSpend`, `topExpensiveRollup`), tức là những con số **luôn tăng** và không
so sánh được gì. đ/ngày là chỉ số duy nhất trả lời được "món này có đáng tiền không", và nó tự cân bằng
giữa giá mua và độ bền.

**Nội dung**

- Mỗi thiết bị một con số: `(purchasePrice + Σ Warranty.cost) ÷ số ngày đã sở hữu`. Máy đã bán thì chia
  tới `soldAt` và trừ `soldPrice`: `(mua + gói − bán) ÷ số ngày giữ` = "đ/ngày thực trả".
- Trên `/stats` thêm card **"Đắt nhất để dùng mỗi ngày"** — bảng xếp hạng ngược hẳn với "Top 5 thiết bị
  đắt nhất" đang có: máy 30 triệu dùng 4 năm có thể rẻ/ngày hơn máy 8 triệu dùng 8 tháng.
- Thêm một mục vào dropdown sort của danh sách thiết bị. Sort đang chạy **in-memory** ở
  `api/internal/services/devices.go:267` (N ≤ 50) nên thêm case mới rất rẻ.
- `[suy luận]` Cách diễn đạt "mỗi ngày trả bao nhiêu" đã quen thuộc trong truyền thông công nghệ VN, nên
  copy tiếng Việt sẽ bấm đúng chỗ.

**Bước đầu tiên bắt tay được ngay**

Hàm thuần `costPerDay(device)` trong `website/src/lib/stats-rollup.ts` + fixture test (đã có tiền lệ
`stats-rollup` test), render ở trang chi tiết thiết bị. **Web-only, không đụng API, không migration.**

---

#### 8. Dự báo chi tiêu 12 tháng tới

**Khu vực:** api + web · **Impact:** high · **Effort:** M
**Nhãn:** `[repo]` · **Loại:** tính năng mới

**Vì sao đáng làm**

**Toàn bộ app chỉ nhìn về quá khứ**: đã tiêu bao nhiêu. Trong khi đó `Subscription.renewalDate` +
`billingCycle` + `intervalDays` đã đủ để tính **chính xác** số tiền sắp bị trừ, và `Warranty.endDate` +
`WishlistItem.targetDate` đã đủ để biết mốc sắp tới. Nhắc gia hạn hiện chỉ bắn **từng gói một** ở mốc
3/1/0 ngày (`api/internal/store/queries/subscriptions.sql:114-125`) — không tổng hợp thành kế hoạch tiền.
Grep `forecast|dự báo|budget|ngân sách` trên `website/src` + `api/internal` = 0 kết quả.

**Nội dung**

`GET /api/v1/forecast` (read-only) trả 12 bucket tháng:

1. các kỳ gia hạn tiếp theo của mọi sub ACTIVE non-`LIFETIME` (CUSTOM dùng `intervalDays`), `LIFETIME` bị
   loại như mọi phép `monthlyEquivalent` hiện có → **không phá parity** với 3 client;
2. tổng 12 tháng + dòng "nếu không đổi gì";
3. `Warranty` có `endDate` trong 12 tháng tới, kèm `cost` của gói cũ làm tham chiếu để dành tiền;
4. `WishlistItem` có `targetDate` rơi vào 12 tháng tới, kèm `currentPrice`.

Web `/stats`: BarChart cột chồng, **tô khác màu** để phân biệt *tiền chắc chắn trả* (subscription) với
*tiền có thể phát sinh* (bảo hành/wishlist), kèm dòng phụ "N gói gia hạn · M gói bảo hành hết hạn".

**Bước đầu tiên bắt tay được ngay**

Viết hàm Go thuần `forecastSubscriptions(subs []Subscription, months int) []MonthBucket` (tái dùng logic
`nextRenewalDate` đang có ở cả 3 client) + test, rồi hiển thị web-only từ dữ liệu client đã có **trước
khi** mở endpoint — để kiểm chứng biểu đồ có đọc được không đã.

---

#### 9. Sổ sự kiện + "Có gì mới kể từ lần trước" (+ nhắc quay lại theo nhịp im lặng)

**Khu vực:** api + web · **Impact:** high · **Effort:** M
**Nhãn:** `[repo]` · **Loại:** tính năng mới (gộp "nhắc quay lại theo nhịp im lặng")

**Vì sao đáng làm**

**17 bảng, không bảng nào ghi *chuyện gì đã xảy ra*.** Cron gửi push nhưng chỉ để lại **dấu chống
trùng**, và `Stats` (`api/internal/cron/run.go:36-46`) được trả về rồi bị log và vứt. Ba hệ quả kiểm
chứng được:

- Tin "iCloud đã tự trừ 499.000đ" chỉ tồn tại trong `SubscriptionPayment` của **đúng một** subscription —
  phải drill vào mới thấy.
- Gói BH hết hạn hôm qua **không hiện ở đâu** (`warranties.sql:171`).
- Push bị vuốt mất là sự kiện biến mất vĩnh viễn.

**Nội dung**

- Migration `0010`: bảng `Event` **append-only** — mỗi hàng là một việc **HỆ THỐNG** đã làm hộ người dùng:
  cron vừa gửi loại nhắc nào, gói BH vừa rời cửa sổ, subscription vừa bị auto-charge, wishlist vừa tới
  hạn check-in, thiết bị vừa được tạo từ wishlist. **Điểm chèn đã có sẵn**: cron gọi stamp ở
  `run.go:258,304,336,385` — chỉ cần ghi thêm một hàng cùng chỗ.
- `GET /api/v1/events?since=&limit=`.
- Web: trang `/hoat-dong` + card dashboard **"Có gì mới kể từ lần trước"**, mốc lấy từ `User.lastActiveAt`.
- Bucket cron #6 (nhắc theo **nhịp im lặng**, không theo ngày lịch): nếu `now − User.lastActiveAt` ∈
  {30, 60, 90} ngày **theo bậc, không lặp lại** VÀ có ≥ 1 sự kiện mới → gửi **ĐÚNG MỘT** push có nội dung
  thật: *"45 ngày rồi không mở. 6 việc đã xảy ra: 2 gói BH đã hết, iCloud tự trừ 3 lần, 1 món wishlist
  tới hạn."*

**⚠️ Cảnh báo:** phải thêm cột `User.lastActiveAt`. `Session.lastSeenAt` bump tối đa 5 phút/lần
(`sessions.sql:26-34`) **nhưng** hàng `Session` bị `PruneExpiredSessions` xoá khi hết hạn
(`sessions.sql:57-59`) và TTL trượt 30 ngày → **đúng lúc người dùng ngủ đông thì mốc biến mất**.

**Nguyên tắc thiết kế:** vòng lặp quay lại phải là **pull** (có gì để xem), không phải **push** (có gì để
bị nhắc) — repo đã tự kết luận đúng như vậy ở `docs/SPEC-MAINTENANCE-SCHEDULES.md`. Và **không** nhắc lặp
lại cho tới khi người dùng quay lại (cách nhanh nhất để bị tắt thông báo vĩnh viễn).

**Bước đầu tiên bắt tay được ngay**

Migration `Event` + ghi **một** loại sự kiện duy nhất (subscription auto-charge — vì đó là dòng tiền có
thật, và điểm chèn đã xác định ở `run.go`) + một trang web đọc nó. Push nhịp im lặng để vòng sau.

---

#### 10. Share sheet → wishlist (PWA `share_target` + Android `ACTION_SEND`)

**Khu vực:** web + android · **Impact:** high · **Effort:** M (nửa web/PWA là S)
**Nhãn:** `[repo]` `[ngoài]` · **Loại:** tính năng mới

**Vì sao đáng làm**

Khoảnh khắc tốn công nhất là lúc **đang lướt Shopee/Lazada trên điện thoại** và thấy món muốn theo dõi.
Hiện phải: copy link → mở app → tab Wishlist → nút + → dán → tự gõ tên → chọn ưu tiên. Cột `buyUrl` /
`imageUrl` **đã có** trong schema (`0001_initial.sql:236-237`), đã expose trong openapi và đã có trong
form — nhưng **không có gì nhận dữ liệu từ ngoài vào app**:

- `manifest.webmanifest` chỉ có `shortcuts`, **không có `share_target`** (đã grep = 0).
- `AndroidManifest.xml:19-27` chỉ có `MAIN`/`LAUNCHER`.
- `Info.plist` không có `CFBundleURLTypes`.
- `website/src/app/(app)/wishlist/new/page.tsx` hiện **không** đọc `searchParams`.

**Nội dung**

Chuẩn hoá **MỘT** hợp đồng URL `/wishlist/new?ten=&link=&mota=` rồi cắm ba nguồn vào đúng hợp đồng đó:

- **(a) PWA** — thêm `share_target` với `method: "GET"` vào `manifest.webmanifest`. Chrome Android sẽ gọi
  `/wishlist/new?ten=…&link=…` khi người dùng chọn WarrantyVault trong share sheet. **GET không cần service
  worker** (dữ liệu đến dưới dạng query param), nên `sw.js` giữ nguyên.
- **(b) Android** — thêm `<intent-filter>` cho `ACTION_SEND` (text/plain) + `ACTION_VIEW` (http/https) vào
  `MainActivity` (đang `exported="true"`); đọc `Intent.EXTRA_TEXT`/`EXTRA_SUBJECT`, tách URL http(s) đầu
  tiên, điều hướng sang form wishlist đã điền.
- **(c) Desktop** — một bookmarklet dán đúng URL đó khi đang xem trang sản phẩm.

Cần **validate độ dài** `ten`/`link` vì đây là dữ liệu ngoài đi vào form.

**Bước đầu tiên bắt tay được ngay**

Sửa `wishlist/new/page.tsx` nhận `searchParams` và truyền initial vào `WishlistForm` (ô "Link mua" đã có ở
`wishlist-form.tsx:402-411`) + thêm `share_target` vào manifest. **Xong nửa PWA trong vài giờ và kiểm tra
được ngay trên Chrome Android**, không cần build lại app native.

---

#### 11. Hộp thư vào: forward hoá đơn → AI bóc tách → nháp

**Khu vực:** api + ai + deploy · **Impact:** high · **Effort:** L
**Nhãn:** `[repo]` `[ngoài]` · **Loại:** tính năng mới

**Vì sao đáng làm**

Hoá đơn điện tử của các shop VN **vốn đã nằm trong hộp thư** dưới dạng PDF. Việc phải làm hiện nay là mở
app, chụp lại màn hình/giấy rồi upload. Forward là **2 cú chạm**, không camera, và PDF là bản gốc có đủ
ngày/giá thay vì ảnh hoá đơn nhiệt mờ. Đây là mức giảm công nhập liệu lớn nhất trong cả danh sách, và nó
tái dùng đúng pipeline AI đã build.

**⚠️ Phân biệt rõ với mục roadmap §5 đã loại**

Roadmap §5 loại *"Tự động đọc hoá đơn điện tử (XML/PDF hàng loạt)"* vì **chưa kiểm chứng được có API/định
dạng tiêu dùng nào của nhà bán lẻ**. Thiết kế này **khác về bản chất**: nó **không giả định nhà bán lẻ có
API nào** — người dùng tự forward, và nó tái dùng pipeline AI đã build (bao gồm cả PDF).

**Nội dung**

Cấp cho mỗi user một địa chỉ nhận riêng dạng `u-<token>@<id>.resend.app` (Resend cấp subdomain, nên
**không phụ thuộc việc mua domain** — `docs/HUMAN_TASKS.md` vẫn đang treo mục đó). Luồng: Resend bắn
webhook `email.received` (chỉ metadata) → Go verify chữ ký → gọi Receiving API lấy html/text/headers +
danh sách attachment (URL tải tạm thời) → tải PDF/ảnh về → đẩy bytes vào đúng `services.ExtractReceipt`
đang dùng → lưu một hàng `InboxEmail` trạng thái `PENDING/PARSED/FAILED` → push báo → người dùng xác nhận
trong màn "Hộp thư" mới thì mới tạo `Device`.

**Ba ràng buộc kỹ thuật thật:**

1. `api/internal/email/resend.go` hiện chỉ có `SendPasswordReset` + `SendEmailChange` — **chỉ GỬI, không
   NHẬN**. Đây là năng lực **mới**, không phải mở rộng nhỏ.
2. Webhook chỉ có metadata → **phải gọi lại API** để lấy body/attachment.
3. Phải thêm **guard SSRF**: chỉ cho phép host của Resend, không nhận URL tuỳ ý — hiện repo **không có
   helper fetch URL do người dùng cung cấp** và cũng không có guard SSRF nào.

Vì webhook phải trả 200 nhanh, việc gọi AI nên chạy nền và để cron hiện có (`api/cmd/cron`) drain hàng
`PENDING`. Gate bằng `User.aiOptIn` đang có (migration `0003`, mặc định **OFF**) vì mỗi email là một lần
gọi Anthropic **tính tiền**.

**Bước đầu tiên bắt tay được ngay**

Dựng **một** webhook `POST /api/v1/inbox/resend` chỉ **ghi metadata** vào bảng `InboxEmail` + verify chữ
ký (chưa gọi AI, chưa tải file). Mục tiêu: đo được luồng có chạy thật không **trước khi** trả tiền cho
phần bóc tách.

---

#### 12. Tự động sao lưu định kỳ lên cloud của chính người dùng

**Khu vực:** ios + android (+ api nếu muốn hỗ trợ lịch chạy) · **Impact:** medium · **Effort:** L
**Nhãn:** `[repo]` `[ngoài]` · **Loại:** tính năng mới

**Vì sao đáng làm**

**Mọi đường sao lưu hiện nay đều là thao tác tay** — đúng vào lúc người dùng bận nhất (vừa mua máy xong)
thì họ chưa từng bấm export lần nào. Hậu quả nặng hơn một danh sách subscription: **ảnh hoá đơn là thứ
duy nhất không thể tạo lại**, blob là ciphertext nên thiếu `FILE_MASTER_KEY` là mất ảnh vĩnh viễn. Và
`docs/FEATURE_ROADMAP.md` B7 ghi rõ việc **diễn tập restore vẫn chưa làm** — backup chưa từng chạy tự
động thì càng khó tin.

**Nội dung**

`BGTaskScheduler` (iOS) / `WorkManager` (Android) định kỳ tạo file backup — JSON, hoặc ZIP có kèm blob khi
người dùng chọn — và đẩy lên **iCloud Drive / Google Drive của chính người dùng**, giữ lại N bản gần nhất,
kèm màn hình **"Các bản sao lưu"** (ngày, kích thước, khôi phục tại chỗ). Không cần server của mình làm
nơi lưu, **không cần thêm hạ tầng**.

`[ngoài]` (nguồn đến từ báo cáo lăng kính, chưa đọc lại trực tiếp): Subby làm đúng mô hình này và xếp nó
vào tầng trả tiền — *"PRO also backs up automatically every week to your own iCloud or Google Drive, and
keeps the last three"*.

**Trung thực về giới hạn:** blob khoá bằng `FILE_MASTER_KEY` nên **restore sang máy khác khoá là file vẫn
về nhưng không mở được**. UI phải nói thẳng điều này thay vì hứa "an toàn tuyệt đối".

**Bước đầu tiên bắt tay được ngay**

Một nút **"Sao lưu ngay lên Drive"** + màn hình danh sách bản sao lưu trên iOS (chạy tay trước, **chưa
cần** `BGTaskScheduler`). Giá trị nằm ở chỗ **có nơi lưu ngoài máy**, không nằm ở chỗ tự động — và bước
này còn là điều kiện để làm nổi bài diễn tập restore ở B7.

---

#### 13. Dán bảng để nhập nhiều thiết bị một lúc

**Khu vực:** web · **Impact:** medium · **Effort:** M
**Nhãn:** `[repo]` · **Loại:** tính năng mới

**Vì sao đáng làm**

Tồn đọng thật của một người dùng là *"10 món đồ cũ chưa từng nhập vào app"* — và hiện là 10 lần điền
form × 5 trường. Nếu người dùng đã có bảng trong Google Sheets (rất phổ biến), dán một lần là xong. Vault
rỗng thì mọi tính năng khác đều vô nghĩa, nên đây là **fix cho bài toán cold start**.

Export CSV đã có trên cả 3 client, nhưng `website/src/lib/csv.ts` là **serialisation thuần** — chỉ có
`escapeCsvField`/`serializeCsv`/`tableToCsv`, **không có parser nào**; grep `parseCsv|importCsv|FileReader`
trong `website/src` chỉ ra đúng 1 chỗ là nơi tạo Blob để tải xuống. Import backup là envelope v5/v6 riêng
của app, **không ăn được bảng tính**.

**Nội dung**

`/devices/import` — một textarea để dán nguyên một vùng ô copy từ Excel/Sheets/Notes. Web tự tách TSV/CSV
(`;` hoặc `,`), hiện **bảng preview** có đối chiếu catalog (`getDeviceFormCatalog()` đã có sẵn), chỉ ra
từng dòng thiếu gì, rồi submit tuần tự vào `POST /api/v1/devices` đang có. **Không đổi Go, không thêm
dependency.** Cần parse `dd/MM/yyyy` (đúng định dạng `csvDate` của repo đang ghi ra) và quy đổi giá kiểu
`15.000.000` / `15tr`.

**Vì sao chọn DÁN thay vì nhập file:** clipboard là Unicode và phân tách bằng tab, nên né được **đúng hai
cái bẫy mà chính repo đã ghi lại** trong `csv.ts` — file `.csv` từ Excel vi-VN dùng `;` chứ không phải
`,`, và không có BOM thì "Máy giặt" thành "MÃ¡y giáº·t".

**Bước đầu tiên bắt tay được ngay**

Một hàm thuần `parseClipboardTable(text)` + test (đủ case: tab, `;`, `,`, giá có dấu chấm, ngày
`dd/MM/yyyy`, ô trống), và **một trang preview chỉ-đọc** — chưa submit gì cả.

---

#### 14. Thiết bị đã bán không còn chiếm suất 50

**Khu vực:** api · **Impact:** medium · **Effort:** S
**Nhãn:** `[repo]` · **Loại:** thay đổi chính sách hạn mức

**Vì sao đáng làm**

Hôm nay xoá thiết bị là **xoá CỨNG**: `"Device"` CASCADE sang `Warranty`/`Attachment`/`Reminder`
(`0001_initial.sql:129-131,152,170,180`) và blob bị xoá khỏi đĩa
(`api/internal/services/attachments.go:244`). Người dùng chạm trần 50 thiết bị (`devices.go:19`) buộc phải
**xoá máy đã bán để thêm máy mới** — tức là trả giá bằng đúng thứ mà "hồ sơ đã bán để tra lại sau" cần:
hoá đơn, ngày bán, giá bán, lãi/lỗ. Với một người dùng cá nhân sống 5–10 năm với app, đây là mâu thuẫn
**tất yếu**, không phải tình huống hiếm.

**Nội dung**

`CountDevicesByUser` (`devices.sql:117-120`) chỉ đếm thiết bị **chưa bán** (`status <> 'SOLD'`), kèm một
tab/lối vào "Đã bán" với tổng kết (số máy, tổng thu, lãi/lỗ luỹ kế, bảo hành còn lại tại thời điểm bán).

**An toàn vì** `CountDevicesByUser` chỉ có **ĐÚNG MỘT** caller là `CreateDevice` (`devices.go:365`), nên
đổi predicate không kéo theo đường nào khác.

**⚠️ Hai chiều phải xử lý:**

1. Nới hạn mức nghĩa là một tài khoản giữ được 50 máy đang dùng **+ N** máy đã bán → cần một trần cho N
   (ví dụ 500) nếu không muốn bảng phình vô hạn.
2. Đường **import backup hiện KHÔNG kiểm hạn mức này** (`backup.go` không gọi `CountDevicesByUser`), nên
   trần mới phải áp **cả ở đường import**, không chỉ ở `CreateDevice`.

**Bước đầu tiên bắt tay được ngay**

Sửa predicate trong `devices.sql:117-120` + cập nhật thông điệp lỗi tiếng Việt + ghi rõ quy tắc mới vào
`openapi.yaml`/`CLAUDE.md` để client không tự đếm lại theo cách khác.

---

#### 15. Danh bạ bảo hành: hotline hãng + link TTBH uỷ quyền

**Khu vực:** api + web · **Impact:** medium · **Effort:** S
**Nhãn:** `[repo]` `[ngoài]` · **Loại:** tính năng mới

**Vì sao đáng làm**

Đây là **lỗ hổng dữ liệu mà chính repo thừa nhận**: catalog cố ý để `WarrantyProvider.phone/address`
**NULL** với lý do *"those change constantly, this migration cannot verify them, and a wrong hotline is
worse than an empty one"* (`0008_seed_brand_store_warranty_provider.sql:41-44`), nên `notes` chỉ còn cách
nói "tra cứu trung tâm gần nhất trên trang hỗ trợ của hãng". Đồng thời **"sửa chữa ngoài trung tâm uỷ
quyền" là căn cứ từ chối bảo hành có thật** (FPT Shop liệt kê trong danh sách loại trừ) → mất bảo hành vì
sửa sai chỗ là rủi ro **có căn cứ**, không phải lo xa.

`[ngoài]` (đọc trực tiếp trong phiên này): chân trang chính thức `fptshop.com.vn` có mục *"Đại lý uỷ quyền
và TTBH uỷ quyền của Apple"* và *"Tra cứu bảng giá sửa chữa"* → thông tin loại này **tồn tại công khai** và
đang được nhà bán lẻ duy trì.

**Nội dung**

Bảng catalog mới `BrandServiceInfo` (theo **đúng mẫu** Category/Brand/Store/WarrantyProvider đang có):
brand → hotline, trang tra cứu TTBH uỷ quyền, trang bảng giá sửa chữa, **link chính thức** (không phải
địa chỉ chép tay). Trên trang chi tiết thiết bị, thẻ **"Đi bảo hành ở đâu"** hiện đúng hotline + link của
hãng đó, kèm câu cảnh báo lấy từ danh sách loại trừ thật.

**Phạm vi để effort trung thực:** v1 **CHỈ** seed link chính thức + hotline (tự cập nhật ở nguồn),
**KHÔNG** tự dựng danh bạ địa chỉ từng trung tâm (việc đó vừa `L` vừa rất dễ lỗi thời).

**Bước đầu tiên bắt tay được ngay**

Migration seed cho 10 hãng phổ biến nhất (Apple, Samsung, Xiaomi, OPPO, LG, Daikin, Panasonic, Asus,
Acer, Dell) với hotline + URL tra cứu TTBH **chính thức**, + một card trên trang chi tiết thiết bị. Không
cần đổi `openapi.yaml` nếu đọc qua `GET /v1/catalog` đã có.

---

#### 16. Tìm được theo chữ nằm trong ảnh hoá đơn

**Khu vực:** api + web · **Impact:** medium · **Effort:** M
**Nhãn:** `[repo]` `[ngoài]` · **Loại:** tính năng mới

**Vì sao đáng làm**

Tìm kiếm hiện chỉ chạy trên **4 cột văn bản của `Device`** (`name`/`brand`/`model`/`serialNumber`,
`0007_locale_safe_unaccent.sql:66-121`). Nội dung file đính kèm **KHÔNG được index ở bất kỳ đâu**: blob là
ciphertext AES-256-GCM, trường duy nhất đọc được là `description` do người dùng tự gõ. Hệ quả thật: khi
nhân viên bảo hành hỏi *"hoá đơn đâu"*, đường tìm duy nhất hiện nay là **mở từng thiết bị rồi mở từng
ảnh**.

`[ngoài]` (nguồn từ báo cáo lăng kính, chưa đọc lại trực tiếp): Keepfolio để tính năng này ở tầng trả tiền
— *"Pro can search the text inside your documents"*.

**Nội dung**

Khi upload ảnh hoá đơn (**và** user đã opt-in AI), chạy client Anthropic hiện có **đúng MỘT lần** để lấy
text thô của cả trang, lưu lại và đưa vào index `wv_unaccent` + GIN trigram đang dùng; sau đó
`GET /api/v1/devices?q=` và `GET /api/v1/search?q=` khớp thêm cột này, trả về **kèm đoạn text khớp** để
người dùng thấy vì sao nó khớp.

**Lưu ý không trùng roadmap:** roadmap §5 loại *"tự động đọc hoá đơn điện tử (XML/PDF hàng loạt)"* vì
thiếu cổng dữ liệu bên ngoài. Việc này **KHÁC**: OCR thứ **đã nằm sẵn trong kho**, không phụ thuộc cổng
nào.

**Bước đầu tiên bắt tay được ngay**

Thêm cột `Attachment."ocrText"` (nullable) và ghi text trong **cùng lần gọi AI đã có** (không thêm chi
phí), rồi **hiển thị** text đó trong gallery. Bước index là bước đắt — để sau khi đã thấy text có ích.

---

#### 17. Tổng kết tháng: một push + trang lưu trữ theo kỳ

**Khu vực:** api + web · **Impact:** medium · **Effort:** M
**Nhãn:** `[repo]` `[suy luận]` · **Loại:** tính năng mới (gộp "bản tin tháng" của lăng kính AI)

**Vì sao đáng làm**

**Cả 5 bucket cron đều là cửa sổ ngày** và chỉ chạy khi có hàng rơi vào cửa sổ
(`run.go:214,268,311,342`) → user **không có gì hết hạn tháng này nhận 0 liên lạc**. Số liệu đã có sẵn
nhưng chỉ thấy nếu tự mở `/stats`, và **không tồn tại so sánh kỳ-trước ở đâu cả** (đã grep
`tháng trước|kỳ trước|năm ngoái|so với` trên toàn bộ `website/src/app` + `components`: chỉ có delta giá
wishlist và lãi/lỗ bán lại, cả hai đều **per-item**). Đây là nhịp **12 lần chạm/năm có nội dung thật**, vì
subscription được auto-charge hằng tháng trong transaction thật (`run.go:392-466`).

**Nội dung**

Bucket cron **#7**: lần chạy đầu tiên của mỗi tháng, mỗi user có dữ liệu nhận **ĐÚNG MỘT** push — *"Tháng
9: chi 12,4tr, ít hơn tháng 8 3,1tr • 2 gói BH đã hết • iCloud tự gia hạn 2 lần"* — kèm link
`/tong-ket/2026-09`. Trang đó là **hiện vật lưu vĩnh viễn**: chi theo tháng **so với tháng liền trước**, số
gói hết hạn trong kỳ, số tiền subscription **THỰC TRẢ** (từ `SubscriptionPayment.amount`, không phải ước
lượng), wishlist đã mua. Chống trùng theo đúng mẫu `0002_cron_idempotency`: **một cột mốc trên bảng chủ
thể** (`User.lastRecapPeriod`).

**⚠️ Rủi ro thật:** push tháng rất dễ bị coi là nhiễu → cần **cờ tắt riêng** và **trần cứng 1
lần/user/tháng**.

**Bước đầu tiên bắt tay được ngay**

Dựng trang `/tong-ket/[period]` từ dữ liệu `/stats` đã có (**chưa cần push**) để xem nội dung có thật sự
đáng gửi hay không. Nếu trang không đọc được thì push cũng vô nghĩa.

---

#### 18. Sổ linh kiện thay thế có hạn bảo hành riêng

**Khu vực:** api + web · **Impact:** medium · **Effort:** M
**Nhãn:** `[repo]` `[ngoài]` · **Loại:** tính năng mới

**Vì sao đáng làm**

Điều 30.2.c Luật 19/2023/QH15 (trích nguyên văn trong `docs/SPEC-WARRANTY-CLAIM.md:288-291`):
*"thay thế linh kiện, phụ kiện thì thời hạn bảo hành linh kiện, phụ kiện đó được **tính lại từ thời điểm
thay thế**"*. Nghĩa là pin/màn hình thay mới có **đồng hồ bảo hành riêng chạy từ ngày thay** — và repo
**không có chỗ nào biểu diễn được**: `Warranty` gắn cứng `deviceId` và mô tả **GÓI** của máy, còn
`Reminder` gắn cứng `warrantyId` (`0001_initial.sql:137,174`). Hệ quả thật: người dùng **mất quyền bảo
hành pin/màn hình chỉ vì không có gì nhắc**. Trường hợp không có claim nào (mua sạc rời, thay pin ở tiệm
ngoài) hiện **không ghi được ở bất kỳ đâu**.

**Nội dung**

Một danh sách nhỏ trong trang thiết bị: mỗi dòng = linh kiện/phụ kiện (pin, màn hình, sạc, tai nghe, ốp),
ngày thay/mua, nơi làm, giá, **số tháng bảo hành riêng**, ảnh chứng từ. App tính ngày hết hạn cho **TỪNG
DÒNG** và nhắc trước 7 ngày, **độc lập** với bảo hành thân máy. Dòng "pin thay 03/2026 — BH 12 tháng —
hết hạn 03/2027" vẫn còn hạn trong khi bảo hành máy đã hết từ lâu.

**Không trùng spec:** `WarrantyClaim` (spec đã có, chưa build) là **MỘT LẦN ĐI BẢO HÀNH** — có `cost`,
`outcome`, `deviceReturnedAt` — nhưng **không có ngày hết hạn cho linh kiện và không có thực thể linh
kiện**.

**Bước đầu tiên bắt tay được ngay**

Bảng `ReplacedPart(id, deviceId FK, name, replacedAt, months, cost, place, notes)` + CRUD trong trang thiết
bị (**web-only trước**), chưa cần phần nhắc. Nhắc thêm sau khi có dữ liệu thật để nhìn.

---

#### 19. Đưa ngày hết hạn vào lịch (feed ICS + "Thêm vào Lịch")

**Khu vực:** api + web (+ ios + android) · **Impact:** medium · **Effort:** M
**Nhãn:** `[repo]` `[ngoài]` · **Loại:** tính năng mới

**Vì sao đáng làm**

Kênh duy nhất hiện nay là push ở mốc 7 và 30 ngày, và **một push bị vuốt mất là mất vĩnh viễn** — trong
khi đúng lúc đó người dùng lại đang lập kế hoạch chi tiêu. Một event trong lịch **nằm lại**, hiện ra khi
mở tuần/tháng, và **không phụ thuộc việc app có được mở hay không**. Grep
`EventKit|EKEvent|ics|ical|webcal|calendar` trên `ios/Sources`, `ios/App`, `android/app/src`,
`api/internal` = **0 kết quả**.

**Nội dung**

- **(a) Feed đăng ký được:** `GET /api/v1/calendar.ics?token=<ký>` trả `VCALENDAR` gồm all-day `VEVENT`
  cho: ngày hết hạn hiệu lực của từng bảo hành (helper `effectiveWarrantyEnd()` đã có), đồng thời
  `Subscription.renewalDate` và `WishlistItem.targetDate`. Subscribe một lần trong Google Calendar / Apple
  Calendar là **tự cập nhật mãi**. Token **phải là signed URL** vì Google Calendar không gửi bearer;
  read-only, thu hồi được, và **chỉ chứa ngày + tên thiết bị, KHÔNG chứa giá/ghi chú**.
- **(b) "Thêm vào Lịch" cho một món:** web trả file `.ics` qua route handler với
  `Content-Type: text/calendar`; iOS dùng EventKit `requestWriteOnlyAccessToEvents()` — API xin quyền
  **CHỈ GHI** có từ iOS 17, và `deploymentTarget` của project **đúng 17.0** (`ios/project.yml:5`), chỉ cần
  thêm một dòng `NSCalendarsWriteOnlyAccessUsageDescription`; Android dùng `Intent.ACTION_INSERT` với
  extras của `CalendarContract` — **không cần xin quyền nào** (manifest hiện chỉ có `INTERNET` +
  `POST_NOTIFICATIONS`).

Đây **không phải** "thêm một kiểu nhắc nữa" mà là **đưa dữ liệu sang hệ thống lập kế hoạch của chính
người dùng**.

**Bước đầu tiên bắt tay được ngay**

Một route handler web trả `.ics` cho **MỘT** thiết bị (**không cần token, không cần feed**) — hữu ích
ngay, và kiểm chứng được định dạng trước khi làm feed đăng ký.

---

#### 20. Lối tắt ứng dụng + widget "Sắp hết hạn"

**Khu vực:** ios + android · **Impact:** medium · **Effort:** S (lối tắt) → L (widget đầy đủ)
**Nhãn:** `[repo]` `[ngoài]` · **Loại:** tính năng mới (gộp 2 ý của 2 lăng kính)

**Vì sao đáng làm**

Giá trị lõi của app là **một cái ngày không được quên**, và widget là bề mặt duy nhất hiện được ngày đó
mà không cần mở bất cứ thứ gì.

`[ngoài]` (nguồn từ báo cáo lăng kính, chưa đọc lại trực tiếp): MyWrntee liệt kê *"Home screen widgets
(small, medium, large), Spotlight search and Siri shortcuts, Quick Actions from the app icon"* ngay cạnh
danh sách tính năng bán được; Subby xếp widget vào đúng 5 thứ của bản trả tiền PRO.

`[repo]` Và chính **PWA đã có** `shortcuts` trong `manifest.webmanifest:44-57` — đây là bản tương ứng còn
**thiếu ở hai app native**.

**Nội dung**

- **(a) Làm trước, rẻ (S):** `shortcuts.xml` (Android) + `UIApplicationShortcutItems` (iOS) trỏ tới "Thêm
  thiết bị" / "Quét hoá đơn" / "Nhắc nhở". **Chỉ là XML, không cần target mới, không cần cache.**
- **(b) Widget nhỏ (L):** hiển thị 3 mốc gần nhất từ `GET /api/v1/reminders?withinDays=60` đang có.

**⚠️ Chi phí thật của phần (b) KHÔNG nằm ở UI widget** mà ở chỗ **cả hai client hiện KHÔNG cache dữ liệu
gì**: iOS chỉ có Keychain (token) + UserDefaults (theme/app lock); Android chỉ có
EncryptedSharedPreferences + SharedPreferences. Nên phải xây thêm:

- **iOS** — một widget extension target **thứ hai** (`project.yml` hiện chỉ có 1 target application,
  `:20-28`), một App Group + **Keychain access group** (`KeychainStore.swift:12` đang dùng service
  `app.warrantyvault` **KHÔNG** có `kSecAttrAccessGroup`), và app ghi snapshot vào container dùng
  chung. Lưu ý `ios/WarrantyVault.xcodeproj/project.pbxproj` **được git-track**, nên phải giữ đồng bộ
  `project.yml` và `pbxproj`.
- **Android** — thêm `androidx.glance:glance-appwidget` + WorkManager (cả hai đều **chưa có** trong
  `libs.versions.toml`), và một `AppWidgetProvider` trong manifest.

**Bước đầu tiên bắt tay được ngay**

**Chỉ làm (a)** — hai file XML, không cần target mới, không cần cache, ship được trong một buổi. Widget
đầy đủ chỉ nên bắt đầu sau khi có ai đó thật sự dùng lối tắt.

---

## 3. Nhóm theo chủ đề

| Nhóm | Ý | Câu hỏi nó trả lời |
|---|---|---|
| **A. Không bỏ lỡ mốc thời gian thật** | #1, #3, #19, #20, (#17) | "Còn kịp không?" |
| **B. Không mất tiền âm thầm** | #4, #7, #8, #17 | "Tiền của tôi đang đi đâu?" |
| **C. Chứng minh & dùng được bảo hành khi cần** | #2, #15, #16, #18 | "Hoá đơn đâu? Đi bảo hành ở đâu? Còn hạn không?" |
| **D. Nhập liệu rẻ** | #10, #11, #13, #6 | "Nhập cái này mất bao lâu?" |
| **E. Nền tảng tin cậy & không mất dữ liệu** | #5, #9, #12, #14 | "Tôi có kiểm soát được cái này không?" |

**Nếu chỉ làm được 3 việc:** #1 (hạn đổi trả), #6 (hậu kiểm AI), #3 (hàng đợi việc cần xử lý).
Ba việc này độc lập nhau, đều không cần hạ tầng mới, và #6 chỉ tốn một buổi.

**Nếu chỉ làm được 1 việc:** #1. Đây là mốc duy nhất mà việc bỏ lỡ nó **trực tiếp làm mất tiền**, và nó
đang hoàn toàn vô hình trong app.

**Thứ tự triển khai gợi ý (theo phụ thuộc kỹ thuật, không theo giá trị):**

1. `S` không phụ thuộc gì, làm ngay: **#6, #14, #15, #20(a)**.
2. `M` cần một migration: **#1, #9, #18** — và **#9 nên đi trước #17** (bản tin tháng cần sổ sự kiện để có
   nội dung "có gì mới").
3. `M` chỉ đụng web/tính toán: **#7, #13, #2 (giai đoạn 1: trang in), #19 (giai đoạn 1)**.
4. `M` cần endpoint + openapi: **#3, #4, #5, #8, #10, #16**.
5. `L` cần hạ tầng hoặc nền tảng mới: **#11 (Resend Receiving), #12 (BGTaskScheduler/WorkManager),
   #20(b) (widget extension)**.

---

## 4. Đã cân nhắc và loại

> Ghi lại để người sau không phải tranh luận lại. Mỗi mục kèm lý do một dòng.

### 4a. Loại vì ĐÃ CÓ (kiểm tra trước khi làm lại)

| Ý bị loại | Vì sao |
|---|---|
| Quản lý **thiết bị nhận push** trên 3 client | **Đã có** (`PushSubscription` + UI trên cả web, iOS, Android). Ý #5 trong tài liệu này là **phiên đăng nhập**, không phải đích nhận thông báo — hai bảng khác nhau, mục đích khác nhau. |
| Nhật ký / sổ tay do **người dùng tự viết** | `Device.notes` và `WishlistItem.notes` đã có. #9 chỉ ghi sự kiện do **HỆ THỐNG** sinh ra — người dùng không tạo được, cũng không sửa/xoá được. |
| Chart lịch sử giá wishlist · sparkline từng món · delta % · min/max | **Đã có**: `WishlistPrice` + `POST /wishlist/{id}/prices` + `UpdatePriceDialog`, và trang chi tiết wishlist **tự tính** delta %, min, max, số điểm giá, vẽ chart (`website/src/components/charts/price-history.tsx`). Chỉ còn phần **GỘP** thành chỉ số tiết kiệm/đội giá là mới → xếp sau, xem 4d. |
| Lịch sử thanh toán subscription · gia hạn 1 chạm · quy đổi /tháng | **Đã có** và đã hiển thị. #4 không phải "hiện lịch sử" mà là **đọc chuỗi lịch sử để suy ra kết luận** — thứ chưa có. |
| Dark mode / theme / tuỳ biến giao diện / PWA offline / i18n tiếng Việt / Face ID | **Đã có** toàn bộ. |
| Export CSV (web + iOS + Android) | **Đã có**. #13 là chiều **NGƯỢC LẠI** (parse dữ liệu dán vào), không phải export. |
| Tìm kiếm không dấu + tìm kiếm xuyên thực thể | **Đã có**. #16 thêm **nguồn dữ liệu mới** vào index (chữ trong ảnh), không phải sửa cơ chế tìm. |
| Ẩn nhắc nhở + hoàn tác + xem lại danh sách đã ẩn | **Đã có**. #3 **cố ý không** đụng bảng `Reminder` vì lý do ở 4b. |
| Widget trên **PWA** | Đã có `shortcuts` trong `manifest.webmanifest`. #20 là bản tương ứng còn thiếu ở **hai app native**. |
| Backup export/import (JSON + ZIP kèm blob, 2 chế độ) | **Đã có**. #12 là **tự động hoá + nơi lưu**, không phải định dạng mới. |

### 4b. Loại vì không hợp app cá nhân 1 người dùng

| Ý bị loại | Vì sao |
|---|---|
| **Nhiều người cùng sở hữu một thiết bị** (bảng `Membership`, sửa điều kiện `userId = $1` ở ~40 handler) | Đổi **mô hình dữ liệu + quyền**, không phải một tính năng: hạn mức 50/người mất nghĩa, mọi đường ghi phải phân quyền, và **không có bằng chứng nhu cầu** (roadmap §5 đã loại "tài khoản chia sẻ trong gia đình"). Thay thế **không đổi mô hình**: link chỉ-đọc trong **#2**. |
| **Streak / chuỗi ngày mở app** | App không có hành động hằng ngày để giữ chuỗi; streak sẽ bị phá trong tuần đầu. `[ngoài]` Chính blog Duolingo viết rằng mất chuỗi khiến người học "mất tinh thần" tới mức **không dám bắt đầu lại**, và họ phải thêm "streak freeze" — động thái chỉ tăng **0,38%** người học hằng ngày. Hiệu ứng cảm nhận cũng giảm rất nhanh (ngày 2→3 là +50%, ngày 200→201 là +0,5%). *(Nguồn từ báo cáo lăng kính, tôi chưa đọc lại trực tiếp.)* |
| **Huy hiệu / thành tích** ("thiết bị thứ 10", "theo dõi 1 năm") | Không có hành động nào để vinh danh. Trang trí. |
| **Geofence** ("bạn đang ở Điện Máy Xanh") | PWA không có background geolocation; cả hai app native phải làm thêm việc + xin quyền vị trí. Chi phí/quyền riêng tư lớn hơn giá trị. |
| **Sổ chi tiêu cá nhân đầy đủ** (thu/chi/phân loại) | Là app khác, và repo này **không có dữ liệu thu nhập**. |
| **Per-user reminder lead time** (số ngày nhắc trước, cấu hình được) | **Cố ý KHÔNG làm** theo `CLAUDE.md` (dòng "Chưa khả dụng" trên iOS là cố ý). Lưu ý phân biệt: **#1 không phải** tính năng này — #1 thêm một **MỐC NGÀY MỚI** (hạn đổi trả) với lead time cố định T-3/T-1, không mở cấu hình lead time cho bảo hành. |
| **Sign in with Apple** | **Cố ý KHÔNG làm** theo `CLAUDE.md`. Không đề xuất. |

### 4c. Loại vì đã nằm trong roadmap §5 — không mở lại

| Ý | Vì sao không mở lại |
|---|---|
| **Đồng bộ giao dịch ngân hàng/ví** để tự phát hiện subscription | Roadmap §5: **không tìm được API tiêu dùng công khai nào**. **#4 không hứa điều này** — nó chỉ soát kỹ những gì người dùng **đã ghi**. |
| **Scraping giá bán lẻ** (Điện Máy Xanh / Shopee / Lazada) | Roadmap §5: không có API công khai được xác minh + rủi ro ToS/pháp lý. **Mọi ý liên quan giá trong tài liệu này CHỈ dùng `PriceLog` do người dùng tự nhập.** |
| **Quét mã vạch/QR để ĐIỀN form** | Roadmap §5 loại vì trùng mục đích nhập liệu với OCR. Bản *"quét QR trên tem để **TRA CỨU** thiết bị đã có"* khác về mục đích (dùng `GET /api/v1/search` sẵn có, không đổ vào form) — xem 4d. |
| **Đọc hoá đơn điện tử hàng loạt từ cổng nhà bán lẻ** | Roadmap §5: chưa kiểm chứng được API/định dạng tiêu dùng. **#11 không giả định điều đó** — người dùng tự forward. |
| **Phân trang danh sách** | Roadmap §5: giới hạn cứng (50/100/200) khiến payload tệ nhất vẫn nhỏ; hoãn có ý thức. |
| **i18n / tiếng Anh** | Roadmap §5: tiếng Việt là quyết định sản phẩm có chủ đích. |
| **Admin CRUD app đầy đủ** | Roadmap §5: migration seed + SQL là đủ. **#15** theo đúng khuôn đó (migration seed, không admin UI). |

### 4d. Không tồi, nhưng xếp sau top 20 (kèm lý do cụ thể)

| Ý | Vì sao chưa vào top 20 |
|---|---|
| **Trợ lý hỏi đáp trên chính dữ liệu trong vault** (ý lớn nhất của lăng kính AI) | `L`, và bốn lý do thật: (i) gửi **cả danh sách thiết bị + giá + tên gói** cho bên thứ ba là mức tiết lộ **khác hẳn** "một ảnh hoá đơn", nên cần **cờ opt-in RIÊNG** + màn xem trước dữ liệu sẽ gửi — copy opt-in hiện tại chỉ nói về ảnh; (ii) với 20–50 thiết bị, search + `/stats` + **#7** + **#8** trả lời được phần lớn câu hỏi; (iii) rủi ro model **bịa số về tiền của chính người dùng** là rủi ro niềm tin lớn nhất trong app này; (iv) nó nên **dùng lại đúng các hàm tóm tắt** của #7/#8 thay vì tự tính. → làm **sau** #7 và #8. |
| **Quét tem/nhãn máy để điền model + serial/IMEI** | **Không trùng** roadmap #15 về mặt kỹ thuật (hoá đơn VN gần như không in IMEI, nên đường OCR hoá đơn **không lấp được ô serial** trong thực tế). Nhưng xếp sau vì: (a) là **mô hình AI thứ ba** đứng sau cờ `aiOptIn` đang mặc định **TẮT**; (b) cần camera native trên 2 client; (c) serial vẫn gõ tay được, chỉ tốn công. |
| **Điều khoản & hạn mức gói bảo hành mở rộng** (phạm vi rơi vỡ/vào nước, hạn mức tối đa, số lần bồi thường, khấu trừ) | Có căn cứ thật — `[ngoài]` (đọc trực tiếp) chính sách FPT Shop niêm yết **5 gói Bolttech**: bảo hành mở rộng, đổi mới 12 tháng, VIP 1 đổi 1, rơi vỡ vào nước, thay pin 3 năm; và `endDate` + `cost` đúng là phần **ÍT thông tin nhất** của loại gói này (`0001_initial.sql:137-155` không có trường nào cho phạm vi/hạn mức/số lần). Xếp sau vì giá trị chỉ bộc lộ khi **`WarrantyClaim` được build** — mà spec đó **chưa build**. |
| **Chỉ số "% giá trị tài sản còn được bảo vệ"** + **tiền nằm trong máy đã hỏng/mất mà bảo hành còn hiệu lực** | Rẻ (`S`) và đúng, nhưng chỉ là **nâng cấp** của thẻ "giá trị tài sản còn bảo hành" đang có: `activeAssetValue()` (`stats-rollup.ts:146-158`) chỉ trả `{total, count}` và UI chỉ in **tỉ lệ đếm thiết bị**, trong khi tử số theo tiền **đã tính sẵn**. Nên gộp vào lần sửa `/stats` kế tiếp, không tách thành tính năng riêng. |
| **Các chỉ số mua sắm**: % thu hồi khi bán lại theo hãng · chi theo hãng/nơi mua · mẫu hỏng theo hãng · so cùng kỳ năm trước · gói mua kèm lúc mua máy · chênh lệch giá wishlist | Tất cả đều **tính được từ dữ liệu đang có** và đều `S`–`M`, nhưng chúng là **báo cáo**, không phải **hành động**; và với ≤ 50 thiết bị thì ngưỡng mẫu tối thiểu (≥ 2–3 máy/hãng) khiến phần lớn biểu đồ **trống trong 1–2 năm đầu**. Gộp thành một đợt "insight mua sắm" **sau** khi có nhiều dữ liệu. Riêng *chi theo nơi mua* cần thêm một bước chuẩn hoá chuỗi (`purchasePlace` là ô nhập tự do — "FPT Shop", "fptshop", "FPT shop " sẽ thành 3 nhóm) qua `public.wv_unaccent` + khớp catalog `Store`; **bỏ bước đó thì tính năng vô dụng**. |
| **Lý do rời tài sản** (cho tặng / thu cũ đổi mới + liên kết máy cũ–máy mới) | `saleProfitLoss` hiện là `soldPrice − purchasePrice` thuần, nên **cho tặng máy hiển thị "Lỗ 100%"** và credit thu cũ không được trừ vào máy mới — cả hai đều sai về ý nghĩa. Có căn cứ (`[ngoài]` FPT Shop có chương trình "Trade-in – Upgrade"), nhưng **tiền đang được tính ở 3 nơi độc lập** (`stats-rollup.ts` web, `StatsRollup.swift` iOS, `devices.totalWarrantyCost` Android) → sửa một nơi là 3 client lệch số, phải sửa cả 3 kèm fixture. Chi phí thật cao hơn vẻ ngoài. |
| **Cho mượn: "ai đang giữ máy này" + nhắc ngày hẹn trả** | **Chưa có bằng chứng nhu cầu** (cùng loại rủi ro mà roadmap #13 đã hoãn), effort `L`, và thêm bảng mới phải đi kèm: backup export/import + **đúng thứ tự xoá trong `ImportReplace`** + nới điều kiện `payload.Version != 5` (so sánh **BẰNG** — bump version mà không nới là mọi file backup cũ thành rác). |
| **Trả lời câu hỏi check-in ngay trên thông báo đẩy** | Hay, nhưng đổi **hợp đồng payload push** (`Payload` hiện chỉ `title`/`body`/`url`/`tag`, `push/payload.go:13-18`) và phải sửa **cả 3 kênh** (APNs category, FCM action, `sw.js` `showNotification`); và câu trả lời "Đã mua" **vẫn buộc phải mở app** vì nó TẠO `Device` trong cùng transaction. Làm sau khi payload đã có lý do khác để đổi. |
| **App Intent + phiên dài hạn cho Shortcuts/Tasker** | Phần "token dài hạn" đã được **#5 bao phủ một nửa** (phiên có nhãn + thu hồi được, bảng `Session` đã đủ cột); phần App Intent nên làm **cùng #20(a)**. Đứng riêng thì trùng. |
| **Gói bàn giao số (.json/QR) để người mua tự nhập** | Chỉ đáng nếu **người mua cũng dùng WarrantyVault**; và blob khoá bằng `FILE_MASTER_KEY` nên **khác instance thì ảnh về mà không mở được** (giới hạn repo đã ghi cho backup). Nếu làm thì nên thiết kế **CHUNG một artifact với #2** (phần người đọc = phiếu in, phần máy đọc = JSON), đừng làm hai định dạng rời nhau. |
| **Định danh hoá đơn điện tử** (ký hiệu, số HĐ, MST, mã tra cứu, SĐT mua hàng) | `S` và đúng chỗ quầy bảo hành hỏi, nhưng (a) một phần chạm vào mục roadmap §5 đã loại (đọc hoá đơn điện tử từ cổng nhà bán lẻ), và (b) giá trị phụ thuộc người dùng có thực sự cần **hoá đơn VAT** hay không — **chưa có bằng chứng**. |
| **Quỹ để dành cho wishlist** | Bám đúng nhịp check-in **đang chạy sẵn** nên không cần máy thông báo mới — nhưng **cầu CHƯA kiểm chứng** và phụ thuộc người dùng chịu ghi tay. Cùng loại rủi ro mà roadmap **#13** đã hoãn vì thiếu bằng chứng nhu cầu. Nếu phải bỏ một ý, bỏ ý này trước. |
| **Quét mã QR trên tem để tra cứu thiết bị đã có** | Là bản **khác mục đích** của mục roadmap §5 đã loại (tra cứu ≠ điền form), và **không cần sửa backend một dòng** (dùng `GET /api/v1/search?q=` + index `serialNumber` đã có). Xếp sau vì phải thêm camera native trên 2 client + quyền `CAMERA` (manifest Android hiện **chưa có**) mà chỉ phục vụ tra cứu. |
| **Cứu truy vấn 0 kết quả bằng từ đồng nghĩa (AI)** | `unaccent` + trigram giải quyết **DẤU**, không giải quyết **TỪ ĐỒNG NGHĨA**: máy tên "Máy lạnh Daikin" **không** khớp truy vấn "điều hoà". Nhưng **một bảng đồng nghĩa viết tay (~15 cặp: điều hoà/máy lạnh, tủ lạnh/fridge, nồi cơm/rice cooker…)** giải quyết phần lớn với **0 đồng và 0 ms**. → làm bản viết tay trước; AI là **tầng HAI**, chỉ bật sau khi có log truy vấn 0-kết-quả thật. |
| **Hỏi đáp trên tài liệu bảo hành đã lưu (có trích dẫn)** | Điểm mới so với spec claim là **đối chiếu với chính tài liệu của người dùng và trích dẫn được nguồn** (spec để `rejectionReason` nhập tay, §9 ghi rõ "v1 là nhập tay"). Nhưng giá trị phụ thuộc người dùng **CÓ** file điều khoản — phần lớn phiếu bảo hành VN là **thẻ giấy**, và chất lượng đọc chữ trên ảnh thẻ mờ là **chưa kiểm chứng**. |
| **Soát subscription bằng AI viết lời** | Phần **PHÁT HIỆN** đã gộp vào **#4** (SQL, chính xác, 0 đồng, giải thích được). AI chỉ nên là **lớp diễn đạt**, không phải điều kiện tiên quyết. |
| **Widget đầy đủ** | Xem **#20(b)** — không loại, chỉ tách khỏi phần rẻ. |
| **"Thêm nhanh bằng một câu tiếng Việt"** · **"OCR trả về cả nháp subscription"** · **"AI viết mô tả cho ảnh"** · **"Tra TTBH gần bạn qua web search"** · **"Soạn tin nhắn yêu cầu bảo hành"** | Đều là mở rộng hợp lý của đường AI đang có (~40–500₫/lần, rẻ), nhưng: (a) **tất cả** đứng sau cờ `aiOptIn` mặc định **TẮT** nên giá trị thực bị chặn; (b) mỗi cái là một **bề mặt prompt mới** phải bảo trì; (c) với "soạn tin nhắn yêu cầu bảo hành", `docs/SPEC-WARRANTY-CLAIM.md:1200` ghi rõ tranh chấp/khiếu nại là **domain khác** — nếu làm thì phải là **spec riêng**, và **luật phải là hằng số trong Go**, model chỉ được viết phần tường thuật (rủi ro model bịa điều luật là rủi ro thật). |

### 4e. Loại vì trùng nhau (đã gộp — đây là các cặp đã hợp nhất)

| Các ý trùng | Gộp thành |
|---|---|
| "Phiếu bảo hành cho từng thiết bị" (đối thủ) + "Phiếu bàn giao BH có link chia sẻ" (VN) + "Hồ sơ bàn giao khi bán" (vòng đời) + "Liên kết chỉ-xem cho người nhà" (vòng đời) | **#2** |
| "Hạn 1 đổi 1" (đối thủ) + "Cửa sổ đổi trả của sàn TMĐT" (VN) | **#1** |
| "Widget + Siri/Shortcut" (đối thủ) + "Widget màn hình chính 'Sắp hết hạn'" (tự động hoá) | **#20** |
| "Tổng kết tháng" (retention) + "Bản tin tháng đẩy qua push" (AI) | **#17** |
| "Sổ sự kiện + Có gì mới" (retention) + "Nhắc quay lại theo nhịp im lặng" (retention) | **#9** |
| "Cảnh báo gói auto-renew mà lâu không thấy động tĩnh" (dữ liệu) + "Soát subscription định kỳ" (AI) | **#4** |
| "Điểm sẵn sàng hồ sơ + danh sách việc cần bổ sung" (đối thủ) | **#3** (hàng đợi đã có nhánh "thiếu serial / thiếu ảnh hoá đơn / thiếu ngày mua") |
| "Danh bạ TTBH uỷ quyền" (VN) + "Tra TTBH gần bạn qua web search" (AI) | **#15** (bản tĩnh, rẻ, không phụ thuộc AI) |
| "Tự động sao lưu" (đối thủ) + "Backup phải kèm ảnh" (roadmap #2, đã xong) | **#12** (roadmap #2 là định dạng, #12 là **tự động hoá + nơi lưu** — không trùng) |

---

## 5. Nguồn tham khảo

### 5a. Repo (tôi đã đọc trực tiếp trong phiên này)

| File | Dùng cho ý |
|---|---|
| `api/migrations/0001_initial.sql:22-268` | #1 (`Reminder.warrantyId` NOT NULL, `:174`), #3, #5 (`Session` `:34-46`), #6 (`serialNumber` không unique, `:121`), #7 (`purchasePrice` `:123`, `Warranty.cost` `:145`), #9 (17 bảng, không bảng sự kiện), #14 (CASCADE `:129-131,152,170,180`), #18 (`Warranty` `:137`) |
| `api/migrations/0002_cron_idempotency.sql` | #9, #17 — mẫu chống trùng theo `::date` |
| `api/migrations/0003_user_ai_optin.sql` | #6, #11, #16, 4d — cờ `aiOptIn` mặc định OFF |
| `api/migrations/0006_device_resale.sql` | #1, #3, #7 — tiền lệ nullable + validate ở app |
| `api/migrations/0007_locale_safe_unaccent.sql:66-121` | #16 — index chỉ trên 4 cột `Device` |
| `api/migrations/0008_seed_brand_store_warranty_provider.sql:41-44` | #15 — `phone`/`address` NULL có chủ ý |
| `api/migrations/0009_email_change.sql` | #5 — tiền lệ "burn every outstanding token" |
| `api/internal/cron/run.go:214,268,311,342,392-466` | #1, #9, #17 — toàn bộ bucket là cửa sổ ngày; auto-bill là dòng tiền thật |
| `api/internal/store/queries/warranties.sql:171,186,189-192,208,211-219` | #1, #3 — BH hết hạn rơi khỏi feed; `isDismissed` là cổng chặn push |
| `api/internal/store/queries/devices.sql:117-120` | #14 — `COUNT(*)` không lọc `status` |
| `api/internal/store/queries/sessions.sql:2,26-34,57-59` | #5, #9 — khuôn `tokenHash`; `lastSeenAt` bump 5 phút; prune xoá mốc |
| `api/internal/store/queries/subscriptions.sql:105,114-125` | #4, #8 — chỉ có nhắc từng gói |
| `api/internal/services/devices.go:19,24,267,365` | #3 (`status` chỉ là validate), #7 (sort in-memory), #14 (`MaxDevicesPerUser = 50`) |
| `api/internal/services/stats.go:14,20-51` | #7, 4d — chỉ số thuần tiền, không có metric thời gian |
| `api/internal/services/ai_extract.go:63-79` | #6, #16, 4d — `DraftDevice` không có trường subscription |
| `api/internal/push/payload.go:13-18` | 4d — `Payload` chỉ `title`/`body`/`url`/`tag` |
| `api/internal/handlers/attachments.go:52-56` | #2 — file chỉ qua bearer |
| `api/internal/email/resend.go:57,89` | #11 — chỉ có 2 hàm GỬI, không có nhận |
| `website/src/lib/stats-rollup.ts:68,115,146-158,160` | #7, 4d — `activeAssetValue` chỉ trả `{total,count}` |
| `website/src/app/(app)/stats/page.tsx:140-300` | #7, #8 — chỗ đặt card mới |
| `website/src/components/device-form.tsx:620-920,1083` | #1 — form không có ngày nhận hàng / hạn đổi trả |
| `website/src/lib/csv.ts:1-30,130-180` | #13 — ghi rõ 2 bẫy Excel vi-VN; chỉ serialize, không parse |
| `website/public/manifest.webmanifest:44-57` | #10, #20 — có `shortcuts`, **không** có `share_target` |
| `android/app/src/main/AndroidManifest.xml:5-6,19-27` | #10, #19, #20 — chỉ `INTERNET`+`POST_NOTIFICATIONS`, chỉ `MAIN`/`LAUNCHER` |
| `ios/project.yml:5,20-28` | #19, #20 — iOS 17.0, chỉ 1 target application |
| `website/next.config.mjs:29` | #2 — `Referrer-Policy` hiện tại |
| `docs/FEATURE_ROADMAP.md` §3 + §4 + §5 | Toàn bộ mục 4c và phần "đã có" |
| `docs/SPEC-WARRANTY-CLAIM.md:261-301,1200` | #18 (Điều 30.2.c nguyên văn), 4d (tranh chấp là domain khác) |
| `docs/SPEC-MAINTENANCE-SCHEDULES.md` §2.3 | #3 — `isDismissed` là cổng chặn push |
| `CLAUDE.md` | 4b — Sign in with Apple và per-user lead time là **cố ý không làm** |

### 5b. Ngoài — tôi đã fetch và đọc trực tiếp trong phiên này

- **FPT Shop — Chính sách đổi trả** (hiệu lực 01/7/2024):
  <https://fptshop.com.vn/ho-tro/chinh-sach-doi-san-pham>
  Dùng cho **#1** (cửa sổ 0–30 ngày "1 ĐỔI 1", mốc 31–365 ngày chỉ còn gửi bảo hành, phí khấu hao 30%
  tháng đầu +5%/tháng, ngoại lệ theo nhóm hàng, và ràng buộc **tất toán trả góp trước khi đổi trả**), và
  cho **#15** (chân trang có "Đại lý uỷ quyền và TTBH uỷ quyền của Apple", "Tra cứu bảng giá sửa chữa") và
  cho **4d** (5 gói Bolttech: bảo hành mở rộng, đổi mới 12 tháng, VIP 1 đổi 1, rơi vỡ vào nước, thay pin
  3 năm).

### 5c. Ngoài — đến từ báo cáo của các lăng kính, tôi **chưa** đọc lại trực tiếp

Các nguồn này được dùng làm bằng chứng phụ (thường chỉ để nói "đối thủ X có tính năng này"), **không**
dùng làm căn cứ cho bất kỳ con số nào trong tài liệu:

- Đối thủ warranty/inventory: MyWrntee, Keepfolio, Itemtopia, Hasset, HomeZada, Encircle, Sortly,
  HomeBinder, AllKeep, Subby, Bobby, Rocket Money, ReturnRadar — App Store listings + trang chủ.
- Việt Nam: CellphoneS (chính sách đổi trả), Chợ Tốt (mẹo mua điện thoại cũ / mẹo mua hàng an toàn),
  Shopee (trả hàng/hoàn tiền), BeeCost (lịch sử giá), Samsung Care+ / AppleCare+ tại VN, VPBank /
  Techcombank (điều khoản trả góp), MISA (QR hoá đơn điện tử), `hddt.fptshop.com.vn`.
- Retention/hành vi: blog Duolingo về streak; Nunes & Drèze 2006 (endowed progress, *Journal of Consumer
  Research* 32, 442-52 — qua bài tóm tắt của Psychology of Games).
- Hạ tầng/AI: tài liệu Resend Receiving, MDN `share_target`, ML Kit barcode scanning,
  `DataScannerViewController`, bảng giá + prompt caching + web search tool của Anthropic.

### 5d. Những gì tôi **KHÔNG** kiểm chứng được (và vì thế không đưa vào top 20)

- **Chu kỳ "hạn kích hoạt gói"** của Samsung Care+ / AppleCare+ tại VN: trang FAQ fetch về HTTP 200
  nhưng phần nội dung không render → **không hardcode con số nào**; nếu làm, trường đó phải do **người
  dùng nhập**.
- **Số ngày đổi trả cụ thể của Shopee/Lazada/TikTok Shop**: chỉ thấy ở mức tiêu đề, **chưa đọc được con
  số** → **#1 không hardcode số ngày của sàn nào**, chỉ đếm ngược theo số người dùng nhập.
- **Byte-layout chuỗi QR trên hoá đơn điện tử**: chỉ xác minh được rằng app thuế **đọc được** nó, không
  xác minh được định dạng → đây là lý do ý "định danh hoá đơn" (4d) không tự parse QR.
- **API "Route emails" của Cloudflare** và **Google OAuth restricted scopes**: chưa đọc đủ để so sánh với
  Resend cho **#11** → #11 chọn Resend vì repo **đã có sẵn client + `RESEND_API_KEY`**.
- **Chất lượng OCR trên ảnh hoá đơn nhiệt mờ / thẻ bảo hành giấy**: không có dữ liệu kiểm chứng → không
  hứa ở bất kỳ ý nào.
