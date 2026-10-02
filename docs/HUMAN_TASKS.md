# Việc chỉ mày làm được — checklist cho chủ dự án

> File này liệt kê **những việc agent không thể làm thay**: cần tài khoản, cần thẻ,
> cần quyền `sudo`, hoặc cần chính mày ra quyết định.
> Mọi việc code được thì **không** nằm ở đây — xem `docs/FEATURE_ROADMAP.md`.
>
> Cách dùng: làm từ trên xuống. Mỗi mục ghi rõ **tốn gì** → **lấy gì** → **quăng vào đâu**
> → **mở khoá được gì**. Xong mục nào tick `[x]` rồi báo tao.

**Cập nhật:** 2026-10-03 (lần 2) — **đã kiểm lại từng mục** (không tin bản cũ). Mục nào đã hết việc thì
ghi rõ là **HẾT VIỆC** chứ không xoá, để mày biết là tao đã kiểm chứ không phải bỏ sót.

> Kiểm ở HEAD `794b35a` **+ working tree** (backend agent còn đang commit). Thay đổi so với bản 2026-10-02:
> **(a)** 0.1 (quyền `~/.npm`) **hết việc** — không cần `sudo` nữa;
> **(b)** 3.4 (5 control chết trên iOS) **đã được xử lý bằng code**, không còn là quyết định của mày;
> **(c)** thêm **2.5 — diễn tập restore**, việc quan trọng nhất còn lại mà chỉ mày làm được;
> **(d)** **1.3 nay quan trọng hơn**: luồng đổi email mới của backend cũng cần email thật mới chạy được;
> **(e)** không có **biến env mới nào bắt buộc** phải cấp (đã diff `api/.env.example` + grep toàn bộ
> `os.Getenv` trong `api/`).

---

## Nhóm 0 — Miễn phí, làm được ngay hôm nay

Không tốn tiền, không cần chờ duyệt. Làm trước vì mấy cái dưới phụ thuộc vào đây.

### [x] 0.1 — Sửa quyền `~/.npm` (cần `sudo`) — ✅ **HẾT VIỆC, không cần làm**

```bash
sudo chown -R 501:20 ~/.npm
```

- **Vì sao:** npm không ghi được cache → `npm view`, `npm audit`, `npm ci` fail với
  `EPERM: Your cache folder contains root-owned files`. Lỗi này do một bản npm cũ để lại.
- **Kiểm lại 2026-10-03:** `ls -ld ~/.npm` → `trungit staff` (uid **501**, đúng uid hiện tại), và
  `npm view left-pad version` trả `1.3.0` bình thường. **Không cần chạy lệnh trên nữa.**
- ~~Xong thì: npm chạy bình thường, CI local khớp với CI GitHub.~~ → đã đạt.

### [ ] 0.2 — Trỏ `xcode-select` về Xcode thật (cần `sudo`) — **vẫn còn nguyên**

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcode-select -p   # phải ra /Applications/Xcode.app/Contents/Developer
```

- **Vì sao:** đang trỏ vào `/Library/Developer/CommandLineTools` nên `swift build`,
  `swift test` và `xcodebuild` **đều fail**. Tao đã phải ép `DEVELOPER_DIR` mỗi lần
  chạy test iOS.
- **Kiểm lại 2026-10-03:** `xcode-select -p` vẫn ra `/Library/Developer/CommandLineTools`. **Chưa sửa.**
  Cách chạy test tạm thời (đã kiểm, xanh — 125 test ở lần đếm mới nhất):
  `cd ios && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer swift test --disable-sandbox`
  (`--disable-sandbox` là bắt buộc vì máy này bật sandbox cho SwiftPM.)
- **Mất:** 5 giây.
- **Xong thì:** `cd ios && swift test` chạy được trực tiếp, **không cần** `DEVELOPER_DIR` lẫn
  `--disable-sandbox`; mở được project trong Xcode; `xcrun simctl` hoạt động (mở khoá luôn mục 0.4).

### [ ] 0.3 — Sinh bộ secret cho production

Chạy 3 lệnh này, **lưu lại đâu đó an toàn** (1Password / keychain):

```bash
openssl rand -hex 32      # → POSTGRES_PASSWORD
openssl rand -base64 32   # → FILE_MASTER_KEY
openssl rand -hex 32      # → CRON_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"  # → SESSION_SECRET
```

> ⚠️ **`POSTGRES_PASSWORD` phải dùng `-hex`, KHÔNG dùng `-base64`.** Mật khẩu base64
> hay chứa ký tự `/`, mà `/` phá `DATABASE_URL` (`invalid port ":ab" after host`)
> → API không kết nối được DB. Đây là lỗi đã kiểm chứng bằng `net/url` của Go.

> ⚠️ **`FILE_MASTER_KEY` mất là mất sạch ảnh/hoá đơn đã upload.** Blob mã hoá
> AES-256-GCM, mỗi file có data key riêng được wrap bằng key này. Sai key thì
> download trả **404 "Không tìm thấy file"** (không phải báo lỗi key) — rất dễ
> tưởng là lỗi khác. Backup file này **tách riêng** khỏi backup DB.

> ⚠️ **`POSTGRES_PASSWORD` KHÔNG có trong `api/.env.example` lẫn `website/.env.example`.**
> Cả hai file đó đều không có dòng nào cho nó, nhưng `docker-compose.yml` **bắt buộc**
> (`POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?...}`) — thiếu là `docker compose up` dừng ngay.
> Nên khi tạo `.env` ở repo root thì **tự thêm** dòng `POSTGRES_PASSWORD=...` (giá trị `-hex` ở trên),
> đừng chỉ copy 2 file example rồi thắc mắc tại sao compose đòi biến chưa từng được nhắc.
> `POSTGRES_USER` / `POSTGRES_DB` thì có default (`warranty` / `warranty_vault`), không cần điền.

> ℹ️ **`SESSION_TTL_DAYS` là biến chết — đừng mất thời gian.** Compose có forward nó
> (`docker-compose.yml:78`) và `deploy/PRODUCTION_CHECKLIST.md:63` có nhắc, nhưng **Go không đọc
> biến này ở đâu cả**: TTL phiên là hằng số `30 * 24h` trong `api/internal/auth/session.go:17`.
> Đặt gì cũng không có tác dụng.

- **Mất:** 1 phút. **Xong thì:** đủ secret để dựng stack ở nhóm 2.

### [ ] 0.4 — Quyết định dọn 24G simulator

`~/Library/Developer/CoreSimulator` chiếm 24G nhưng **không phải rác** — đó là
simulator thật kèm dữ liệu app (iPhone 17 6.6G, ToanThang iPhone 17 3.0G,
iPad Pro 13" 2.9G, ToanThang iPhone SE 2.6G, Sim-iOS27 2.2G…).

*(Kiểm lại 2026-10-03: vẫn đúng **24G**, chưa có gì thay đổi.)*

Tao **không tự xoá** vì mất state app của mày. Chọn một:

```bash
# Cách A — reset 1 máy cụ thể (giữ máy, xoá sạch dữ liệu app)
xcrun simctl erase <udid>

# Cách B — xoá hẳn máy không dùng nữa (không hoàn tác)
xcrun simctl delete <udid>

# Cách C — xem máy nào nặng nhất trước khi quyết
du -sh ~/Library/Developer/CoreSimulator/Devices/* | sort -rh | head
```

- **Lưu ý:** `xcrun simctl delete unavailable` **không xoá được gì** — máy mày hiện
  có 0 simulator rác. Đừng phí thời gian.

### [ ] 0.5 — Sinh cặp khoá VAPID cho web push

```bash
npx web-push generate-vapid-keys
```

- Lấy `Public Key` → `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (website) **và** `VAPID_PUBLIC_KEY` (Go).
- Lấy `Private Key` → `VAPID_PRIVATE_KEY` (Go).
- **Mất:** 1 phút. **Xong thì:** bật được thông báo đẩy trên web.

---

## Nhóm 1 — Tài khoản miễn phí (chỉ cần đăng ký)

### [ ] 1.1 — Firebase project → FCM cho Android

**Tốn:** 0đ. FCM không tính phí. Gói Spark (miễn phí) là đủ.

1. Vào <https://console.firebase.google.com> → tạo project.
2. Thêm app Android, package name **`com.warrantyvault.app`** (phải khớp
   `applicationId` trong `android/app/build.gradle.kts`).
3. Tải `google-services.json` → chép vào `android/app/google-services.json`.
   File hiện tại chỉ là **stub** (`project_number: "000"`, `api_key: "placeholder"`)
   nên build xanh nhưng push thật **không chạy**.
   *(Kiểm lại 2026-10-03: vẫn **y nguyên stub**, chưa thay.)*
4. Project Settings → Service accounts → **Generate new private key** → tải JSON.
   Nội dung JSON đó → biến `FCM_SERVICE_ACCOUNT_JSON` của Go.
5. `FCM_PROJECT_ID` = project ID.

> ⚠️ `android/app/google-services.json` **đang bị gitignore** (đúng — nó chứa API key).
> Nên đừng ngạc nhiên khi `git status` không thấy nó.

- **Mở khoá:** push notification trên Android.
- **Gửi lại tao:** xác nhận đã đặt file + đã có service account JSON (đừng dán JSON vào chat).

### [ ] 1.2 — Upstash Redis → rate limit production

**Tốn:** 0đ ở free tier (đủ cho quy mô cá nhân).

1. <https://upstash.com> → tạo Redis database (chọn region gần VN, vd Singapore).
2. Lấy **REST URL** + **REST TOKEN**.
3. → `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, và đặt `RATE_LIMITER=upstash`.
   (`api/internal/ratelimit/factory.go` nhận **cả** `upstash` lẫn `redis`; giá trị khác thì log warning
   rồi rơi về memory. Compose đã forward sẵn `RATE_LIMITER` từ `.env` root.)

- **Không làm cũng chạy được:** Go tự fallback sang token-bucket in-memory khi thiếu
  env. Nhược điểm: reset khi restart và **không dùng chung giữa nhiều instance**.
- **Mở khoá:** rate limit bền, chống brute-force auth đúng nghĩa.

### [ ] 1.3 — Resend → email đặt lại mật khẩu **và** xác nhận đổi email

**Tốn:** 0đ ở free tier (giới hạn số email/ngày — kiểm tra lại khi đăng ký).

1. <https://resend.com> → tạo API key.
2. → `RESEND_API_KEY`. Đặt `RESEND_FROM` (phải là domain đã verify với Resend).
3. Cần domain riêng để verify → phụ thuộc mục 2.1.

- **Không làm cũng "chạy":** chức năng quên mật khẩu **chỉ ghi link ra log**, user
  không nhận được email. Với app thật thì coi như **hỏng**.
- 🆕 **Mục này nay chặn 2 tính năng, không còn 1.** Backend vừa thêm luồng **đổi email**
  (`POST /api/v1/auth/change-email` + `confirm-email-change`, migration `0009`): token xác nhận gửi tới
  **địa chỉ email mới**, nên không có Resend thật thì người dùng đổi email xong sẽ **kẹt** — địa chỉ cũ
  vẫn dùng được (vì chưa confirm), nhưng không có đường nào confirm.
  Phần **code** còn thiếu (không phải việc của mày): web chưa có trang `/confirm-email/<token>` mà link
  trong mail trỏ tới. Việc của mày ở đây chỉ là **domain + API key**.

### [ ] 1.4 — Anthropic API key → OCR hoá đơn (tuỳ chọn)

**Tốn:** trả theo lượng dùng (không cố định). Mặc định model `claude-haiku-4-5-20251001`.

1. <https://console.anthropic.com> → tạo API key.
2. → `ANTHROPIC_API_KEY`. Có thể đổi `ANTHROPIC_MODEL`.
3. ⚠️ **Compose phải forward 2 biến này** — tao đã thêm rồi (commit `daa9d29`). Trước đó đặt key trong
   `.env` cũng vô tác dụng khi chạy Docker: endpoint luôn trả 503 `feature_disabled`.
   *(Kiểm lại 2026-10-03: `docker-compose.yml:101-102` vẫn forward đủ `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`.)*
4. Nhớ bật opt-in trong app (Cài đặt → Quét hoá đơn) — thiếu opt-in thì endpoint trả 403
   `ai_optin_required` **kể cả khi đã có key**.

- **Riêng tư:** ảnh hoá đơn **đã giải mã** được gửi sang Anthropic. Đây là lý do
  tính năng bị khoá sau opt-in từng user và mặc định **TẮT**.

---

## Nhóm 2 — Việc phải trả tiền

> Giá dưới đây là **giá niêm yết tham khảo** — tao không verify được bảng giá trực tiếp
> từ trang chủ Apple (trang trả về menu, không có giá). **Mày xác nhận lại lúc đăng ký.**

### [ ] 2.1 — Domain (cần trước mọi thứ khác ở nhóm này)

- **Tốn:** ~$10–15/năm tuỳ đuôi.
- **Lấy gì:** 1 domain, trỏ **3 A record** về IP VPS:
  `<domain>`, `www.<domain>`, `api.<domain>`.
- **Mở khoá:** Caddy xin được cert Let's Encrypt, Resend verify được domain,
  cookie `wv_session` hoạt động (cookie bật `secure` khi `NODE_ENV=production`,
  nên **test qua HTTP sẽ không giữ được session** — phải HTTPS).

### [ ] 2.2 — VPS

- **Tốn:** ~$5–6/tháng (Hetzner CX22 / DigitalOcean $6 droplet / Vultr — `deploy/README.md`
  đã tính sẵn cho các loại này).
- **Yêu cầu:** Ubuntu 22.04+ hoặc Debian 12+. Mở port **80 + 443**. Port 3000/4000
  **không** cần mở.
- ⚠️ **`ufw` KHÔNG chặn được port do Docker publish** (Docker đi qua chain
  FORWARD/DOCKER-USER, không phải INPUT). Compose hiện publish `3000:3000` và
  `4000:4000` ra mọi interface. Sửa thành `127.0.0.1:4000:4000` nếu muốn chắc —
  hoặc dùng rule `DOCKER-USER`. Chi tiết có trong `deploy/PRODUCTION_CHECKLIST.md`.
  *(Kiểm lại 2026-10-03: `docker-compose.yml` vẫn còn `"4000:4000"` (dòng 64) và `"3000:3000"` (dòng 144) —
  **chưa siết**, và đây là việc của mày vì nó phụ thuộc cách mày dựng VPS.)*
- ⚠️ **Nếu mày dùng Postgres tự dựng (không phải image `postgres:17` của compose): database PHẢI
  có encoding UTF8.** Không phải chi tiết vụn: encoding khác UTF8 thì Postgres **không lưu nổi ký tự
  tiếng Việt**, và tính năng tìm kiếm trả **rỗng trong im lặng** — không lỗi, không log, người dùng chỉ
  thấy "không tìm thấy gì". Đây là ràng buộc duy nhất còn lại của search (collation thì **không** còn
  ảnh hưởng — migration `0007` đã sửa). Kiểm bằng `SHOW server_encoding;` → phải là `UTF8`.
  Cách kiểm hành vi: tạo thiết bị tên `Điện thoại SamSung` rồi tìm `dien thoai` không dấu.
- **Mở khoá:** deploy thật. Trước đó mọi thứ chỉ là template.

### [ ] 2.3 — Apple Developer Program → APNs + TestFlight

- **Tốn:** **$99 USD/năm** (Apple có miễn giảm cho tổ chức phi lợi nhuận/sinh viên ở
  một số khu vực — kiểm tra mục Fee waivers). Xác nhận giá tại
  <https://developer.apple.com/programs/> và <https://developer.apple.com/support/enrollment/>.
- **Lấy gì:**
  1. **APNs Auth Key (.p8)** — Certificates, Identifiers & Profiles → Keys → tạo key
     bật Apple Push Notifications. Tải file `.p8` (**chỉ tải được 1 lần**).
  2. `APNS_KEY_ID` = Key ID của key đó.
  3. `APNS_TEAM_ID` = Team ID (góc trên phải trang developer).
  4. Nội dung file `.p8` → `APNS_PRIVATE_KEY`.
  5. Khi chạy thật: `APNS_PRODUCTION=1`.
- ⚠️ **Tên biến là `APNS_PRIVATE_KEY`, không phải `APNS_KEY_P8`.** `CLAUDE.md` từng ghi
  sai và đã được sửa.
- **Mở khoá:** push trên iOS + TestFlight để test trên máy thật.

### [ ] 2.4 — Google Play Console → internal testing Android

- **Tốn:** phí đăng ký **một lần** (theo trí nhớ là $25 USD — **xác nhận lại** tại
  <https://play.google.com/console/about/>).
- **Mở khoá:** phát nội bộ cho máy Android thật, không phải sideload APK.

### [ ] 2.5 — Diễn tập restore backup (cần VPS/DB staging) — **việc quan trọng nhất còn lại**

- **Tốn:** 0đ thêm nếu đã có VPS ở 2.2 (dùng chính máy đó, hoặc một DB tạm).
- **Vì sao chỉ mày làm được:** cần một môi trường thật + quyết định "thế nào là khôi phục thành công".
  Agent không tự dựng hạ tầng được.
- **Vì sao quan trọng:** `deploy/backup.sh` đã được sửa để thật sự archive cả **volume blob ảnh**
  (bản cũ im lặng bỏ qua vì image distroless không có `tar`), nhưng **chưa từng có ai đem bản backup
  đi restore thử**. Nay có **2 đường backup**, phải hiểu rõ đường nào mang ảnh theo:
  - **JSON mặc định** (`GET /api/v1/backup/export`) — **KHÔNG** có bytes ảnh; chính payload tự khai báo
    bằng `includesAttachmentBytes: false` + `attachmentBytesNote`.
  - **ZIP** (`?includeBlobs=true`) — **CÓ** blob đã mã hoá (envelope version 6, note đổi thành "CÓ chứa …
    cần đúng `FILE_MASTER_KEY`"). Blob là ciphertext AES-256-GCM, nên restore sang máy khác khoá thì
    **file vẫn về nhưng không mở được** — và lỗi hiện ra dưới dạng 404 "Không tìm thấy file", rất dễ
    chẩn đoán sai.
- **Làm gì:** `deploy/PRODUCTION_CHECKLIST.md` §6 có quy trình; tối thiểu là
  (1) restore `db-*.sql.gz` vào một DB rỗng, (2) giải nén `uploads-*.tar.gz` vào đúng `PRIVATE_UPLOAD_ROOT`,
  (3) chạy stack với **đúng** `FILE_MASTER_KEY` cũ, (4) đăng nhập và **mở thử một ảnh hoá đơn**.
  Bước 4 là bước duy nhất chứng minh được mọi thứ khớp nhau. Nếu muốn kiểm luôn đường mới thì làm thêm
  một vòng: export `?includeBlobs=true` → import lại vào tài khoản sạch → mở ảnh.
- **Xong thì:** mới được tin là có backup. Trước đó thì chưa.

---

## Nhóm 3 — Quyết định của mày (không tốn tiền, nhưng tao không tự quyết được)

### [ ] 3.1 — Có thu phí không, và thu bao nhiêu?

Hiện app **không có paywall** — mọi tính năng mở hết. Nếu định thu phí thì cần chốt
trước khi làm, vì nó ảnh hưởng cả 3 client + schema DB (thêm bảng subscription cho
chính app). *(Sửa 2026-10-03: bản cũ trỏ tới mục "Monetization" trong `docs/FEATURE_ROADMAP.md` —
**mục đó không tồn tại**. Roadmap §5 có bàn các thứ bị loại, nhưng **không** có mục nào về giá/paywall;
đây thuần là quyết định của mày, chưa tài liệu nào phân tích giúp.)*

### [ ] 3.2 — Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân

App lưu **dữ liệu cá nhân** (email, tên, SĐT, địa chỉ, serial thiết bị, hoá đơn).
Nếu chạy công khai cho người khác dùng, mày có thể thuộc diện phải làm hồ sơ đánh giá
tác động xử lý DLPCL. **Tao không phải luật sư và chưa verify được nghĩa vụ cụ thể** —
mày tự tra hoặc hỏi người có chuyên môn. Nếu chỉ dùng cá nhân thì nhẹ hơn nhiều.

### [ ] 3.3 — Tên miền thương hiệu

Code đang dùng **WarrantyVault** ở mọi nơi (web, iOS, Android, tài liệu). Design
handoff có nhắc cả **AssetVault**. Nếu muốn đổi thì đổi **trước khi** phát hành lên
store — đổi sau phải sửa bundle ID, package name, và làm lại store listing.

### [x] 3.4 — 5 control chết trên iOS — ✅ **HẾT VIỆC, agent đã xử lý xong (2026-10-03)**

Bản 2026-10-02 liệt kê 5 chỗ bấm vào không làm gì trên iOS và hỏi mày muốn xoá hay làm thật.
Commit `48c8bbb` (*"wire the five inert controls — CSV, import, Face ID lock, honest rows"*) đã xử lý
**cả 5** — không cần mày quyết nữa:

| Chỗ | Bản cũ | Nay |
|---|---|---|
| "Xuất dữ liệu CSV" | Không có endpoint CSV | ✅ Chạy thật: `DeviceCSVExport` + `.fileExporter` (roadmap #14) |
| "Import từ file" | Trùng chức năng backup | ✅ Chạy thật: dùng chung luồng import backup JSON |
| "Face ID & Touch ID" | Chưa cài `LocalAuthentication` | ✅ Chạy thật: `ios/Sources/WarrantyVaultKit/AppLock.swift` + `AppLockStore`, khoá khi app quay lại foreground, mở bằng biometrics **hoặc** mã mở khoá thiết bị, tự tắt nếu máy không còn mã (không bao giờ khoá cứng người dùng) |
| "Apple ID" | Control chết | ✅ Nói thật: hiện "Chưa khả dụng" kèm footer giải thích — **không** còn giả vờ bấm được |
| "Nhắc trước" | Ghi vào `@State`, không lưu | ✅ Nói thật: hiện "Hệ thống tự gửi, chưa tuỳ chỉnh được — 7 & 30 ngày" (đúng lịch cron), bỏ hẳn picker giả |

**Còn lại đúng một quyết định, và nó tuỳ chọn** — chỉ làm nếu mày muốn:

- `[ ]` **Sign in with Apple thật?** Hiện đã ghi "Chưa khả dụng" trung thực. Làm thật thì cần
  Apple Developer (2.3) + endpoint xác thực token identity phía Go + liên kết tài khoản. Không có nó
  thì app **không** bị coi là lỗi.
- `[ ]` **Cho người dùng tự chọn "nhắc trước" mấy ngày?** Hiện là hằng số trong cron (7 & 30 ngày),
  API **không** có field per-user. Muốn có thì phải thêm cột + migration + sửa cron + cả 3 client.
  Mặc định đề xuất: **không làm** cho tới khi có người thật hỏi.

---

## Thứ tự tao đề xuất

```
0.2 → 0.3 → 0.5            (miễn phí, 10 phút, mở khoá dev local; 0.1 đã hết việc)
   ↓
2.1 domain → 2.2 VPS       (bắt đầu tốn tiền ~$6/tháng)
   ↓
2.5 DIỄN TẬP RESTORE       (làm ngay sau khi có VPS — trước khi tin vào backup)
   ↓
1.2 Upstash → 1.3 Resend   (miễn phí, làm được ngay sau khi có domain)
   ↓
2.3 Apple ($99) → 1.1 Firebase → 2.4 Play Console
   ↓
0.4 dọn simulator · 1.4 Anthropic · 3.1–3.3 quyết định
```

**Lý do thứ tự này:** 0.x miễn phí và mở khoá dev local ngay. Domain + VPS là
"cửa ngõ" — có nó mới verify được Resend, mới test được cookie `secure`, mới deploy
thật. **Diễn tập restore (2.5) chen ngay sau VPS** vì đó là bước duy nhất chứng minh
backup có thật sự dùng được, và nó rẻ hơn nhiều so với việc phát hiện muộn. Apple đắt
nhất nên để sau cùng, khi mọi thứ khác đã sẵn sàng.

---

## Bảng tra nhanh: biến env ↔ lấy ở đâu

| Biến | Lấy từ | Nhóm |
|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` — **không có trong `.env.example` nào**, phải tự thêm vào `.env` root | 0.3 |
| `FILE_MASTER_KEY` | `openssl rand -base64 32` | 0.3 |
| `CRON_SECRET` | `openssl rand -hex 32` | 0.3 |
| `SESSION_SECRET` | `crypto.randomBytes(32).toString('base64')` | 0.3 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` | 0.5 |
| `FCM_SERVICE_ACCOUNT_JSON` / `FCM_PROJECT_ID` | Firebase service account | 1.1 |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` / `RATE_LIMITER=upstash` | Upstash console | 1.2 |
| `RESEND_API_KEY` / `RESEND_FROM` | Resend console | 1.3 |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Anthropic console | 1.4 |
| `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_BUNDLE_ID` / `APNS_PRIVATE_KEY` / `APNS_PRODUCTION=1` | Apple Developer | 2.3 |
| `APP_URL` | domain của mày | 2.1 |
| `WEB_URL` | compose tự lấy từ `APP_URL`, không cần điền | — |
| `GO_API_URL` | compose tự set = `http://api:4000/api` — **phải có `/api`**, xem ghi chú dưới | — |
| ~~`SESSION_TTL_DAYS`~~ | **biến chết** — Go không đọc, đừng điền | — |

> ⚠️ **`GO_API_URL` phải kết thúc bằng `/api`.** `website/src/lib/api/client.ts` ghép
> `GO_API_URL + '/v1/...'`, còn Go phục vụ `/api/v1/...`. Thiếu `/api` là **mọi** lời
> gọi web → Go 404, web trông như hỏng sạch. Giá trị đúng khi chạy local:
> `GO_API_URL="http://localhost:4000/api"`.

> ⚠️ **Compose chỉ đọc `.env` ở repo root.** Nó **không** có `env_file:`, nên
> `api/.env` và `website/.env` **không có tác dụng** khi chạy `docker compose up`.
> Đây là cái bẫy hay gặp nhất khi deploy.
> *(Kiểm lại 2026-10-03: vẫn đúng — `docker-compose.yml` không có `env_file:` nào; compose header
> cũng ghi rõ phải copy **cả hai** file example ra `.env` ở root.)*

---

## Đã kiểm lại những gì (2026-10-03)

Để mày biết chỗ nào tao **thật sự** xác minh chứ không phải chép lại bản cũ:

| Mục | Cách kiểm | Kết quả |
|---|---|---|
| 0.1 quyền npm | `ls -ld ~/.npm` + `npm view left-pad version` | ✅ hết việc (chủ sở hữu uid 501, npm chạy được) |
| 0.2 `xcode-select` | `xcode-select -p` | ❌ vẫn trỏ CommandLineTools |
| 0.4 simulator | `du -sh ~/Library/Developer/CoreSimulator` | ❌ vẫn 24G |
| 1.1 Firebase | đọc `android/app/google-services.json` | ❌ vẫn stub |
| 1.4 Anthropic | grep `ANTHROPIC` trong `docker-compose.yml` | ✅ đã forward đủ 2 biến |
| 2.2 port publish | grep `ports:` trong `docker-compose.yml` | ❌ vẫn `3000:3000` + `4000:4000` |
| 2.3 tên biến APNs | đối chiếu `api/.env.example` | ✅ `APNS_PRIVATE_KEY`, không phải `APNS_KEY_P8` |
| 3.4 5 control iOS | đọc `MoreScreen`/`AccountView`/`SettingsView`/`AppLock.swift` | ✅ đã xử lý xong |
| 1.3 nay chặn mấy luồng | đọc `auth.go` (`change-email` / `confirm-email-change`) + `0009_email_change.sql` | ⚠️ **2 luồng** cùng phụ thuộc Resend: reset mật khẩu **và** xác nhận đổi email |
| Backup có ảnh chưa | đọc `services/backup.go` + `handlers/backup.go` | ✅ có: `?includeBlobs=true` → .zip version 6; JSON mặc định vẫn không có ảnh |
| Migration mới | `ls api/migrations/` | 9 file (`0001`…`0009`); `PRODUCTION_CHECKLIST.md` §2 mới liệt kê tới `0007` — **cần cập nhật** |
| Biến env mới cần mày cấp | `git diff` trên `api/.env.example` + grep `os.Getenv` toàn bộ `api/` | ⚪ **không có biến mới nào bắt buộc** — chỉ thêm dòng `VAPID_PUBLIC_KEY` cho tường minh (0.5 đã bao) |

**Hai thứ tao phát hiện thêm nhưng không sửa được (không nằm trong file của tao):**
`website/.env.example` vẫn ghi *"Docker (root compose): hiện set `http://api:4000` — cần thêm `/api`"*
— **đã lỗi thời**, compose nay set đúng `http://api:4000/api`. Và `deploy/PRODUCTION_CHECKLIST.md:63`
liệt kê `SESSION_TTL_DAYS` như biến thật trong khi Go không đọc nó; §2 của checklist đó cũng còn liệt kê
7 migration trong khi repo đã có 9.

---

## Việc KHÔNG cần mày làm (agent tự lo)

Để mày khỏi mất thời gian: những thứ sau **không** cần tài khoản/tiền, agent làm được —
đừng đưa vào danh sách của mày.

- Viết/sửa code, migration, test cho cả 4 codebase
- Sinh secret **cho môi trường dev local** (khác production)
- Dựng `docker-compose.yml`, Caddyfile, systemd unit, script backup
- Sửa tài liệu, OpenAPI, và chạy toàn bộ test suite
