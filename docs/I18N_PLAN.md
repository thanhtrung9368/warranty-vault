# Kế hoạch song ngữ (Anh + Việt)

> **Trạng thái:** đang làm — bắt đầu 2026-10-04.
> **Quyết định nguồn:** chủ repo yêu cầu song ngữ, **mặc định tiếng Anh**.
> Việc này **đảo ngược** quyết định cũ ở [FEATURE_ROADMAP.md](FEATURE_ROADMAP.md) §5 ("tiếng Việt là
> quyết định sản phẩm có chủ đích"). Đảo ngược là quyết định hợp lệ của chủ sản phẩm — nhưng tài liệu
> cũ phải được sửa, đừng để hai chỗ nói ngược nhau.

## 1. Vì sao không "chỉ dịch"

Đo ngày 2026-10-04:

| Nơi | Chuỗi hiển thị tiếng Việt | File test assert tiếng Việt |
|---|---|---|
| **Go API** | **~803** | 35 |
| iOS | ~1.159 | 23 |
| Android | ~967 | 40 |
| Web | ~307 | 20 |
| **Tổng** | **~3.236** | **118** |

Và **không có hạ tầng i18n nào**: không `Accept-Language`, không cột `locale`, không thư viện.

## 2. Quyết định kiến trúc — cái quan trọng nhất

### 2.1. Go là nguồn chuỗi, không phải 3 client

`api/internal/httpx/response.go:26` — server trả `message` + `fieldErrors` **dạng chuỗi đã dịch sẵn**.
Đó là nguồn chuỗi cho **cả 3 client**: mọi lỗi validate, mọi thông báo giới hạn, mọi lỗi nghiệp vụ.

Hai lựa chọn đã cân nhắc:

| Cách | Vì sao chọn / loại |
|---|---|
| **Server đọc `Accept-Language`** | ✅ **CHỌN.** Additive — không phá contract. Và **bắt buộc** cho push (xem 2.3) |
| Server trả mã lỗi, client tự dịch | ❌ **LOẠI.** Phá contract API, và **nhân 3** công dịch: mỗi client phải có bảng dịch cho mọi mã |

### 2.2. Thứ tự quyết định ngôn ngữ

```
1. ?lang=vi|en          (query param — để test và debug, thắng tất cả)
2. Accept-Language      (chuẩn HTTP — client gửi)
3. User.locale          (lựa chọn đã lưu của người dùng)
4. "en"                 (mặc định)
```

Dùng `golang.org/x/text/language` — **đã có trong `go.mod`** (`v0.36.0`). Không thêm dependency.

**Ngôn ngữ không hỗ trợ → rơi về mặc định, KHÔNG trả 400.** Một client gửi `Accept-Language: fr`
phải nhận tiếng Anh, không phải lỗi.

### 2.3. Push notification — lý do `User.locale` là bắt buộc

Nội dung push sinh ở **Go** (cron), ví dụ *"Còn 3 ngày đổi trả…"*. Request cron **không có** ngữ cảnh
người dùng — không có `Accept-Language`, không có ai để hỏi. Nên server **phải** biết mỗi người dùng
thích ngôn ngữ nào.

→ Cần cột **`User.locale`** + migration `0014`. Đây là **tính năng mới**, không phải dịch thuật.

### 2.4. Mặc định là `en`, nhưng đừng để tiếng Việt thành hạng hai

Chủ repo yêu cầu mặc định tiếng Anh. Nhưng người dùng thật gần như chắc chắn là người Việt, và điện
thoại họ đặt tiếng Việt → `Accept-Language: vi` → nhận tiếng Việt. **Đúng như mong đợi.**

Điều cần tránh: để bản tiếng Việt kém hơn bản tiếng Anh (thiếu chuỗi, dịch máy). **Tiếng Việt là bản
gốc** — mọi chuỗi đang tồn tại đều là tiếng Việt. Bản tiếng Anh là bản **dịch thêm**.

## 3. Thứ tự thi công

**Go trước, client sau.** Client phụ thuộc contract; làm client trước là đoán.

| Pha | Vùng | Nội dung | Trạng thái |
|---|---|---|---|
| **0** | `api/` | Hạ tầng: `User.locale` + migration `0014`, bộ khung catalog, middleware `Accept-Language`, `?lang=`, `PATCH /auth/me` nhận `locale`, push dùng `User.locale`. **Chỉ chuyển một lát cắt** (auth) để chứng minh mẫu | ✅ **xong** — xem ghi chú dưới |
| **1** | `api/` | Dịch nốt ~800 chuỗi Go theo mẫu đã chứng minh, **chia 5 wave tuần tự** | 🔄 **wave 1+2 xong**, xem bảng dưới |
| **2** | `android/` | `values/` (en) + `values-vi/`, đổi ngôn ngữ trong app | ⬜ |
| **3** | `ios/` | String Catalog, đổi ngôn ngữ trong app | ⬜ |
| **4** | `website/` | Từ điển + chuyển ngôn ngữ | ⬜ |
| **5** | `docs/`, test | Sửa mâu thuẫn tài liệu, cập nhật test | ⬜ |

**Pha 0 phải xong trước khi làm pha 1.** Chứng minh mẫu trên **một lát cắt nhỏ** rồi mới nhân ra
803 chuỗi — nếu mẫu sai thì sai 803 lần.

### 3.1. Pha 1 chia 5 wave — và vì sao phải TUẦN TỰ

**Go biên dịch cả module.** Hai agent cùng sửa `api/` thì một con để lại lỗi cú pháp là con kia
build fail, rồi có thể đi "sửa" file của con đầu. Nên **mỗi thời điểm chỉ một agent được ở trong
`api/`** — đúng bài học của `sqlc generate`. Các wave chạy nối tiếp, không song song.

| Wave | Domain | Trạng thái |
|---|---|---|
| 1 | devices + warranties (+ `serial_validation.go`) | ✅ xong — 29 chuỗi |
| 2 | subscriptions + wishlist | ✅ xong — 36 chuỗi |
| 3 | backup + attachments + files | ✅ xong — 61 chuỗi (62 khoá) |
| 4 | ai + shares + search + directory | ⬜ |
| 5 | cron + email templates + `actions.go` + `forecast.go` + còn lại | ⬜ |

**Catalog:** 72 (hết pha 0) → **101** (hết wave 1) → **140** (hết wave 2) → **202** (hết wave 3).

### 3.2. Hai file wave 2 KHÔNG chuyển nhưng CÓ chứa copy subscription/wishlist

Brief wave 2 liệt kê thiếu. Wave 5 phải nhận chúng:

- **`services/forecast.go`** — `forecastNote` nói thẳng về gói ACTIVE/LIFETIME và chi phí wishlist,
  cộng 2 câu validate khoảng tháng.
- **`services/actions.go`** — các mục hàng đợi của subscription và wishlist (*"Sắp bị trừ tiền nhưng
  chưa có link huỷ"*, *"Ngày gia hạn chưa được cập nhật"*, *"Đã qua ngày dự kiến mua"*), **và nó
  render ngày/tiền qua `formatViDate`/`formatVNDInt64` chỉ có tiếng Việt** — nên cần đúng bộ
  locale plumbing mà `subscription_audit.go` vừa nhận.

Wave 2 đã thêm `formatMoney`/`formatDate` riêng ở phía audit (delegate sang `i18n.FormatMoney`/
`i18n.FormatDate`) thay vì sửa 2 hàm kia, để domain chưa chuyển không bị xê dịch.

### 3.3. Bẫy wire code — wave 2 phát hiện, các wave sau phải kiểm

`services/subscriptions.go` dựng 3 lỗi qua helper `errBadInput` với `Code: "BAD_INPUT"`. Cách
chuyển "hiển nhiên" là `ErrValidationKeyed` — nhưng nó set `Code: "VALIDATION"`, nên response sẽ
**giữ nguyên 400 và giữ nguyên bản dịch**, chỉ **âm thầm đổi mã lỗi trên wire** từ `bad_input`
(openapi ghi đúng thế cho path đó) sang `validation`. **Không test nào bắt được**, và web có so
`'bad_input'`.

→ Đã thêm `services/errors.go::ErrBadInputKeyed` (`BAD_INPUT` + `MessageKey`) và
`TestSubscriptionBodyErrorCodesAreStable` khoá từng ca.

**Luật cho wave sau:** trước khi đổi một error sang helper i18n, **xem `Code` cũ là gì** và giữ
nguyên. Mã lỗi là contract; chỉ phần chữ được dịch.

### 3.4. Wave 3 (backup + attachments + files) — brief sai gì, và còn lại gì

- **`services/backup_ids.go` không có trong brief** nhưng chứa câu từ chối cross-account — đúng câu
  mà `handlers/backup_test.go` khẳng định. Đã chuyển: 1 câu, cộng 7 nhãn thực thể (`thiết bị`,
  `gói bảo hành`, …) được nội suy vào câu đó nên cũng phải vào catalog. Nhãn `subscription` **cố ý**
  không có entry: nó là cùng một từ ở cả hai ngôn ngữ, và khoá lạ thì `i18n.Text` trả lại chính khoá.
- **`internal/files/` vẫn tiếng Việt ở tầng package** (không có request context, và được gọi từ hai
  domain). Chữ của nó *là* khoá catalog, còn bên gọi có request mới dịch
  (`services/attachments.go::filesText`) — nhờ vậy `handlers/ai.go` (wave 4) vẫn gửi **đúng byte
  tiếng Việt** như trước. Hai chuỗi của `files/` **không** có entry: `mime.go`'s `"file trống"`
  (`Upload` chặn body rỗng trước khi tới nó, nên khoá bất khả) và `resize.go`'s `errBadImage` (code
  chết — không ai `return` nó).
- **Một câu của domain attachments rò sang AI:** `decryptAttachment` dùng chung với
  `services.ExtractReceipt`, nên `"Không tìm thấy file"` của `POST /api/v1/ai/extract-receipt` giờ
  theo ngôn ngữ request, trong khi phần còn lại của AI vẫn tiếng Việt tới wave 4. Không test nào vỡ;
  ghi lại để wave 4 biết chỗ này đã đổi và đừng dịch lại lần hai.
- **Không có cặp số ít/số nhiều nào ở các giới hạn attachment:** 5 file và 100 MB là hằng số, không
  nội suy số đếm. Câu duy nhất mang số đếm là cảnh báo blob thiếu trong `.zip`
  (`services/backup_blobs.go::missingBlobNote`, có cặp khoá); còn câu "có %d file đính kèm, vượt giới
  hạn" chỉ chạy khi `> 5` nên dạng số ít bất khả — thêm khoá sẽ là entry không ai tạo ra được.
- **Domain này không có tiền.** Byte size chỉ có dạng hằng số 5 MB / 100 MB, và thứ duy nhất đổi theo
  ngôn ngữ là khoảng trắng trước đơn vị (`5MB` → `5 MB`).
- **Nợ đã biết, cố ý không sửa ở wave này:** openapi ghi `409` cho `POST /devices/{id}/attachments`
  nhưng handler trả `400 limit_reached` (type `AttachmentError` khác `services.Error`). Đổi nó là đổi
  status thật mà client có thể đang dựa vào — cần người quyết contract, không phải một wave dịch chữ.
- **`/api/files/{id}` không nhận `?lang=`:** mọi lỗi ở đó là 404 với body rỗng của `net/http`, không
  có chữ nào để dịch.
- **Hai lỗi cross-cutting wave 3 phát hiện, cố ý KHÔNG sửa (không thuộc domain này):**
  1. `internal/handlers/auth.go:115` ghép câu đã dịch với `ratelimit.FormatRetry`
     (`internal/ratelimit/helpers.go:68`) — hàm này **chỉ có tiếng Việt**, nên `?lang=en` cho ra
     `"Too many attempts. Try again in 2 phút"`. Đã kiểm bằng cách chạy thật. Sửa thì phải cho
     `FormatRetry` biết ngôn ngữ (hoặc trả về số + đơn vị tách rời) — việc của wave "còn lại".
  2. `internal/auth/middleware.go:26,34` ghi 401 bằng `httpx.WriteError` với chuỗi tiếng Việt **hardcode**,
     không qua catalog — nên mọi endpoint đã chuyển (kể cả `/api/v1/backup/*`) vẫn trả 401 tiếng Việt
     dưới `?lang=en`. **Không được sửa lẻ:** middleware này dùng chung với các domain chưa chuyển
     (AI, shares, cron…), nên dịch nó sẽ lật chữ của những endpoint đó — phải làm ở wave cuối, cùng
     lúc với "Lỗi hệ thống".
- **Chuỗi chưa ai nhận (không thuộc wave 1-3, wave 5 "còn lại" phải để ý):**
  `handlers/reminders.go` (4 chuỗi tham số `withinDays`/`includeDismissed` — trong đó
  `"Phải là true hoặc false"` **đã có** entry do wave 3 thêm), `handlers/sessions.go` (7 —
  đã ghi nợ ở §3.1 pha 0), `handlers/push.go` + `services/push.go`, `handlers/cron.go`.

**Pha 2/3/4 chạy song song được** (thư mục khác nhau), nhưng chỉ sau khi pha 1 xong.

### 3.1. Pha 0 đã chốt những gì (đọc trước khi làm pha 1)

Mẫu đã được chứng minh trên lát cắt auth + push. Công thức cho **mỗi** chuỗi ở pha 1:

```go
// 1. gọi site — bọc chuỗi tiếng Việt ĐANG CÓ, không sửa nó
fieldErrors["email"] = []string{i18n.Text(ctx, "Email không hợp lệ")}
message := i18n.T(ctx, "Còn %d ngày", days)      // có tham số → T
// 2. một entry trong internal/i18n/catalog.go
"Email không hợp lệ": {vi: "Email không hợp lệ", en: "Invalid email address"},
```

| Quyết định | Chốt | Vì sao |
|---|---|---|
| Khoá catalog | **chính chuỗi tiếng Việt** | Pha 1 chỉ *thêm*, không đặt tên 803 lần; khoá sai rơi về đúng câu tiếng Việt, không bao giờ ra `err.limit50` |
| Nội suy | `fmt.Sprintf` (`%s`, `%d`), gọi qua `i18n.T` | Không thêm dependency; `%` trong chuỗi tĩnh không bị Sprintf đụng vì `Text`/`Lookup` không chạy Sprintf khi không có tham số |
| Thiếu bản dịch | rơi sang **ngôn ngữ còn lại**, rồi tới chính khoá | Không bao giờ ra chuỗi rỗng hay tên khoá |
| `Text` vs `T` | `Text(ctx, key)` khi không có tham số; `T(ctx, key, args…)` khi có | `go vet` coi `(string, ...any)` là printf-wrapper và **fail** nếu khoá không phải literal — `Text` đi đường `Lookup`, không có đuôi variadic |
| Số nhiều | cặp khoá `…%d ngày` / `…1 ngày`, caller truyền **hai** danh sách tham số (`cron.renderCount`) | Tiếng Việt không biến đổi, tiếng Anh có; không kéo CLDR về cho một phép `== 1` |
| `locale` trong DB | `text` NULL + CHECK hai chữ cái thường | NULL = "chưa chọn" (KHÁC `'en'`); thành viên `{en,vi}` do app ép, nên thêm ngôn ngữ thứ ba **không cần migration** |
| `locale` trong response | `omitempty` | Client cũ không thấy byte nào đổi |
| `?lang=` | chỉ nhận đúng `vi`/`en`; giá trị khác **rơi xuống mức kế tiếp**, không phải 400 | Là công tắc debug theo contract openapi |
| `PATCH /auth/me` | hai field ba trạng thái, **độc lập**; body rỗng vẫn 400 | Client cũ gửi mỗi `displayName` không thể xoá ngôn ngữ đã lưu |
| Thư viện | **không thêm dependency nào** | `golang.org/x/text/language` đã có sẵn (`ParseAcceptLanguage` + `Matcher` với kiểm tra confidence) |

**Còn nợ, pha 1 phải làm:**

- ~740 chuỗi ngoài lát cắt auth (devices, subscriptions, wishlist, backup, AI, shares…).
  `writeServiceError`/`writeDevicesErr`/`writeAttachmentError`/`writeShareLookupFailure` đã nhận
  `ctx` sẵn nên chỉ cần đổi chuỗi thành `i18n.Text`.
- `User.locale` **không** nằm trong backup payload (`services/backup.go`), giống `DecisionSnooze`:
  mất khi restore thì rơi về `Accept-Language`, hướng an toàn.
- Template email (`internal/email/resend.go`) vẫn tiếng Việt — chưa vào catalog.
- `GET/POST /api/v1/auth/sessions*` vẫn tiếng Việt và **chưa** nhận `?lang=`.
- Lỗi từ `services.*` chưa chuyển hết: cơ chế đã có (`Error.MessageKey`, `ErrValidationKeyed`),
  nhưng mới `profile.go` dùng.


## 4. Luật cho mọi agent làm việc này

1. **Chỉ thêm, đừng phá.** Response hiện tại phải giữ nguyên hình dạng khi không có `Accept-Language`
   — client cũ không được vỡ.
2. **Tiếng Việt là bản gốc.** Không "dịch lại" tiếng Việt. Chuỗi tiếng Việt hiện có là **đúng**;
   việc của mày là **bọc** nó vào catalog và **thêm** bản tiếng Anh.
3. **Test phải ghim ngôn ngữ.** Test assert chuỗi phải nói rõ nó đang kiểm ngôn ngữ nào
   (`?lang=vi`), không phụ thuộc locale của máy chạy. **Đây là chỗ dễ sinh test flaky nhất.**
4. **Không dịch máy móc.** Câu tiếng Anh phải đọc tự nhiên. Ví dụ `"Đã đạt giới hạn 50 thiết bị chưa
   bán"` → `"You have reached the limit of 50 unsold devices"`, không phải từng chữ một.
5. **Chuỗi trong comment/log KHÔNG cần dịch.** Chỉ chuỗi tới tay người dùng. Đừng đụng comment.
6. **Số nhiều (plural).** Tiếng Việt không biến đổi theo số lượng, tiếng Anh có. `"3 ngày"` →
   `"3 days"` nhưng `"1 ngày"` → `"1 day"`. Chỗ nào có số lượng thì phải xử lý.

## 5. Bẫy đã biết

- **118 file test assert chuỗi tiếng Việt.** Đổi mặc định sang tiếng Anh là vỡ hết. Phải ghim locale
  trong test, **không** sửa assertion cho qua.
- **`Values` trong chart/badge** cũng là chuỗi — đừng bỏ sót.
- **Nhãn enum** (`ACTIVE`, `SOLD`, `MONTHLY`…) có **bản sao tĩnh ở cả 3 client** và
  `api/internal/services/category_seed_test.go` **fail nếu lệch**. Đổi 1 nơi là CI đỏ.
- **`APP_URL` / link trong email** không phải chuỗi dịch — đừng đụng.
- **Play Store**: app name và default language đặt ở Play Console, **không** nằm trong repo. Đổi ở
  Console phải làm tay.

## 6. Việc không thuộc phạm vi này

- Dịch **tài liệu trong repo** (`docs/**`, `*.md`) — tài liệu là cho người phát triển, giữ tiếng Việt.
- Dịch **comment code**.
- Thêm ngôn ngữ thứ ba. Kiến trúc phải **cho phép**, nhưng đừng làm bây giờ.
