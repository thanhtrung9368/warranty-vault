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
| **1** | `api/` | Dịch nốt ~803 chuỗi Go theo mẫu đã chứng minh | ⬜ **sẵn sàng bắt đầu** |
| **2** | `android/` | `values/` (en) + `values-vi/`, đổi ngôn ngữ trong app | ⬜ |
| **3** | `ios/` | String Catalog, đổi ngôn ngữ trong app | ⬜ |
| **4** | `website/` | Từ điển + chuyển ngôn ngữ | ⬜ |
| **5** | `docs/`, test | Sửa mâu thuẫn tài liệu, cập nhật test | ⬜ |

**Pha 0 phải xong trước khi làm pha 1.** Chứng minh mẫu trên **một lát cắt nhỏ** rồi mới nhân ra
803 chuỗi — nếu mẫu sai thì sai 803 lần.

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
