# Lộ trình tính năng — WarrantyVault

> Tài liệu này là **đánh giá có bằng chứng** về những gì còn thiếu để repo này thực sự "xong".
> Mọi khẳng định về repo đều kèm đường dẫn file + số dòng đã đọc trực tiếp. Mọi khẳng định từ bên
> ngoài đều kèm URL và được ghi rõ mức độ tin cậy.
>
> **Quy ước nhãn bằng chứng**
> - `[repo]` — đã đọc code/migration trong repo này.
> - `[ngoài]` — có nguồn bên ngoài, URL ở [§6](#6-nguồn-tham-khảo).
> - `[suy luận]` — nhận định của người viết, **không** phải dữ kiện.
>
> Ngày lập: 2026-10-02. Không có số liệu thị trường, giá cả hay yêu cầu pháp lý nào được bịa ra;
> chỗ nào không kiểm chứng được thì ghi rõ "chưa kiểm chứng".

---

## 0. Trạng thái hiện tại — cập nhật 2026-10-03

> **Đọc mục này trước §1.** §1–§6 giữ nguyên văn bản ngày 2026-10-02 để làm lịch sử; phần dưới
> đây là trạng thái **đã kiểm lại bằng code**, không phải bằng lời kể.
>
> **Mốc kiểm chứng:** HEAD `794b35a` (2026-10-03) **+ working tree** — đợt này nhiều thứ vừa landed
> nhưng **chưa commit** (backend agent còn đang chạy: đổi email, backup kèm blob, seed Brand/Store).
> Dòng nào thuộc nhóm đó được đánh dấu **🆕 chưa commit**; đừng coi là đã chốt trong git.
> Mọi dòng "đã xong" dưới đây đều chỉ tới file **còn tồn tại trong repo** ở mốc đó.

**Ký hiệu:** ✅ xong · 🟡 xong một phần (nói rõ phần nào) · 📄 mới có spec, chưa có code.

| # | Việc | Trạng thái | Làm khác gì so với đề xuất / còn lại gì |
|---|---|---|---|
| 1 | Seed catalog + đường quản trị | ✅ **lỗi chặn đã hết** · 🟡 không thêm admin | `api/migrations/0004_seed_category_catalog.sql` seed đủ 20 category (idempotent, `ON CONFLICT (code) DO NOTHING`). **🆕 chưa commit:** `0008_seed_brand_store_warranty_provider.sql` seed nốt Brand/Store/WarrantyProvider — thứ mà 0004 cố ý bỏ qua; lý do đổi ý ghi trong header 0008 (picker rỗng trên DB mới là form trông hỏng ngay thiết bị đầu tiên, `BrandCategory` sẽ là join chết, và `matchBrand` của OCR chỉ bind được khi catalog có brand). **Không** có route/trang admin nào được thêm; 2 comment nói dối về Prisma Studio trong `catalog.go` đã được sửa thành "không có admin UI, sửa SQL trực tiếp". |
| 2 | Backup gồm ảnh, và copy hướng dẫn đang sai | ✅ **đã xong** (phần zip 🆕 chưa commit) | Copy trong `backup-tools.tsx` đã nói thật từ trước, và Go đã tự khai báo qua `includesAttachmentBytes` + `attachmentBytesNote`. **Mới:** `GET /api/v1/backup/export?includeBlobs=true` trả **.zip** mang cả blob đã mã hoá (envelope version 6, `includesAttachmentBytes: true`, note tiếng Việt đổi thành "CÓ chứa … cần đúng `FILE_MASTER_KEY`"), còn export JSON giữ nguyên version 5 y như cũ. `POST /api/v1/backup/import` **sniff magic `PK\x03\x04`** nên nhận cả hai định dạng trên cùng endpoint, và `missingAttachmentIds` nói rõ blob nào thiếu trên đĩa thay vì im lặng xuất một backup nhỏ hơn. ⚠️ `openapi.yaml` mục `/backup/export` **chưa** mô tả `includeBlobs` — cần bổ sung. |
| 3 | `/stats` tính đúng chi phí | ✅ số đúng ở cả 3 client · 🟡 làm khác đề xuất | Go **đã** có `devices.totalWarrantyCost` (`api/internal/services/stats.go:30`) — nhưng **chỉ Android dùng** (`StatsScreen.kt:225`). Web vẫn rollup trong RSC (`website/src/lib/stats-rollup.ts`, có test) và chỉ lấy phần subscription từ Go; iOS rollup on-device (`ios/Sources/WarrantyVaultKit/StatsRollup.swift`). Cả 3 nay đều cộng `Warranty.cost`. |
| 4 | Web: quản lý thiết bị push | ✅ | `website/src/components/push-devices.tsx`, gọi `listMySubscriptions()` trong `settings/page.tsx`. |
| 5 | Nhắc nhở đã ẩn: xem lại + khôi phục (cần sửa API) | ✅ web + iOS (🆕 chưa commit) · 🟡 Android | Làm **đúng như đề xuất**: `GET /api/v1/reminders?includeDismissed=true` (`api/internal/handlers/reminders.go` + `services/reminders.go` + query + test). Hành vi đã chốt: `withinDays` **không** áp cho row đã ẩn (ẩn từ lâu vẫn hiện), lọc theo status thiết bị cũng không áp (thiết bị đã bán vẫn thấy), số row bị chặn cấu trúc bởi 50 thiết bị × 5 gói = 250, và `isDismissed` dùng `omitempty` nên **chỉ xuất hiện khi `true`** — nhờ vậy `includeDismissed=false` giống y response cũ. Web (`lib/api/reminders.ts`, `lib/dismissed-reminders.ts`) và iOS (`Endpoints.swift`, `DismissedReminders.swift`) nay đọc feed nhẹ này thay vì parse cả backup export. Android vẫn chỉ có "Hoàn tác" ngay sau khi ẩn. |
| 6 | `/offline` hứa sai | ✅ hết nói dối · 🟡 chưa cache dữ liệu | `website/src/app/offline/page.tsx` nay nói thẳng "chưa lưu dữ liệu để xem offline". Chọn phương án "nói thật" của đề xuất; stale-while-revalidate trong `sw.js` **chưa làm**. |
| 7 | Tìm kiếm tiếng Việt không dấu + tìm kiếm xuyên thực thể | ✅ **cả hai vế** (vế 2 🆕 chưa commit) | Vế thiết bị: `0005_device_search_unaccent.sql` + `0007_locale_safe_unaccent.sql` (đảo thành `lower(wv_unaccent(x))` để không phụ thuộc collation) + 4 index GIN trigram. **Mới:** `GET /api/v1/search?q=&limit=` trả `{query, devices[], subscriptions[], wishlist[]}` — nhóm rỗng luôn là `[]` (không bao giờ `null`), `limit` tính **mỗi nhóm** (default 20, max 50), `q` rỗng/chỉ khoảng trắng → 200 với nhóm rỗng, `q` > 200 ký tự → 400. `q` của từng endpoint list **không đổi**. |
| 8 | Sửa mô tả file đính kèm | ✅ | `PATCH /api/v1/attachments/{id}` (`api/internal/handlers/attachments.go:54`, chỉ nhận `description`), sửa inline trong `website/src/components/attachment-gallery.tsx`. |
| 9 | Parity điều hướng mobile + badge | ✅ | `MobileBottomNav` render **đủ 7 mục** (kể cả `/reminders`, `/stats`) và badge so `item.href === '/reminders'` — đúng như đề xuất "cách rẻ nhất". |
| 10 | Sửa hồ sơ: tên hiển thị + đổi email | 🟡 **API xong cả hai** · client email chưa nối | Tên: `PATCH /api/v1/auth/me` chỉ nhận `displayName` (≤80 byte, `""`/`null` = xoá) — web/iOS/Android đều có form. Email (**🆕 chưa commit**): `POST /api/v1/auth/change-email` (bắt buộc mật khẩu hiện tại) + `POST /api/v1/auth/confirm-email-change`, migration `0009_email_change.sql` mở rộng bảng `PasswordReset` bằng cột `pendingEmail` — token gửi tới **địa chỉ mới**, hash + TTL + dùng một lần, và tách tuyệt đối khỏi token reset mật khẩu (query của hai luồng loại trừ nhau qua `pendingEmail IS NULL` / `IS NOT NULL`). Còn thiếu: web **chưa** có trang `/confirm-email/<token>` (link trong mail trỏ tới đó) lẫn form đổi email; iOS/Android cũng chưa. |
| 11 | `WarrantyClaim` + lịch sử sửa chữa | 📄 spec xong, chưa code | `docs/SPEC-WARRANTY-CLAIM.md`. Trang landing cũng đã bị sửa để **thôi hứa** tính năng này (commit `0e4664f`). |
| 12 | Bán lại / khấu hao | ✅ | `0006_device_resale.sql` (`soldAt` + `soldPrice`, nullable, không ràng buộc DB — validate ở write path). Cả 3 client hiện "Ngày bán / Giá bán / lãi-lỗ". |
| 13 | Lịch bảo trì định kỳ | 📄 spec xong · **khuyến nghị HOÃN build** | `docs/SPEC-MAINTENANCE-SCHEDULES.md`: vế "cung" có thật, vế "cầu" (hộ gia đình có muốn app nhắc) **không có bằng chứng nào**. |
| 14 | Export CSV | ✅ cả 3 client · **không** thêm endpoint Go | Web: server action `website/src/app/actions/csv.ts` + `lib/csv.ts`/`lib/csv-export.ts` (devices, subscriptions, wishlist). iOS `DeviceCSVExport`, Android `android/.../export/CsvExport.kt`. Đúng "cách 2" (rẻ hơn) của đề xuất. |
| 15 | OCR: trích xuất IMEI/serial + số tháng bảo hành, nhận cả hoá đơn PDF | 🟡 serial + số tháng xong · **PDF vẫn KHÔNG hỗ trợ** | `api/internal/ai/extract.go` có `serialNumber` + `warrantyMonths` (chặn 0–120) trong cả tool schema lẫn system prompt, có test. Câu hỏi treo ở "Bước đầu" đã có đáp án: magic-byte whitelist **cho phép** PDF (`api/internal/files/mime.go` — PDF không bị resize), nhưng đường OCR **từ chối** PDF bằng 400 rõ ràng thay vì để rơi vào 502 — comment ở `api/internal/services/ai_extract.go:121-128` vẫn ghi thẳng "PDF OCR is NOT supported". Muốn có thì phải làm thật, không phải bật cờ. |

**Tóm lại (sau đợt 🆕):** **11/15 mục đã xong** — #2, #3, #4, #5, #6, #7, #8, #9, #12, #14 trọn vẹn,
cộng **#1 xong phần chặn** (đường quản trị admin **cố ý không làm**, đã ghi rõ trong code).
2 mục xong một nửa: **#10** (API đổi email xong, client chưa nối) và **#15** (serial/số tháng xong,
PDF chưa). 2 mục dừng ở spec: **#11**, **#13**.
Điều đáng chú ý: **không mục nào trong 15 mục bị xoá hay lặng lẽ bỏ qua** — mục nào chưa xong vẫn nằm
dưới đây kèm lý do.

**Kiểm lại bằng gì (chạy ở mốc `794b35a` + working tree):**

```bash
bash api/scripts/check_openapi_drift.sh          # → 54 endpoints / 37 path, khớp openapi
cd website && npm test                            # → 116 test / 7 file
cd ios && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --disable-sandbox                   # → 125 test (đếm hàm test; lần chạy thật ở 5b04306 ra 123/123)
cd android && ./gradlew :app:testDebugUnitTest    # → 143 test / 19 class
ls api/migrations/                                # → 0001…0009
```

⚠️ **Số endpoint là thứ trôi nhanh nhất trong tài liệu này** — backend agent còn đang thêm route. Nếu
con số trên lệch với output thật thì **tin cái script**, không tin tài liệu này.

**Việc còn lại thật sự làm được ngay hôm nay:** nối client cho đổi email (trang `/confirm-email/[token]`
+ form), #15 PDF OCR (quyết định sản phẩm), #11 build `WarrantyClaim` sau khi spec được duyệt, #13 chỉ
nên làm sau khi phỏng vấn người dùng, #6 cache dữ liệu trong `sw.js` nếu muốn offline thật. Toàn bộ việc
**không** code được nằm ở `docs/HUMAN_TASKS.md`.

---

## 1. Tóm tắt

**Hiện trạng.** Về mặt kỹ thuật, repo này đã ở trạng thái rất tốt và hiếm gặp: Go là backend duy nhất
sở hữu Postgres, `openapi.yaml` là hợp đồng thật (33 path / **51** cặp method+path, khớp với route
đăng ký trong `api/cmd/server/main.go` + `api/internal/handlers/*.go` — `api/scripts/check_openapi_drift.sh`
so hai bên và CI chạy script này), web là UI mỏng proxy toàn bộ read/write qua `website/src/lib/api/*`,
và hai client native (iOS/Android) nói cùng một REST API. Các tính năng khó đã xong: OCR hoá đơn bằng
AI có opt-in theo user, push đa nền tảng (VAPID/APNs/FCM), cron nhắc bảo hành/subscription/wishlist,
file đính kèm mã hoá AES-256-GCM, backup/restore JSON, xoá tài khoản.

**Việc quan trọng nhất còn thiếu — và nó là một lỗi chặn, không phải tính năng.**

> ✅ **ĐÃ SỬA (2026-10-03).** Mục này giữ nguyên phần phân tích bên dưới làm lịch sử. Bản sửa là
> `api/migrations/0004_seed_category_catalog.sql` — seed đủ 20 code trong `CATEGORY_LABELS`, idempotent,
> kèm test `api/internal/services/category_seed_test.go` parse cả `types.ts`, `CategoryLabels.swift`,
> `CategoryLabels.kt` lẫn chính file migration để không ai lệch được nữa. Vấn đề **còn lại một nửa**:
> vẫn **không có** cơ chế admin nào (không route, không trang) — catalog sửa bằng SQL trực tiếp, và
> 2 comment cũ trong `catalog.go` đã được viết lại cho đúng sự thật đó.

> **Trên một database mới, không ai tạo được thiết bị nào cả.**

Bảng `Category` **không được seed ở bất kỳ đâu** — không có `INSERT INTO public."Category"` trong
`api/migrations/`, `api/scripts/seed_dev.sql` chỉ seed `Device`/`Warranty`/`Subscription`/`Wishlist*`
(`api/scripts/seed_dev.sql:38,87,168,206,225`), và `deploy/` không có bước seed nào.
Nhưng `CreateDevice` **bắt buộc** phải validate category:

```go
// api/internal/services/devices.go:298-303
func CreateDevice(...) (store.Device, error) {
	if err := ValidateDeviceInput(&in); err != nil { ... }
	if err := assertCategoryExists(ctx, db, in.Category); err != nil {
		return store.Device{}, err
	}
```

`assertCategoryExists` (`api/internal/services/devices.go:515-523`) trả `ErrCategoryInvalid()`
("Loại thiết bị không hợp lệ") khi không tìm thấy row. Hệ quả dây chuyền `[repo]`:

1. `GET /api/v1/catalog` trả `categories: []` → combobox "Loại" trong
   `website/src/components/device-form.tsx:342` rỗng, form rơi về literal `'OTHER'`
   (`device-form.tsx:209`).
2. `POST /api/v1/devices` → **400 "Loại thiết bị không hợp lệ"**. `UpdateDevice` cũng vậy
   (`devices.go:397`), và wishlist cũng vậy (`wishlist.go:181,280`).
3. Đăng ký tài khoản vẫn thành công (`POST /api/v1/auth/register` không đụng catalog), nên user mới
   **đăng nhập được nhưng không thêm được gì**. Đây là kiểu lỗi tệ nhất: im lặng cho tới bước cuối.

Tệ hơn, đường thoát hiểm được tài liệu hoá đã **không còn tồn tại**: comment trong code chỉ dẫn
quản trị catalog bằng Prisma Studio —

```go
// api/internal/services/catalog.go:18
// admin-edited via Prisma Studio so freshness within a minute is fine.
// api/internal/services/catalog.go:124
// (currently only Prisma Studio touches these tables, ...)
```

— nhưng Prisma đã bị gỡ khỏi repo (CLAUDE.md: "There is no Prisma"), và **không có route admin nào
trong Go** (`grep -i admin api/internal/handlers/*.go` → 0 kết quả) lẫn trang admin nào trong web.
Nói cách khác: catalog được mô tả là "admin-curated" nhưng **không có cơ chế admin nào tồn tại**.
*(Cập nhật 2026-10-03: 2 comment đó đã được viết lại cho đúng — `catalog.go:19` và `catalog.go:135`
nay nói thẳng là không có admin UI và Prisma Studio đã bị gỡ. Tình trạng "không có admin" thì vẫn y nguyên.)*

**Việc quan trọng nhất còn thiếu về mặt sản phẩm** (khác với việc trên): app theo dõi *ngày hết hạn*
nhưng không hỗ trợ *việc đi bảo hành*. Không có entity `WarrantyClaim`, không có lịch sử sửa chữa
(`grep CREATE TABLE api/migrations/*.sql` → **17 bảng** tính đến `0007`, không bảng nào cho claim/repair). Chu trình
người dùng dừng đúng lúc giá trị nhất: nhận thông báo → … → hết.

**Kết luận thẳng.** Repo này không thiếu tính năng hào nhoáng; nó thiếu (a) một bước seed để chạy
được, (b) sự thật trong vài chỗ copy/UX đang nói dối người dùng, và (c) vòng lặp nghiệp vụ cuối
cùng của domain. Xếp hạng dưới đây phản ánh đúng thứ tự đó.
*(Cập nhật 2026-10-03: (a) đã xong — migration `0004`. (b) đã xong ở cả 3 chỗ đã nêu: copy backup,
copy trang offline, và lời hứa "claim" trên landing page. (c) vẫn còn, nhưng giờ đã có spec.)*

---

## 2. Nguyên tắc ưu tiên

Xếp hạng theo thứ tự ưu tiên sau, **không** theo độ "hay" của tính năng:

1. **Sửa cái đang sai trước khi thêm cái mới.** Một con số "tổng chi" sai hoặc một trang offline nói
   dối gây hại nhiều hơn một tính năng còn thiếu. (Áp dụng cho #3, #6, #7.)
2. **Chặn > khó chịu > thiếu.** Lỗi làm sản phẩm không dùng được trên môi trường mới xếp trên mọi
   thứ. (#1)
3. **Mất dữ liệu > mất thời gian.** Nguy cơ người dùng mất ảnh hoá đơn vĩnh viễn xếp trên mọi tiện
   ích. (#2)
4. **Việc không bị chặn bởi tiền/tài khoản phải xếp trên việc bị chặn.** Toàn bộ top 15 là việc làm
   được **ngay hôm nay**; mọi thứ cần VPS/Apple/Firebase/key nằm riêng ở [§4](#4-việc-bị-chặn-bởi-tiềntài-khoản).
5. **Đã có backend thì ưu tiên nối UI.** Nếu Go/API/openapi đã hỗ trợ mà một client chưa dùng, đó là
   việc rẻ và chắc chắn thắng. (#3, #4 áp dụng mạnh điều này.)
6. **Parity giữa 3 client được tính là bug, không phải enhancement.** Khi iOS/Android đã có mà web
   chưa có (hoặc ngược lại), người dùng cùng một sản phẩm nhận trải nghiệm khác nhau. (#4, #5, #9.)
7. **Việc lớn chỉ vào danh sách khi có "bước đầu" rõ ràng.** Không có mục nào ở đây mà người tiếp
   theo không thể bắt đầu trong 1 buổi. Việc XL (#11) vẫn vào danh sách nhưng bước đầu **chỉ là viết
   spec + schema openapi**, không phải viết code.
8. **Effort phải phản ánh số client phải sửa.** Sửa 1 file web = S. Thêm field vào API = phải cập
   nhật openapi + Go + web + iOS + Android theo đúng quy ước trong CLAUDE.md, nên tối thiểu là M.

**Effort:** S ≤ nửa ngày · M ≤ 2 ngày · L ≤ 1 tuần · XL > 1 tuần.

---

## 3. Roadmap

### #1 — Seed catalog + mở một đường quản trị catalog thật
| | |
|---|---|
| **Trạng thái** | ✅ **Lỗi chặn đã hết** — `0004_seed_category_catalog.sql` seed đủ 20 category, và **🆕 chưa commit** `0008_seed_brand_store_warranty_provider.sql` seed nốt Brand/Store/WarrantyProvider. 🟡 **Đường quản trị admin: KHÔNG làm** (cố ý; `catalog.go` nay ghi rõ "no admin UI", sửa SQL trực tiếp). |
| **Khu vực** | `api` (+ `deploy`, `web`) |
| **Vì sao** | `[repo]` Đây là **lỗi chặn**: bảng `Category` rỗng trên DB mới → `CreateDevice`/`UpdateDevice` (`api/internal/services/devices.go:302,397`) và wishlist (`api/internal/services/wishlist.go:181,280`) trả 400 "Loại thiết bị không hợp lệ"; combobox loại ở `website/src/components/device-form.tsx:342` rỗng. Đường quản trị được tài liệu hoá (Prisma Studio — `api/internal/services/catalog.go:18,124`) đã bị gỡ cùng Prisma và không có route/trang admin thay thế. |
| **Tác động** | **Nghiêm trọng.** Không có mục này thì mọi mục còn lại đều vô nghĩa trên production. |
| **Effort** | **M** |
| **Bước đầu** | Viết `api/migrations/0004_seed_catalog.sql` (goose) insert đúng ~20 code trong `CATEGORY_LABELS` (`website/src/lib/types.ts:5-25`: `PHONE, LAPTOP, TABLET, SMARTWATCH, HEADPHONE, SPEAKER, CAMERA, TV, MONITOR, KEYBOARD, MOUSE, GAMING_CONSOLE, AC, FRIDGE, WASHING, KITCHEN, APPLIANCE, ELECTRONICS, FURNITURE, OTHER`) với `name` tiếng Việt + `sortOrder`, kèm vài chục `Store` phổ biến (Điện Máy Xanh, FPT Shop, CellphoneS, Shopee…) và `WarrantyProvider`. Sau đó sửa 2 comment ở `catalog.go` cho khỏi nói dối. |

### #2 — Backup phải bao gồm ảnh, và copy hướng dẫn đang sai
| | |
|---|---|
| **Trạng thái** | ✅ **Đã xong** (phần zip: 🆕 chưa commit). Copy đã nói thật; `includesAttachmentBytes` + `attachmentBytesNote` khiến payload tự khai báo. **Mới:** `?includeBlobs=true` trả .zip chứa cả blob đã mã hoá (version 6), JSON export vẫn version 5; import sniff ZIP magic nên đọc được cả hai; `missingAttachmentIds` nêu rõ blob thiếu. ⚠️ `openapi.yaml` chưa mô tả `includeBlobs`. |
| **Khu vực** | `api` + `web` |
| **Vì sao** | `[repo]` `website/src/components/backup-tools.tsx` nói với người dùng 2 lần rằng ảnh nằm ở `public/uploads` (dòng 44, 70-72) và "sao chép lại folder `public/uploads`" (dòng 108). **Điều này sai**: attachment là blob mã hoá AES-256-GCM do Go sở hữu dưới `PRIVATE_UPLOAD_ROOT`; `Attachment` lưu `iv` + `wrappedKey` trong DB (`api/migrations/0001_initial.sql:158-172`) nên **copy thư mục ảnh là vô nghĩa** — thiếu `FILE_MASTER_KEY` thì blob không giải mã được. Nghiêm trọng hơn: JSON backup chỉ chứa metadata attachment, nên **restore sang máy mới = mất toàn bộ ảnh hoá đơn vĩnh viễn**, đúng thứ tài liệu hứa sẽ bảo vệ. |
| **Tác động** | **Cao.** Rủi ro mất dữ liệu thật + copy sai làm người dùng tin nhầm là đã an toàn. |
| **Effort** | **S** cho phần copy, **M** cho phần nhúng bytes ảnh vào backup |
| **Bước đầu** | Sửa ngay 3 đoạn copy trong `backup-tools.tsx` để nói thật (ảnh **không** nằm trong file JSON và **không** ở `public/uploads`). Sau đó thiết kế định dạng backup v2: hoặc (a) `.zip` gồm `data.json` + `attachments/<id>.enc`, hoặc (b) ghi rõ "backup này không gồm ảnh" và cảnh báo đỏ trong UI. |

### #3 — `/stats`: tính đúng chi phí bảo hành + chi phí subscription, dùng một nguồn sự thật
| | |
|---|---|
| **Trạng thái** | ✅ **Số đã đúng ở cả 3 client** — nhưng **làm khác đề xuất**: Go có `devices.totalWarrantyCost` (`services/stats.go:30`) mà **chỉ Android đọc**; web vẫn rollup trong RSC (`lib/stats-rollup.ts`) và chỉ lấy subscription từ Go; iOS rollup on-device (`StatsRollup.swift`). `lib/api/stats.ts` không còn là code chết. |
| **Khu vực** | `web` + `api` |
| **Vì sao** | `[repo]` Trang `/stats` chỉ cộng `Device.purchasePrice` — `website/src/app/(app)/stats/page.tsx` dòng 34, 50, 68, 90. Nó **bỏ qua** `Warranty.cost` và **bỏ qua toàn bộ** subscription. Trong khi đó `GET /api/v1/stats` **đã** trả `subscriptions.totalMonthlyVnd` và **đang được dùng** — Android (`android/.../ui/screens/stats/StatsScreen.kt:237`) và iOS (`ios/App/Features/Stats/StatsView.swift:179` dùng `snap.monthlyEquivalent`) đều hiển thị chi phí subscription; **chỉ web không gọi endpoint đó**. Bằng chứng mạnh nhất: `website/src/lib/api/stats.ts` là **code chết** — `grep -rn "lib/api/stats"` trên toàn bộ `website/src` trả **0 importer**. Và `UserStats` trong `openapi.yaml:1497` **không có field nào** cho chi phí bảo hành, nên đây là khoảng trống **toàn hệ thống**, không riêng web. |
| **Tác động** | **Cao.** Con số "Tổng chi" — chỉ số headline của trang — đang sai ở cả 3 nền tảng. |
| **Effort** | **M** |
| **Bước đầu** | Thêm query `StatsWarrantiesCost` (SUM `Warranty.cost` theo `userId`) vào `api/internal/store/queries/stats.sql`, thêm field `totalWarrantyCost` vào `DeviceStats`, cập nhật `openapi.yaml:1497`. Song song, đổi `stats/page.tsx` sang gọi `api.stats.get()` thay vì rollup trong RSC — vì các chart phái sinh (`monthlySpendBuckets`, `spendByCategoryRollup`) vẫn cần `DeviceListItem[]`, giữ lại 1 call `api.devices.list()` và **chỉ** lấy con số tổng từ Go. |

### #4 — Web: trang quản lý thiết bị nhận thông báo (push devices)
| | |
|---|---|
| **Trạng thái** | ✅ **Đã xong** — `website/src/components/push-devices.tsx`, render trong `(app)/settings/page.tsx`, gọi `listMySubscriptions()` + xoá qua `DELETE /api/v1/push/{id}`. |
| **Khu vực** | `web` |
| **Vì sao** | `[repo]` Web **không có chỗ nào** liệt kê hay xoá thiết bị đã đăng ký push. `listMySubscriptions()` (`website/src/app/actions/push.ts:57`) và `api.push.list` (`website/src/lib/api/push.ts:32`) có **0 caller** — `grep -rn "listMySubscriptions"` chỉ khớp đúng dòng định nghĩa. Backend đã sẵn sàng: `GET /api/v1/push` và `DELETE /api/v1/push/{id}` (`api/internal/handlers/push.go:24,26`). **Đây là gap của riêng web**: iOS đã có `ios/App/Features/Settings/PushDevicesView.swift`, Android đã có `android/.../ui/screens/settings/PushDevicesScreen.kt` + test riêng (`PushDevicesViewModelTest.kt`). |
| **Tác động** | **Trung bình–cao.** Là vấn đề quyền riêng tư: người dùng không thể thu hồi thông báo khỏi một máy đã mất/bán. |
| **Effort** | **S** (backend + 2 client tham chiếu đã có, chỉ cần port) |
| **Bước đầu** | Thêm section "Thiết bị nhận thông báo" vào `website/src/app/(app)/settings/page.tsx`, gọi `listMySubscriptions()` và render nút xoá gọi `DELETE /api/v1/push/{id}`. Port trực tiếp từ `PushDevicesScreen.kt`. |

### #5 — Nhắc nhở đã ẩn: xem lại + khôi phục (cần sửa API)
| | |
|---|---|
| **Trạng thái** | ✅ **Đã làm đúng như đề xuất** (🆕 chưa commit phần API): `GET /api/v1/reminders?includeDismissed=true` tồn tại, `withinDays` + lọc status **không** áp cho row đã ẩn, `isDismissed` chỉ xuất hiện khi `true` (nhờ `omitempty`, nên hành vi cũ không đổi), số row bị chặn cấu trúc 250. Web và iOS nay đọc feed nhẹ này thay vì parse backup export. 🟡 Android vẫn chỉ có "Hoàn tác", chưa có danh sách "Đã ẩn". |
| **Khu vực** | `api` + `web` + `ios` + `android` |
| **Vì sao** | `[repo]` Ẩn nhắc nhở hiện là hành động **một chiều**. `website/src/app/(app)/reminders/page.tsx:179` hardcode `isDismissed={false}`. Nhưng sửa ở web là **không đủ**: `services.ListUpcomingReminders` (`api/internal/services/reminders.go:31-60`) loại reminder đã ẩn **trong SQL** và **không nhận tham số nào** để bao gồm chúng — comment ở `reminders/page.tsx:19-22` ghi rõ section "Đã ẩn" đã biến mất từ lúc chuyển sang Go. Nghĩa là **API hiện không có khả năng trả về reminder đã ẩn**. Điểm sáng: UI khôi phục đã được viết sẵn và bỏ không — `components/dismiss-button.tsx:38,56,61` đã có nhánh `isDismissed ? 'Hiện lại' : 'Đã xem, ẩn đi'`, chỉ chưa bao giờ nhận `true`. |
| **Tác động** | **Trung bình–cao.** Người dùng ẩn nhầm là mất thông tin vĩnh viễn trên UI. |
| **Effort** | **M** |
| **Bước đầu** | Thêm query param `includeDismissed=true` vào `GET /api/v1/reminders` (`api/internal/handlers/reminders.go`) + `openapi.yaml:727`, truyền xuống `ListUpcomingReminders`. Rồi ở web thêm tab "Đã ẩn" truyền `isDismissed` thật — logic restore đã có sẵn trong `DismissButton`. |

### #6 — Trang `/offline` đang hứa điều service worker không làm
| | |
|---|---|
| **Trạng thái** | ✅ **Đã chọn phương án "nói thật"** — `website/src/app/offline/page.tsx` nay ghi rõ "WarrantyVault chưa lưu dữ liệu để xem offline", bỏ hẳn lời hứa "sync". 🟡 Phần "làm thật" (cache stale-while-revalidate trong `sw.js`): **chưa làm**, vẫn chỉ precache `/offline`. |
| **Khu vực** | `web` |
| **Vì sao** | `[repo]` `website/public/sw.js` chỉ precache đúng một URL: `const OFFLINE_SHELL = ['/offline']` (dòng 4), và với navigation chỉ làm network-first → fallback về `/offline`. **Không có cache dữ liệu nào.** Nhưng `website/src/app/offline/page.tsx` nói với người dùng: *"Một số dữ liệu đã lưu trước đó vẫn xem được — phần còn lại sẽ sync khi có mạng."* Câu này **sai**, và còn hứa cả "sync" trong khi app không có cơ chế sync nào. Đây không chỉ là lỗi copy: tra cứu bảo hành tại cửa hàng là tình huống **offline thật** (sóng yếu trong siêu thị điện máy) — đúng use case mà tính năng này tồn tại để phục vụ. |
| **Tác động** | **Trung bình.** Mất niềm tin + bỏ lỡ use case có giá trị thật. |
| **Effort** | **S** (nói thật) / **M** (làm thật) |
| **Bước đầu** | Sửa copy trước (5 phút) để ngừng nói dối. Sau đó, nếu muốn làm thật: cache stale-while-revalidate cho `GET /v1/devices` và `GET /v1/devices/{id}` trong `sw.js`, kèm banner "dữ liệu có thể cũ". |

### #7 — Tìm kiếm tiếng Việt không dấu + tìm kiếm xuyên thực thể
| | |
|---|---|
| **Trạng thái** | ✅ **Cả hai vế** (vế xuyên thực thể 🆕 chưa commit). Thiết bị: `0005` + `0007` + 4 index GIN trigram, test theo cả locale C lẫn UTF-8. **Mới:** `GET /api/v1/search?q=&limit=` (`services/search.go`) gom 3 nhóm trong 1 round trip, `limit` mỗi nhóm 20/50, `q` rỗng → 200 nhóm rỗng, > 200 ký tự → 400. |
| **Khu vực** | `api` (+ `web`, `ios`, `android`) |
| **Vì sao** | `[repo]` Tìm kiếm thiết bị dùng `ILIKE '%' || $4 || '%'` trên `name/brand/model/serialNumber` (`api/internal/store/queries/devices.sql:20-23`). `ILIKE` của Postgres **không** bỏ dấu: gõ `dien thoai` **không** khớp `Điện thoại`, `samsung galaxy` không khớp tên có dấu. Và `grep -rniE "unaccent\|tsvector\|pg_trgm\|CREATE EXTENSION" api/migrations/` → **0 kết quả**, nên không có extension nào hỗ trợ. Ngoài ra `q` chỉ áp dụng cho `Device`: không tìm được đồng thời subscription/wishlist. `[suy luận]` Với người dùng Việt gõ không dấu rất phổ biến, đây là ma sát hàng ngày chứ không phải chi tiết nhỏ. |
| **Tác động** | **Trung bình–cao** (UX lõi cho thị trường mục tiêu). |
| **Effort** | **M** |
| **Bước đầu** | `CREATE EXTENSION IF NOT EXISTS unaccent;` trong một migration goose mới, thêm index functional trên `unaccent(lower(name))` cho `Device`, và đổi `ListDevices` sang so khớp đã chuẩn hoá. Kiểm tra `unaccent` có sẵn trên Postgres 17 self-hosted (có trong `contrib`) — cần xác nhận trên image đang dùng trước khi cam kết. |

### #8 — Sửa được mô tả của file đính kèm
| | |
|---|---|
| **Trạng thái** | ✅ **Đã xong** — `PATCH /api/v1/attachments/{id}` (`api/internal/handlers/attachments.go:54`, chỉ nhận `description`), web sửa inline trong `website/src/components/attachment-gallery.tsx`; iOS + Android cũng đã có. |
| **Khu vực** | `api` + `web` + `ios` + `android` |
| **Vì sao** | `[repo]` `Attachment` **có** cột `description` (`api/migrations/0001_initial.sql:158-172`), nhưng tập route attachment chỉ có 4 đường: `POST /api/v1/devices/{id}/attachments`, `GET /api/v1/devices/{id}/attachments`, `DELETE /api/v1/attachments/{id}`, `GET /api/files/{id}` (`api/internal/handlers/attachments.go:51-54`). **Không có PATCH** ⇒ mô tả là write-once: gõ sai lúc upload thì phải xoá file và upload lại. |
| **Tác động** | **Trung bình.** Ma sát nhỏ nhưng gặp thường xuyên, và chi phí sửa rất thấp. |
| **Effort** | **S** |
| **Bước đầu** | Thêm `PATCH /api/v1/attachments/{id}` (chỉ nhận `description`, ownership check `AND userId = $1` như mọi handler khác) + mục trong `openapi.yaml`, rồi cho phép sửa inline trong `website/src/components/attachment-gallery.tsx`. |

### #9 — Parity điều hướng mobile + badge nhắc nhở đang chết
| | |
|---|---|
| **Trạng thái** | ✅ **Đã xong** — `MobileBottomNav` không còn lọc cứng danh sách href: nó render **đủ 7 mục** (kể cả `/reminders` và `/stats`) trong một dải cuộn ngang, và badge điều kiện `item.href === '/reminders'` nay có thể đúng. |
| **Khu vực** | `web` |
| **Vì sao** | `[repo]` Hai lỗi trong cùng một component. (a) `MobileBottomNav` lọc cứng danh sách href về `['/dashboard','/devices','/subscriptions','/wishlist','/settings']` (`website/src/components/sidebar.tsx:141-145`), nên `/reminders` và `/stats` **không có lối vào nào trên mobile** (sidebar ẩn từ `md:` trở xuống — dòng 148). (b) Vì bộ lọc đó, điều kiện `item.href === '/reminders'` ở dòng 154 **không bao giờ đúng** ⇒ badge số nhắc nhở **không bao giờ hiển thị trên mobile**, dù `reminderCount` vẫn được truyền vào và vẫn được tính. Đây là bug logic thuần, không phải thiếu sót thiết kế. |
| **Tác động** | **Trung bình.** Người dùng mobile (phần lớn traffic của một app cá nhân) không thấy được nhắc nhở bảo hành — tức là tính năng lõi. |
| **Effort** | **S** |
| **Bước đầu** | Sửa `mobileItems` để đưa `/reminders` vào (đổi `/settings` sang menu phụ hoặc dùng nút "Thêm"), hoặc đổi badge sang so khớp theo `match(pathname)`. Cách rẻ nhất: thay `/settings` bằng `/reminders` trong mảng 5 mục và giữ badge hiện có. |

### #10 — Sửa hồ sơ: tên hiển thị + đổi email
| | |
|---|---|
| **Trạng thái** | 🟡 **API xong cả hai vế, client đổi email chưa nối.** Tên: `PATCH /api/v1/auth/me` chỉ nhận `displayName` (≤80 byte; `""`/`null` = xoá) — web/iOS/Android đều có form. Email (**🆕 chưa commit**): `POST /api/v1/auth/change-email` + `POST /api/v1/auth/confirm-email-change`, migration `0009_email_change.sql` (cột `pendingEmail` trên `PasswordReset`; token gửi tới địa chỉ **mới**, hash + TTL + dùng một lần, không thể lẫn với token reset mật khẩu). Link trong mail trỏ `/confirm-email/<token>` nhưng **web chưa có route đó** — đây là việc kế tiếp rõ ràng nhất. |
| **Khu vực** | `api` + `web` + `ios` + `android` |
| **Vì sao** | `[repo]` Không tồn tại đường nào để sửa hồ sơ. `grep -rniE "displayName\|updateProfile\|PATCH /api/v1/auth"` trên `api/internal/handlers/auth.go` và `website/src/app/actions/auth.ts` → **0 kết quả**. Trang cài đặt chỉ có 6 mục: Giao diện, Thông báo, Đổi mật khẩu, Quét hoá đơn (AI), Sao lưu & khôi phục, Xoá tài khoản (`website/src/app/(app)/settings/page.tsx:23-49`). Nghĩa là **đổi email là không thể** — cách duy nhất là xoá tài khoản và làm lại, kéo theo mất toàn bộ dữ liệu và ảnh. |
| **Tác động** | **Trung bình.** |
| **Effort** | **M** (đổi email cần luồng xác minh, không chỉ một UPDATE) |
| **Bước đầu** | Tách làm hai: (1) `PATCH /api/v1/auth/me` chỉ cho `displayName` — rẻ, an toàn, làm ngay; (2) đổi email để sau, cần luồng xác nhận 2 bước và có thể tái dùng hạ tầng `PasswordReset` (`api/migrations/0001_initial.sql:51`) + email service đã có. |

### #11 — Entity "lần đi bảo hành" (`WarrantyClaim`) + lịch sử sửa chữa
| | |
|---|---|
| **Trạng thái** | 📄 **Spec xong, chưa có code** — `docs/SPEC-WARRANTY-CLAIM.md`. Schema vẫn **không** có bảng claim/repair (17 bảng, không bảng nào liên quan). Trang landing cũng đã thôi hứa tính năng này (commit `0e4664f`: "khi cần claim" → "khi cần đi bảo hành"). |
| **Khu vực** | `api` + `web` + `ios` + `android` |
| **Vì sao** | `[repo]` Không có khái niệm này trong schema: 16 bảng trong `api/migrations/0001_initial.sql` không có bảng nào cho claim/repair. `[suy luận]` Đây là **lỗ hổng sản phẩm lớn nhất**: app nhắc "sắp hết bảo hành" rồi dừng — đúng lúc người dùng cần hành động. `[ngoài]` Việc chứng minh yêu cầu bảo hành là bài toán "có đủ giấy tờ trong tay hay không" — cần hoá đơn có ngày mua, nơi bán và số serial/IMEI (`unstore.io` — nguồn yếu, xem §6). Một claim entity biến app từ *sổ ghi chú* thành *công cụ xử lý*. |
| **Tác động** | **Cao về giá trị sản phẩm**, thấp về mức khẩn cấp. |
| **Effort** | **XL** — bước đầu cố tình giới hạn ở spec |
| **Bước đầu** | **Chỉ viết spec, không viết code.** Thiết kế schema `WarrantyClaim` (`warrantyId`, `openedAt`, `issue`, `status ∈ {DRAFT,SENT,IN_REPAIR,RESOLVED,REJECTED}`, `resolvedAt`, `cost`, `notes`, `attachments`) thành một mục trong `openapi.yaml` + một file `docs/` đề xuất. Chỉ khi spec được duyệt mới đụng migration. |

### #12 — Bán lại / khấu hao thiết bị
| | |
|---|---|
| **Trạng thái** | ✅ **Đã xong** — `0006_device_resale.sql` thêm `soldAt` + `soldPrice` (nullable; ràng buộc "gửi cả hai hoặc không gửi gì" validate ở `services/devices.go`, **không** đặt ở DB để row cũ không bị chặn). Cả 3 client hiện "Ngày bán / Giá bán / lãi-lỗ". |
| **Khu vực** | `api` + `web` |
| **Vì sao** | `[repo]` `Device` có `status` và đã có giá trị `'SOLD'` trong taxonomy (`api/internal/services/stats.go:14`: `ACTIVE, EXPIRED, SOLD, BROKEN, LOST`), **nhưng bảng `Device` không có `soldAt`, `soldPrice`, `currentValue`** (`api/migrations/0001_initial.sql:114-135`: chỉ có `purchaseDate`, `purchasePrice`). Nghĩa là app biết một thiết bị "đã bán" nhưng không biết bán bao nhiêu, khi nào ⇒ không tính được lãi/lỗ thực. |
| **Tác động** | **Trung bình.** Ăn khớp tự nhiên với `/stats` sau khi #3 xong. |
| **Effort** | **M** |
| **Bước đầu** | Thêm 2 cột nullable `soldAt` + `soldPrice` vào `Device` qua migration mới, hiện "Đã bán: <giá> — lãi/lỗ <số>" ở `website/src/app/(app)/devices/[id]/page.tsx`, và thêm dòng "Giá trị còn lại" vào `/stats`. |

### #13 — Lịch bảo trì định kỳ cho đồ gia dụng
| | |
|---|---|
| **Trạng thái** | 📄 **Spec xong, khuyến nghị HOÃN build** — `docs/SPEC-MAINTENANCE-SCHEDULES.md` chia tiền đề thành 2 vế: vế "cung" (dịch vụ bảo trì có thật ở VN) **đã xác minh**; vế "cầu" (hộ gia đình muốn app nhắc) **không có bằng chứng nào**. Schema vẫn chưa đổi: `Reminder` vẫn gắn cứng `warrantyId`. |
| **Khu vực** | `api` + `web` + `ios` + `android` |
| **Vì sao** | `[repo]` Hệ thống nhắc nhở chỉ biết 3 loại: bảo hành, subscription, wishlist — cron `api/cmd/cron` (và `POST /api/v1/cron/warranty-check`) fan-out đúng các loại đó, và `Reminder` gắn cứng vào `warrantyId` (`api/migrations/0001_initial.sql:174-183`: `"warrantyId" text NOT NULL` + FK). Muốn nhắc "vệ sinh điều hoà" thì phải làm generic hoá `Reminder`. `[suy luận]` Điều hoà và máy lọc nước là đồ gia dụng phổ biến ở VN cần bảo trì định kỳ, nhưng **tôi chưa kiểm chứng được** tần suất/thói quen bằng nguồn nào — coi đây là giả thuyết cần phỏng vấn người dùng trước khi build. |
| **Tác động** | **Trung bình** (khác biệt hoá nếu giả thuyết đúng). |
| **Effort** | **L** (đổi schema `Reminder` + backfill + sửa cả 3 client đọc reminder) |
| **Bước đầu** | **Chưa viết code.** Xác minh giả thuyết trước: hỏi 5–10 người dùng thật xem họ có đang tự nhắc việc bảo trì không. Nếu có, migration tiếp theo mới thêm `DeviceMaintenanceSchedule` (bảng riêng, **không** sửa `Reminder`) để tránh phá vỡ cron hiện tại. |

### #14 — Export CSV
| | |
|---|---|
| **Trạng thái** | ✅ **Đã xong ở cả 3 client, theo đúng "cách 2" (rẻ hơn)** — không thêm endpoint Go nào. Web: server action `website/src/app/actions/csv.ts` + `lib/csv.ts` / `lib/csv-export.ts` (devices, subscriptions, wishlist; có BOM cho Excel). iOS: `DeviceCSVExport`. Android: `android/.../export/CsvExport.kt`. |
| **Khu vực** | `api` + `web` |
| **Vì sao** | `[repo]` Không tồn tại: `grep -rniE "csv"` trên `website/src` và `api/internal` → **0 kết quả**. `[ngoài]` Tiêu chí đánh giá app warranty-tracking có uy tín thấp nhưng nhất quán: khả năng "export to CSV or PDF for handing the file to an adjuster or a shared spreadsheet" được liệt kê như một tiêu chí chọn app (`unstore.io`, xem §6 — nguồn yếu, chỉ dùng làm tín hiệu). |
| **Tác động** | **Thấp–trung bình.** Nhưng là "van an toàn" chống khoá dữ liệu, và backup JSON đã có sẵn nên chi phí thấp. |
| **Effort** | **S** |
| **Bước đầu** | Thêm `GET /api/v1/devices/export.csv` trong Go (stream CSV, `Content-Disposition: attachment`), hoặc rẻ hơn: sinh CSV ở web từ `api.devices.list()` đã có sẵn trong `stats/page.tsx`. Ưu tiên cách 2 vì không cần đụng openapi. |

### #15 — OCR: trích xuất IMEI/serial + số tháng bảo hành, nhận cả hoá đơn PDF
| | |
|---|---|
| **Trạng thái** | 🟡 **serial + số tháng: xong. PDF: vẫn KHÔNG hỗ trợ.** `api/internal/ai/extract.go` có `serialNumber` + `warrantyMonths` (chặn 0–120) trong cả tool schema lẫn system prompt, có test. Magic-byte whitelist **cho phép** PDF (`api/internal/files/mime.go`), nhưng đường OCR **từ chối** PDF bằng 400 rõ ràng (`services/ai_extract.go:121-128`, comment vẫn ghi "PDF OCR is NOT supported"). Muốn có thì phải làm thật, không phải bật cờ. |
| **Khu vực** | `ai` + `api` |
| **Vì sao** | `[repo]` Pipeline OCR đã tồn tại và trả draft (`api/internal/services/ai_extract.go`, `POST /api/v1/ai/extract-receipt`), map fuzzy về catalog. Nhưng `Device.serialNumber` đã có sẵn trong schema (`api/migrations/0001_initial.sql:120`) và đang **không được OCR điền**. `[ngoài]` Theo hướng dẫn tra cứu bảo hành của FPT Shop, bảo hành điện tử ở VN được lưu **theo IMEI hoặc số serial**, một số sản phẩm **vẫn yêu cầu hoá đơn** để xác minh thời điểm mua, và thời hạn có thể tính từ **ngày kích hoạt, ngày mua hoặc ngày xuất kho** tuỳ hãng (`fptshop.com.vn`, đã fetch — xem §6). Điều này khiến serial/IMEI trở thành **định danh bảo hành thật**, không phải ghi chú phụ. |
| **Tác động** | **Trung bình.** Tăng độ chính xác draft, giảm gõ tay — và đúng với cách bảo hành ở VN vận hành. |
| **Effort** | **M** |
| **Bước đầu** | Mở rộng tool schema trong `api/internal/ai/` để trích thêm `serialNumber` và `warrantyMonths`; kiểm tra xem `attachment` hiện có whitelist magic-byte chặn PDF không (`api/internal/files/` — magic-byte whitelist được ghi trong CLAUDE.md) trước khi hứa hỗ trợ PDF. |

---

## 4. Việc bị chặn bởi tiền/tài khoản

**Các mục dưới đây KHÔNG được xếp hạng trong top 15** vì chúng bị chặn bởi chi tiêu hoặc tài khoản
bên thứ ba, không phải bởi công việc kỹ thuật. Toàn bộ top 15 làm được ngay hôm nay, không tốn xu nào.
Đừng để danh sách này chiếm chỗ của việc không bị chặn.

| # | Việc | Chặn bởi | Ghi chú |
|---|---|---|---|
| B1 | Triển khai production (VPS + domain + TLS) | Tiền VPS + tên miền | Templated sẵn: `deploy/systemd/*`, `deploy/caddy/Caddyfile`, `deploy/PRODUCTION_CHECKLIST.md`, `docker-compose.yml`. Đây là thứ **mở khoá** mọi thứ khác. ~~nhưng #1 phải xong trước~~ → **#1 đã xong (2026-10-03)**, không còn lý do kỹ thuật nào để hoãn. Checklist còn nhắc một ràng buộc thật: DB **phải** có encoding UTF8, nếu không tìm kiếm tiếng Việt trả rỗng trong im lặng. |
| B2 | Phát hành iOS / APNs thật | Apple Developer Program **$99/năm** | Cần `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY` (`.p8`), `APNS_PRODUCTION=1`. Code đã sẵn sàng trong `api/internal/push/` + `ios/App/Core/Push/*`. |
| B3 | Push FCM thật cho Android | Project Firebase | Cần `FCM_SERVICE_ACCOUNT_JSON` **và** `android/app/google-services.json` thật (hiện vẫn là stub `project_number: "000"`). Code đã sẵn sàng trong `api/internal/push/`. |
| B4 | Rate limit phân tán | Tài khoản Upstash | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (+ `RATE_LIMITER=upstash`, giá trị `redis` cũng được — xem `api/internal/ratelimit/factory.go`). **Không chặn**: tự fallback sang token-bucket trong bộ nhớ, chỉ không scale ngang được. |
| B5 | Email thật (đặt lại mật khẩu **và** xác nhận đổi email) | Tài khoản Resend (`RESEND_API_KEY` + `RESEND_FROM` trên domain đã verify) | Không có key thì `/forgot` **chỉ ghi link ra log** ⇒ mất mật khẩu = mất tài khoản. Từ đợt này luồng **đổi email cũng phụ thuộc đúng hạ tầng đó** (token xác nhận gửi tới địa chỉ mới), nên thiếu B5 thì tính năng đổi email coi như không dùng được ngoài dev. |
| B6 | OCR hoá đơn thật | `ANTHROPIC_API_KEY` | Không có key thì endpoint trả 503 `feature_disabled` và **server vẫn boot bình thường** — degrade an toàn. Compose đã forward `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` (commit `daa9d29`) nên đặt trong `.env` là có tác dụng. |
| B7 | Diễn tập restore thật (khôi phục từ backup) | Một VPS/DB staging | Việc này **phải** làm trước khi tin vào backup — và **vẫn chưa làm**. #2 nay đã có đường mang blob theo (`?includeBlobs=true` → .zip), nhưng blob là ciphertext mà key wrap bằng `FILE_MASTER_KEY`: restore sang máy khác khoá là **file vẫn về nhưng không mở được**. Vì vậy bài diễn tập phải kiểm **cả hai** định dạng, và bước quyết định là mở thử một ảnh hoá đơn sau khi restore. `deploy/backup.sh` archive cả volume blob; chưa ai đem đi restore thử. |

---

## 5. Đã cân nhắc và loại

Ghi lại để người sau không phải tranh luận lại. Mỗi mục kèm lý do một dòng.

**Loại vì đã tồn tại (kiểm tra trước khi làm lại):**
- **Quản lý thiết bị push trên mobile** — đã có: `ios/App/Features/Settings/PushDevicesView.swift`, `android/.../PushDevicesScreen.kt`. Web từng thiếu ⇒ gộp vào #4, và **#4 nay đã xong** (`website/src/components/push-devices.tsx`).
- **Sửa chart của iOS cho bằng web** — ~~placeholder 0~~ **đã sửa**: `ios/Sources/WarrantyVaultKit/StatsRollup.swift` (có test `StatsRollupTests`) + `StatsView` vẽ `monthlyBuckets` / `categoryTotals` thật. Không còn là nợ kỹ thuật.
- **Lịch sử thanh toán subscription** — đã có và đã hiển thị: `SubscriptionPayment` được dùng bởi `POST /api/v1/subscriptions/{id}/payments` và `.../renew`, và `website/src/app/(app)/subscriptions/[id]/page.tsx:201-214` đã vẽ "Lịch sử thanh toán". **Không phải gap.**
- **Lịch sử giá wishlist** — đã có: `WishlistPrice` + `POST /api/v1/wishlist/{id}/prices` + `UpdatePriceDialog` trong `website/src/components/wishlist-actions.tsx:23`. **Không phải gap.**
- **Dark mode / theme** — đã có: `website/src/components/appearance-tweaks.tsx`, `theme-toggle.tsx`.

**Loại vì không đáng làm bây giờ:**
- **Phân trang (pagination) cho danh sách.** Đã xác nhận thiếu: `GET /api/v1/devices` không có `limit`/`offset`/`page` (`openapi.yaml:194-200`). **Nhưng** giới hạn cứng trong Go (50 thiết bị / 100 subscription / 200 wishlist — `api/internal/services/`) khiến payload tệ nhất vẫn nhỏ; thêm phân trang bây giờ là tối ưu hoá một vấn đề chưa tồn tại, đồng thời phải sửa cả 3 client. **Hoãn có ý thức**, không phải bỏ quên.
- **i18n / tiếng Anh.** Tiếng Việt là quyết định sản phẩm có chủ đích (CLAUDE.md: "All user-facing strings are Vietnamese"), không phải thiếu sót.
- **Xây một admin CRUD app đầy đủ.** Với #1, một migration seed + SQL là đủ. Một admin UI là sản phẩm riêng, chỉ hợp lý khi có người vận hành catalog thường xuyên — hiện chưa có.
- **Quét mã vạch / QR.** Xuất hiện ở các app inventory đối thủ (`[ngoài]` Sortly/iTrackMine có barcode scanning — nguồn yếu, §6), nhưng #15 (OCR điền serial/IMEI) giải quyết cùng vấn đề "nhập liệu" với chi phí thấp hơn nhiều và không cần camera native trên web được. *(#15 phần serial/IMEI nay đã xong.)*

**Loại vì chưa kiểm chứng được (không phải vì không hay):**
- **Tự động đọc hoá đơn điện tử (XML/PDF hàng loạt).** `[ngoài]` Có cổng tra cứu hoá đơn điện tử của nhà bán lẻ (ví dụ `hddt.fptshop.com.vn`) nhưng **tôi chưa kiểm chứng** có API/định dạng tiêu dùng nào để app cá nhân đọc được. Không có bằng chứng ⇒ không đưa vào roadmap. Nếu muốn theo đuổi, đây là việc **nghiên cứu**, không phải việc code.
- **Đồng bộ giao dịch ngân hàng/ví (MoMo, ZaloPay) để tự phát hiện subscription.** **Không tìm được** API tiêu dùng công khai nào trong quá trình nghiên cứu. Đây là loại tính năng mà nếu làm dựa trên giả định sai sẽ tốn hàng tháng. Cần xác minh trước.
- **Theo dõi giá bán lẻ cho wishlist (scraping Điện Máy Xanh / Shopee / Lazada).** Không có API công khai nào được xác minh, và scraping các sàn này có rủi ro pháp lý/ToS chưa được đánh giá. `[suy luận]` Rủi ro cao hơn giá trị. **Không làm** cho tới khi có nguồn dữ liệu hợp pháp.
- **Barcode/OCR cho hoá đơn nhiệt mờ.** `[ngoài]` Được nhắc là khó (Encircle "handles smudged thermal paper") nhưng tôi không có dữ liệu kiểm chứng về chất lượng OCR của chính mình ⇒ không hứa.

**Loại vì không phải vấn đề của repo này:**
- **Tài khoản chia sẻ trong gia đình.** Multi-user ở đây là *nhiều tài khoản riêng biệt*, mỗi người dữ liệu riêng ("Mỗi tài khoản dữ liệu riêng, không chia sẻ" — `settings/page.tsx:62`). Chia sẻ là thay đổi mô hình dữ liệu + quyền, không phải một tính năng. Không có bằng chứng nhu cầu ⇒ không đưa vào.

---

## 6. Nguồn tham khảo

### Đã fetch và đọc trực tiếp
- **Nghị định 55/2024/NĐ-CP** (quy định chi tiết Luật Bảo vệ quyền lợi người tiêu dùng), hiệu lực
  **01/7/2024** — [toàn văn](https://phapluat.suckhoedoisong.vn/toan-van-nghi-dinh-55-2024-nd-cp-quy-dinh-chi-tiet-mot-so-dieu-cua-luat-bao-ve-quyen-loi-nguoi-tieu-dung-48390.html)
  (nguồn: Báo Sức khoẻ & Đời sống, dẫn lại `xaydungchinhsach.chinhphu.vn`).
  **Phát hiện quan trọng — và là một cảnh báo chống bịa:** tôi đã đọc toàn văn nghị định này và nó
  **KHÔNG** quy định thời hạn bảo hành cho hàng hoá. Nội dung của nó là: hợp đồng theo mẫu / điều
  kiện giao dịch chung, sản phẩm hàng hoá **có khuyết tật** (thu hồi), bán hàng đa cấp, giao dịch
  từ xa, nền tảng số lớn. **Vì vậy: bất kỳ ai nói "luật VN bắt buộc bảo hành X tháng" đều cần dẫn
  nguồn khác** — nghị định này không phải nguồn đó.
- **Hướng dẫn tra cứu thời gian bảo hành — FPT Shop** —
  [bài viết](https://fptshop.com.vn/tin-tuc/thu-thuat/cach-tra-cuu-thoi-gian-bao-hanh-san-pham-209578).
  Các dữ kiện dùng trong #15: bảo hành điện tử lưu theo **IMEI/serial**; thời hạn có thể tính từ
  **ngày kích hoạt / ngày mua / ngày xuất kho** tuỳ hãng; một số sản phẩm **vẫn cần hoá đơn**; có thể
  tra cứu tại nơi mua bằng **số điện thoại đã dùng khi mua**. Trang này cũng xác nhận sự tồn tại của
  hai cổng tra cứu: [tra cứu bảo hành](https://fptshop.com.vn/kiem-tra-bao-hanh?tab=thong-tin-bao-hanh)
  và [tra cứu hoá đơn điện tử](https://hddt.fptshop.com.vn/), cùng
  [chính sách bảo hành](https://fptshop.com.vn/ho-tro/chinh-sach-bao-hanh) và
  [chính sách đổi trả](https://fptshop.com.vn/ho-tro/chinh-sach-doi-san-pham).
  *Lưu ý:* đây là trang của **nhà bán lẻ**, tức là phát ngôn của một bên — dùng làm mô tả **thực tế
  vận hành**, không phải nguồn pháp lý.
- **Danh sách app warranty-tracking (8 app)** — [unstore.io](https://unstore.io/discover/best-apps-for-warranty-tracking-android/).
  **Chất lượng nguồn: YẾU** — đây là bài SEO dạng listicle, không phải đánh giá độc lập. Tôi **cố ý
  không** trích giá, điểm số hay số người dùng từ bài này (không kiểm chứng được). Chỉ dùng nó làm
  tín hiệu về **nhóm tiêu chí** mà thị trường quan tâm: nhắc trước khi hết hạn, OCR hoá đơn, nhiều
  ảnh/tài liệu trên một bản ghi, gắn thẻ theo phòng/loại, **export CSV/PDF**, **truy cập offline**.
- **Unikorn.vn — "Subkit: See where your money goes"** — [trang sản phẩm](https://unikorn.vn/p/subkit).
  Unikorn.vn tự mô tả là nền tảng giới thiệu sản phẩm công nghệ do **người Việt** làm. Trang chi tiết
  **không render được nội dung** khi fetch (JS-heavy) ⇒ **chỉ xác nhận sự tồn tại** của một app theo
  dõi subscription do người Việt làm; **không** xác nhận được tính năng, giá, hay quy mô. Không dùng
  làm bằng chứng cho bất kỳ khẳng định nào khác.

### Tìm thấy qua tìm kiếm nhưng CHƯA fetch được / chưa đọc
Ghi rõ ở đây để người sau không nhầm là đã kiểm chứng:
- **Luật số 19/2023/QH15** (Luật Bảo vệ quyền lợi người tiêu dùng), hiệu lực **01/7/2024** —
  [vanban.chinhphu.vn](https://vanban.chinhphu.vn/?classid=1&docid=208363&orggroupid=1&pageid=27160)
  và [tulieuvankien.dangcongsan.vn](https://tulieuvankien.dangcongsan.vn/he-thong-van-ban/van-ban-quy-pham-phap-luat/luat-bao-ve-quyen-loi-nguoi-tieu-dung-so-192023qh15-hieu-luc-thi-hanh-tu-ngay-0172024-9693).
  Tôi xác nhận được **số hiệu + ngày hiệu lực** qua tiêu đề nguồn, nhưng **chưa đọc trực tiếp** nội
  dung Điều 32 ("Trách nhiệm bảo hành hàng hóa, linh kiện, phụ kiện") — bản mirror tôi thử fetch trả
  **HTTP 403**. ⇒ **Không** đưa ra khẳng định nào về nội dung điều luật này trong roadmap.
- **Bài về trách nhiệm bảo hành** trên cổng thông tin Cục Cạnh tranh và Bảo vệ người tiêu dùng
  (Bộ Công Thương) — [dnvntd.bvntd.gov.vn](https://dnvntd.bvntd.gov.vn/hoat-dong-bao-hanh-san-pham-trong-giao-dich-ban-hang-truc-tiep-doanh-nghiep-da-dam-bao-quyen-loi-nguoi-tieu-dung-chua-a866).
  Nguồn chính thống, nhưng **chưa fetch** ⇒ chỉ liệt kê làm điểm bắt đầu cho người muốn đào sâu pháp lý.
- **Chính sách bảo hành CellphoneS** —
  [cellphones.com.vn](https://cellphones.com.vn/quy-che-hoat-dong-ung-dung-cellphones/chinh-sach-bao-hanh).
  URL tồn tại; **nội dung chưa đọc** ⇒ không trích dẫn điều khoản nào.
- **Trung tâm bảo hành Điện Máy Xanh** — [dienmayxanh.com/bao-hanh](https://www.dienmayxanh.com/bao-hanh).
  URL tồn tại (tra cứu theo hãng/sản phẩm); **nội dung chưa đọc**.

### Những gì tôi KHÔNG kiểm chứng được (và vì thế không đưa vào roadmap)
- Số liệu thị trường VN: số người dùng smartphone, số subscription trung bình/người, số ví điện tử.
  **Không tìm được nguồn đủ tin cậy** trong phạm vi nghiên cứu này ⇒ **không có con số nào** trong
  tài liệu này.
- Có tồn tại app **quản lý bảo hành/tài sản** nào của người Việt hay không. Chỉ tìm được tín hiệu về
  một app **subscription** (Subkit, mục trên). ⇒ Không khẳng định "chưa có đối thủ VN", vì không
  chứng minh được điều phủ định.
- Mọi thông tin về yêu cầu pháp lý cụ thể (thời hạn bảo hành tối thiểu, nghĩa vụ cấp hoá đơn cho
  khách cá nhân, quyền đổi trả bắt buộc). Như đã nêu, nghị định 55/2024 không quy định các điều này,
  và tôi chưa đọc được toàn văn Luật 19/2023/QH15.
