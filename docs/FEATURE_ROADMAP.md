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

## 1. Tóm tắt

**Hiện trạng.** Về mặt kỹ thuật, repo này đã ở trạng thái rất tốt và hiếm gặp: Go là backend duy nhất
sở hữu Postgres, `openapi.yaml` là hợp đồng thật (34 path, khớp với 38 route đăng ký trong
`api/internal/handlers/*.go`), web là UI mỏng proxy toàn bộ read/write qua `website/src/lib/api/*`,
và hai client native (iOS/Android) nói cùng một REST API. Các tính năng khó đã xong: OCR hoá đơn bằng
AI có opt-in theo user, push đa nền tảng (VAPID/APNs/FCM), cron nhắc bảo hành/subscription/wishlist,
file đính kèm mã hoá AES-256-GCM, backup/restore JSON, xoá tài khoản.

**Việc quan trọng nhất còn thiếu — và nó là một lỗi chặn, không phải tính năng.**

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

**Việc quan trọng nhất còn thiếu về mặt sản phẩm** (khác với việc trên): app theo dõi *ngày hết hạn*
nhưng không hỗ trợ *việc đi bảo hành*. Không có entity `WarrantyClaim`, không có lịch sử sửa chữa
(`grep CREATE TABLE api/migrations/*.sql` → 16 bảng, không bảng nào cho claim/repair). Chu trình
người dùng dừng đúng lúc giá trị nhất: nhận thông báo → … → hết.

**Kết luận thẳng.** Repo này không thiếu tính năng hào nhoáng; nó thiếu (a) một bước seed để chạy
được, (b) sự thật trong vài chỗ copy/UX đang nói dối người dùng, và (c) vòng lặp nghiệp vụ cuối
cùng của domain. Xếp hạng dưới đây phản ánh đúng thứ tự đó.

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
| **Khu vực** | `api` (+ `deploy`, `web`) |
| **Vì sao** | `[repo]` Đây là **lỗi chặn**: bảng `Category` rỗng trên DB mới → `CreateDevice`/`UpdateDevice` (`api/internal/services/devices.go:302,397`) và wishlist (`api/internal/services/wishlist.go:181,280`) trả 400 "Loại thiết bị không hợp lệ"; combobox loại ở `website/src/components/device-form.tsx:342` rỗng. Đường quản trị được tài liệu hoá (Prisma Studio — `api/internal/services/catalog.go:18,124`) đã bị gỡ cùng Prisma và không có route/trang admin thay thế. |
| **Tác động** | **Nghiêm trọng.** Không có mục này thì mọi mục còn lại đều vô nghĩa trên production. |
| **Effort** | **M** |
| **Bước đầu** | Viết `api/migrations/0004_seed_catalog.sql` (goose) insert đúng ~20 code trong `CATEGORY_LABELS` (`website/src/lib/types.ts:5-25`: `PHONE, LAPTOP, TABLET, SMARTWATCH, HEADPHONE, SPEAKER, CAMERA, TV, MONITOR, KEYBOARD, MOUSE, GAMING_CONSOLE, AC, FRIDGE, WASHING, KITCHEN, APPLIANCE, ELECTRONICS, FURNITURE, OTHER`) với `name` tiếng Việt + `sortOrder`, kèm vài chục `Store` phổ biến (Điện Máy Xanh, FPT Shop, CellphoneS, Shopee…) và `WarrantyProvider`. Sau đó sửa 2 comment ở `catalog.go` cho khỏi nói dối. |

### #2 — Backup phải bao gồm ảnh, và copy hướng dẫn đang sai
| | |
|---|---|
| **Khu vực** | `api` + `web` |
| **Vì sao** | `[repo]` `website/src/components/backup-tools.tsx` nói với người dùng 2 lần rằng ảnh nằm ở `public/uploads` (dòng 44, 70-72) và "sao chép lại folder `public/uploads`" (dòng 108). **Điều này sai**: attachment là blob mã hoá AES-256-GCM do Go sở hữu dưới `PRIVATE_UPLOAD_ROOT`; `Attachment` lưu `iv` + `wrappedKey` trong DB (`api/migrations/0001_initial.sql:158-172`) nên **copy thư mục ảnh là vô nghĩa** — thiếu `FILE_MASTER_KEY` thì blob không giải mã được. Nghiêm trọng hơn: JSON backup chỉ chứa metadata attachment, nên **restore sang máy mới = mất toàn bộ ảnh hoá đơn vĩnh viễn**, đúng thứ tài liệu hứa sẽ bảo vệ. |
| **Tác động** | **Cao.** Rủi ro mất dữ liệu thật + copy sai làm người dùng tin nhầm là đã an toàn. |
| **Effort** | **S** cho phần copy, **M** cho phần nhúng bytes ảnh vào backup |
| **Bước đầu** | Sửa ngay 3 đoạn copy trong `backup-tools.tsx` để nói thật (ảnh **không** nằm trong file JSON và **không** ở `public/uploads`). Sau đó thiết kế định dạng backup v2: hoặc (a) `.zip` gồm `data.json` + `attachments/<id>.enc`, hoặc (b) ghi rõ "backup này không gồm ảnh" và cảnh báo đỏ trong UI. |

### #3 — `/stats`: tính đúng chi phí bảo hành + chi phí subscription, dùng một nguồn sự thật
| | |
|---|---|
| **Khu vực** | `web` + `api` |
| **Vì sao** | `[repo]` Trang `/stats` chỉ cộng `Device.purchasePrice` — `website/src/app/(app)/stats/page.tsx` dòng 34, 50, 68, 90. Nó **bỏ qua** `Warranty.cost` và **bỏ qua toàn bộ** subscription. Trong khi đó `GET /api/v1/stats` **đã** trả `subscriptions.totalMonthlyVnd` và **đang được dùng** — Android (`android/.../ui/screens/stats/StatsScreen.kt:237`) và iOS (`ios/App/Features/Stats/StatsView.swift:179` dùng `snap.monthlyEquivalent`) đều hiển thị chi phí subscription; **chỉ web không gọi endpoint đó**. Bằng chứng mạnh nhất: `website/src/lib/api/stats.ts` là **code chết** — `grep -rn "lib/api/stats"` trên toàn bộ `website/src` trả **0 importer**. Và `UserStats` trong `openapi.yaml:1497` **không có field nào** cho chi phí bảo hành, nên đây là khoảng trống **toàn hệ thống**, không riêng web. |
| **Tác động** | **Cao.** Con số "Tổng chi" — chỉ số headline của trang — đang sai ở cả 3 nền tảng. |
| **Effort** | **M** |
| **Bước đầu** | Thêm query `StatsWarrantiesCost` (SUM `Warranty.cost` theo `userId`) vào `api/internal/store/queries/stats.sql`, thêm field `totalWarrantyCost` vào `DeviceStats`, cập nhật `openapi.yaml:1497`. Song song, đổi `stats/page.tsx` sang gọi `api.stats.get()` thay vì rollup trong RSC — vì các chart phái sinh (`monthlySpendBuckets`, `spendByCategoryRollup`) vẫn cần `DeviceListItem[]`, giữ lại 1 call `api.devices.list()` và **chỉ** lấy con số tổng từ Go. |

### #4 — Web: trang quản lý thiết bị nhận thông báo (push devices)
| | |
|---|---|
| **Khu vực** | `web` |
| **Vì sao** | `[repo]` Web **không có chỗ nào** liệt kê hay xoá thiết bị đã đăng ký push. `listMySubscriptions()` (`website/src/app/actions/push.ts:57`) và `api.push.list` (`website/src/lib/api/push.ts:32`) có **0 caller** — `grep -rn "listMySubscriptions"` chỉ khớp đúng dòng định nghĩa. Backend đã sẵn sàng: `GET /api/v1/push` và `DELETE /api/v1/push/{id}` (`api/internal/handlers/push.go:24,26`). **Đây là gap của riêng web**: iOS đã có `ios/App/Features/Settings/PushDevicesView.swift`, Android đã có `android/.../ui/screens/settings/PushDevicesScreen.kt` + test riêng (`PushDevicesViewModelTest.kt`). |
| **Tác động** | **Trung bình–cao.** Là vấn đề quyền riêng tư: người dùng không thể thu hồi thông báo khỏi một máy đã mất/bán. |
| **Effort** | **S** (backend + 2 client tham chiếu đã có, chỉ cần port) |
| **Bước đầu** | Thêm section "Thiết bị nhận thông báo" vào `website/src/app/(app)/settings/page.tsx`, gọi `listMySubscriptions()` và render nút xoá gọi `DELETE /api/v1/push/{id}`. Port trực tiếp từ `PushDevicesScreen.kt`. |

### #5 — Nhắc nhở đã ẩn: xem lại + khôi phục (cần sửa API)
| | |
|---|---|
| **Khu vực** | `api` + `web` + `ios` + `android` |
| **Vì sao** | `[repo]` Ẩn nhắc nhở hiện là hành động **một chiều**. `website/src/app/(app)/reminders/page.tsx:179` hardcode `isDismissed={false}`. Nhưng sửa ở web là **không đủ**: `services.ListUpcomingReminders` (`api/internal/services/reminders.go:31-60`) loại reminder đã ẩn **trong SQL** và **không nhận tham số nào** để bao gồm chúng — comment ở `reminders/page.tsx:19-22` ghi rõ section "Đã ẩn" đã biến mất từ lúc chuyển sang Go. Nghĩa là **API hiện không có khả năng trả về reminder đã ẩn**. Điểm sáng: UI khôi phục đã được viết sẵn và bỏ không — `components/dismiss-button.tsx:38,56,61` đã có nhánh `isDismissed ? 'Hiện lại' : 'Đã xem, ẩn đi'`, chỉ chưa bao giờ nhận `true`. |
| **Tác động** | **Trung bình–cao.** Người dùng ẩn nhầm là mất thông tin vĩnh viễn trên UI. |
| **Effort** | **M** |
| **Bước đầu** | Thêm query param `includeDismissed=true` vào `GET /api/v1/reminders` (`api/internal/handlers/reminders.go`) + `openapi.yaml:727`, truyền xuống `ListUpcomingReminders`. Rồi ở web thêm tab "Đã ẩn" truyền `isDismissed` thật — logic restore đã có sẵn trong `DismissButton`. |

### #6 — Trang `/offline` đang hứa điều service worker không làm
| | |
|---|---|
| **Khu vực** | `web` |
| **Vì sao** | `[repo]` `website/public/sw.js` chỉ precache đúng một URL: `const OFFLINE_SHELL = ['/offline']` (dòng 4), và với navigation chỉ làm network-first → fallback về `/offline`. **Không có cache dữ liệu nào.** Nhưng `website/src/app/offline/page.tsx` nói với người dùng: *"Một số dữ liệu đã lưu trước đó vẫn xem được — phần còn lại sẽ sync khi có mạng."* Câu này **sai**, và còn hứa cả "sync" trong khi app không có cơ chế sync nào. Đây không chỉ là lỗi copy: tra cứu bảo hành tại cửa hàng là tình huống **offline thật** (sóng yếu trong siêu thị điện máy) — đúng use case mà tính năng này tồn tại để phục vụ. |
| **Tác động** | **Trung bình.** Mất niềm tin + bỏ lỡ use case có giá trị thật. |
| **Effort** | **S** (nói thật) / **M** (làm thật) |
| **Bước đầu** | Sửa copy trước (5 phút) để ngừng nói dối. Sau đó, nếu muốn làm thật: cache stale-while-revalidate cho `GET /v1/devices` và `GET /v1/devices/{id}` trong `sw.js`, kèm banner "dữ liệu có thể cũ". |

### #7 — Tìm kiếm tiếng Việt không dấu + tìm kiếm xuyên thực thể
| | |
|---|---|
| **Khu vực** | `api` (+ `web`, `ios`, `android`) |
| **Vì sao** | `[repo]` Tìm kiếm thiết bị dùng `ILIKE '%' || $4 || '%'` trên `name/brand/model/serialNumber` (`api/internal/store/queries/devices.sql:20-23`). `ILIKE` của Postgres **không** bỏ dấu: gõ `dien thoai` **không** khớp `Điện thoại`, `samsung galaxy` không khớp tên có dấu. Và `grep -rniE "unaccent\|tsvector\|pg_trgm\|CREATE EXTENSION" api/migrations/` → **0 kết quả**, nên không có extension nào hỗ trợ. Ngoài ra `q` chỉ áp dụng cho `Device`: không tìm được đồng thời subscription/wishlist. `[suy luận]` Với người dùng Việt gõ không dấu rất phổ biến, đây là ma sát hàng ngày chứ không phải chi tiết nhỏ. |
| **Tác động** | **Trung bình–cao** (UX lõi cho thị trường mục tiêu). |
| **Effort** | **M** |
| **Bước đầu** | `CREATE EXTENSION IF NOT EXISTS unaccent;` trong một migration goose mới, thêm index functional trên `unaccent(lower(name))` cho `Device`, và đổi `ListDevices` sang so khớp đã chuẩn hoá. Kiểm tra `unaccent` có sẵn trên Postgres 17 self-hosted (có trong `contrib`) — cần xác nhận trên image đang dùng trước khi cam kết. |

### #8 — Sửa được mô tả của file đính kèm
| | |
|---|---|
| **Khu vực** | `api` + `web` + `ios` + `android` |
| **Vì sao** | `[repo]` `Attachment` **có** cột `description` (`api/migrations/0001_initial.sql:158-172`), nhưng tập route attachment chỉ có 4 đường: `POST /api/v1/devices/{id}/attachments`, `GET /api/v1/devices/{id}/attachments`, `DELETE /api/v1/attachments/{id}`, `GET /api/files/{id}` (`api/internal/handlers/attachments.go:51-54`). **Không có PATCH** ⇒ mô tả là write-once: gõ sai lúc upload thì phải xoá file và upload lại. |
| **Tác động** | **Trung bình.** Ma sát nhỏ nhưng gặp thường xuyên, và chi phí sửa rất thấp. |
| **Effort** | **S** |
| **Bước đầu** | Thêm `PATCH /api/v1/attachments/{id}` (chỉ nhận `description`, ownership check `AND userId = $1` như mọi handler khác) + mục trong `openapi.yaml`, rồi cho phép sửa inline trong `website/src/components/attachment-gallery.tsx`. |

### #9 — Parity điều hướng mobile + badge nhắc nhở đang chết
| | |
|---|---|
| **Khu vực** | `web` |
| **Vì sao** | `[repo]` Hai lỗi trong cùng một component. (a) `MobileBottomNav` lọc cứng danh sách href về `['/dashboard','/devices','/subscriptions','/wishlist','/settings']` (`website/src/components/sidebar.tsx:141-145`), nên `/reminders` và `/stats` **không có lối vào nào trên mobile** (sidebar ẩn từ `md:` trở xuống — dòng 148). (b) Vì bộ lọc đó, điều kiện `item.href === '/reminders'` ở dòng 154 **không bao giờ đúng** ⇒ badge số nhắc nhở **không bao giờ hiển thị trên mobile**, dù `reminderCount` vẫn được truyền vào và vẫn được tính. Đây là bug logic thuần, không phải thiếu sót thiết kế. |
| **Tác động** | **Trung bình.** Người dùng mobile (phần lớn traffic của một app cá nhân) không thấy được nhắc nhở bảo hành — tức là tính năng lõi. |
| **Effort** | **S** |
| **Bước đầu** | Sửa `mobileItems` để đưa `/reminders` vào (đổi `/settings` sang menu phụ hoặc dùng nút "Thêm"), hoặc đổi badge sang so khớp theo `match(pathname)`. Cách rẻ nhất: thay `/settings` bằng `/reminders` trong mảng 5 mục và giữ badge hiện có. |

### #10 — Sửa hồ sơ: tên hiển thị + đổi email
| | |
|---|---|
| **Khu vực** | `api` + `web` + `ios` + `android` |
| **Vì sao** | `[repo]` Không tồn tại đường nào để sửa hồ sơ. `grep -rniE "displayName\|updateProfile\|PATCH /api/v1/auth"` trên `api/internal/handlers/auth.go` và `website/src/app/actions/auth.ts` → **0 kết quả**. Trang cài đặt chỉ có 6 mục: Giao diện, Thông báo, Đổi mật khẩu, Quét hoá đơn (AI), Sao lưu & khôi phục, Xoá tài khoản (`website/src/app/(app)/settings/page.tsx:23-49`). Nghĩa là **đổi email là không thể** — cách duy nhất là xoá tài khoản và làm lại, kéo theo mất toàn bộ dữ liệu và ảnh. |
| **Tác động** | **Trung bình.** |
| **Effort** | **M** (đổi email cần luồng xác minh, không chỉ một UPDATE) |
| **Bước đầu** | Tách làm hai: (1) `PATCH /api/v1/auth/me` chỉ cho `displayName` — rẻ, an toàn, làm ngay; (2) đổi email để sau, cần luồng xác nhận 2 bước và có thể tái dùng hạ tầng `PasswordReset` (`api/migrations/0001_initial.sql:51`) + email service đã có. |

### #11 — Entity "lần đi bảo hành" (`WarrantyClaim`) + lịch sử sửa chữa
| | |
|---|---|
| **Khu vực** | `api` + `web` + `ios` + `android` |
| **Vì sao** | `[repo]` Không có khái niệm này trong schema: 16 bảng trong `api/migrations/0001_initial.sql` không có bảng nào cho claim/repair. `[suy luận]` Đây là **lỗ hổng sản phẩm lớn nhất**: app nhắc "sắp hết bảo hành" rồi dừng — đúng lúc người dùng cần hành động. `[ngoài]` Việc chứng minh yêu cầu bảo hành là bài toán "có đủ giấy tờ trong tay hay không" — cần hoá đơn có ngày mua, nơi bán và số serial/IMEI (`unstore.io` — nguồn yếu, xem §6). Một claim entity biến app từ *sổ ghi chú* thành *công cụ xử lý*. |
| **Tác động** | **Cao về giá trị sản phẩm**, thấp về mức khẩn cấp. |
| **Effort** | **XL** — bước đầu cố tình giới hạn ở spec |
| **Bước đầu** | **Chỉ viết spec, không viết code.** Thiết kế schema `WarrantyClaim` (`warrantyId`, `openedAt`, `issue`, `status ∈ {DRAFT,SENT,IN_REPAIR,RESOLVED,REJECTED}`, `resolvedAt`, `cost`, `notes`, `attachments`) thành một mục trong `openapi.yaml` + một file `docs/` đề xuất. Chỉ khi spec được duyệt mới đụng migration. |

### #12 — Bán lại / khấu hao thiết bị
| | |
|---|---|
| **Khu vực** | `api` + `web` |
| **Vì sao** | `[repo]` `Device` có `status` và đã có giá trị `'SOLD'` trong taxonomy (`api/internal/services/stats.go:14`: `ACTIVE, EXPIRED, SOLD, BROKEN, LOST`), **nhưng bảng `Device` không có `soldAt`, `soldPrice`, `currentValue`** (`api/migrations/0001_initial.sql:114-135`: chỉ có `purchaseDate`, `purchasePrice`). Nghĩa là app biết một thiết bị "đã bán" nhưng không biết bán bao nhiêu, khi nào ⇒ không tính được lãi/lỗ thực. |
| **Tác động** | **Trung bình.** Ăn khớp tự nhiên với `/stats` sau khi #3 xong. |
| **Effort** | **M** |
| **Bước đầu** | Thêm 2 cột nullable `soldAt` + `soldPrice` vào `Device` qua migration mới, hiện "Đã bán: <giá> — lãi/lỗ <số>" ở `website/src/app/(app)/devices/[id]/page.tsx`, và thêm dòng "Giá trị còn lại" vào `/stats`. |

### #13 — Lịch bảo trì định kỳ cho đồ gia dụng
| | |
|---|---|
| **Khu vực** | `api` + `web` + `ios` + `android` |
| **Vì sao** | `[repo]` Hệ thống nhắc nhở chỉ biết 3 loại: bảo hành, subscription, wishlist — cron `api/cmd/cron` (và `POST /api/v1/cron/warranty-check`) fan-out đúng các loại đó, và `Reminder` gắn cứng vào `warrantyId` (`api/migrations/0001_initial.sql:174-183`: `"warrantyId" text NOT NULL` + FK). Muốn nhắc "vệ sinh điều hoà" thì phải làm generic hoá `Reminder`. `[suy luận]` Điều hoà và máy lọc nước là đồ gia dụng phổ biến ở VN cần bảo trì định kỳ, nhưng **tôi chưa kiểm chứng được** tần suất/thói quen bằng nguồn nào — coi đây là giả thuyết cần phỏng vấn người dùng trước khi build. |
| **Tác động** | **Trung bình** (khác biệt hoá nếu giả thuyết đúng). |
| **Effort** | **L** (đổi schema `Reminder` + backfill + sửa cả 3 client đọc reminder) |
| **Bước đầu** | **Chưa viết code.** Xác minh giả thuyết trước: hỏi 5–10 người dùng thật xem họ có đang tự nhắc việc bảo trì không. Nếu có, migration tiếp theo mới thêm `DeviceMaintenanceSchedule` (bảng riêng, **không** sửa `Reminder`) để tránh phá vỡ cron hiện tại. |

### #14 — Export CSV
| | |
|---|---|
| **Khu vực** | `api` + `web` |
| **Vì sao** | `[repo]` Không tồn tại: `grep -rniE "csv"` trên `website/src` và `api/internal` → **0 kết quả**. `[ngoài]` Tiêu chí đánh giá app warranty-tracking có uy tín thấp nhưng nhất quán: khả năng "export to CSV or PDF for handing the file to an adjuster or a shared spreadsheet" được liệt kê như một tiêu chí chọn app (`unstore.io`, xem §6 — nguồn yếu, chỉ dùng làm tín hiệu). |
| **Tác động** | **Thấp–trung bình.** Nhưng là "van an toàn" chống khoá dữ liệu, và backup JSON đã có sẵn nên chi phí thấp. |
| **Effort** | **S** |
| **Bước đầu** | Thêm `GET /api/v1/devices/export.csv` trong Go (stream CSV, `Content-Disposition: attachment`), hoặc rẻ hơn: sinh CSV ở web từ `api.devices.list()` đã có sẵn trong `stats/page.tsx`. Ưu tiên cách 2 vì không cần đụng openapi. |

### #15 — OCR: trích xuất IMEI/serial + số tháng bảo hành, nhận cả hoá đơn PDF
| | |
|---|---|
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
| B1 | Triển khai production (VPS + domain + TLS) | Tiền VPS + tên miền | Templated sẵn: `deploy/systemd/*`, `deploy/caddy/Caddyfile`, `deploy/PRODUCTION_CHECKLIST.md`, `docker-compose.yml`. Đây là thứ **mở khoá** mọi thứ khác — nhưng #1 phải xong trước, nếu không production sẽ chạy mà không tạo được thiết bị. |
| B2 | Phát hành iOS / APNs thật | Apple Developer Program **$99/năm** | Cần `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY` (`.p8`). Code + `ios/App/Core/Push/*` đã sẵn sàng. |
| B3 | Push FCM thật cho Android | Project Firebase | Cần `FCM_SERVICE_ACCOUNT_JSON`. Code đã sẵn sàng trong `api/internal/push/`. |
| B4 | Rate limit phân tán | Tài khoản Upstash | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. **Không chặn**: `api/internal/ratelimit/` tự fallback sang token-bucket trong bộ nhớ, chỉ không scale ngang được. |
| B5 | Email đặt lại mật khẩu thật | Tài khoản Resend (`RESEND_API_KEY`) | Không có key thì luồng `/forgot` không gửi được mail ⇒ mất mật khẩu = mất tài khoản. Đây là lý do **#10 (đổi email)** nên làm sau khi B5 được mở. |
| B6 | OCR hoá đơn thật | `ANTHROPIC_API_KEY` | Không có key thì endpoint trả 503 `feature_disabled` và **server vẫn boot bình thường** — degrade an toàn. |
| B7 | Diễn tập restore thật (khôi phục từ backup) | Một VPS/DB staging | Việc này **phải** làm trước khi tin vào backup. Liên quan trực tiếp tới #2: nếu không diễn tập, sẽ không ai phát hiện ra ảnh không nằm trong bản backup cho tới lúc cần. |

---

## 5. Đã cân nhắc và loại

Ghi lại để người sau không phải tranh luận lại. Mỗi mục kèm lý do một dòng.

**Loại vì đã tồn tại (kiểm tra trước khi làm lại):**
- **Quản lý thiết bị push trên mobile** — đã có: `ios/App/Features/Settings/PushDevicesView.swift`, `android/.../PushDevicesScreen.kt`. Chỉ web thiếu ⇒ gộp vào #4.
- **Lịch sử thanh toán subscription** — đã có và đã hiển thị: `SubscriptionPayment` được dùng bởi `POST /api/v1/subscriptions/{id}/payments` và `.../renew`, và `website/src/app/(app)/subscriptions/[id]/page.tsx:201-214` đã vẽ "Lịch sử thanh toán". **Không phải gap.**
- **Lịch sử giá wishlist** — đã có: `WishlistPrice` + `POST /api/v1/wishlist/{id}/prices` + `UpdatePriceDialog` trong `website/src/components/wishlist-actions.tsx:23`. **Không phải gap.**
- **Dark mode / theme** — đã có: `website/src/components/appearance-tweaks.tsx`, `theme-toggle.tsx`.

**Loại vì không đáng làm bây giờ:**
- **Phân trang (pagination) cho danh sách.** Đã xác nhận thiếu: `GET /api/v1/devices` không có `limit`/`offset`/`page` (`openapi.yaml:194-200`). **Nhưng** giới hạn cứng trong Go (50 thiết bị / 100 subscription / 200 wishlist — `api/internal/services/`) khiến payload tệ nhất vẫn nhỏ; thêm phân trang bây giờ là tối ưu hoá một vấn đề chưa tồn tại, đồng thời phải sửa cả 3 client. **Hoãn có ý thức**, không phải bỏ quên.
- **i18n / tiếng Anh.** Tiếng Việt là quyết định sản phẩm có chủ đích (CLAUDE.md: "All user-facing strings are Vietnamese"), không phải thiếu sót.
- **Xây một admin CRUD app đầy đủ.** Với #1, một migration seed + SQL là đủ. Một admin UI là sản phẩm riêng, chỉ hợp lý khi có người vận hành catalog thường xuyên — hiện chưa có.
- **Quét mã vạch / QR.** Xuất hiện ở các app inventory đối thủ (`[ngoài]` Sortly/iTrackMine có barcode scanning — nguồn yếu, §6), nhưng #15 (OCR điền serial/IMEI) giải quyết cùng vấn đề "nhập liệu" với chi phí thấp hơn nhiều và không cần camera native trên web được.
- **Sửa chart của iOS cho bằng web.** `[repo]` `ios/App/Features/Stats/StatsView.swift:266,283` tự nhận dữ liệu theo tháng/phân loại là placeholder 0. Là nợ kỹ thuật thật, nhưng thấp hơn #3 (đang *hiển thị sai*) và chỉ ảnh hưởng một client.

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
