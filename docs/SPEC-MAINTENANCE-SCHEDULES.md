# SPEC — Lịch bảo trì định kỳ cho đồ gia dụng (`DeviceMaintenanceSchedule`)

> **Trạng thái:** ĐỀ XUẤT + **KẾ HOẠCH KIỂM CHỨNG GIẢ THUYẾT**. Chưa viết code. Đây là bước đầu của
> roadmap [#13](FEATURE_ROADMAP.md).
>
> ## ⚠️ Đọc mục này trước
>
> Roadmap tự đánh dấu tiền đề của mục #13 là **CHƯA KIỂM CHỨNG**:
>
> > *"`[suy luận]` Điều hoà và máy lọc nước là đồ gia dụng phổ biến ở VN cần bảo trì định kỳ, nhưng
> > **tôi chưa kiểm chứng được** tần suất/thói quen bằng nguồn nào — coi đây là giả thuyết cần phỏng
> > vấn người dùng trước khi build."* — `FEATURE_ROADMAP.md:220`
>
> Tài liệu này **giữ nguyên** trạng thái đó. Nó **không** biến giả thuyết thành sự thật. Ngược lại,
> nó chia giả thuyết thành **hai vế** và chỉ ra rằng nghiên cứu ngoài đã xác minh **vế yếu hơn** trong
> khi **vế quyết định vẫn chưa có bằng chứng nào**:
>
> | Vế | Phát biểu | Trạng thái bằng chứng |
> |---|---|---|
> | **A. Cung** | Ở VN, bảo trì định kỳ đồ gia dụng là dịch vụ **có thật**, có hãng bán, có giá, có khuyến nghị tần suất. | ✅ **Đã xác minh** (§3.1) — nhưng đây **không** phải điều roadmap nghi ngờ. |
> | **B. Cầu** | Hộ gia đình VN **muốn một app nhắc** họ bảo trì. | ❌ **Không có bằng chứng nào.** Tôi tìm và **không** tìm được. |
>
> **Khuyến nghị của tài liệu này: HOÃN build, LÀM kiểm chứng ngay.** Chi tiết + điều kiện mở khoá ở
> [§8](#8-khuyến-nghị-defer-hoãn-build-làm-kiểm-chứng-ngay).
>
> **Quy ước nhãn:** `[repo]` đã đọc trong repo · `[ngoài]` có URL ở [§9](#9-nguồn-tham-khảo) ·
> `[suy luận]` nhận định của người viết · `[chưa kiểm chứng]` tìm nhưng không xác minh được.
>
> Ngày lập: 2026-10-02. Không chạy build/test. Chỉ ghi trong `docs/`.

---

## 1. Vì sao câu hỏi này khó hơn vẻ ngoài của nó

`[suy luận]` Đây **không** phải câu hỏi "làm sao nhắc định kỳ" — câu đó đã có lời giải trong repo
(§2.3). Đây là câu hỏi **"có ai cần không"**. Và nó khó vì ba lý do:

1. **Chi phí kỹ thuật thấp nhưng chi phí _sản phẩm_ cao.** Thêm một bảng + một bucket cron là việc
   nhỏ. Nhưng nếu giả thuyết sai, ta đã thêm một khái niệm vĩnh viễn vào schema, phải sửa **cả 3
   client**, phải mang nó qua mọi migration và mọi bản backup về sau — cho một tính năng không ai dùng.
   Roadmap §2.8 nói đúng: *"Effort phải phản ánh số client phải sửa."*
2. **"Nhắc bảo trì" có thể là giải pháp cho một vấn đề không tồn tại.** `[suy luận]` Người ta không quên
   vệ sinh điều hoà vì thiếu thông báo — họ quên vì **không có thói quen đó**, hoặc vì **phải trả
   tiền** thuê thợ. Một notification không tạo ra thói quen và không trả tiền thợ.
3. **Có một tính năng rẻ hơn và có thể đúng hơn.** Xem [§7](#7-phương-án-thay-thế-rẻ-hơn--và-có-thể-đúng-hơn).

---

## 2. Mô hình nhắc nhở hiện tại, và **chính xác** vì sao nó không diễn đạt được lịch bảo trì

Toàn bộ mục này `[repo]`.

### 2.1 Ba loại nhắc nhở, không phải một hệ thống chung

Roadmap nói *"hệ thống nhắc nhở chỉ biết 3 loại"* (`:220`). Chính xác hơn: **không có "hệ thống nhắc
nhở" nào cả.** Có **ba cơ chế độc lập**, mỗi cái gắn vào một bảng khác nhau:

| Loại | Bảng mang trạng thái | Cột `lastNotifiedAt` | Query chọn | Cron |
|---|---|---|---|---|
| Bảo hành hết hạn | **`Reminder`** | `Reminder.lastNotifiedAt` (0002) | `ListWarrantiesInWindow` | `run.go:213-265` |
| Subscription gia hạn | `Subscription` | `Subscription.lastNotifiedRenewalAt` (0001) | `ListSubscriptionsDueForRenewal` | `run.go:341-390` |
| Wishlist tới hạn / check-in | `WishlistItem` | `WishlistItem.lastNotifiedAt` (0001) | `ListWishlistTargetDateDue`, `ListWishlistDueForCheckin` | `run.go:267-339` |

⇒ **Hai trong ba loại KHÔNG dùng `Reminder`.** Chúng mang cặp cột riêng trên bảng chủ thể. Đây là
quan sát quan trọng nhất của §2 và nó định hình toàn bộ khuyến nghị ở §5.

### 2.2 `Reminder` gắn cứng vào `warrantyId` — bằng chứng schema

`[repo]` `api/migrations/0001_initial.sql:174-183`:

```sql
CREATE TABLE public."Reminder" (
    id text NOT NULL,
    "warrantyId" text NOT NULL,
    "isDismissed" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "Reminder_pkey" PRIMARY KEY (id),
    CONSTRAINT "Reminder_warrantyId_fkey" FOREIGN KEY ("warrantyId")
        REFERENCES public."Warranty"(id) ON UPDATE CASCADE ON DELETE CASCADE
);
```

Cộng thêm `"lastNotifiedAt" timestamp(3)` từ `[repo]` `0002_cron_idempotency.sql:21-22`.

**Bốn lý do `Reminder` không diễn đạt được "vệ sinh điều hoà mỗi 3 tháng":**

1. **`warrantyId` là `NOT NULL` + FK.** Một lịch bảo trì không thuộc về một gói bảo hành nào. Muốn nhét
   vào, phải **nới `NOT NULL`** — tức là phá vỡ ràng buộc toàn vẹn của bảng đang chạy production.
2. **`Reminder` không có trường thời gian nào để so sánh.** Nó chỉ có `createdAt` và `lastNotifiedAt`
   — cả hai đều là **dấu vết của việc đã thông báo**, không phải **ngày đến hạn**. Không có
   `dueDate`, không có `intervalDays`, không có `nextDueAt`. Không có gì để hỏi *"cái gì tới hạn hôm
   nay?"*
3. **Không có chủ thể.** `Reminder` không có `deviceId`, không có `title`, không có `kind`. Một hàng
   `Reminder` chỉ có nghĩa khi đi kèm `Warranty`. "Vệ sinh điều hoà" không có `Warranty` nào để đi kèm.
4. **Ngữ nghĩa `isDismissed` đang gánh việc khác.** Đây là lý do nặng nhất — xem §2.3.

### 2.3 Cái bẫy: `isDismissed` đang **chặn push**, không chỉ là cờ UI

`[repo]` `api/internal/store/queries/warranties.sql:163-187`:

```sql
-- name: ListWarrantiesInWindow :many
SELECT w.*, d."userId" AS user_id, d.name AS device_name
FROM "Warranty" w
JOIN "Device" d ON d.id = w."deviceId"
WHERE d.status = 'ACTIVE'
  AND w."endDate" >= $1
  AND w."endDate" <  $2
  AND NOT EXISTS (                       -- ← chặn #1: đã ẩn
      SELECT 1 FROM "Reminder" r
      WHERE r."warrantyId" = w.id AND r."isDismissed" = true
  )
  AND NOT EXISTS (                       -- ← chặn #2: đã thông báo hôm nay
      SELECT 1 FROM "Reminder" r
      WHERE r."warrantyId" = w.id
        AND r."lastNotifiedAt" IS NOT NULL
        AND r."lastNotifiedAt"::date >= CURRENT_DATE
  );
```

Và `ListUpcomingReminders` (`warranties.sql:124-144`) + `CountActiveReminders` (`:146-159`) dùng **cùng**
vị từ `NOT EXISTS (... isDismissed = true)`.

> ### 🔴 Hệ quả: `Reminder.isDismissed` là **điều khiển truy cập** cho thông báo, không phải cờ giao diện.
>
> Nếu generic hoá `Reminder` và cho nó trỏ tới một `DeviceMaintenanceSchedule`, thì **một hàng
> `Reminder` có `isDismissed = true` gắn với một `warrantyId` nào đó sẽ chặn vĩnh viễn** thông báo hết
> hạn của warranty đó. Người dùng ẩn nhắc "vệ sinh điều hoà" → **mất luôn nhắc hết hạn bảo hành điều
> hoà**. Đây là bug im lặng, không có thông báo lỗi, và chỉ lộ ra khi người dùng bỏ lỡ bảo hành.

Đây là **cùng một cái bẫy** đã được nêu ở `docs/SPEC-WARRANTY-CLAIM.md` §2.3 / §6.1. Hai tài liệu độc
lập cùng chỉ ra một điểm nghẽn — đó là dấu hiệu thiết kế `Reminder` đã tới hạn sử dụng.

### 2.4 Vì sao cron cũng không giúp được

`[repo]` Mọi bucket trong `api/internal/cron/run.go` đều lọc qua **`Warranty.endDate`** hoặc
`Subscription.renewalDate` hoặc `WishlistItem.targetDate`. Không bucket nào có khái niệm "cái gì tới
hạn theo chu kỳ N ngày **tính từ chính bảng chủ thể**", ngoại trừ **một**:

```sql
-- api/internal/store/queries/wishlist.sql:145-155  (ListWishlistDueForCheckin)
SELECT *
FROM "WishlistItem"
WHERE status IN ('WATCHING', 'DECIDED')
  AND "reminderIntervalDays" IS NOT NULL
  AND NOW() - COALESCE("lastNotifiedAt", "createdAt")
      >= ("reminderIntervalDays" * INTERVAL '1 day');
```

### 2.5 ⭐ Tiền lệ nội bộ: repo **đã** làm nhắc định kỳ — chỉ là làm cho wishlist

`[repo]` `WishlistItem` có **đúng** những gì `Reminder` thiếu (`0001_initial.sql:242-243`):

```sql
"reminderIntervalDays" integer,
"lastNotifiedAt"       timestamp(3) without time zone,
```

cộng `ListWishlistDueForCheckin` + `StampWishlistNotified` (`wishlist.sql:145-161`) và bucket cron
`run.go:310-339`, với nội dung push *"🔔 Đã {n} ngày chưa update giá «{tên}»"*.

> **Đây là lập luận trung tâm của tài liệu này.** Tính năng "nhắc định kỳ theo số ngày" **đã tồn tại
> và đang chạy production** — cho giá wishlist. Nghĩa là:
> - **Rủi ro kỹ thuật gần như bằng 0.** Không phải phát minh gì mới; chỉ áp cùng mẫu cho một chủ thể khác.
> - **Rủi ro duy nhất còn lại là sản phẩm.** Và đó chính là giả thuyết chưa kiểm chứng.
> - **Mẫu đúng của repo là cột-trên-bảng-chủ-thể, không phải `Reminder`.** Generic hoá `Reminder` sẽ là
>   lựa chọn **không nhất quán** với chính repo này.

`[suy luận]` Hệ quả thực tế: câu hỏi của #13 **không** phải *"làm được không"* (làm được, đã có mẫu)
mà là *"có nên không"*.

---

## 3. Giả thuyết — tách hai vế, và bằng chứng cho từng vế

### 3.1 Vế A (CUNG) — ✅ **ĐÃ XÁC MINH**: dịch vụ bảo trì là có thật ở VN

Đây là vế **dễ** và tôi đã xác minh được. Ghi lại vì nó hữu ích, nhưng **nó không chứng minh vế B**.

**(a) Hãng sản xuất bán dịch vụ bảo dưỡng như một dòng sản phẩm.** `[ngoài]`
LG Việt Nam có mục **"Dịch vụ bảo dưỡng NEW"** trong menu *Dịch vụ* cấp cao nhất, dưới thương hiệu
**LG Best Care**, cùng với **"Gia hạn bảo hành"**:
[lg.com/vn/tro-giup/lg-best-care/bao-duong/](https://www.lg.com/vn/tro-giup/lg-best-care/bao-duong/)
(đã fetch, HTTP 200 — trang render được **khung điều hướng**, trong đó có cả ba mục
`LG Best Care`, `Dịch vụ bảo dưỡng`, `Gia hạn bảo hành`).
⇒ `[suy luận]` Một hãng điện tử lớn chỉ mở dòng dịch vụ bảo dưỡng **thu tiền** ở một thị trường nếu có
người trả tiền. Đây là bằng chứng **gián tiếp** về cầu, **không** phải bằng chứng trực tiếp.
⚠️ **Giới hạn:** phần **nội dung chi tiết** của trang bảo dưỡng (giá, chu kỳ, danh mục) **không render
được** khi fetch ⇒ **không** trích được con số nào từ đây.

**(b) Chu kỳ bảo trì được nhà bán lẻ công bố, và nó PHỤ THUỘC NGỮ CẢNH.** `[ngoài]`
CellphoneS/Sforum, bài *"Bao lâu vệ sinh máy lạnh 1 lần?"* (đã fetch, HTTP 200 — đọc được toàn văn).
Dữ kiện:

| Ngữ cảnh | Chu kỳ khuyến nghị |
|---|---|
| Gia đình dùng ít | **~6 tháng/lần** |
| Gia đình dùng 6–12 giờ/ngày | **3–4 tháng/lần** |
| Văn phòng / cửa hàng / quán ăn | **2–3 tháng/lần** |
| Nhà xưởng, nhiều bụi công nghiệp | **1 tháng/lần** |
| Lưới lọc (mọi trường hợp) | **2–4 tuần/lần** |
| Máy Inverter — kiểm tra tổng thể | **≥ 1 lần/năm** (bo mạch, cảm biến, gas) |

Và câu quan trọng nhất, nguyên văn:
> *"**Không có một lịch vệ sinh chung cho mọi máy lạnh** vì tần suất còn phụ thuộc vào cường độ sử
> dụng và môi trường xung quanh."*

⇒ **Hệ quả thiết kế trực tiếp:** `intervalDays` **phải do người dùng đặt**, với **gợi ý** theo loại
thiết bị — **không** được hard-code một con số cho `AC`. Bất kỳ thiết kế nào nhúng "điều hoà = 3 tháng"
vào code là **sai với chính tài liệu của ngành**. Xem §4.2.

**(c) Thị trường dịch vụ vệ sinh có giá.** `[chỉ thấy trong kết quả tìm kiếm]` Có nhiều nhà cung cấp
quảng cáo vệ sinh điều hoà từ **~150.000₫** (ví dụ `f24.vn`, và một Q&A trên `thegioididong.com`).
⚠️ **Chưa fetch** ⇒ **không** dùng con số này như dữ kiện về giá; chỉ ghi nhận sự tồn tại của thị trường.

**(d) Báo chí đại chúng đã đặt vấn đề.** `[chỉ đọc được tiêu đề]` Thanh Niên có bài
*"Thiết bị điện cũng phải 'khám sức khỏe định kỳ'"* (đã fetch — **HTTP 200 nhưng nội dung bị trả về
rỗng/truncated**, chỉ nhận được tiêu đề).
⚠️ **Không** đọc được nội dung ⇒ **không** trích dẫn bài này cho bất kỳ khẳng định nào.

### 3.2 Vế B (CẦU) — ❌ **KHÔNG có bằng chứng**: không ai chứng minh hộ gia đình muốn app nhắc

Đây là vế **quyết định**, và đây là chỗ tôi **không** tìm được gì.

**Những gì tôi đã tìm và KHÔNG tìm được:**

1. **Không có khảo sát nào** về thói quen bảo trì thiết bị gia dụng của hộ gia đình VN. Các kết quả
   tìm kiếm về chủ đề này trả về **nghiên cứu ở Anh và châu Âu**
   (`salford-repository.worktribe.com` về hành vi kéo dài tuổi thọ thiết bị ở **hộ gia đình Anh**;
   `jipmerlibrary` về hành vi bảo trì thiết bị — **góc nhìn hộ gia đình châu Âu**).
   ⇒ **Không** được ngoại suy từ Anh/Âu sang VN. Thói quen sở hữu, thay thế và thuê thợ khác nhau.
2. **Không có bằng chứng rằng người dùng có "nỗi đau" này.** Vế A chứng minh **có dịch vụ để mua**,
   không chứng minh **có người muốn được nhắc**. Hai chuyện khác nhau: người ta có thể thuê thợ khi
   máy chảy nước (sự cố), chứ không theo lịch (định kỳ). `[suy luận]` **Phản ứng theo sự cố** là mô
   hình hành vi mặc định, và nó **không cần** tính năng này.
3. **Không có bằng chứng từ chính sản phẩm.** `[suy luận]` App này chưa có người dùng thật ở quy mô
   đủ để nói "người dùng đòi tính năng này" — không có kênh phản hồi nào trong repo, và roadmap §6 ghi
   rõ **không tìm được** số liệu thị trường VN. Nếu có telemetry thì đây là chỗ nên tra; tôi **không**
   tìm thấy mã telemetry/analytics nào trong quá trình đọc.

**Kết luận vế B:** giả thuyết của roadmap **vẫn nguyên trạng thái chưa kiểm chứng**. Nghiên cứu ngoài
**không** nâng được độ tin cậy của nó. Bất kỳ ai build dựa trên "điều hoà và máy lọc nước là đồ gia
dụng phổ biến ở VN" nên lưu ý: đó là **hai** khẳng định, và **vế thứ hai** — *"nên cần nhắc nhở"* —
không được khẳng định nào ở trên chống lưng.

### 3.3 Một quan sát làm giảm giá trị của reminder thuần túy

`[suy luận]` Trong bảng ở §3.1(b), mọi chu kỳ đều **ngắn hơn hoặc bằng 6 tháng**, và lưới lọc là
**2–4 tuần**. Nhưng:
- Điều hoà ở miền Bắc **không chạy** 3–4 tháng mùa đông. Một interval cố định 3 tháng **sẽ bắn vào
  tháng 12**, khi máy không được dùng ⇒ nhắc nhở **sai thời điểm** và làm mất niềm tin vào thông báo.
- `[suy luận]` Một lịch *"vệ sinh lưới lọc mỗi 2–4 tuần"* là **quá dày** cho push notification. Nếu
  bắn đúng, người dùng sẽ tắt thông báo; nếu bắn gộp, nó thành nhiễu.

⇒ Đây là lý do kỹ thuật để nghi ngờ rằng **reminder không phải là hình dạng đúng của tính năng này**.
Xem §7.

---

## 4. Thiết kế đề xuất

### 4.1 Nguyên tắc

1. **Không `ALTER` `Reminder`.** (§2.3, §5)
2. **Một thiết bị → N lịch.** Một điều hoà có thể cần "vệ sinh lưới lọc 1 tháng", "vệ sinh sâu 6
   tháng", "kiểm tra gas 12 tháng" — ba chu kỳ khác nhau, không nhồi vào một bản ghi.
3. **Ghi nhận việc đã làm là bắt buộc, không phải tuỳ chọn.** Nếu không có hành động "Đã làm", nhắc
   nhở sẽ lặp mãi và người dùng sẽ tắt nó. Xem §4.3.
4. **`intervalDays` do người dùng đặt** (§3.1b), có gợi ý theo `Device.category`.
5. **Tách khỏi `/api/v1/reminders` ở v1** để không phá 3 client. Xem §6.3.

### 4.2 Schema đề xuất (migration `0009_maintenance_schedule.sql`)

Theo quy ước `0001`: `text` PK app sinh, enum = `text` + validate ở app, `timestamp(3) without time
zone`, **có `"createdAt"` + `"updatedAt"`**.

```sql
-- +goose Up
-- +goose StatementBegin

CREATE TABLE public."DeviceMaintenanceSchedule" (
    id             text NOT NULL,
    "deviceId"     text NOT NULL,
    title          text NOT NULL,          -- "Vệ sinh lưới lọc", "Thay lõi RO số 3"
    kind           text NOT NULL DEFAULT 'CLEANING'::text,
    -- Lịch: HOẶC chu kỳ, HOẶC ngày cố định. Xem CHECK bên dưới.
    "intervalDays" integer,                -- NULL nếu dùng nextDueAt cố định
    "nextDueAt"    timestamp(3) without time zone NOT NULL,  -- luôn có: nguồn sự thật để query
    "lastDoneAt"   timestamp(3) without time zone,           -- NULL = chưa từng làm
    "lastNotifiedAt" timestamp(3) without time zone,         -- idempotency, mẫu WishlistItem
    "anchorMonth"  integer,                -- 1..12: gợi ý mùa (điều hoà miền Bắc). NULL = không mùa
    "estimatedCost" integer,               -- VND, tuỳ chọn
    notes          text,
    "isActive"     boolean DEFAULT true NOT NULL,
    "createdAt"    timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt"    timestamp(3) without time zone NOT NULL,
    CONSTRAINT "DeviceMaintenanceSchedule_pkey" PRIMARY KEY (id),
    CONSTRAINT "DeviceMaintenanceSchedule_deviceId_fkey"
        FOREIGN KEY ("deviceId") REFERENCES public."Device"(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    -- Bất biến: chu kỳ phải hợp lệ khi có
    CONSTRAINT "DeviceMaintenanceSchedule_interval_chk"
        CHECK ("intervalDays" IS NULL OR "intervalDays" BETWEEN 1 AND 3650),
    CONSTRAINT "DeviceMaintenanceSchedule_anchor_chk"
        CHECK ("anchorMonth" IS NULL OR "anchorMonth" BETWEEN 1 AND 12)
);

CREATE INDEX "DeviceMaintenanceSchedule_deviceId_idx"
    ON public."DeviceMaintenanceSchedule" USING btree ("deviceId");
CREATE INDEX "DeviceMaintenanceSchedule_nextDueAt_idx"
    ON public."DeviceMaintenanceSchedule" USING btree ("nextDueAt");
CREATE INDEX "DeviceMaintenanceSchedule_active_due_idx"
    ON public."DeviceMaintenanceSchedule" USING btree ("isActive", "nextDueAt");

-- Nhật ký đã làm. Tách bảng để giữ LỊCH SỬ, không chỉ trạng thái mới nhất.
CREATE TABLE public."MaintenanceLog" (
    id           text NOT NULL,
    "scheduleId" text NOT NULL,
    "doneAt"     timestamp(3) without time zone NOT NULL,
    "cost"       integer,
    "vendor"     text,                     -- ai làm
    "notes"      text,
    "createdAt"  timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT "MaintenanceLog_pkey" PRIMARY KEY (id),
    CONSTRAINT "MaintenanceLog_scheduleId_fkey"
        FOREIGN KEY ("scheduleId") REFERENCES public."DeviceMaintenanceSchedule"(id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX "MaintenanceLog_scheduleId_idx" ON public."MaintenanceLog" USING btree ("scheduleId");
CREATE INDEX "MaintenanceLog_doneAt_idx"     ON public."MaintenanceLog" USING btree ("doneAt");

-- +goose StatementEnd
```

**`kind`** (validate ở app, `[suy luận]`):

```
'CLEANING'          -- vệ sinh: lưới lọc, dàn lạnh, lồng giặt
'FILTER_REPLACE'    -- thay lõi/vật tư tiêu hao: lõi RO, túi lọc, than hoạt tính
'INSPECTION'        -- kiểm tra định kỳ: gas, bo mạch, điện trở
'CALIBRATION'       -- hiệu chỉnh
'OTHER'
```

**`nextDueAt` là nguồn sự thật duy nhất để query** — không tính `NOW() - lastDoneAt >= interval` trong
SQL như `ListWishlistDueForCheckin` đang làm. Lý do `[suy luận]`:

- Query wishlist hiện tại **không index được** (biểu thức trên hai cột) ⇒ phải quét bảng. Với
  `WishlistItem ≤ 200/người` thì không sao; nhưng đây là cơ hội sửa mẫu cho đúng **trước khi** nhân bản.
- `nextDueAt` cho phép **ngày cố định** (bảo dưỡng theo mùa ở §3.3) và **dời lịch thủ công** mà không
  cần thêm cột.
- Khi `intervalDays` có giá trị: ghi `MaintenanceLog` → `nextDueAt = doneAt + intervalDays`,
  `lastDoneAt = doneAt` trong **một transaction**. Khi `intervalDays` NULL: người dùng tự đặt `nextDueAt`.

**Hạn mức đề xuất:** `MaxMaintenanceSchedulesPerDevice = 10` `[suy luận]` (một điều hoà cần 3–4;
10 là dư). **Không** thêm hạn mức theo user: 50 thiết bị × 10 = 500 lịch, mỗi lịch ~150 byte.

**Backup:** phải bump v6 (§ `SPEC-WARRANTY-CLAIM.md` §6.3 — **cùng một lần bump**, cùng rào
`payload.Version != 5`). Nest `MaintenanceSchedules[]` trong `BackupDevice`, mỗi lịch có
`Logs[]`.

### 4.3 Vì sao `MaintenanceLog` là bảng riêng, không chỉ `lastDoneAt`

`[suy luận]` Nếu chỉ có `lastDoneAt`, app trả lời được *"lần trước khi nào"* nhưng **không** trả lời
được *"tôi đã chi bao nhiêu cho việc bảo trì cái tủ lạnh này trong 3 năm"*. Roadmap #3 đang sửa `/stats`
để tính đúng chi phí sở hữu (`[repo]` `:126-133`), và roadmap #12 (bán lại/khấu hao, `:211-214`) cũng
cần chi phí thực. Chi phí bảo trì là **một phần của chi phí sở hữu** — nếu bỏ `MaintenanceLog`, `/stats`
sẽ lại sai theo một cách mới.

⚠️ **Đây là phạm vi tăng thêm so với roadmap #13.** Roadmap chỉ nói *"nhắc vệ sinh điều hoà"*. Bảng log
là mở rộng **có chủ ý** của tôi, và nó **củng cố** khuyến nghị hoãn ở §8 (phạm vi lớn hơn ⇒ càng cần
kiểm chứng trước).

---

## 5. Đánh giá khuyến nghị của roadmap: bảng riêng hay `ALTER Reminder`?

Roadmap khuyến nghị (`:223`):
> *"Nếu có, migration tiếp theo mới thêm `DeviceMaintenanceSchedule` (**bảng riêng, không** sửa
> `Reminder`) để tránh phá vỡ cron hiện tại."*

### 5.1 Kết luận: **ĐỒNG Ý** — nhưng lý do của roadmap quá yếu

**Lý do roadmap đưa ra:** *"tránh phá vỡ cron hiện tại"*. Đó là lý do **đúng nhưng nông**. Nó gợi ý
rằng đây là đánh đổi giữa *"sạch sẽ về mô hình"* và *"an toàn"* — và nếu chỉ vì an toàn thì một dev
giỏi có thể sẽ muốn làm cho sạch (generic hoá) và viết test cho cron.

**Lý do thật, mạnh hơn — ba tầng:**

1. **`isDismissed` là điều khiển truy cập, không phải cờ UI** (§2.3). Generic hoá không chỉ "có rủi ro
   phá cron" — nó **tạo ra một lỗi đúng đắn (correctness bug)**: một hàng ẩn nhắc bảo trì sẽ **chặn
   vĩnh viễn** thông báo hết hạn bảo hành. Đây không phải vấn đề "viết test kỹ hơn là được"; nó là
   **xung đột ngữ nghĩa** giữa hai tính năng dùng chung một cột. Không có test nào sửa được một mô hình
   sai.
2. **`StampWarrantyNotified` là upsert theo `warrantyId`** `[repo]` (`warranties.sql:189-204`). Nó
   `UPDATE ... WHERE "warrantyId" = $1`, rồi `INSERT` nếu không có hàng nào. Không có chỗ cho
   discriminator `kind`. Thêm chủ thể thứ hai buộc phải **viết lại** query này — và nó là query
   **idempotency của push production**.
3. **Mẫu nhất quán của repo là cột-trên-bảng-chủ-thể, không phải `Reminder`** (§2.1, §2.5): `Subscription`
   và `WishlistItem` đều KHÔNG dùng `Reminder`. Nếu ta generic hoá `Reminder` cho bảo trì, ta sẽ có
   **ba** mẫu khác nhau trong cùng một codebase: `Reminder` (đa hình), cột riêng trên `Subscription`,
   cột riêng trên `WishlistItem`. Bảng riêng cho bảo trì là lựa chọn **nhất quán với đa số hiện có**.

### 5.2 Cái giá thật của bảng riêng — và nó nằm ở **đường ĐỌC**, không phải đường ghi

Tôi phải nói thẳng về đánh đổi, vì roadmap không nói:

`[repo]` `GET /api/v1/reminders` trả **một** loại hàng: `ReminderWarranty` = `Warranty` +
`device{id,name,category}` (`openapi.yaml:1653-1665`), và handle chỉ một tham số `withinDays`
(`handlers/reminders.go:13-14,28-39`). Ba client đều có model **cố định** cho hình dạng này:

- Web: `website/src/app/(app)/reminders/page.tsx` — bucket theo số ngày còn lại.
- Android: `network/Models.kt:561` `RemindersResponse(reminders: List<UpcomingReminder>)`,
  `:576` `ReminderDevice`; màn hình `ui/screens/reminders/RemindersScreen.kt` + `RemindersViewModel`.
- iOS: `DismissedReminders.swift`, `Models.swift:270-273` (`struct Reminder` với `warrantyId`,
  `isDismissed`).

⇒ Thêm bảo trì vào **cùng** endpoint biến nó thành **union phân biệt (discriminated union)**: mỗi hàng
phải có `kind`, và mọi client phải rẽ nhánh render. **Đó là thay đổi phá vỡ (breaking)** cho 3 client
nếu làm ẩu.

**Giảm thiểu (khuyến nghị):** **endpoint riêng** `GET /api/v1/maintenance/due` ở v1. Không đụng
`/reminders`. Gộp lại chỉ khi tính năng đã được kiểm chứng và có nhu cầu xem một chỗ. Xem §6.3.

**Kết luận §5:** bảng riêng, **và** endpoint riêng. Roadmap đúng về bảng, thiếu về endpoint.

---

## 6. Thay đổi cần có

### 6.1 Cron

Thêm **bước 3.5** (sau wishlist check-in, `run.go:339`), cùng mẫu `query → dispatch → stamp`:

```sql
-- name: ListMaintenanceDue :many
SELECT m.*, d."userId" AS user_id, d.name AS device_name, d.category AS device_category
FROM "DeviceMaintenanceSchedule" m
JOIN "Device" d ON d.id = m."deviceId"
WHERE m."isActive" = true
  AND d.status = 'ACTIVE'
  AND m."nextDueAt" >= $1            -- đầu ngày hôm nay
  AND m."nextDueAt" <  $2            -- cuối ngày hôm nay + leadDays
  AND (m."lastNotifiedAt" IS NULL
       OR m."lastNotifiedAt"::date < CURRENT_DATE)
ORDER BY m."nextDueAt" ASC;
```

Nội dung push `[suy luận]` (theo giọng `run.go`, có emoji như các bucket khác):

```
Title (đến hạn hôm nay):  🔧 Hôm nay: {title} — "{device_name}"
Title (trước n ngày):      🔧 Còn {n} ngày: {title} — "{device_name}"
Body:                      "Lần trước: {lastDoneAt|chưa từng làm}" + (" • ~{estimatedCost}")
URL:                       /devices/{deviceId}/maintenance
Tag:                       "maint-{scheduleId}"
```

`leadDays` `[suy luận]`: **3 ngày** (đủ để đặt thợ), khác với bảo hành (7/30 ngày) vì chu kỳ bảo trì
ngắn hơn nhiều.

**Idempotency:** stamp `lastNotifiedAt = NOW()`, y hệt `StampWishlistNotified`
`[repo]` (`wishlist.sql:157-161`).

**Thêm vào `cron.Stats`** (`run.go:36-46`): `MaintenanceNotices`. Và vào **cả hai** khối log ở
`api/cmd/cron/main.go:66-91`.

**⚠️ Rủi ro vận hành mới:** bucket này là bucket **đầu tiên** có thể bắn **thường xuyên** (lưới lọc
2–4 tuần ⇒ mỗi tháng một lần cho **mỗi** điều hoà). Cộng dồn nhiều thiết bị, người dùng có thể nhận
**nhiều push/tháng** — nhiều hơn hẳn 4 bucket hiện tại (vốn chỉ bắn 7d/30d một lần/năm cho mỗi
warranty). `[suy luận]` Đây là rủi ro **làm người dùng tắt thông báo**, và nó **làm hại cả tính năng
bảo hành đang chạy tốt**. Cần: gộp nhiều lịch đến hạn trong cùng ngày thành **một** push, và/hoặc trần
số push bảo trì mỗi tuần. **Đây là lý do kỹ thuật độc lập để hoãn.**

### 6.2 Endpoint

```yaml
  /api/v1/devices/{id}/maintenance:
    get:
      tags: [maintenance]
      summary: Lịch bảo trì định kỳ của một thiết bị
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [schedules]
                properties:
                  schedules:
                    type: array
                    items: { $ref: '#/components/schemas/MaintenanceSchedule' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
    post:
      tags: [maintenance]
      summary: Tạo lịch bảo trì
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/MaintenanceScheduleInput' }
      responses:
        '201':
          description: Đã tạo
          content:
            application/json:
              schema: { $ref: '#/components/schemas/MaintenanceSchedule' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '409': { $ref: '#/components/responses/Conflict' }

  /api/v1/maintenance/{id}:
    patch:
      tags: [maintenance]
      summary: Sửa / tạm dừng lịch
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/MaintenanceScheduleUpdate' }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/MaintenanceSchedule' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }
    delete:
      tags: [maintenance]
      summary: Xoá lịch (và nhật ký của nó)
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        '204': { description: Đã xoá }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }

  /api/v1/maintenance/{id}/done:
    post:
      tags: [maintenance]
      summary: |
        Ghi nhận ĐÃ LÀM. Trong một transaction: tạo MaintenanceLog,
        đặt lastDoneAt = doneAt, và đẩy nextDueAt = doneAt + intervalDays (nếu có chu kỳ).
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [doneAt]
              properties:
                doneAt: { type: string, format: date-time }
                cost: { type: integer, nullable: true }
                vendor: { type: string, nullable: true }
                notes: { type: string, nullable: true }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/MaintenanceSchedule' }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '404': { $ref: '#/components/responses/NotFound' }

  /api/v1/maintenance/due:
    get:
      tags: [maintenance]
      summary: Mọi lịch bảo trì tới hạn của người dùng hiện tại (feed riêng, KHÔNG gộp vào /reminders)
      parameters:
        - name: withinDays
          in: query
          schema: { type: integer, default: 14, minimum: 1, maximum: 365 }
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [due]
                properties:
                  due:
                    type: array
                    items: { $ref: '#/components/schemas/MaintenanceDueRow' }
        '401': { $ref: '#/components/responses/Unauthorized' }
```

Schema (rút gọn — viết đủ khi implement):

```yaml
    MaintenanceKind:
      type: string
      enum: [CLEANING, FILTER_REPLACE, INSPECTION, CALIBRATION, OTHER]

    MaintenanceSchedule:
      type: object
      required: [id, deviceId, title, kind, nextDueAt, isActive, createdAt, updatedAt]
      properties:
        id: { type: string }
        deviceId: { type: string }
        title: { type: string }
        kind: { $ref: '#/components/schemas/MaintenanceKind' }
        intervalDays: { type: integer, nullable: true }
        nextDueAt: { type: string, format: date-time }
        lastDoneAt: { type: string, format: date-time, nullable: true }
        anchorMonth: { type: integer, nullable: true, minimum: 1, maximum: 12 }
        estimatedCost: { type: integer, nullable: true }
        notes: { type: string, nullable: true }
        isActive: { type: boolean }
        createdAt: { type: string, format: date-time }
        updatedAt: { type: string, format: date-time }

    MaintenanceScheduleInput:
      type: object
      required: [title, nextDueAt]
      properties:
        title: { type: string, minLength: 1, maxLength: 200 }
        kind: { $ref: '#/components/schemas/MaintenanceKind' }
        intervalDays: { type: integer, nullable: true, minimum: 1, maximum: 3650 }
        nextDueAt: { type: string }
        anchorMonth: { type: integer, nullable: true }
        estimatedCost: { type: integer, nullable: true }
        notes: { type: string, nullable: true }

    MaintenanceDueRow:
      allOf:
        - $ref: '#/components/schemas/MaintenanceSchedule'
        - type: object
          required: [device]
          properties:
            device:
              type: object
              required: [id, name, category]
              properties:
                id: { type: string }
                name: { type: string }
                category: { type: string }
```

**Gợi ý chu kỳ mặc định — để ở client, KHÔNG ở DB.** `[suy luận]` Vì §3.1(b) nói không có lịch chung,
gợi ý chỉ là **giá trị khởi tạo của form**, người dùng sửa được. Đặt trong
`website/src/lib/maintenance-presets.ts` + bản sao ở iOS/Android:

| `Device.category` | Gợi ý | Nguồn |
|---|---|---|
| `AC` | "Vệ sinh lưới lọc" 30 ngày · "Vệ sinh sâu" 90 ngày · "Kiểm tra gas" 365 ngày | §3.1(b) |
| `FRIDGE` | "Vệ sinh & kiểm tra ron cửa" 180 ngày | `[suy luận]` |
| `WASHING` | "Vệ sinh lồng giặt" 90 ngày | `[suy luận]` |
| `KITCHEN` | "Thay lõi/vật tư lọc" — **bắt người dùng nhập** | `[chưa kiểm chứng]` |
| khác | — (không gợi ý) | — |

⚠️ **Máy lọc nước (`KITCHEN`/`APPLIANCE`) không có gợi ý** vì tôi **không** xác minh được chu kỳ thay
lõi RO. Roadmap nêu máy lọc nước là ví dụ (`:220`) nhưng tôi **không** tìm được nguồn đáng tin cho
chu kỳ thay lõi — kết quả tìm kiếm chỉ trả về **trang bán lõi lọc** (`meta.vn`) và một hướng dẫn
không rõ tác giả (`dichvu3t.com`). **Không bịa con số.**

### 6.3 Ba client

**Nguyên tắc: v1 KHÔNG đụng `/api/v1/reminders`.** Thêm màn hình riêng. Nhãn tiếng Việt nhân bản ở 3
nơi (quy ước `CLAUDE.md`).

- **Web:** `src/lib/types.ts` (`MAINTENANCE_KIND_LABELS`), `src/lib/api/maintenance.ts`,
  `src/app/actions/maintenance.ts` (`'use server'`, parse `FormData` bằng helper `str()`/`num()`,
  **không** Zod), card mới trong `src/app/(app)/devices/[id]/page.tsx` (cạnh card "Bảo hành" ở
  `:176-233`), trang `src/app/(app)/devices/[id]/maintenance/page.tsx`. Nút **"Đã làm"** là hành động
  quan trọng nhất trên UI.
- **iOS:** `Models.swift` (DTO + nhãn), `Endpoints.swift`, `APIClient.swift`, view dưới
  `App/Features/`.
- **Android:** `network/Models.kt`, Retrofit `ApiService`, `ui/screens/maintenance/` (port mẫu
  `ui/screens/reminders/`), + test như `PushDevicesViewModelTest.kt`.

---

## 7. Phương án thay thế rẻ hơn — và có thể **đúng hơn**

`[suy luận]` Đây là phần quan trọng nhất của tài liệu, và roadmap **không** xét tới.

**Quan sát:** §3.3 chỉ ra reminder có thể **sai hình dạng**. Vấn đề của người dùng có thể **không phải**
*"nhắc tôi khi tới hạn"* mà là *"tôi không nhớ lần trước làm khi nào"*. Hai vấn đề này cần hai sản phẩm
khác nhau:

| | **A. Nhắc nhở (proactive)** | **B. Nhật ký (reactive)** |
|---|---|---|
| Câu hỏi người dùng | "Khi nào tôi nên làm?" | "Lần trước tôi làm khi nào?" |
| Cần gì | `intervalDays` + cron + push | chỉ cần ghi chép |
| Rủi ro | **Sai thời điểm** (mùa, §3.3), **làm nhiễu** (§6.1), tắt thông báo | gần như không |
| Chi phí | M–L (3 client + cron + push) | **S** (một bảng, một form) |
| Dựa trên | **giả thuyết chưa kiểm chứng** (vế B) | nhu cầu tự thân, kiểm chứng được ngay khi ship |

**Đề xuất: nếu build, build B trước.** Lý do:

1. **B không cần giả thuyết nào.** Người dùng có ghi lại việc họ đã làm hay không là **quan sát được
   ngay** bằng một form. Không cần chờ phỏng vấn.
2. **B tạo dữ liệu để trả lời A.** Nếu 3 tháng sau có người dùng thật sự ghi log, đó là bằng chứng
   **hành vi** (mạnh hơn lời nói trong phỏng vấn) rằng họ quan tâm tới bảo trì định kỳ. Nếu **không ai**
   ghi, A chắc chắn thất bại — và ta đã tiết kiệm phần đắt nhất.
3. **B dùng đúng một nửa của schema ở §4.2** (`MaintenanceLog` + `nextDueAt`), nên **không có công việc
   nào bị vứt đi** nếu sau này thêm cron.
4. **B không đụng cron.** ⇒ Không có rủi ro §6.1 (làm nhiễu, tắt thông báo) và không đụng
   `api/cmd/cron` đang chạy tốt. Đây đúng tinh thần roadmap §2.1 *"Sửa cái đang sai trước khi thêm cái
   mới"* và khuyến nghị bảng-riêng-để-không-phá-cron.

⇒ **Khuyến nghị cuối: hoãn A, và coi B là bước 1 của A nếu giả thuyết được kiểm chứng.** Xem §8.

---

## 8. Khuyến nghị: **DEFER** (hoãn build, làm kiểm chứng ngay)

### 8.1 Khuyến nghị

> **KHÔNG build `DeviceMaintenanceSchedule` + cron bây giờ.**
> **CÓ làm kế hoạch kiểm chứng ở §8.2 ngay** — nó gần như miễn phí (0 dòng code, vài cuộc trò chuyện).
> **NẾU giả thuyết sống sót → build phương án B (§7) trước, rồi mới tới A.**

**Không "drop".** Lý do không bỏ hẳn: rào cản kỹ thuật thấp (§2.5 — mẫu đã có), vế cung đã xác minh
(§3.1), và nếu giả thuyết đúng thì đây là **khác biệt hoá thật** (roadmap `:221` ghi *"Trung bình
(khác biệt hoá nếu giả thuyết đúng)"*). Bỏ hẳn là mất một lựa chọn rẻ.

### 8.2 Vì sao hoãn — năm lý do, xếp theo sức nặng

1. **Vế quyết định của giả thuyết không có một mẩu bằng chứng nào** (§3.2). Nghiên cứu ngoài xác minh
   vế **cung** — vế mà roadmap **không** nghi ngờ — và **không** nâng được độ tin cậy của vế **cầu**.
2. **Thứ tự ưu tiên của chính roadmap chống lại nó.** #13 xếp **sau** #11, #12 (roadmap §3), và §2.1
   nói rõ *"Sửa cái đang sai trước khi thêm cái mới."* Hiện có **#1 là lỗi chặn** (không tạo được thiết
   bị trên DB mới) và #11 là lỗ hổng sản phẩm lớn nhất. `[suy luận]` Làm #13 trước #11 là làm tính năng
   khác biệt hoá **trước khi** có tính năng lõi.
3. **Rủi ro làm hỏng thứ đang chạy tốt.** §6.1: bucket bảo trì là bucket đầu tiên bắn **thường xuyên**.
   Push quá nhiều ⇒ người dùng tắt thông báo ⇒ **mất luôn nhắc hết hạn bảo hành** — tính năng lõi đang
   hoạt động. Đây là rủi ro **hồi quy**, không chỉ là "tính năng mới không hiệu quả".
4. **Nó cần chung một lần bump backup v6 với #11.** `[repo]` `backup.go:382` từ chối mọi version ≠ 5.
   Làm #13 riêng nghĩa là bump v6 **hai lần** (v6 cho claim, v7 cho maintenance) ⇒ **hai** lần rủi ro R1.
   Gộp lại thì phải làm #11 trước. ⇒ Lại là lý do thứ tự.
5. **`[suy luận]` Chi phí cơ hội.** Cùng effort đó, roadmap có #3 (`/stats` đang hiển thị **sai** chi phí
   trên **cả 3** nền tảng — `:130-133`), #4 (quyền riêng tư: không thu hồi được push — `:140`), #5 (ẩn
   nhắc nhở là một chiều — `:149`). Ba việc đó **đang sai**, không phải **còn thiếu**.

### 8.3 Kế hoạch kiểm chứng giả thuyết — cụ thể, không phải "hỏi người dùng"

Mục tiêu: **bác bỏ hoặc xác nhận vế B** trước khi viết migration. Cách rẻ nhất để **bác bỏ** một giả
thuyết là **cố tình tìm bằng chứng chống lại nó** — nên mỗi câu hỏi dưới đây được thiết kế để **phá**,
không phải để xác nhận.

**(a) Ai — 8–12 người, chia 3 nhóm, hỏi riêng:**

| Nhóm | Ai | Vì sao nhóm này |
|---|---|---|
| **N1 (4–5 người)** | Chủ hộ đang dùng **điều hoà** ở **miền Bắc** | Có mùa đông ⇒ kiểm tra §3.3 (nhắc sai mùa) |
| **N2 (2–3 người)** | Chủ hộ dùng **máy lọc nước** | Roadmap nêu đích danh (`:220`); tôi không có dữ liệu chu kỳ |
| **N3 (2–4 người)** | Chủ hộ **không** dùng điều hoà, có tủ lạnh/máy giặt | **Nhóm đối chứng** — nếu họ cũng muốn nhắc, giả thuyết mở rộng; nếu không, tính năng bị giới hạn vào AC |

**(b) Câu hỏi — hỏi về HÀNH VI QUÁ KHỨ, không hỏi về ý định tương lai.**
`[suy luận]` "Bạn có muốn tính năng X không?" luôn trả về "có". Đây là cách hỏi để tránh:

1. *"Lần cuối cùng bạn vệ sinh điều hoà là khi nào? Ai làm? Bao nhiêu tiền?"*
   → **Đo được:** họ có **nhớ** không. Nếu không nhớ nổi ngày, đó là **bằng chứng cho** nhu cầu ghi chép
   (§7 phương án B), **không** chứng minh nhu cầu nhắc nhở.
2. *"Trong 12 tháng qua, đã bao giờ bạn tự nhủ 'phải gọi thợ vệ sinh điều hoà' rồi quên không?"*
   → **Đo được:** có tồn tại **sự kiện quên** không. Nếu chưa từng quên ⇒ không có vấn đề để giải.
3. *"Bạn có đang dùng cách nào để nhắc việc này không? (lịch điện thoại, ghi chú, nhắc miệng, Zalo)"*
   → **Đo được:** có **workaround** không. Có workaround = có nỗi đau thật. **Không có workaround =
   nhiều khả năng không phải vấn đề.**
4. *"Nếu có thứ ghi lại giúp bạn lần trước làm khi nào, bạn có dùng không? Nếu nó **bắn thông báo**
   mỗi 3 tháng thì sao?"*
   → **Đo được:** phân biệt được **A (nhắc)** và **B (nhật ký)** — đây là câu quan trọng nhất.
5. *"Bạn có sẵn sàng trả tiền cho việc vệ sinh định kỳ, hay chỉ gọi thợ khi máy có vấn đề?"*
   → **Đo được:** mô hình hành vi **định kỳ** vs **theo sự cố** (§3.2 mục 2). Nếu là theo sự cố ⇒
   nhắc định kỳ **vô dụng**.
6. *"Bạn có tắt thông báo của app nào vì bị làm phiền không? App gì?"*
   → **Đo được:** ngưỡng chịu đựng push. Liên quan trực tiếp rủi ro §6.1.

**(c) Tín hiệu ĐỦ để build** — cần **đồng thời**:

- ≥ **5/8** người ở N1+N2 trả lời được câu 1 (nhớ **tháng** của lần cuối), **VÀ**
- ≥ **5/8** nói "có" ở câu 2 (đã từng quên), **VÀ**
- ≥ **3/8** đang có **workaround** thật ở câu 3, **VÀ**
- ≥ **5/8** chọn **A** (nhắc) hơn **B** (nhật ký) ở câu 4.

**(d) Tín hiệu ĐỦ để build B thay vì A:**

- Câu 1 **thấp** (ít người nhớ) **NHƯNG** câu 3 **có** workaround ⇒ vấn đề là **ghi chép**, không phải
  nhắc nhở ⇒ **build B, bỏ cron**.

**(e) Tín hiệu **BÁC BỎ** (⇒ drop, hoặc đẩy xuống cuối):**

- **≥ 6/8** ở N1+N2 nói **chưa từng quên** (câu 2), **HOẶC**
- **≥ 6/8** không có workaround nào (câu 3) **VÀ** chọn theo-sự-cố ở câu 5, **HOẶC**
- **≥ 6/8** nói "chỉ gọi thợ khi máy hỏng" (câu 5).
- Tín hiệu phụ: nhiều người kể chuyện tắt thông báo ở câu 6 ⇒ ngay cả khi có nhu cầu, **push** là kênh
  sai.

**(f) Kiểm chứng bằng hành vi (mạnh hơn lời nói) — nếu muốn chắc hơn:**
Ship **chỉ phương án B** (form ghi log, **không** cron, **không** push). Đo sau 60 ngày:
- **> 15%** người dùng có ≥1 thiết bị loại `AC`/`FRIDGE`/`WASHING` **tạo ít nhất một log** ⇒ có nhu cầu
  ⇒ mở khoá A.
- **< 5%** ⇒ bác bỏ. Không build A.

⚠️ **Giới hạn của kế hoạch này:** `[suy luận]` 8–12 người là **mẫu tiện lợi**, không phải mẫu xác suất.
Nó đủ để **bác bỏ** một giả thuyết yếu, **không** đủ để kết luận về thị trường. Nếu owner muốn ra quyết
định đầu tư lớn, cần mẫu lớn hơn — nhưng với quyết định "có viết một migration không", 8–12 là tương
xứng. **Ghi rõ để người sau không trích dẫn nó như khảo sát.**

**(g) Chỗ ghi kết quả.** `[suy luận]` Kết quả nên được ghi vào `docs/HUMAN_TASKS.md` (nhóm việc chỉ
chủ dự án làm được — file này đã có nhóm *"Quyết định của mày"*) hoặc một file mới
`docs/RESEARCH-MAINTENANCE.md`. **Tài liệu này không tạo file đó** — nó chỉ đề xuất.

---

## 9. Nguồn tham khảo

### Đã fetch và đọc trực tiếp `[ngoài]`

- **CellphoneS/Sforum — "Bao lâu vệ sinh máy lạnh 1 lần? Chu kỳ chuẩn giúp máy bền"** —
  [cellphones.com.vn/sforum/bao-lau-ve-sinh-may-lanh-1-lan](https://cellphones.com.vn/sforum/bao-lau-ve-sinh-may-lanh-1-lan)
  (đã fetch, HTTP 200, **đọc được toàn văn**). Nguồn cho **toàn bộ** bảng chu kỳ ở §3.1(b) và cho câu
  *"Không có một lịch vệ sinh chung cho mọi máy lạnh"*.
  *Chất lượng:* nội dung công nghệ của một **nhà bán lẻ**, không phải tài liệu kỹ thuật của hãng và
  không phải nghiên cứu. Dùng làm mô tả **khuyến nghị phổ biến của ngành**, không phải tiêu chuẩn.
  **Tác giả bài viết có gắn link bán máy lạnh** ⇒ có động cơ thương mại; đã tính đến khi đánh giá.
- **LG Việt Nam — LG Best Care** —
  [lg.com/vn/tro-giup/lg-best-care/](https://www.lg.com/vn/tro-giup/lg-best-care/) và
  [lg.com/vn/tro-giup/lg-best-care/bao-duong/](https://www.lg.com/vn/tro-giup/lg-best-care/bao-duong/)
  (đã fetch, HTTP 200). Xác nhận **sự tồn tại** của ba dòng dịch vụ: `LG Best Care`, **`Dịch vụ bảo
  dưỡng`**, **`Gia hạn bảo hành`**.
  ⚠️ **Giới hạn nghiêm trọng:** trang render bằng JS nên fetch chỉ nhận được **khung điều hướng**.
  **Không** đọc được giá, chu kỳ, hay danh mục sản phẩm áp dụng ⇒ **không** trích con số nào từ đây.
  Chỉ dùng làm bằng chứng **có tồn tại** dòng dịch vụ bảo dưỡng do hãng bán.

### Đã thấy trong kết quả tìm kiếm nhưng **CHƯA** fetch / nội dung rỗng

Ghi rõ để người sau **không** nhầm là đã kiểm chứng:

- **Thanh Niên — "Thiết bị điện cũng phải 'khám sức khỏe định kỳ'"** —
  [thanhnien.vn/...-185240616084616872.htm](https://thanhnien.vn/thiet-bi-dien-cung-phai-kham-suc-khoe-dinh-ky-185240616084616872.htm)
  đã fetch **HTTP 200 nhưng nội dung trả về rỗng** (chỉ có tiêu đề). ⇒ **Chỉ** ghi nhận rằng báo chí
  đại chúng có đặt vấn đề. **Không** trích dẫn nội dung, **không** dùng làm bằng chứng cho vế B.
- **Giá dịch vụ vệ sinh điều hoà (~150.000₫)** — nhiều nhà cung cấp (`f24.vn`,
  Q&A trên `thegioididong.com`). **Chưa fetch** ⇒ chỉ ghi nhận thị trường tồn tại.
- **Chu kỳ thay lõi máy lọc nước** — kết quả tìm kiếm trả về **trang bán lõi lọc** (`meta.vn`,
  `buderwater.com`) và hướng dẫn không rõ tác giả (`dichvu3t.com`). **Không** có nguồn đáng tin ⇒
  **không** đưa ra con số nào (§6.2).
- **Nghiên cứu về hành vi bảo trì thiết bị** — `salford-repository.worktribe.com` (**hộ gia đình Anh**),
  `jipmerlibrary.ovidds.com` (**hộ gia đình châu Âu**). **Chưa fetch**, và **quan trọng hơn: sai địa
  bàn.** ⇒ **Không** ngoại suy sang VN.
- **LG here4U** ([lg.com/vn/tro-giup/lg-here4u/](https://www.lg.com/vn/tro-giup/lg-here4u/) — đã fetch,
  HTTP 200, nhưng cũng chỉ nhận được khung điều hướng) và **LG Subscribe**
  ([lg.com/vn/lg-subscribe/](https://www.lg.com/vn/lg-subscribe/)) — mô hình thuê/đăng ký thiết bị kèm
  chăm sóc. Chỉ ghi nhận sự tồn tại; **không** đọc được điều khoản.

### Tài liệu trong repo đã đọc

- `docs/FEATURE_ROADMAP.md` — #13 (`:216-223`), §2.1 (`:84`), §2.8 (`:99-100`), §5, §6.
- `docs/SPEC-WARRANTY-CLAIM.md` — tài liệu anh em, cùng ngày. §2.3/§6.1 của nó **độc lập** phát hiện
  cùng cái bẫy `Reminder.isDismissed`; §6.3 nêu yêu cầu bump backup v6 **dùng chung**.
- `docs/HUMAN_TASKS.md` — không có mục nào về bảo trì; nhóm *"Quyết định của mày"* là chỗ phù hợp để
  ghi kết quả kiểm chứng (§8.3g).

### Những gì tôi KHÔNG kiểm chứng được

1. **Vế B của giả thuyết** — không có khảo sát, không có dữ liệu hành vi, không có bằng chứng nào cho
   việc hộ gia đình VN muốn app nhắc bảo trì. **Đây là lý do chính của khuyến nghị hoãn.**
2. Chu kỳ thay lõi **máy lọc nước RO** — không tìm được nguồn đáng tin.
3. Chi tiết dòng **"Dịch vụ bảo dưỡng" của LG** — giá, chu kỳ, sản phẩm áp dụng (trang JS-heavy).
4. **Nội dung** bài Thanh Niên — chỉ có tiêu đề.
5. **Tỉ lệ người dùng thật sự làm bảo trì định kỳ** ở VN — không có số liệu. Sẽ là bịa nếu đưa ra.
6. **Nghị định 55/2024/NĐ-CP** — tài liệu này **không** dẫn nó cho bất kỳ khẳng định nào. Roadmap đã
   xác minh nó **không** có quy định thời hạn bảo hành; tôi **không** đọc lại và **không** phản đối.
   Bảo trì định kỳ **không** phải nghĩa vụ pháp lý — **không** có căn cứ pháp lý nào cho tính năng này,
   và tài liệu này **không** giả vờ có.

---

## 10. Tóm tắt một khối

| Câu hỏi | Trả lời |
|---|---|
| `Reminder` có diễn đạt được lịch bảo trì không? | **Không.** `warrantyId NOT NULL` + FK (`0001:174-183`); không có trường ngày đến hạn; không có chủ thể; và `isDismissed` đang **chặn push** (`warranties.sql:178-187`) nên generic hoá sẽ tạo **lỗi đúng đắn**, không chỉ rủi ro. |
| Roadmap khuyến nghị bảng riêng — có đúng không? | **Đúng**, nhưng lý do roadmap nêu *"tránh phá vỡ cron"* là **quá yếu**. Lý do thật: xung đột ngữ nghĩa `isDismissed`, `StampWarrantyNotified` upsert theo `warrantyId`, và mẫu nhất quán của repo là **cột-trên-bảng-chủ-thể** (`Subscription`, `WishlistItem` đều KHÔNG dùng `Reminder`). |
| Roadmap thiếu gì? | **Endpoint.** Gộp vào `/api/v1/reminders` là **phá vỡ** 3 client (model cố định ở `Models.kt:561`, `Models.swift:270`). Cần endpoint riêng. |
| Rủi ro kỹ thuật? | **Thấp** — mẫu đã chạy production cho wishlist (`wishlist.sql:145-161`). |
| Rủi ro sản phẩm? | **Cao** — vế cầu **không có bằng chứng nào**; và push thường xuyên có thể làm người dùng tắt thông báo, **hỏng luôn** nhắc bảo hành. |
| Có căn cứ pháp lý không? | **Không.** Bảo trì định kỳ không phải nghĩa vụ pháp lý. Không dẫn luật nào cho tính năng này. |
| Khuyến nghị | **DEFER.** Làm kiểm chứng §8.3 **ngay** (0 dòng code). Nếu sống sót → build **phương án B (nhật ký)** trước, rồi mới tới A (nhắc nhở). Nếu bị bác bỏ → **drop**. |
