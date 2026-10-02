# SPEC — `WarrantyClaim` (lần đi bảo hành) + lịch sử sửa chữa

> **Trạng thái:** ĐỀ XUẤT, chưa viết code. Tài liệu này là bước đầu của roadmap
> [#11](FEATURE_ROADMAP.md) — roadmap cố tình giới hạn mục này ở "chỉ viết spec, không viết code"
> vì nó **đổi mô hình dữ liệu** và không an toàn để build mò.
>
> **Quy ước nhãn bằng chứng** (giống `FEATURE_ROADMAP.md`):
> - `[repo]` — đã đọc code/migration trong repo này, có đường dẫn + số dòng.
> - `[ngoài]` — có nguồn bên ngoài, URL ở [§10](#10-nguồn-tham-khảo).
> - `[suy luận]` — nhận định của người viết, **không** phải dữ kiện.
> - `[chưa kiểm chứng]` — đã tìm nhưng **không** xác minh được. Không được coi là sự thật.
>
> Ngày lập: 2026-10-02 (cùng ngày với roadmap). Người viết **không** chạy build, **không** chạy
> test, **không** sửa file nào ngoài `docs/`.

---

## 1. Tóm tắt cho người bận

**Vấn đề.** App nhắc *"BH Tiêu chuẩn của «iPhone 15» sắp hết trong 30 ngày"* rồi dừng
`[repo]` (`api/internal/cron/run.go:242-250`). Đúng lúc người dùng cần **hành động** thì sản phẩm
hết đường. Không có entity nào ghi lại việc đi bảo hành.

**Bằng chứng mạnh nhất rằng đây là lỗ hổng thật, không phải suy đoán:** trang landing **đã hứa**
tính năng này từ trước khi nó tồn tại —

```
// website/src/app/page.tsx:51
desc: 'Tải ảnh hoặc PDF — tối đa 5 file mỗi thiết bị, mã hoá AES-256. Tìm lại nhanh khi cần claim.',
```

`[repo]` Từ `claim` chỉ xuất hiện đúng một lần trong toàn bộ `api/`, `website/src/`, `ios/`,
`android/` — chính là dòng copy marketing trên. **Không có entity, không có bảng, không có route.**
Copy đang nói dối người dùng.[^1]

**Ba phát hiện quyết định thiết kế** (chi tiết ở §4 và §7):

1. **Luật VN đã có quy tắc tính lại thời hạn bảo hành** — `[ngoài]` Điều 30.2.c Luật 19/2023/QH15:
   *"Thời gian thực hiện bảo hành không tính vào thời hạn bảo hành"*. App hiện **không** mô hình
   hoá điều này: cron đọc thẳng `Warranty.endDate` nên vẫn báo "sắp hết hạn" trong khi hạn thực tế
   đã được đẩy lùi. Đây là lý do kỹ thuật mạnh nhất để có `WarrantyClaim`.
2. **`status` mà roadmap đề xuất không khớp nghiệp vụ thật.** `RESOLVED`/`REJECTED` là **kết cục**,
   không phải **trạng thái**. Luật phân biệt ba kết cục hoàn toàn khác nhau: sửa xong / **đổi mới** /
   **hoàn tiền**. Đề xuất tách thành 2 trường: `status` (đang ở đâu) + `outcome` (kết thúc thế nào).
3. **`warrantyId` làm chủ sở hữu là sai** — nên là `deviceId` làm chủ, `warrantyId` cho phép NULL.
   Lý do ở [§5.1](#51-ai-là-chủ-sở-hữu--deviceid-hay-warrantyid). Đây là chỗ tôi **không** đồng ý
   với cách roadmap phát biểu.

**Khuyến nghị:** làm, nhưng **không phải bây giờ và không phải toàn bộ**. Ưu tiên #1 (seed catalog)
vẫn phải xong trước — trên DB mới không ai tạo được thiết bị nào `[repo]`
(`assertCategoryExists`, `api/internal/services/devices.go:597`; gọi tại `:360` và `:461`).
Xem [§9](#9-khuyến-nghị-triển-khai).

> ### ⚠️ Cảnh báo về số migration và số dòng — đọc trước khi implement
>
> Lúc tài liệu này được viết, `ls api/migrations/` cho thấy `0006_device_resale.sql` và
> `0007_locale_safe_unaccent.sql` **đã tồn tại** (do công việc khác đang chạy song song — roadmap
> #12 và #7). Vì vậy tài liệu này đề xuất **`0008_warranty_claim.sql`**, **không** phải 0006.
> **Kiểm tra lại `ls api/migrations/` ngay trước khi tạo file** — số có thể đã tiến tiếp.
>
> Ngoài ra nhiều file được tài liệu này trích dẫn đang bị agent khác sửa
> (`api/internal/services/devices.go`, `backup.go`, `attachments.go`, `users.sql`…). **Số dòng có thể
> lệch.** Mọi trích dẫn ở đây đều kèm **tên hàm/tên query** — hãy tìm theo tên, đừng tin số dòng.
> Các số dòng đã được kiểm lại tại thời điểm viết cho: `0001_initial.sql`, `0002`, `warranties.sql`,
> `wishlist.sql`, `cron/run.go`, `files/mime.go`.

---

## 2. Hiện trạng mô hình dữ liệu — như nó **thực sự** là

Toàn bộ mục này là `[repo]`, đọc trực tiếp. Không có gì trong đây là suy đoán.

### 2.1 Số bảng — đính chính nhỏ so với roadmap

`FEATURE_ROADMAP.md:71` viết *"16 bảng trong `api/migrations/0001_initial.sql`"*.
Đếm lại: **17 bảng**.

```
$ grep -c "^CREATE TABLE" api/migrations/0001_initial.sql
17
```

`User, Session, PasswordReset, Category, Brand, BrandCategory, Store, WarrantyProvider, Device,
Warranty, Attachment, Reminder, Subscription, SubscriptionPayment, WishlistItem, WishlistPrice,
PushSubscription`. (`grep -h "^CREATE TABLE" api/migrations/*.sql | wc -l` → cũng 17: các migration
0002–0005 chỉ `ALTER TABLE`, không thêm bảng.) Kết luận của roadmap — **không bảng nào cho
claim/repair** — vẫn đúng; chỉ con số là lệch một.

### 2.2 `Warranty` — cái mà một claim sẽ bám vào

`[repo]` `api/migrations/0001_initial.sql:137-156`:

| Cột | Kiểu | Null | Ghi chú |
|---|---|---|---|
| `id` | text | NOT NULL | PK, app sinh bằng `auth.NewID()` |
| `deviceId` | text | NOT NULL | FK → `Device(id)`, `ON DELETE CASCADE` |
| `type` | text | NOT NULL | `STANDARD \| EXTENDED \| THIRD_PARTY`, validate ở app |
| `provider` | text | NULL | **tên tự do**, không FK tới `WarrantyProvider` |
| `startDate` | timestamp(3) | NOT NULL | |
| `endDate` | timestamp(3) | NOT NULL | |
| `months` | integer | NOT NULL | |
| `cost` | integer | NULL | VND |
| `address` | text | NULL | |
| `phone` | text | NULL | |
| `notes` | text | NULL | |
| `createdAt` / `updatedAt` | timestamp(3) | NOT NULL | |

Ba điểm quan trọng cho thiết kế claim:

- **`Warranty` không có `userId`.** `[repo]` Quyền sở hữu được ép bằng JOIN qua `Device`; comment ở
  `api/internal/store/queries/warranties.sql:3-5` ghi rõ điều này. **Mọi** query claim mới phải làm
  y hệt — nếu không sẽ có lỗ hổng IDOR.
- **Một thiết bị có 0..N warranty** (`MaxWarrantiesPerDevice = 5`,
  `[repo]` `api/internal/services/warranties.go:18`). "Hạn bảo hành hiệu lực" = `max(endDate)`
  `[repo]` (`website/src/lib/warranty.ts::effectiveWarrantyEnd`).
- **`provider` là text tự do.** Không có FK tới bảng `WarrantyProvider` (bảng đó tồn tại —
  `0001:101-112` — nhưng chỉ dùng làm catalog gợi ý). Nghĩa là claim **không** thể giả định có một
  "trung tâm bảo hành" có khoá ngoại.

### 2.3 `Reminder` — cái bẫy phải tránh

`[repo]` `0001_initial.sql:174-183` + `0002_cron_idempotency.sql:21-25`:

| Cột | Kiểu | Null | Nguồn |
|---|---|---|---|
| `id` | text | NOT NULL | 0001 |
| `warrantyId` | text | **NOT NULL** | 0001, FK → `Warranty(id)` CASCADE |
| `isDismissed` | boolean | NOT NULL default false | 0001 |
| `createdAt` | timestamp(3) | NOT NULL | 0001 |
| `lastNotifiedAt` | timestamp(3) | **NULL** | **0002** (thêm sau) |

`[repo]` `Reminder` **không** phải một hàng đợi thông báo. Nó là **cờ "người dùng đã ẩn thông báo
hết hạn của warranty này"**, và cờ đó đang **chặn push**:

```sql
-- api/internal/store/queries/warranties.sql:178-187 (ListWarrantiesInWindow)
  AND NOT EXISTS (
      SELECT 1 FROM "Reminder" r
      WHERE r."warrantyId" = w.id AND r."isDismissed" = true
  )
```

> **Hệ quả bảo mật/UX:** nếu ai đó thêm một hàng `Reminder` cho claim với cùng `warrantyId` và
> `isDismissed = true`, **thông báo sắp hết hạn của warranty đó sẽ im lặng vĩnh viễn**. Đây là lý do
> §7.2 khuyến nghị **không** dùng `Reminder` cho claim.

### 2.4 `Attachment` — kênh bằng chứng, và hai ràng buộc cứng

`[repo]` `0001_initial.sql:158-172`: `id`, **`deviceId` NOT NULL** (FK → `Device` CASCADE),
`fileName`, `storagePath`, `fileType`, `fileSize`, `iv bytea`, `wrappedKey bytea`, `description`,
`uploadedAt`.

Hai ràng buộc mà bất kỳ thiết kế claim nào cũng phải tôn trọng:

1. **`storagePath` được kiểm tra là phải nằm dưới thư mục của device.**
   `[repo]` `api/internal/services/backup.go:435-436`:
   ```go
   if !safeStoragePathRE.MatchString(a.StoragePath) ||
       !strings.HasPrefix(a.StoragePath, d.ID+"/") {
   ```
   `Upload` ghi blob vào `<PRIVATE_UPLOAD_ROOT>/<deviceId>/<uuid>.enc`
   `[repo]` (`attachments.go:166-171`).
2. **Hạn mức đang tính theo `Attachment` và theo device** `[repo]`
   (`api/internal/services/attachments.go:22-24`):
   `MaxAttachmentBytes = 5 MB`, `MaxAttachmentsPerDevice = 5`, `MaxUploadBytesPerUser = 100 MB`.
   `SumAttachmentBytesByUser` chỉ SUM bảng `Attachment`
   (`[repo]` gọi tại `attachments.go:147`) — **bảng mới sẽ không bị tính vào hạn mức 100 MB** trừ khi
   ta sửa. Xem rủi ro R4 ở [§8](#8-câu-hỏi-mở--rủi-ro).

**Tin tốt:** whitelist MIME **đã** cho PDF `[repo]`:

```go
// api/internal/files/mime.go:13-20
var AllowedMIMEs = map[string]struct{}{
	"image/jpeg": {}, "image/png": {}, "image/webp": {},
	"image/gif": {}, "image/heic": {}, "application/pdf": {},
}
```

⇒ Roadmap #15 lo *"kiểm tra xem whitelist magic-byte có chặn PDF không"* — **không chặn**. Bằng chứng
cho claim (hoá đơn PDF, phiếu tiếp nhận scan) upload được **ngay hôm nay**, không cần đụng `files/`.

### 2.5 Cron — bốn bucket, không có bucket nào cho claim

`[repo]` `api/internal/cron/run.go` là **cùng một logic** cho cả `api/cmd/cron` (CLI) và
`POST /api/v1/cron/warranty-check` (`[repo]` `api/cmd/cron/main.go:1-5,62`). Sáu bước:

| # | Dòng | Việc | Idempotency |
|---|---|---|---|
| 1 | `213-265` | Warranty hết hạn 7d / 30d | `StampWarrantyNotified` → `Reminder.lastNotifiedAt` |
| 2 | `267-308` | Wishlist tới `targetDate` 0/7/30d | `StampWishlistNotified` → `WishlistItem.lastNotifiedAt` |
| 3 | `310-339` | Wishlist check-in định kỳ | `StampWishlistNotified` |
| 4 | `341-390` | Subscription gia hạn 3/1/0d | `StampSubscriptionRenewalNotified` |
| 5 | `392-466` | Subscription auto-bill / expire | transaction + `AdvanceSubscriptionRenewal` |
| 6 | `468-474` | Prune session hết hạn | — |

**Mẫu chung của repo:** mọi bucket đều *query → fan-out push → stamp `lastNotifiedAt`*. Một bucket
claim phải theo đúng mẫu này ([§7.3](#73-cron-thêm-bucket-claim)). Lưu ý comment ở `run.go:124-128`:
**`TZ=Asia/Ho_Chi_Minh` phải được set khi deploy**, vì cột là `timestamp without time zone` và cron
so sánh bằng `time.Now()` local.

### 2.6 Backup — định dạng v5, và một rào cứng

`[repo]` `api/internal/services/backup.go`:

```go
type BackupExport struct {
	Version       int    `json:"version"`      // :36  — hiện là 5
	ExportedAt    string `json:"exportedAt"`
	Subscriptions []BackupSubscription `json:"subscriptions"`
	Wishlist      []BackupWishlistItem `json:"wishlist"`
	Devices       []BackupDevice       `json:"devices"`   // → warranties → reminders, attachments
}
```

và ở đầu `ImportBackup` (`:382`):

```go
if payload.Version != 5 {
	return nil, &Error{Code: "VALIDATION", Message: "Định dạng backup không được hỗ trợ"}
}
```

> **Rào cứng:** đây là so sánh **bằng**, không phải `>=`. Bump lên v6 mà không sửa dòng này ⇒ **mọi
> file backup v5 đang tồn tại của người dùng trở thành rác không import được.** Xem R1 ở §8.

Hai phát hiện phụ, đều là **lỗi đang sống**, không phải vấn đề của spec này — nhưng sẽ phải sửa
trong cùng đợt nếu đụng vào backup:

- **`BackupReminder` thiếu `lastNotifiedAt`** `[repo]` (`backup.go:136-140` chỉ có `ID`,
  `IsDismissed`, `CreatedAt`), trong khi cột đã tồn tại từ migration 0002. Export/import làm **mất
  mốc chống trùng thông báo** ⇒ sau khi restore, cron có thể push lại thông báo đã gửi.
- **Backup v5 không chứa bytes ảnh.** `[repo]` `BackupAttachment` chỉ có metadata + `iv` +
  `wrappedKey` (`backup.go:142-152`). Đây chính là roadmap #2 — claim sẽ **thừa hưởng** lỗi này:
  bằng chứng claim nằm trong backup dưới dạng metadata trỏ tới blob không tồn tại.

### 2.7 Hạn mức mỗi người dùng (đã xác minh trong Go, không chỉ trong CLAUDE.md)

| Hằng | File | Giá trị |
|---|---|---|
| `MaxDevicesPerUser` | `services/devices.go:19` | 50 |
| `MaxWarrantiesPerDevice` | `services/warranties.go:18` | 5 |
| `MaxSubscriptionsPerUser` | `services/subscriptions.go:19` | 100 |
| `MaxWishlistPerUser` | `services/wishlist.go:19` | 200 |
| `MaxAttachmentBytes` | `services/attachments.go:22` | 5 MB |
| `MaxAttachmentsPerDevice` | `services/attachments.go:23` | 5 |
| `MaxUploadBytesPerUser` | `services/attachments.go:24` | 100 MB |

---

## 3. Quy trình bảo hành ở Việt Nam — nguồn ngoài

Đây là phần **quyết định** hình dạng của entity. Chỉ ghi cái đã đọc được.

### 3.1 Khung pháp lý — **đã đọc toàn văn** `[ngoài]`

Nguồn: **Công báo Chính phủ số 865+866 ngày 30-7-2023**, bản sao Wikisource của Luật số
**19/2023/QH15**. Tôi đã fetch và đọc trực tiếp các trang 57, 58, 59 của bản Công báo.

> ⚠️ **ĐÍNH CHÍNH QUAN TRỌNG CHO ROADMAP.** `FEATURE_ROADMAP.md:330` ghi Điều 32 Luật 19/2023/QH15
> là *"Trách nhiệm bảo hành hàng hóa, linh kiện, phụ kiện"*. **Sai số điều.** Bản Công báo đã ban
> hành ghi rõ:
> - **Điều 30. Bảo hành sản phẩm, hàng hóa, linh kiện, phụ kiện** ← đây mới là điều về bảo hành
> - Điều 31. Trách nhiệm tiếp nhận và giải quyết phản ánh, yêu cầu, khiếu nại
> - **Điều 32. Trách nhiệm đối với sản phẩm, hàng hóa có khuyết tật** ← về **thu hồi hàng lỗi**, không
>   phải bảo hành
>
> Roadmap tự nhận *"chưa đọc trực tiếp nội dung"* — nên đây là lỗi số điều, không phải lỗi bịa.
> Người viết sau: **đừng** dẫn "Điều 32" cho bảo hành.

**Nội dung đã xác minh của Điều 30** (nguyên văn, trích):

- **Khoản 1 — thời hạn bảo hành do thoả thuận, không do luật ấn định:**
  *"Sản phẩm, hàng hóa, linh kiện, phụ kiện được bảo hành **theo thỏa thuận của các bên** hoặc
  bắt buộc bảo hành theo quy định của pháp luật."*
  ⇒ **Luật này KHÔNG quy định thời hạn bảo hành tối thiểu cho hàng tiêu dùng.** Điều này **nhất
  quán** với cảnh báo sẵn có của roadmap về Nghị định 55/2024/NĐ-CP. Bất kỳ ai nói "luật VN bắt buộc
  bảo hành X tháng" vẫn cần nguồn khác — **tôi cũng không tìm được nguồn đó.**
- **Khoản 2.a — chính sách bảo hành phải công bố 6 thành phần:** *"thời điểm, thời hạn áp dụng, nội
  dung, phạm vi, phương thức thực hiện bảo hành và các trường hợp loại trừ trách nhiệm bảo hành"*.
  → Đây là **danh sách trường mà UI claim nên hiển thị**, và ánh xạ gần như 1-1 vào
  `Warranty.startDate / endDate / type / provider / notes`.
- **Khoản 2.c — có `văn bản tiếp nhận bảo hành`, và đồng hồ bảo hành DỪNG:**
  *"Cung cấp cho người tiêu dùng **văn bản tiếp nhận bảo hành** hoặc hình thức tiếp nhận bảo hành
  tương đương khác, trong đó ghi rõ **thời gian thực hiện bảo hành**. **Thời gian thực hiện bảo
  hành không tính vào thời hạn bảo hành** sản phẩm, hàng hóa, linh kiện, phụ kiện."*
  → Hệ quả kỹ thuật ở [§4.3](#42-đồng-hồ-bảo-hành-dừng-điều-302c--tính-năng-ẩn-của-claim).
- **Khoản 2.c (tiếp) — linh kiện thay mới được tính lại hạn:**
  *"thay thế linh kiện, phụ kiện thì thời hạn bảo hành linh kiện, phụ kiện đó được **tính lại từ thời
  điểm thay thế**"*; đổi cả sản phẩm mới thì tính lại từ thời điểm đổi.
- **Khoản 2.d — phải cho mượn máy tương tự:** *"Cung cấp cho người tiêu dùng sản phẩm, hàng hóa,
  linh kiện, phụ kiện **tương tự để sử dụng tạm thời** hoặc có hình thức giải quyết phù hợp theo
  thỏa thuận..."*
- **Khoản 2.đ — quy tắc 3 lần, và đổi/hoàn tiền:** *"Đổi sản phẩm, hàng hóa, linh kiện, phụ kiện mới
  tương tự hoặc thu hồi ... và **trả lại tiền** cho người tiêu dùng trong trường hợp **hết thời gian
  thực hiện bảo hành mà không sửa chữa được** hoặc không khắc phục được lỗi hoặc trong trường hợp
  **đã thực hiện bảo hành ... từ 03 lần trở lên trong thời hạn bảo hành mà vẫn không khắc phục được
  lỗi**."*
  → **Điều kiện là HAI VẾ:** ≥3 lần **VÀ** vẫn chưa khắc phục được. Đừng hiển thị "đủ 3 lần là được
  đổi máy" — đó là đọc sai luật.
- **Khoản 2.e — bên bán chịu chi phí:** sửa chữa + vận chuyển **cả hai chiều** từ nơi ở/nơi sử dụng
  của người tiêu dùng đến nơi bảo hành và ngược lại.
- **Khoản 2.g — uỷ quyền không làm mất trách nhiệm:** bên bán vẫn chịu trách nhiệm *"trong trường hợp
  ủy quyền hoặc thuê tổ chức, cá nhân khác thực hiện việc bảo hành"*.
  → Đây là cơ sở pháp lý cho mô hình **trung tâm bảo hành uỷ quyền**: người dùng gặp bên thứ ba,
  nhưng bên chịu trách nhiệm là nơi bán.

**Điều 29 (liền trước) — bằng chứng giao dịch:** *"Tổ chức, cá nhân kinh doanh có trách nhiệm cung
cấp cho người tiêu dùng **hóa đơn, chứng từ, tài liệu liên quan đến giao dịch**"*, và với giao dịch
trên không gian mạng thì phải *"tạo điều kiện cho người tiêu dùng truy cập, tải, lưu trữ và in hóa
đơn"*.

> **Cẩn thận về chiều của nghĩa vụ.** Điều 29 đặt nghĩa vụ **cung cấp hoá đơn lên NGƯỜI BÁN**, không
> đặt nghĩa vụ "người mua phải xuất trình hoá đơn" lên người tiêu dùng. **Tôi không tìm được** điều
> luật nào bắt người tiêu dùng phải có hoá đơn giấy mới được bảo hành. Việc "phải có hoá đơn" là
> **thực tế vận hành của nhà bán lẻ**, không phải yêu cầu pháp lý — xem §3.2.

### 3.2 Thực tế vận hành ở nhà bán lẻ `[ngoài]`

Nguồn chính: **chính sách bảo hành FPT Shop** (đã fetch, HTTP 200). Đây là **phát ngôn của một bên
bán lẻ**, dùng làm mô tả *thực tế vận hành*, **không** phải nguồn pháp lý.

Dữ kiện dùng được:

- **Bắt đầu tính từ ngày xuất hoá đơn:** *"Chương trình bảo hành bắt đầu có hiệu lực từ thời điểm FPT
  Shop xuất hóa đơn"* → khớp với `Warranty.startDate`.
- **Thời hạn theo hãng:** *"Thời hạn bảo hành: được thể hiện trên trang thông tin chi tiết của từng
  sản phẩm hoặc theo chính sách bảo hành của Nhà sản xuất"* → xác nhận không có hạn chung.
- **Có theo dõi tiến độ bảo hành — tức là có trạng thái trung gian thật:**
  *"Theo dõi tiến độ bảo hành nhanh chóng qua kênh hotline hoặc tự tra cứu"* → trỏ tới
  `fptshop.com.vn/kiem-tra-bao-hanh?tab=thong-tin-bao-hanh`. Trang này (đã fetch) có **4 tab**:
  tra cứu *thời gian* bảo hành, tra cứu *thông tin sản phẩm đang bảo hành*, tra cứu **bảng giá sửa
  chữa**, tra cứu **trung tâm bảo hành hãng**.
  ⇒ **Trạng thái "đang gửi bảo hành" là một khái niệm có thật mà người dùng VN đã quen tra cứu.**
- **Miễn phí cả hai chiều vận chuyển** — khớp Điều 30.2.e.
- **Danh sách loại trừ (dùng làm taxonomy gợi ý, xem §5.3):**
  sửa chữa ngoài trung tâm uỷ quyền; lắp đặt/bảo trì/sử dụng sai hướng dẫn; **ngấm nước, chất lỏng,
  bụi bẩn** (áp dụng cả thiết bị IP68/IP69); biến dạng, nứt vỡ, cấn móp do nhiệt/lực; mốc, rỉ sét,
  ăn mòn hoá chất; bất khả kháng (hoả hoạn, lũ, động đất, sét, tai nạn, côn trùng); **can thiệp phần
  mềm: root, unlock bootloader, ROM không chính thức, mất IMEI**; **linh kiện hao mòn** (gờ LCD, nắp
  LCD, vỏ, khung, dây cáp, đầu nối, nắp phím).
- **Hai điều kiện tiếp nhận hay bị bỏ qua, và app nên nhắc trước:**
  *"Vui lòng **tắt tất cả các mật khẩu bảo vệ**, FPT Shop sẽ từ chối tiếp nhận bảo hành nếu thiết bị
  của bạn bị khóa"* và *"các nội dung lưu trữ trên sản phẩm của Quý khách **sẽ bị xóa và định dạng
  lại**... vui lòng tự sao lưu"*.
  ⇒ `[suy luận]` Đây là **checklist trước khi đi bảo hành** rẻ tiền và có giá trị thật — đưa vào
  `WarrantyClaim.notes` mặc định hoặc một checklist tĩnh trong UI.

### 3.3 `[chưa kiểm chứng]` — những gì tôi **không** xác minh được

Ghi rõ để người sau không tưởng là đã kiểm chứng:

1. **Thời gian xử lý thực tế.** Tôi **không tìm được** cam kết SLA bằng con số ("tối đa 7/15/30
   ngày") trên bất kỳ chính sách nhà bán lẻ nào đã fetch. Có kết quả tìm kiếm nhắc tới việc một chuỗi
   nâng "một đổi một" lên **60 ngày** (bài Tuổi Trẻ 2017) nhưng **tôi chưa fetch và đây là tin 2017**
   ⇒ **không dùng con số này**. Nguồn duy nhất về "thời gian" mà tôi đọc được là **Điều 30.2.c**, và
   nó chỉ nói văn bản tiếp nhận **phải ghi** thời gian thực hiện — **không ấn định con số**.
2. **Trạng thái cụ thể trong nhà máy.** Tôi biết *có* tra cứu tiến độ, nhưng **chưa đọc được** danh
   sách trạng thái mà FPT Shop hiển thị (trang tra cứu cần nhập IMEI/số điện thoại; không fetch được
   kết quả). Danh sách `WAITING_PARTS` ở §5.3 là `[suy luận]` từ thực tế ngành, **không** phải trích
   xuất từ hệ thống của họ.
3. **Phân bố loại trừ thực tế.** Không có số liệu về tỉ lệ claim bị từ chối, lý do phổ biến, hay
   thời gian chờ linh kiện trung bình. Mọi con số như vậy sẽ là bịa.
4. **Nghị định 55/2024/NĐ-CP.** Roadmap đã xác minh nó **không** có quy định thời hạn bảo hành. Tôi
   **không** đọc lại toàn văn và **không** phản đối kết luận đó; tôi cũng **không** dẫn nó cho bất kỳ
   khẳng định nào ở đây.
5. **Nghị định 98/2020/NĐ-CP Điều 56** (mức phạt vi phạm nghĩa vụ bảo hành) — tôi chỉ thấy nó được
   **một blog luật sư** (`luatduonggia.vn`) dẫn lại, kèm các khung phạt 5–100 triệu đồng theo giá trị
   hàng. **Chưa đọc văn bản gốc** ⇒ coi là chưa kiểm chứng; **không** dùng để tư vấn cho người dùng.
6. **Án lệ / thực thi.** Không có dữ liệu về việc Điều 30.2.c (dừng đồng hồ bảo hành) có được các
   nhà bán lẻ VN thực thi tự động hay không. Xem R2.

---

## 4. Vì sao cần `WarrantyClaim` — ba lập luận, không phải "cho đẹp"

### 4.1 Vòng lặp sản phẩm đứt đúng chỗ giá trị nhất

`[repo]` Cron bước 1 (`run.go:213-265`) push *"BH ... sắp hết trong 7/30 ngày"* với
`URL: /devices/{id}`. Người dùng bấm vào, thấy **trang chi tiết thiết bị** — nơi có card "Bảo hành"
và gallery đính kèm `[repo]` (`website/src/app/(app)/devices/[id]/page.tsx:176-233, 253-271`).
Trang đó **không có** nút nào để bắt đầu một lần bảo hành. Hành trình dừng ở đây.

`[suy luận]` Giá trị của app nằm ở **sau** thông báo: đã gửi đi chưa, trung tâm nói gì, bao lâu rồi,
có được đổi mới không, mất bao nhiêu tiền. Không có entity ⇒ không có gì để hiển thị.

### 4.2 Đồng hồ bảo hành DỪNG (Điều 30.2.c) — tính năng ẩn của claim

Đây là lập luận **kỹ thuật** mạnh nhất, và roadmap **không** hề nhắc tới.

Luật: thời gian thực hiện bảo hành **không tính vào** thời hạn bảo hành. Nghĩa là nếu máy nằm ở
trung tâm 25 ngày, hạn bảo hành **hiệu lực** phải được đẩy lùi 25 ngày.

Hiện trạng `[repo]`: **không chỗ nào trong hệ thống biết điều này.**

- `ListWarrantiesInWindow` (`warranties.sql:169-187`) lọc thẳng `w.endDate`, không cộng bù.
- `ListUpcomingReminders` (`warranties.sql:124-144`) cũng vậy.
- `effectiveWarrantyEnd()` (`website/src/lib/warranty.ts`) chỉ lấy `max(endDate)`.

⇒ **Hệ quả có thật:** người dùng gửi máy đi bảo hành 25 ngày. Máy về. App vẫn báo "sắp hết bảo hành"
theo `endDate` cũ — **sớm hơn 25 ngày so với quyền thực tế**. App đang *understate* quyền lợi của
chính người dùng nó phục vụ.

**Thiết kế:** `WarrantyClaim` lưu `handedOverAt` (hoặc `intakeAt`) và `deviceReturnedAt`. Tổng thời
gian "máy không ở nhà người dùng" cho mỗi warranty = Σ(`deviceReturnedAt − handedOverAt`) trên các
claim `đã đóng`. `effectiveWarrantyEnd` = `max(endDate) + pausedDays`.

**Cảnh báo thiết kế — đừng tự động áp dụng.** `[suy luận]` Việc nhà bán lẻ có tự động gia hạn theo
luật hay không là `[chưa kiểm chứng]` (R2). Vì vậy:
- Field này nên là **thông tin hiển thị có ghi chú**, ví dụ *"Hạn trên giấy: 12/03/2027 · Cộng bù
  25 ngày bảo hành: **06/04/2027** (theo Điều 30.2.c Luật 19/2023/QH15 — nhà bán lẻ có thể không tự
  động áp dụng, hỏi trước)"*.
- **Không** được đổi ngầm số mà cron dùng để push, nếu không người dùng sẽ bị dời ngày thông báo mà
  không hiểu tại sao. Đề xuất: cron vẫn dùng `endDate` thô ở v1; phần cộng bù chỉ là **hiển thị** ở
  v1, và chỉ trở thành hành vi push khi có cờ bật/tắt ở v2.

### 4.3 Quy tắc "3 lần" (Điều 30.2.đ) — chỉ đếm được nếu có entity

Luật cho quyền đổi mới/hoàn tiền khi đã bảo hành **≥3 lần trong thời hạn bảo hành mà vẫn không khắc
phục được lỗi**. Không có bảng claim thì **không thể** đếm, và người dùng không biết mình đang ở lần
thứ mấy. `[suy luận]` Đây là thông tin có giá trị đàm phán thật với trung tâm bảo hành, và nó rẻ:
một `COUNT(*)` trên `WarrantyClaim`.

---

## 5. Thiết kế `WarrantyClaim`

### 5.1 Ai là chủ sở hữu — `deviceId` hay `warrantyId`?

**Roadmap đề xuất `warrantyId` là chủ sở hữu** (`FEATURE_ROADMAP.md:205`: *"Thiết kế schema
`WarrantyClaim` (`warrantyId`, `openedAt`, ...)"*). **Tôi không đồng ý**, và đây là điểm khác biệt
lớn nhất của tài liệu này so với roadmap.

Bốn lý do, theo thứ tự sức nặng:

1. **Không phải mọi lần sửa chữa đều nằm trong bảo hành.** Roadmap gọi mục này là *"lần đi bảo hành
   (`WarrantyClaim`) + **lịch sử sửa chữa**"* (`:198`). Sửa ngoài hạn bảo hành là **ca phổ biến nhất**
   của đồ gia dụng (điều hoà 5 năm tuổi, tủ lạnh 8 năm). Nếu `warrantyId` là NOT NULL, app **không
   biểu diễn được** "tôi trả 500k sửa tủ lạnh ngoài bảo hành" — tức là nửa cái tên của chính mục này
   không làm được. Roadmap cũng đề xuất field `cost` — `cost` chỉ có nghĩa khi claim có thể **không
   miễn phí**, tức là có thể ngoài bảo hành.
2. **Một thiết bị có tới 5 warranty** `[repo]` (`MaxWarrantiesPerDevice = 5`), gồm `STANDARD`,
   `EXTENDED`, `THIRD_PARTY`. Khi người dùng bấm "Đi bảo hành", **họ không biết** nên chọn gói nào —
   và thường là *không quan trọng*, vì họ chỉ mang máy tới cửa hàng. Ép chọn `warrantyId` ngay từ
   `DRAFT` là bắt người dùng trả lời một câu hỏi hành chính trước khi họ có thông tin.
3. **`Warranty` không có `userId`** `[repo]` — quyền sở hữu đi qua `Device`. Nếu claim thuộc
   `Warranty`, mọi query claim phải JOIN **hai** tầng (`Claim → Warranty → Device`). Nếu claim thuộc
   `Device`, chỉ một tầng — cùng mẫu với `Attachment` (`[repo]` `attachments.sql`), giảm khả năng
   viết sai điều kiện `userId` (rủi ro IDOR).
4. **Xoá warranty không nên xoá lịch sử sửa chữa.** `Warranty` có `ON DELETE CASCADE` từ `Device`.
   Nếu claim CASCADE theo `Warranty`, người dùng sửa/xoá một gói bảo hành là **mất luôn lịch sử claim**
   — kể cả những lần sửa ngoài bảo hành không liên quan. Đó là mất dữ liệu người dùng.

**Đề xuất:**

```
WarrantyClaim.deviceId    text NOT NULL   -- FK → Device(id) ON DELETE CASCADE  ← chủ sở hữu
WarrantyClaim.warrantyId  text NULL       -- FK → Warranty(id) ON DELETE SET NULL ← "gói nào được viện dẫn"
WarrantyClaim.coverage    text NOT NULL   -- 'IN_WARRANTY' | 'OUT_OF_WARRANTY' | 'UNKNOWN'
```

- `deviceId` NOT NULL + CASCADE: xoá thiết bị thì xoá lịch sử của nó — **đúng**, vì lịch sử vô nghĩa
  khi không còn thiết bị.
- `warrantyId` NULL + `SET NULL`: xoá một gói bảo hành **không** xoá claim, chỉ mất liên kết. Người
  dùng không mất dữ liệu.
- `coverage` tách khỏi `warrantyId` vì câu hỏi "có được bảo hành không" **độc lập** với "gói nào":
  một claim `OUT_OF_WARRANTY` có `warrantyId = NULL`; một claim `IN_WARRANTY` có thể có `warrantyId`
  NULL nếu người dùng không biết gói nào (UI cho phép "không rõ").

> **Rủi ro của lựa chọn này:** `[suy luận]` nó làm query "claim của gói EXTENDED" phức tạp hơn một
> chút và làm mất tính bất biến "claim luôn thuộc đúng một gói". Tôi cho rằng đánh đổi này xứng đáng,
> nhưng đây là quyết định nên được người dùng/owner xác nhận — xem **Q1** ở §8.

### 5.2 Schema đề xuất (migration `0008_warranty_claim.sql`)

Theo đúng quy ước của `0001_initial.sql`: `text` PK do app sinh (`cuid`/`auth.NewID()`), enum là
`text` + validate ở app (**không** `CREATE TYPE`), `timestamp(3) without time zone`, tiền là
`integer` VND, có `"createdAt"` + `"updatedAt"`.

```sql
-- +goose Up
-- +goose StatementBegin

CREATE TABLE public."WarrantyClaim" (
    id                text NOT NULL,
    "deviceId"        text NOT NULL,
    "warrantyId"      text,
    coverage          text NOT NULL DEFAULT 'UNKNOWN'::text,
    status            text NOT NULL DEFAULT 'DRAFT'::text,
    outcome           text,
    title             text NOT NULL,
    issue             text,
    -- Mốc thời gian của vòng đời
    "openedAt"        timestamp(3) without time zone NOT NULL,
    "submittedAt"     timestamp(3) without time zone,
    "deviceReturnedAt" timestamp(3) without time zone,
    "closedAt"        timestamp(3) without time zone,
    -- Tiếp nhận: khớp Điều 30.2.c (văn bản tiếp nhận ghi rõ thời gian thực hiện)
    "ticketNumber"    text,
    "promisedAt"      timestamp(3) without time zone,
    "serviceCenter"   text,
    "servicePhone"    text,
    "serviceAddress"  text,
    -- Kết quả
    "cost"            integer,           -- VND, 0 = miễn phí trong bảo hành
    "rejectionReason" text,
    "loanerDevice"    text,              -- Điều 30.2.d: máy tạm
    notes             text,
    "lastNotifiedAt"  timestamp(3) without time zone,
    "createdAt"       timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt"       timestamp(3) without time zone NOT NULL,
    CONSTRAINT "WarrantyClaim_pkey" PRIMARY KEY (id),
    CONSTRAINT "WarrantyClaim_deviceId_fkey"
        FOREIGN KEY ("deviceId") REFERENCES public."Device"(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT "WarrantyClaim_warrantyId_fkey"
        FOREIGN KEY ("warrantyId") REFERENCES public."Warranty"(id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    -- Bất biến trạng thái/kết cục: CLOSED thì PHẢI có outcome; chưa CLOSED thì KHÔNG có.
    CONSTRAINT "WarrantyClaim_outcome_closed_chk"
        CHECK ( (status = 'CLOSED') = (outcome IS NOT NULL) )
);

CREATE INDEX "WarrantyClaim_deviceId_idx"     ON public."WarrantyClaim" USING btree ("deviceId");
CREATE INDEX "WarrantyClaim_warrantyId_idx"   ON public."WarrantyClaim" USING btree ("warrantyId");
CREATE INDEX "WarrantyClaim_status_idx"       ON public."WarrantyClaim" USING btree (status);
CREATE INDEX "WarrantyClaim_openedAt_idx"     ON public."WarrantyClaim" USING btree ("openedAt");
CREATE INDEX "WarrantyClaim_promisedAt_idx"   ON public."WarrantyClaim" USING btree ("promisedAt");

-- Bằng chứng: BẢNG RIÊNG, không ALTER "Attachment" (xem §6.2)
CREATE TABLE public."ClaimAttachment" (
    id           text NOT NULL,
    "claimId"    text NOT NULL,
    "fileName"   text NOT NULL,
    "storagePath" text NOT NULL,
    "fileType"   text NOT NULL,
    "fileSize"   integer NOT NULL,
    iv           bytea NOT NULL,
    "wrappedKey" bytea NOT NULL,
    description  text,
    "uploadedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "ClaimAttachment_pkey" PRIMARY KEY (id),
    CONSTRAINT "ClaimAttachment_claimId_fkey"
        FOREIGN KEY ("claimId") REFERENCES public."WarrantyClaim"(id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX "ClaimAttachment_claimId_idx" ON public."ClaimAttachment" USING btree ("claimId");

-- +goose StatementEnd
```

`storagePath` của `ClaimAttachment` theo quy ước
`<deviceId>/claims/<claimId>/<uuid>.enc` — **vẫn nằm dưới thư mục device**, để giữ tương thích với
validator prefix ở `backup.go:435-436` và để `DeleteEncrypted` dọn được theo cây thư mục.

### 5.3 Vòng đời trạng thái — **áp lực thử** đề xuất của roadmap

Roadmap đề xuất `status ∈ {DRAFT, SENT, IN_REPAIR, RESOLVED, REJECTED}` (`:205`). Đánh giá từng giá
trị dựa trên §3:

| Roadmap | Giữ? | Vấn đề |
|---|---|---|
| `DRAFT` | ✅ giữ | Hợp lý: giai đoạn gom hoá đơn/IMEI **trước khi** ra trung tâm. Có giá trị vì luật đặt gánh nặng giấy tờ lên người bán (Điều 29), nhưng thực tế người mua vẫn phải trao đổi. |
| `SENT` | ⚠️ **đổi tên** | Mơ hồ: "tôi đã gửi" vs "họ đã nhận". Mốc pháp lý là **văn bản tiếp nhận** (Điều 30.2.c). Đổi thành `SUBMITTED` + có `submittedAt` + `ticketNumber`. |
| `IN_REPAIR` | ⚠️ **thiếu nhánh** | Thiếu trạng thái **chờ linh kiện** — đây là nguyên nhân trễ hạn phổ biến nhất ngoài thực tế. `[suy luận]` (chưa kiểm chứng được, xem §3.3 mục 2.) |
| `RESOLVED` | ❌ **quá hẹp** | Luật phân biệt **ba** kết cục: sửa xong / **đổi mới** / **hoàn tiền** (Điều 30.2.đ). Gộp vào một `RESOLVED` là **mất thông tin mà luật coi là quan trọng**. Hơn nữa đây là *kết cục*, không phải *trạng thái*. |
| `REJECTED` | ❌ **sai loại** | Bị từ chối **lúc tiếp nhận** (máy còn khoá mật khẩu, đã root — theo chính sách FPT Shop §3.2) khác hoàn toàn với bị từ chối **sau khi kiểm tra** (không thuộc phạm vi). Cả hai là **kết cục**, không phải vị trí trong pipeline. |

**Đề xuất: tách hai trường.** Lý do: một trường không biểu diễn nổi không gian 2 chiều
(pipeline × kết cục), và mọi nỗ lực nhồi sẽ sinh ra tổ hợp giả như `RESOLVED_REPLACED`.

```ts
// Trạng thái = đang ở đâu trong pipeline. Chỉ một trong số này đúng tại một thời điểm.
type ClaimStatus =
  | 'DRAFT'          // đang chuẩn bị: gom hoá đơn, IMEI, sao lưu máy
  | 'SUBMITTED'      // đã giao máy / đã tạo yêu cầu, chưa có kết luận
  | 'IN_REPAIR'      // trung tâm đang xử lý
  | 'WAITING_PARTS'  // đang chờ linh kiện  ← thêm mới; đây là chỗ trễ hạn thật
  | 'CLOSED'         // đã kết thúc (bắt buộc có outcome)
  | 'CANCELLED';     // người dùng rút / tự xử lý / mua máy khác
                     //   (CANCELLED KHÔNG cần outcome — không phải kết cục của trung tâm)

// Kết cục = kết thúc thế nào. CHỈ có giá trị khi status = 'CLOSED'.
type ClaimOutcome =
  | 'REPAIRED'    // sửa xong
  | 'REPLACED'    // đổi sản phẩm mới  (Điều 30.2.đ)
  | 'REFUNDED'    // hoàn tiền         (Điều 30.2.đ)
  | 'REJECTED'    // không thuộc phạm vi bảo hành (kể cả từ chối lúc tiếp nhận)
  | 'UNREPAIRED'; // hết thời gian xử lý mà không khắc phục được (Điều 30.2.đ, vế 1)
```

**Vì sao `CANCELLED` không cần `outcome`:** nó không phải kết cục của trung tâm bảo hành, mà là
người dùng dừng theo đuổi. Nếu gộp, ta sẽ phải thêm `outcome = 'CANCELLED'` — phá vỡ ngữ nghĩa
"outcome là do bên bán quyết định", và làm hỏng phép đếm "3 lần bảo hành" ở §4.3 (một claim tự huỷ
**không** được tính là một lần bảo hành).

**Vì sao `deviceReturnedAt` là timestamp chứ không phải status:** "máy đã về tay tôi chưa" là câu hỏi
**trực giao** với pipeline (máy có thể đã về nhưng claim chưa đóng, hoặc claim đã đóng vì bị từ chối
mà máy đã về từ lúc tiếp nhận). Và ta **cần ngày** để tính phần cộng bù đồng hồ bảo hành (§4.2) —
status không mang được ngày.

**Chuyển trạng thái hợp lệ** (validate ở `api/internal/services/claims.go`):

```
DRAFT ──► SUBMITTED ──► IN_REPAIR ⇄ WAITING_PARTS
  │            │            │           │
  │            │            └─────┬─────┘
  │            │                  ▼
  └────────────┴──────────────► CLOSED (+ outcome)
  │            │
  └────────────┴──────────────► CANCELLED (không outcome)
```

Không cho nhảy cóc `DRAFT → CLOSED`? **Nên cho phép** — người dùng ghi lại một lần bảo hành đã xong
từ tháng trước. Đây là lý do `handedOverAt`/`openedAt` là **người dùng nhập**, không phải `NOW()`.

### 5.4 Taxonomy lý do từ chối

Từ danh sách loại trừ đã fetch (§3.2), `[suy luận]` về việc gom nhóm — **không** phải trích xuất từ
hệ thống của nhà bán lẻ:

```
'WATER_DAMAGE'      // ngấm nước / chất lỏng / bụi
'PHYSICAL_DAMAGE'   // biến dạng, nứt vỡ, cấn móp
'UNAUTHORIZED_REPAIR' // sửa ngoài trung tâm uỷ quyền
'SOFTWARE_TAMPERING'  // root, unlock bootloader, ROM, mất IMEI
'IMPROPER_USE'      // lắp đặt / bảo trì / sử dụng sai hướng dẫn
'CORROSION'         // mốc, rỉ sét, ăn mòn hoá chất
'FORCE_MAJEURE'     // hoả hoạn, lũ, sét, tai nạn, côn trùng
'WEAR_PART'         // linh kiện hao mòn
'EXPIRED'           // hết hạn bảo hành
'NO_RECEIPT'        // không chứng minh được thời điểm mua
'OTHER'
```

`NO_RECEIPT` cần một lưu ý honest: **không có căn cứ pháp lý** bắt người tiêu dùng phải có hoá đơn
(§3.1, Điều 29 đặt nghĩa vụ lên **người bán**). `[suy luận]` Nhưng nó là lý do từ chối có thật ngoài
thực tế. ⇒ UI nên hiển thị nhãn trung tính, ví dụ *"Không chứng minh được thời điểm mua"*, và **không**
hiển thị "bạn phải có hoá đơn" như thể đó là luật.

---

## 6. Tương tác với máy móc đang có

### 6.1 `Reminder` + cron fan-out — **đừng dùng `Reminder`**

**Khuyến nghị: `WarrantyClaim` KHÔNG tạo hàng `Reminder`.** Thay vào đó mang cặp cột
`lastNotifiedAt` của riêng nó.

Lý do (đã kiểm chứng ở §2.3): `Reminder.isDismissed = true` cho một `warrantyId` sẽ **chặn push hết
hạn bảo hành** của warranty đó (`warranties.sql:178-187`). Nếu ta nhồi claim vào `Reminder`:

- Cron stamp claim → upsert `Reminder` theo `warrantyId` → có thể **tạo** hàng `isDismissed = false`
  cho warranty → vô hại.
- Nhưng người dùng ẩn thông báo claim → `isDismissed = true` → **im lặng vĩnh viễn** thông báo hết
  hạn bảo hành. Đây là bug im lặng, khó tìm, và **phá tính năng lõi**.

Thêm nữa, `StampWarrantyNotified` (`warranties.sql:196-204`) là một upsert **theo `warrantyId`**, không
có chỗ cho discriminator. Nhồi claim vào sẽ phải viết lại query đó — tức là đụng vào đường ống đang
chạy tốt, đúng thứ roadmap cảnh báo ở #13.

**Mẫu đúng đã có sẵn trong repo:** `WishlistItem.reminderIntervalDays` + `lastNotifiedAt` +
`ListWishlistDueForCheckin` (`[repo]` `api/internal/store/queries/wishlist.sql:145-161`). Đây là
**tiền lệ nội bộ** cho việc "nhắc định kỳ thì để cột trên bảng chủ thể, không nhét vào `Reminder`".
Đây cũng là lập luận trung tâm của `docs/SPEC-MAINTENANCE-SCHEDULES.md`.

### 6.2 Kênh đính kèm mã hoá — bảng riêng, không `ALTER`

Ba phương án:

| | Cách làm | Đánh giá |
|---|---|---|
| A | `ALTER "Attachment" ADD "claimId" text NULL` + CHECK đúng một trong hai chủ | ❌ **Rủi ro cao.** Đụng bảng đang chạy; `Upload` phải sửa; `ListAttachmentsByDevice`/`CountAttachmentsByDevice`/`SumAttachmentBytesByUser` đều phải rà lại; backup validator prefix phải sửa; và **`deviceId NOT NULL`** hiện tại phải nới thành nullable ⇒ mất ràng buộc. |
| B | **Bảng `ClaimAttachment` riêng**, tái dùng `api/internal/files/` | ✅ **Khuyến nghị.** Không đụng bảng nào đang có. `Attachment` giữ nguyên `deviceId NOT NULL`. |
| C | Giữ attachment ở mức device, thêm bảng nối `ClaimAttachmentLink` | ⚠️ Phức tạp hơn B mà không giải quyết gì thêm, vì một file vẫn chỉ thuộc một claim. |

**Chọn B.** Tái dùng nguyên pipeline đang có, **không** viết lại crypto:

- `files.DetectAndValidate` — whitelist đã gồm PDF `[repo]` (`mime.go:13-20`).
- `files.MaybeResize` — chỉ ảnh; PDF đi thẳng.
- `files.Encrypt` / `files.WriteEncrypted` / `files.ReadEncrypted` / `files.DeleteEncrypted`.
- `files.SafeSegment` để chặn path traversal.

**Bốn việc bắt buộc phải làm cùng lúc** (nếu không sẽ tạo lỗ hổng/hạn mức hở):

1. **Hạn mức dung lượng.** `SumAttachmentBytesByUser` chỉ SUM bảng `Attachment`
   `[repo]` (`attachments.go:147`). Phải sửa thành tổng của **cả hai** bảng, nếu không người dùng
   upload được 100 MB claim + 100 MB device = **gấp đôi hạn mức**. → R4.
2. **Hạn mức số file.** Thêm `MaxClaimAttachments = 10` (claim cần nhiều ảnh hơn: hoá đơn, phiếu tiếp
   nhận, ảnh lỗi, ảnh máy sau khi sửa). **Lý do cần thiết:** `MaxAttachmentsPerDevice = 5`
   `[repo]` (`attachments.go:23`) — một thiết bị đã có thể dùng hết 5 slot cho phiếu bảo hành + hoá
   đơn, **không còn slot nào cho bằng chứng claim**.
3. **Ownership hai tầng.** `GetAttachmentForUser` kiểm tra qua device
   `[repo]` (`attachments.go:75-88`). Claim phải kiểm tra `ClaimAttachment → WarrantyClaim →
   Device.userId`. Viết một query mới, **đừng** tái dùng query cũ.
4. **Xoá.** `ON DELETE CASCADE` lo hàng DB; blob phải xoá tường minh như `Delete`
   `[repo]` (`attachments.go:194-211`) — theo `storagePath` đọc được từ hàng **trước khi** xoá.

### 6.3 Backup export/import

`[repo]` Rào cứng: `payload.Version != 5` → từ chối (`backup.go:382`). Bắt buộc:

1. **Bump `Version` lên 6** (`backup.go:226`) **VÀ** nới điều kiện import thành tập chấp nhận được:
   ```go
   // PHẢI sửa, nếu không mọi file v5 hiện có thành rác.
   if payload.Version != 5 && payload.Version != 6 {
   ```
   ⇒ **R1.**
2. **Thêm `Claims []BackupWarrantyClaim` vào `BackupWarranty`** (`backup.go:120-134`), **không** vào
   `BackupDevice`. Lý do: về mặt dữ liệu claim thuộc device, nhưng về mặt **đọc file backup** thì
   "lần bảo hành của gói bảo hành nào" là ngữ cảnh người dùng cần; và `warrantyId` nullable vẫn biểu
   diễn được bằng `null` trong JSON.
   ```go
   type BackupWarrantyClaim struct {
       ID             string  `json:"id"`
       DeviceID       string  `json:"deviceId"`    // để re-link khi warrantyId = null
       WarrantyID     *string `json:"warrantyId"`
       Coverage       string  `json:"coverage"`
       Status         string  `json:"status"`
       Outcome        *string `json:"outcome"`
       Title          string  `json:"title"`
       Issue          *string `json:"issue"`
       OpenedAt       string  `json:"openedAt"`
       SubmittedAt    *string `json:"submittedAt"`
       DeviceReturnedAt *string `json:"deviceReturnedAt"`
       ClosedAt       *string `json:"closedAt"`
       TicketNumber   *string `json:"ticketNumber"`
       PromisedAt     *string `json:"promisedAt"`
       ServiceCenter  *string `json:"serviceCenter"`
       ServicePhone   *string `json:"servicePhone"`
       ServiceAddress *string `json:"serviceAddress"`
       Cost           *int32  `json:"cost"`
       RejectionReason *string `json:"rejectionReason"`
       LoanerDevice   *string `json:"loanerDevice"`
       Notes          *string `json:"notes"`
       CreatedAt      string  `json:"createdAt"`
       UpdatedAt      string  `json:"updatedAt"`
       Attachments    []BackupClaimAttachment `json:"attachments"`
   }
   ```
3. **Thứ tự xoá trong `ImportReplace`** (`backup.go:425-448`) — hiện đang xoá attachment → reminder →
   warranty → … Phải chèn `ClaimAttachment` **và** `WarrantyClaim` **trước** `BackupDeleteWarrantiesForUser`,
   nếu không FK sẽ chặn (claim trỏ warranty) hoặc xoá mồ côi.
4. **Validate `storagePath` của claim attachment** theo cùng mẫu prefix `d.ID + "/"`
   (`backup.go:435-436`) — vì đường dẫn vẫn nằm dưới thư mục device (§5.2).
5. **Sửa luôn `BackupReminder` thiếu `lastNotifiedAt`** (§2.6) trong cùng đợt — nó là bug đang sống và
   ta đã phải bump version rồi.

> ⚠️ **Không giải quyết ở spec này:** backup **vẫn không chứa bytes ảnh** (roadmap #2). Bằng chứng
> claim sẽ vào backup dưới dạng metadata + `iv` + `wrappedKey`, và **restore sang máy mới vẫn mất
> ảnh**. Spec này **không** được hứa nhiều hơn thế.

### 6.4 Hạn mức mỗi người dùng

| Hằng mới | Đề xuất | Vì sao con số này |
|---|---|---|
| `MaxClaimsPerDevice` | 20 | `[suy luận]` Một thiết bị sống 5–10 năm có thể có vài lần sửa. 20 là dư, và chặn được lạm dụng. |
| `MaxClaimAttachments` | 10 | Nhiều hơn device (5) vì claim cần bằng chứng đa dạng. |
| `MaxAttachmentBytes` | 5 MB | **Giữ nguyên** — dùng chung pipeline. |
| `MaxUploadBytesPerUser` | 100 MB | **Giữ nguyên giá trị**, nhưng phải SUM cả hai bảng (§6.2 việc 1). |

`[suy luận]` **Không** thêm `MaxClaimsPerUser`. `MaxDevicesPerUser = 50` × 20 = 1000 claim tối đa,
và mỗi claim ~200 byte → không đáng thêm một hằng số. Nếu owner muốn chặt hơn, 200 là hợp lý.

---

## 7. API surface đề xuất

### 7.1 `openapi.yaml` — path mới

Chèn sau `/api/v1/warranties/{id}/reminder` (hiện ở dòng 400), theo đúng style file (tags, bearer auth,
`$ref` tới components):

```yaml
  /api/v1/devices/{id}/claims:
    get:
      tags: [claims]
      summary: Danh sách lần bảo hành / sửa chữa của một thiết bị
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
        - name: includeClosed
          in: query
          schema: { type: boolean, default: true }
          description: false ⇒ chỉ trả claim chưa CLOSED/CANCELLED
      responses:
        '200':
          description: Danh sách claim, mới nhất trước
          content:
            application/json:
              schema:
                type: object
                required: [claims]
                properties:
                  claims:
                    type: array
                    items: { $ref: '#/components/schemas/WarrantyClaim' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
    post:
      tags: [claims]
      summary: Tạo một lần bảo hành / sửa chữa
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/WarrantyClaimInput' }
      responses:
        '201':
          description: Đã tạo
          content:
            application/json:
              schema: { $ref: '#/components/schemas/WarrantyClaim' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }   # vượt MaxClaimsPerDevice

  /api/v1/claims/{id}:
    get:
      tags: [claims]
      summary: Chi tiết một lần bảo hành
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/WarrantyClaimDetail' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
    patch:
      tags: [claims]
      summary: Cập nhật (bao gồm chuyển trạng thái)
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/WarrantyClaimUpdate' }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/WarrantyClaim' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
    delete:
      tags: [claims]
      summary: Xoá một lần bảo hành (xoá luôn bằng chứng)
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '204': { description: Đã xoá }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }

  /api/v1/claims/{id}/attachments:
    get:
      tags: [claims]
      summary: Bằng chứng của một lần bảo hành (metadata)
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [attachments]
                properties:
                  attachments:
                    type: array
                    items: { $ref: '#/components/schemas/AttachmentMeta' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
    post:
      tags: [claims]
      summary: Tải bằng chứng lên (multipart/form-data)
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file: { type: string, format: binary }
                description: { type: string, nullable: true }
      responses:
        '201':
          description: Đã tải lên
          content:
            application/json:
              schema: { $ref: '#/components/schemas/AttachmentMeta' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
        '409': { $ref: '#/components/responses/Conflict' }

  /api/v1/claim-attachments/{id}:
    delete:
      tags: [claims]
      summary: Xoá một bằng chứng
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '204': { description: Đã xoá }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
```

**Tái dùng, không tạo mới:** `GET /api/files/{id}`. Stream blob đã giải mã, đã auth + kiểm tra sở hữu
`[repo]` (`api/internal/files/`, proxy web ở `website/src/app/api/files/[id]/route.ts`). Query
ownership bên trong phải được mở rộng để nhận **cả** attachment của device **và** claim — nếu không,
bằng chứng claim tải lên được mà **không xem lại được**. Đây là chi tiết dễ bỏ sót nhất.

### 7.2 `openapi.yaml` — schema mới

```yaml
    ClaimStatus:
      type: string
      enum: [DRAFT, SUBMITTED, IN_REPAIR, WAITING_PARTS, CLOSED, CANCELLED]

    ClaimOutcome:
      type: string
      enum: [REPAIRED, REPLACED, REFUNDED, REJECTED, UNREPAIRED]
      description: |
        Chỉ có giá trị khi status = CLOSED. REPLACED/REFUNDED/UNREPAIRED phản chiếu
        Điều 30.2.đ Luật 19/2023/QH15.

    ClaimCoverage:
      type: string
      enum: [IN_WARRANTY, OUT_OF_WARRANTY, UNKNOWN]

    ClaimRejectionReason:
      type: string
      enum: [WATER_DAMAGE, PHYSICAL_DAMAGE, UNAUTHORIZED_REPAIR, SOFTWARE_TAMPERING,
             IMPROPER_USE, CORROSION, FORCE_MAJEURE, WEAR_PART, EXPIRED, NO_RECEIPT, OTHER]

    WarrantyClaim:
      type: object
      required: [id, deviceId, coverage, status, title, openedAt, createdAt, updatedAt]
      properties:
        id: { type: string }
        deviceId: { type: string }
        warrantyId: { type: string, nullable: true }
        coverage: { $ref: '#/components/schemas/ClaimCoverage' }
        status: { $ref: '#/components/schemas/ClaimStatus' }
        outcome: { allOf: [{ $ref: '#/components/schemas/ClaimOutcome' }], nullable: true }
        title: { type: string, description: 'vd: "Màn hình bị sọc"' }
        issue: { type: string, nullable: true }
        openedAt: { type: string, format: date-time }
        submittedAt: { type: string, format: date-time, nullable: true }
        deviceReturnedAt: { type: string, format: date-time, nullable: true }
        closedAt: { type: string, format: date-time, nullable: true }
        ticketNumber: { type: string, nullable: true, description: 'Số phiếu tiếp nhận' }
        promisedAt:
          type: string
          format: date-time
          nullable: true
          description: 'Thời gian thực hiện bảo hành ghi trên văn bản tiếp nhận (Điều 30.2.c)'
        serviceCenter: { type: string, nullable: true }
        servicePhone: { type: string, nullable: true }
        serviceAddress: { type: string, nullable: true }
        cost: { type: integer, nullable: true, description: 'VND; 0 = miễn phí' }
        rejectionReason:
          allOf: [{ $ref: '#/components/schemas/ClaimRejectionReason' }]
          nullable: true
        loanerDevice: { type: string, nullable: true, description: 'Máy cho mượn (Điều 30.2.d)' }
        notes: { type: string, nullable: true }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }

    WarrantyClaimInput:
      type: object
      required: [title, openedAt]
      properties:
        title: { type: string, minLength: 1, maxLength: 200 }
        issue: { type: string, nullable: true, maxLength: 4000 }
        warrantyId: { type: string, nullable: true }
        coverage: { $ref: '#/components/schemas/ClaimCoverage' }
        openedAt: { type: string }
        ticketNumber: { type: string, nullable: true }
        promisedAt: { type: string, nullable: true }
        serviceCenter: { type: string, nullable: true }
        servicePhone: { type: string, nullable: true }
        serviceAddress: { type: string, nullable: true }
        cost: { type: integer, nullable: true }
        loanerDevice: { type: string, nullable: true }
        notes: { type: string, nullable: true }

    WarrantyClaimUpdate:
      type: object
      description: 'Tất cả field tuỳ chọn; gửi field nào sửa field đó.'
      properties:
        title: { type: string, minLength: 1, maxLength: 200 }
        issue: { type: string, nullable: true }
        status: { $ref: '#/components/schemas/ClaimStatus' }
        outcome: { allOf: [{ $ref: '#/components/schemas/ClaimOutcome' }], nullable: true }
        rejectionReason:
          allOf: [{ $ref: '#/components/schemas/ClaimRejectionReason' }]
          nullable: true
        warrantyId: { type: string, nullable: true }
        coverage: { $ref: '#/components/schemas/ClaimCoverage' }
        submittedAt: { type: string, nullable: true }
        deviceReturnedAt: { type: string, nullable: true }
        closedAt: { type: string, nullable: true }
        ticketNumber: { type: string, nullable: true }
        promisedAt: { type: string, nullable: true }
        serviceCenter: { type: string, nullable: true }
        servicePhone: { type: string, nullable: true }
        serviceAddress: { type: string, nullable: true }
        cost: { type: integer, nullable: true }
        loanerDevice: { type: string, nullable: true }
        notes: { type: string, nullable: true }

    WarrantyClaimDetail:
      allOf:
        - $ref: '#/components/schemas/WarrantyClaim'
        - type: object
          required: [attachments, device]
          properties:
            attachments:
              type: array
              items: { $ref: '#/components/schemas/AttachmentMeta' }
            device:
              type: object
              required: [id, name, category]
              properties:
                id: { type: string }
                name: { type: string }
                category: { type: string }
            # Số lần đã bảo hành trong hạn — phục vụ quy tắc 3 lần (Điều 30.2.đ)
            warrantyRepairCount:
              type: integer
              description: 'Số claim IN_WARRANTY đã CLOSED với outcome != REJECTED'
```

Bổ sung vào `Warranty` (đã có ở `:1291-1316`) một field **dẫn xuất, chỉ đọc**:

```yaml
        # trong components.schemas.Warranty
        pausedDays:
          type: integer
          description: |
            Tổng số ngày thiết bị nằm ngoài tay người dùng vì bảo hành.
            Điều 30.2.c Luật 19/2023/QH15: thời gian này không tính vào thời hạn bảo hành.
            CHỈ là thông tin hiển thị — không đổi hành vi push ở v1.
        effectiveEndDate:
          type: string
          format: date-time
          description: 'endDate + pausedDays. Hiển thị kèm ghi chú, không thay endDate.'
```

### 7.3 Cron: thêm bucket claim

Thêm **bước 5.5** (giữa subscription và prune), theo đúng mẫu `query → dispatch → stamp`:

**(a) Quá hạn tiếp nhận** — claim `submittedAt`/`promisedAt` đã qua mà chưa `CLOSED`:

```sql
-- name: ListClaimsPastPromisedDate :many
SELECT c.*, d."userId" AS user_id, d.name AS device_name
FROM "WarrantyClaim" c
JOIN "Device" d ON d.id = c."deviceId"
WHERE c.status IN ('SUBMITTED', 'IN_REPAIR', 'WAITING_PARTS')
  AND c."promisedAt" IS NOT NULL
  AND c."promisedAt" < $1                      -- hôm nay
  AND (c."lastNotifiedAt" IS NULL
       OR c."lastNotifiedAt"::date < CURRENT_DATE)
```

Nội dung push `[suy luận]` (giữ giọng văn hiện có của `run.go`):

```
Title: ⏰ Quá hạn bảo hành: "{device_name}"
Body:  "Hẹn trả {promisedAt} — đã quá {n} ngày. Gọi {servicePhone}?"
URL:   /devices/{deviceId}/claims/{claimId}
Tag:   "claim-late-{claimId}"
```

**(b) Claim `DRAFT` bị bỏ quên** — tạo `DRAFT` > 14 ngày mà chưa gửi. `[suy luận]` Rẻ và hữu ích
("bạn định đi bảo hành cái này mà chưa đi"). Cùng cơ chế `lastNotifiedAt`.

**(c) Nhắc trước khi hết hạn bảo hành — có ngữ cảnh claim.** Sửa payload ở bước 1 để, nếu warranty có
claim đang mở, đổi câu thành *"Đang bảo hành — nhớ tính thời gian được gia hạn"*. **Không** đổi logic
chọn bucket ở v1 (§4.2).

**Idempotency:** stamp `WarrantyClaim.lastNotifiedAt = NOW()` sau fan-out, **y hệt**
`StampWishlistNotified` `[repo]` (`wishlist.sql:157-161`). Điều kiện `::date < CURRENT_DATE` mirror
`ListWarrantiesInWindow` (`warranties.sql:182-187`).

**Thêm vào `cron.Stats`** (`run.go:36-46`): `ClaimLateNotices`, `ClaimDraftNotices`. Và vào log ở
`api/cmd/cron/main.go:66-91` — cả nhánh lỗi lẫn nhánh thành công.

**Chi phí ước lượng:** ~120 dòng Go + 2 query SQL + 2 field Stat + 2 dòng log. Không đụng logic cũ.

### 7.4 Ba client cần gì

Quy ước `CLAUDE.md`: *"Khi thêm tính năng: cập nhật `openapi.yaml` + implement trong `api/` trước, rồi
nối action Next.js (proxy) và client iOS/Android."* Nhãn tiếng Việt phải được **nhân bản** ở 3 nơi
(`website/src/lib/types.ts`, `ios/.../Models.swift`, `android/.../network/Models.kt`).

**Web (`website/`)** — effort lớn nhất:
- `src/lib/types.ts`: `CLAIM_STATUS_LABELS`, `CLAIM_OUTCOME_LABELS`, `CLAIM_COVERAGE_LABELS`,
  `CLAIM_REJECTION_LABELS` (nhãn tiếng Việt, theo mẫu `STATUS_LABELS`/`WARRANTY_TYPE_LABELS`).
- `src/lib/api/claims.ts` — client typed, theo mẫu `src/lib/api/*`.
- `src/app/actions/claims.ts` — `'use server'`, parse `FormData` thủ công bằng helper `str()`/`num()`
  như `devices.ts` (**không** dùng Zod — chỉ luồng auth mới dùng), forward sang Go, map qua
  `toFormState()`.
- `src/app/(app)/devices/[id]/page.tsx` — thêm card **"Lịch sử bảo hành / sửa chữa"** cạnh card
  "Bảo hành" hiện có (`:176-233`). Nút "Đi bảo hành" ở đây là **điểm vào chính**.
- `src/app/(app)/devices/[id]/claims/[claimId]/page.tsx` — trang chi tiết: timeline trạng thái,
  form tiếp nhận, gallery bằng chứng (tái dùng `components/attachment-gallery.tsx` — nhưng component
  này đang gắn với device; cần generic hoá hoặc nhân bản).
- `src/app/(app)/claims/page.tsx` — **tuỳ chọn.** Danh sách claim đang mở. `[suy luận]` Nên có, vì
  đây là thứ trả lời "máy tôi đang ở đâu".
- Sửa copy ở `src/app/page.tsx:51` — bỏ chữ `claim` hoặc chỉnh lại cho khớp sự thật sau khi ship.

**iOS (`ios/`)**:
- `Sources/WarrantyVaultKit/Models.swift` — `WarrantyClaim`, các enum, **và nhãn tiếng Việt** (file này
  đang nhân bản nhãn từ web).
- `Sources/WarrantyVaultKit/Endpoints.swift` — 5 endpoint mới.
- `Sources/WarrantyVaultKit/APIClient.swift` — method tương ứng.
- View mới: danh sách + chi tiết claim, dưới `App/Features/`.

**Android (`android/`)**:
- `app/src/main/java/com/warrantyvault/app/network/Models.kt` — DTO + nhãn (đang ở `:118` cho
  `Reminder`).
- `ApiService` (Retrofit) — 5 endpoint.
- `ui/screens/claims/ClaimsScreen.kt` + `ClaimsViewModel.kt` + test — port theo mẫu đã có ở
  `ui/screens/reminders/` (`RemindersScreen.kt`, `RemindersViewModel`) và
  `PushDevicesViewModelTest.kt`.

`[suy luận]` **Thứ tự ship nên là: Go → openapi → web → Android → iOS.** Lý do: web là nơi người dùng
tạo claim (nhập liệu dài cần bàn phím), hai client native chủ yếu để **xem** trạng thái. Roadmap
#4/#5 cho thấy chi phí parity 3 client là có thật.

---

## 8. Câu hỏi mở & rủi ro

### Câu hỏi mở

**Q1 — `deviceId` hay `warrantyId` làm chủ? (quan trọng nhất)** Tôi đề xuất `deviceId` (§5.1), ngược
với roadmap. Cần owner xác nhận. Nếu chọn `deviceId`, "lịch sử sửa chữa ngoài bảo hành" hoạt động;
nếu chọn `warrantyId`, một nửa tên của mục #11 không làm được. **Đây là quyết định chặn migration.**

**Q2 — Có đưa `pausedDays` vào hành vi push không?** Đề xuất v1 **không** (§4.2): chỉ hiển thị. Nhưng
nếu hiển thị "hạn thực tế muộn hơn 25 ngày" mà push vẫn báo theo hạn cũ, người dùng sẽ thấy **mâu
thuẫn trong chính sản phẩm**. Hai lựa chọn: (a) ẩn luôn `pausedDays` ở v1, hoặc (b) hiển thị kèm
ghi chú rõ. Tôi nghiêng về (b) nhưng đây là quyết định UX, không phải kỹ thuật.

**Q3 — Claim có cần `DRAFT` không?** `[suy luận]` Có, nhưng nó thêm một trạng thái cho cả 3 client.
Phương án rẻ hơn: bỏ `DRAFT`, cho `openedAt` là quá khứ. Đánh đổi: mất chỗ để nhắc "bạn định đi bảo
hành mà chưa đi" (§7.3b).

**Q4 — Có một `title` tự do hay phân loại lỗi?** Danh sách loại trừ của nhà bán lẻ (§3.2) **không**
phải taxonomy lỗi của người dùng ("màn hình sọc" không nằm trong danh sách loại trừ). Đề xuất: `title`
tự do + `rejectionReason` là enum **chỉ điền khi bị từ chối**. Đừng ép người dùng phân loại lỗi trước
khi biết kết quả.

**Q5 — `coverage` có nên là dẫn xuất thay vì lưu?** Có thể suy ra từ `openedAt` so với
`Warranty.startDate/endDate`. Nhưng trong thực tế người dùng gửi máy **trước** khi biết có được bảo
hành hay không, và kết quả do trung tâm quyết định. Lưu tường minh cho phép ghi lại sự thật.

**Q6 — Thời điểm `INT WAITING_PARTS` có thật không?** `[chưa kiểm chứng]` (§3.3 mục 2). Nếu không ai
dùng, nó là trạng thái chết. Xác minh bằng cách hỏi 3–5 người đã từng đi bảo hành, hoặc ship và đo.

### Rủi ro

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| **R1** | **Bump backup lên v6 phá mọi file v5 hiện có.** `payload.Version != 5` là so sánh bằng `[repo]` (`backup.go:382`). | 🔴 **Cao** | Sửa thành tập chấp nhận `{5, 6}` **trước khi** ship v6. Có test import file v5 (hiện chưa có fixture — `[suy luận]`). Đây là **điều kiện tiên quyết**, không phải việc "nên làm". |
| **R2** | **Đồng hồ dừng (Điều 30.2.c) có thể không được nhà bán lẻ tự động áp dụng.** `[chưa kiểm chứng]` (§3.3 mục 6). App tính `effectiveEndDate` muộn hơn nhưng thực tế bị từ chối. | 🟠 TB | Hiển thị **cả hai** ngày + ghi chú "hỏi trung tâm trước". Không hứa. Không đổi push ở v1. |
| **R3** | **Bảng mới hở hạn mức 100 MB.** `SumAttachmentBytesByUser` chỉ SUM `Attachment`. | 🟠 TB | Sửa query thành tổng hai bảng **trong cùng migration/PR**. Bắt buộc. |
| **R4** | **Bằng chứng claim upload được nhưng không xem được.** `GET /api/files/{id}` kiểm tra sở hữu qua `Attachment → Device`; claim attachment không khớp đường đó. | 🟠 TB | Mở rộng query ownership cho **cả hai** loại **trước khi** ship upload. Có test: user A không xem được file của user B **và** không xem được file claim của device mình không sở hữu. |
| **R5** | **Nhồi claim vào `Reminder` sẽ chặn push hết hạn bảo hành.** | 🟠 TB | Không dùng `Reminder` (§6.1). Nếu review thấy ai đó thêm hàng `Reminder` cho claim → chặn. |
| **R6** | **Scope XL.** Roadmap xếp #11 là XL. Bản thân spec này đã cắt: không có UI đa client, không có OCR, không có push thông minh. | 🟠 TB | Chia 4 giai đoạn (§9). Đừng ship một phát. |
| **R7** | **Backup vẫn mất ảnh** (roadmap #2). Claim kế thừa. | 🟠 TB | Nói thật trong UI. **Đừng** hứa bằng chứng claim được backup an toàn cho tới khi #2 xong. |
| **R8** | **Nhãn tiếng Việt lệch giữa 3 client.** CLAUDE.md ghi rõ đây là bug, không phải enhancement. | 🟡 Thấp | 6 enum × 3 client. Thêm bước kiểm tra parity vào checklist review. |
| **R9** | **Múi giờ.** Cột `timestamp without time zone`; `run.go:124-128` yêu cầu `TZ=Asia/Ho_Chi_Minh`. `promisedAt` do người dùng nhập theo giờ VN. | 🟡 Thấp | Theo đúng quy ước hiện có; không tự thêm UTC conversion. |
| **R10** | **`provider` là text tự do** nên không gợi ý được trung tâm bảo hành theo hãng. | 🟡 Thấp | `serviceCenter` cũng là text tự do ở v1. Catalog `WarrantyProvider` đã tồn tại (`0001:101-112`) nhưng **rỗng trên DB mới** — roadmap #1. Đừng phụ thuộc nó. |

### Những gì tài liệu này **không** giải quyết

- **Không** có API của nhà bán lẻ để đọc trạng thái claim tự động. `[chưa kiểm chứng]` liệu có tồn
  tại API tiêu dùng nào cho `fptshop.com.vn/kiem-tra-bao-hanh`; trang cần IMEI + số điện thoại, và
  tôi **không** kiểm tra được có endpoint ẩn nào không. ⇒ v1 là **nhập tay**.
- **Không** sửa roadmap #2 (ảnh trong backup). Claim chỉ **phơi bày** lỗi đó rõ hơn.
- **Không** giải quyết tranh chấp / khiếu nại. Điều 31 là về tiếp nhận khiếu nại — một domain khác
  (có thể là mục roadmap tương lai, **không** phải spec này).
- **Không** có ước lượng thời gian thực tế (§3.3 mục 1) nên **không** có tính năng "dự đoán ngày trả
  máy". Mọi ngày đều do người dùng nhập.

---

## 9. Khuyến nghị triển khai

**Làm — nhưng theo giai đoạn, và không phải việc đầu tiên.**

Roadmap #11 xếp *"Cao về giá trị sản phẩm, thấp về mức khẩn cấp"* (`:203`). Tôi **đồng ý**, và thêm
một lý do cứng: **#1 (seed catalog) chưa xong thì #11 vô nghĩa** — trên DB mới không tạo được thiết
bị thì không có `Device` nào để gắn claim `[repo]` (`devices.go:302`).

| GĐ | Nội dung | Effort | Điều kiện xong |
|---|---|---|---|
| **0** | **Chốt Q1.** Sửa `openapi.yaml` (spec-only, không code). | S | Q1 được trả lời. **Không đụng migration.** |
| **1** | Migration `0006` (2 bảng) + `services/claims.go` + queries + 5 route + test ownership. **Chưa có UI.** | M | `WarrantyClaim` + `ClaimAttachment` CRUD được qua API; test IDOR xanh; R3 + R4 đã xử lý. |
| **2** | **Backup v6 + chấp nhận v5** (§6.3), gồm sửa `BackupReminder.lastNotifiedAt`. | S–M | Test: file v5 cũ import được; file v6 round-trip; R1 đóng. |
| **3** | Cron bucket claim + `Stats` + log (§7.3). | S | Push thật khi quá `promisedAt`. |
| **4** | Web UI (card + trang chi tiết + form) + nhãn. | M–L | Vòng lặp đầy đủ trên web. |
| **5** | Android, rồi iOS. | M | Parity nhãn + màn hình. |
| **6** *(sau)* | `pausedDays` hiển thị (Q2). Có thể gộp vào GĐ 4 nếu Q2 = (b). | S | — |

**Thứ tự này cố tình đặt GĐ 2 (backup) _trước_ GĐ 4 (UI)**: thà rằng tính năng chưa có UI còn hơn có
UI mà dữ liệu người dùng không backup/restore được. Và R1 phải đóng **trước** khi bất kỳ ai export v6.

**Bước đầu tiên cụ thể (1 buổi, đúng tinh thần roadmap §2.7):** trả lời Q1, rồi viết khối
`components.schemas` của §7.2 vào `openapi.yaml` **như một đề xuất** — chưa implement Go. Đó là
"spec + schema openapi" mà roadmap yêu cầu, không hơn.

---

## 10. Nguồn tham khảo

### Đã fetch và đọc trực tiếp `[ngoài]`

- **Luật số 19/2023/QH15 — Công báo Chính phủ số 865+866 ngày 30-7-2023.** Bản sao Wikisource của
  bản Công báo chính thức. **Đã đọc trang 57, 58, 59** — chứa trọn Điều 29, Điều 30, Điều 31, Điều 32.
  - [Trang 57](https://vi.wikisource.org/wiki/Trang:Cong_bao_Chinh_phu_865_866_nam_2023.pdf/57) —
    Điều 29 (cung cấp bằng chứng giao dịch), Điều 30 khoản 1 + 2.a + 2.b
  - [Trang 58](https://vi.wikisource.org/wiki/Trang:Cong_bao_Chinh_phu_865_866_nam_2023.pdf/58) —
    Điều 30 khoản 2.c→2.g, Điều 31
  - [Trang 59](https://vi.wikisource.org/wiki/Trang:Cong_bao_Chinh_phu_865_866_nam_2023.pdf/59) —
    Điều 32 (**về hàng có khuyết tật/thu hồi — KHÔNG phải bảo hành**)
  - **Giá trị:** nguồn pháp lý mạnh nhất trong tài liệu này (bản Công báo).
  - **Giới hạn:** Wikisource là bản sao do cộng đồng hiệu đính, không phải cổng chính phủ. Nội dung
    khớp với mô tả trong các nguồn thứ cấp, nhưng nếu cần trích dẫn pháp lý chính thức thì phải đối
    chiếu `vanban.chinhphu.vn`.
- **Chính sách bảo hành FPT Shop** —
  [fptshop.com.vn/ho-tro/chinh-sach-bao-hanh](https://fptshop.com.vn/ho-tro/chinh-sach-bao-hanh)
  (đã fetch, HTTP 200). Nguồn cho §3.2: thời điểm bắt đầu = ngày xuất hoá đơn; thời hạn theo hãng;
  có theo dõi tiến độ bảo hành; danh sách loại trừ; yêu cầu tắt mật khẩu bảo vệ; cảnh báo xoá dữ liệu.
  *Đây là phát ngôn của **một nhà bán lẻ** — dùng mô tả thực tế vận hành, **không** phải nguồn pháp lý.*
- **Trang tra cứu bảo hành FPT Shop** —
  [fptshop.com.vn/kiem-tra-bao-hanh](https://fptshop.com.vn/kiem-tra-bao-hanh?tab=thong-tin-bao-hanh)
  (đã fetch, HTTP 200). Xác nhận **4 tab**: thời gian bảo hành / thông tin sản phẩm đang bảo hành /
  **bảng giá sửa chữa** / trung tâm bảo hành hãng. ⇒ trạng thái "đang gửi bảo hành" là khái niệm có
  thật. **Không** đọc được danh sách trạng thái chi tiết (cần IMEI).

### Đã thấy trong kết quả tìm kiếm nhưng **CHƯA** fetch / chưa đọc

Ghi rõ để người sau không nhầm là đã kiểm chứng:

- **`luatduonggia.vn` — "Quy định trách nhiệm bảo hành hàng hóa, linh kiện, phụ kiện"**
  ([URL](https://luatduonggia.vn/phap-luat/quy-dinh-trach-nhiem-bao-hanh-hang-hoa-linh-kien-phu-kien/),
  đã fetch HTTP 200). ⚠️ **Bài này mô tả Luật BVQLNTD 2010, đã hết hiệu lực** — không phải Luật
  19/2023/QH15. Nội dung trùng khớp với Điều 30 luật mới ở các điểm chính (giấy tiếp nhận, dừng đồng
  hồ, quy tắc 3 lần, đổi/hoàn tiền, chi phí vận chuyển, uỷ quyền), nhưng **nó cũng dẫn Nghị định
  98/2020/NĐ-CP Điều 56** với các khung phạt cụ thể mà **tôi chưa đọc văn bản gốc** ⇒ **không** dùng
  các con số phạt đó. Dùng làm tín hiệu đối chiếu, không làm nguồn.
- **Nghị định 98/2020/NĐ-CP Điều 56** (xử phạt vi phạm nghĩa vụ bảo hành) — chỉ biết qua nguồn thứ
  cấp ở trên. **Chưa đọc văn bản gốc.**
- **Bài Tuổi Trẻ 2017** *"iPhone chính hãng một đổi một nâng lên 60 ngày ở Việt Nam"* — chỉ thấy tiêu
  đề trong kết quả tìm kiếm. **Chưa fetch**, và là tin **2017** ⇒ **không** dùng con số 60 ngày.
- **`camnangluat.vn/dieu/luat-19-2023-qh15-dieu-32/`** — fetch trả **HTTP 403** (chặn bot). Không đọc
  được. (Chính vì thế tôi mới tìm tới bản Công báo trên Wikisource.)
- **Nghị định 55/2024/NĐ-CP** — roadmap đã xác minh **không** có quy định thời hạn bảo hành. Tôi
  **không** đọc lại và **không** phản đối kết luận đó.

### Những gì tôi KHÔNG kiểm chứng được

Xem [§3.3](#33-chưa-kiểm-chứng--những-gì-tôi-không-xác-minh-được) — tóm tắt: thời gian xử lý thực tế
bằng con số; danh sách trạng thái nội bộ của nhà bán lẻ; tỉ lệ/lý do từ chối thực tế; mức phạt theo
Nghị định 98/2020; và **liệu nhà bán lẻ VN có tự động gia hạn bảo hành theo Điều 30.2.c hay không**
(đây là **R2**, rủi ro lớn nhất về mặt sản phẩm).

---

[^1]: Kiểm chứng: `grep -rniE "claim|repair"` trên `api/`, `website/src/`, `ios/Sources/`,
    `android/app/src/main` chỉ khớp các định danh JWT (`fcm.go:120`, `fcm_test.go:83-92`) và dòng copy
    ở `website/src/app/page.tsx:51`. Không có bảng, service, handler, model, hay màn hình nào.
