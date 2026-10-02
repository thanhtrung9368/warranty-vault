# Việc chỉ mày làm được — checklist cho chủ dự án

> File này liệt kê **những việc agent không thể làm thay**: cần tài khoản, cần thẻ,
> cần quyền `sudo`, hoặc cần chính mày ra quyết định.
> Mọi việc code được thì **không** nằm ở đây — xem `docs/FEATURE_ROADMAP.md`.
>
> Cách dùng: làm từ trên xuống. Mỗi mục ghi rõ **tốn gì** → **lấy gì** → **quăng vào đâu**
> → **mở khoá được gì**. Xong mục nào tick `[x]` rồi báo tao.

**Cập nhật:** 2026-10-02

---

## Nhóm 0 — Miễn phí, làm được ngay hôm nay

Không tốn tiền, không cần chờ duyệt. Làm trước vì mấy cái dưới phụ thuộc vào đây.

### [ ] 0.1 — Sửa quyền `~/.npm` (cần `sudo`)

```bash
sudo chown -R 501:20 ~/.npm
```

- **Vì sao:** npm không ghi được cache → `npm view`, `npm audit`, `npm ci` fail với
  `EPERM: Your cache folder contains root-owned files`. Lỗi này do một bản npm cũ để lại.
- **Mất:** 5 giây. **Không** mất dữ liệu.
- **Xong thì:** npm chạy bình thường, CI local khớp với CI GitHub.

### [ ] 0.2 — Trỏ `xcode-select` về Xcode thật (cần `sudo`)

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcode-select -p   # phải ra /Applications/Xcode.app/Contents/Developer
```

- **Vì sao:** đang trỏ vào `/Library/Developer/CommandLineTools` nên `swift build`,
  `swift test` và `xcodebuild` **đều fail**. Tao đã phải ép `DEVELOPER_DIR` mỗi lần
  chạy test iOS.
- **Mất:** 5 giây.
- **Xong thì:** `cd ios && swift test` chạy được trực tiếp; mở được project trong Xcode;
  `xcrun simctl` hoạt động (mở khoá luôn mục 0.4).

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

- **Mất:** 1 phút. **Xong thì:** đủ secret để dựng stack ở nhóm 2.

### [ ] 0.4 — Quyết định dọn 24G simulator

`~/Library/Developer/CoreSimulator` chiếm 24G nhưng **không phải rác** — đó là
simulator thật kèm dữ liệu app (iPhone 17 6.6G, ToanThang iPhone 17 3.0G,
iPad Pro 13" 2.9G, ToanThang iPhone SE 2.6G, Sim-iOS27 2.2G…).

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

- **Không làm cũng chạy được:** Go tự fallback sang token-bucket in-memory khi thiếu
  env. Nhược điểm: reset khi restart và **không dùng chung giữa nhiều instance**.
- **Mở khoá:** rate limit bền, chống brute-force auth đúng nghĩa.

### [ ] 1.3 — Resend → email đặt lại mật khẩu

**Tốn:** 0đ ở free tier (giới hạn số email/ngày — kiểm tra lại khi đăng ký).

1. <https://resend.com> → tạo API key.
2. → `RESEND_API_KEY`. Đặt `RESEND_FROM` (phải là domain đã verify với Resend).
3. Cần domain riêng để verify → phụ thuộc mục 2.1.

- **Không làm cũng "chạy":** chức năng quên mật khẩu **chỉ ghi link ra log**, user
  không nhận được email. Với app thật thì coi như **hỏng**.

### [ ] 1.4 — Anthropic API key → OCR hoá đơn (tuỳ chọn)

**Tốn:** trả theo lượng dùng (không cố định). Mặc định model `claude-haiku-4-5-20251001`.

1. <https://console.anthropic.com> → tạo API key.
2. → `ANTHROPIC_API_KEY`. Có thể đổi `ANTHROPIC_MODEL`.
3. ⚠️ **Compose phải forward 2 biến này** — tao đã thêm rồi. Trước đó đặt key trong
   `.env` cũng vô tác dụng khi chạy Docker: endpoint luôn trả 503 `feature_disabled`.

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

---

## Nhóm 3 — Quyết định của mày (không tốn tiền, nhưng tao không tự quyết được)

### [ ] 3.1 — Có thu phí không, và thu bao nhiêu?

Hiện app **không có paywall** — mọi tính năng mở hết. Nếu định thu phí thì cần chốt
trước khi làm, vì nó ảnh hưởng cả 3 client + schema DB (thêm bảng subscription cho
chính app). Xem mục "Monetization" trong `docs/FEATURE_ROADMAP.md`.

### [ ] 3.2 — Nghị định 13/2023/NĐ-CP về bảo vệ dữ liệu cá nhân

App lưu **dữ liệu cá nhân** (email, tên, SĐT, địa chỉ, serial thiết bị, hoá đơn).
Nếu chạy công khai cho người khác dùng, mày có thể thuộc diện phải làm hồ sơ đánh giá
tác động xử lý DLPCL. **Tao không phải luật sư và chưa verify được nghĩa vụ cụ thể** —
mày tự tra hoặc hỏi người có chuyên môn. Nếu chỉ dùng cá nhân thì nhẹ hơn nhiều.

### [ ] 3.3 — Tên miền thương hiệu

Code đang dùng **WarrantyVault** ở mọi nơi (web, iOS, Android, tài liệu). Design
handoff có nhắc cả **AssetVault**. Nếu muốn đổi thì đổi **trước khi** phát hành lên
store — đổi sau phải sửa bundle ID, package name, và làm lại store listing.

---

## Thứ tự tao đề xuất

```
0.1 → 0.2 → 0.3 → 0.5      (miễn phí, 10 phút, mở khoá dev local)
   ↓
2.1 domain → 2.2 VPS       (bắt đầu tốn tiền ~$6/tháng)
   ↓
1.2 Upstash → 1.3 Resend   (miễn phí, làm được ngay sau khi có domain)
   ↓
2.3 Apple ($99) → 1.1 Firebase → 2.4 Play Console
   ↓
0.4 dọn simulator · 1.4 Anthropic · 3.1–3.3 quyết định
```

**Lý do thứ tự này:** 0.x miễn phí và mở khoá dev local ngay. Domain + VPS là
"cửa ngõ" — có nó mới verify được Resend, mới test được cookie `secure`, mới deploy
thật. Apple đắt nhất nên để sau cùng, khi mọi thứ khác đã sẵn sàng.

---

## Bảng tra nhanh: biến env ↔ lấy ở đâu

| Biến | Lấy từ | Nhóm |
|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 32` | 0.3 |
| `FILE_MASTER_KEY` | `openssl rand -base64 32` | 0.3 |
| `CRON_SECRET` | `openssl rand -hex 32` | 0.3 |
| `SESSION_SECRET` | `crypto.randomBytes(32).toString('base64')` | 0.3 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` | 0.5 |
| `FCM_SERVICE_ACCOUNT_JSON` / `FCM_PROJECT_ID` | Firebase service account | 1.1 |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | Upstash console | 1.2 |
| `RESEND_API_KEY` / `RESEND_FROM` | Resend console | 1.3 |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Anthropic console | 1.4 |
| `APNS_KEY_ID` / `APNS_TEAM_ID` / `APNS_BUNDLE_ID` / `APNS_PRIVATE_KEY` | Apple Developer | 2.3 |
| `APP_URL` | domain của mày | 2.1 |
| `GO_API_URL` | compose tự set = `http://api:4000/api` — **phải có `/api`**, xem ghi chú dưới | — |

> ⚠️ **`GO_API_URL` phải kết thúc bằng `/api`.** `website/src/lib/api/client.ts` ghép
> `GO_API_URL + '/v1/...'`, còn Go phục vụ `/api/v1/...`. Thiếu `/api` là **mọi** lời
> gọi web → Go 404, web trông như hỏng sạch. Giá trị đúng khi chạy local:
> `GO_API_URL="http://localhost:4000/api"`.

> ⚠️ **Compose chỉ đọc `.env` ở repo root.** Nó **không** có `env_file:`, nên
> `api/.env` và `website/.env` **không có tác dụng** khi chạy `docker compose up`.
> Đây là cái bẫy hay gặp nhất khi deploy.

---

## Việc KHÔNG cần mày làm (agent tự lo)

Để mày khỏi mất thời gian: những thứ sau **không** cần tài khoản/tiền, agent làm được —
đừng đưa vào danh sách của mày.

- Viết/sửa code, migration, test cho cả 4 codebase
- Sinh secret **cho môi trường dev local** (khác production)
- Dựng `docker-compose.yml`, Caddyfile, systemd unit, script backup
- Sửa tài liệu, OpenAPI, và chạy toàn bộ test suite
