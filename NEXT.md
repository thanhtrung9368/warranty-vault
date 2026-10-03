# Plan kế tiếp — sau Phase F, hướng tới deploy + parity mobile

> Cập nhật: **2026-10-03** (kiểm lại lần 2, ở HEAD `898d96f`). File cũ (bản 14/5 và bản 31/5) đã lỗi thời — Phase E, Phase F, Block
> "Go API quality", toàn bộ Block 0–3 và phần lớn Block 4 trong bản cũ **đã xong hết**.
>
> Đợt 2026-10-02 → 10-03 nay là **51 commit** (`git log --since=2026-10-02 --until=2026-10-04 --oneline | wc -l`),
> không còn là 28 như bản trước ghi. Bản này kiểm bằng code ở HEAD `898d96f`, **không** kiểm bằng lời kể; mốc cũ
> `5b04306` đã bị vượt qua 23 commit.
>
> Phân chia trách nhiệm: việc **code được** → `docs/FEATURE_ROADMAP.md`; việc **chỉ chủ dự án làm
> được** (tài khoản/thẻ/`sudo`/quyết định) → `docs/HUMAN_TASKS.md`; kiến trúc → `CLAUDE.md`.

## Hiện trạng (verified)

**Đã xong:**
- ✅ **Backend Go (Phase A–F)** — toàn bộ API ở `api/`. Prisma đã gỡ sạch khỏi `website/src/app/actions/`
  (chỉ còn `website/src/app/api/files/[id]/` proxy stream). Go đã có `backup.go` (export/import),
  `ResetPassword`, `DELETE /api/v1/auth/me`.
- ✅ **Web cutover** — mọi server action là thin proxy qua `src/lib/api/*` → Go. Vitest đã có (`warranty.test.ts`).
- ✅ **Go quality** — `.golangci.yml` + lint trong CI, OpenAPI drift check trong `api.yml`,
  cron idempotency test, bcrypt compat test, file interop test.
- ✅ **Deploy templates** — `docker-compose.yml`, `deploy/caddy/Caddyfile`, `deploy/systemd/*cron*`,
  `api/Dockerfile`, `website/Dockerfile`, `api/.env.example` + `website/.env.example`.
- ✅ **Mobile MVP** — iOS + Android đều có auth, devices, warranties, subscriptions, wishlist,
  attachments, catalog autocomplete, stats, reminders, change password, push register.

**Đã xong sau bản 31/5 (đợt 2026-10-02 → 10-03, 28 commit):**

- ✅ **Seed catalog (roadmap #1 — lỗi chặn)** — `api/migrations/0004_seed_category_catalog.sql`. Trước
  đó DB mới **không tạo được thiết bị nào** ("Loại thiết bị không hợp lệ"). Đây là mục quan trọng
  nhất của cả đợt.
- ✅ **Tìm kiếm tiếng Việt không dấu (#7, phần thiết bị)** — migration `0005` + `0007`, hàm
  `lower(wv_unaccent(x))` + index GIN trigram; `0007` sửa lỗi `0005` chỉ đúng ở collation UTF-8.
- ✅ **Bán lại thiết bị (#12)** — `0006_device_resale.sql` (`soldAt`/`soldPrice`), cả 3 client.
- ✅ **Sửa mô tả file đính kèm (#8)** — `PATCH /api/v1/attachments/{id}`.
- ✅ **Sửa hồ sơ (#10)** — tên: `PATCH /api/v1/auth/me`. Email: xem mục "Đợt 2" bên dưới (API đã xong).
- ✅ **Export CSV (#14)** — web/iOS/Android, không thêm endpoint Go.
- ✅ **Nhắc nhở đã ẩn xem lại được (#5)** — xem mục "Đợt 2" bên dưới (nay đọc feed `includeDismissed`).
- ✅ **Quản lý thiết bị push trên web (#4)** — `website/src/components/push-devices.tsx`.
- ✅ **`/stats` hết tính sai (#3)** — cộng cả `Warranty.cost`; Go có `totalWarrantyCost` nhưng chỉ
  Android đọc, web/iOS rollup tại chỗ.
- ✅ **Hết 3 chỗ copy nói dối** — backup (#2), trang `/offline` (#6), landing page (thôi hứa "claim").
- ✅ **Điều hướng mobile + badge nhắc nhở (#9)**, **OCR thêm serial/IMEI + số tháng bảo hành (#15 phần đầu)**.
- 📄 **2 spec mới:** `docs/SPEC-WARRANTY-CLAIM.md` (#11) và `docs/SPEC-MAINTENANCE-SCHEDULES.md` (#13,
  spec khuyến nghị **hoãn build** vì vế "cầu" chưa có bằng chứng).
- ✅ **Test dày lên đáng kể:** website 22 → **430** test / 21 file; iOS **324** test; Android 56 → **419** test / 41 class.
  (iOS tăng từ 125 → 324 trong đợt này; con số đang tăng tiếp vì client iOS còn đang được sửa.)
  Thêm nhiều test khoá hành vi (label parity, category seed, search theo locale, backup honesty, resale).
- ✅ **Đợt 2 (cùng ngày):** `0008_seed_brand_store_warranty_provider.sql` (seed
  nốt 3 catalog còn lại), `GET /api/v1/search` (tìm xuyên thiết bị/subscription/wishlist — vế 2 của #7),
  `GET /api/v1/reminders?includeDismissed=true` (web + iOS đọc feed nhẹ thay vì parse backup export),
  `GET /api/v1/backup/export?includeBlobs=true` (zip **có** ảnh, version 6 — #2 xong),
  và `POST /api/v1/auth/change-email` + `confirm-email-change` + `0009_email_change.sql` (#10 API xong).

**Đã xong sau bản kiểm ở `5b04306` (đợt 2026-10-03, kiểm lại ở `898d96f`):**

- ✅ **Đổi email đã nối client — trừ Android.** Web có `website/src/app/(auth)/confirm-email/[token]/page.tsx`
  (trang mà link trong mail trỏ tới) + form `components/email-change-form.tsx` gắn trong `settings/page.tsx`;
  iOS có `EmailChangeSheet.swift` (dán mã hoặc dán cả link, vì app không mở được link mail). **Android vẫn chưa**
  — `ProfileEditSheet.kt:45` còn ghi "email change is not supported by the contract at all", câu đó nay sai.
- ✅ **`includeBlobs` đã được ghi vào `openapi.yaml`** — mục `/api/v1/backup/export` nay mô tả cả tham số lẫn
  hai định dạng trả về. Việc này **không còn** nằm trong danh sách "còn lại".
- ✅ **OCR nhận cả PDF** (`services/ai_extract.go` + `ai.IsSupportedReceiptType`): PDF đi dưới dạng `document`
  block. Trước đây là 400 thẳng. **Không còn** nằm trong danh sách "còn lại".
- ✅ **4 mục mới của `FEATURE_IDEAS.md`, có migration riêng:** `0010_return_window` (hạn đổi trả "1 đổi 1" — #1),
  `0011_decision_snooze` (hàng đợi "Việc cần xử lý" — #3), `0012_brand_service_info` (danh bạ bảo hành theo hãng — #15),
  `0013_device_share` (link chia sẻ chỉ-đọc — #2). Ba mục đầu đã có UI ở cả web/iOS/Android; **link chia sẻ thì iOS
  mới có model + endpoint (`Sources/WarrantyVaultKit/ShareLinks.swift`), chưa có view**.
- ✅ **Trần thiết bị đổi luật (#14):** 50 **thiết bị chưa bán** (`status <> 'SOLD'`) + trần lưu trữ **500 dòng**
  kể cả máy đã bán, áp trên **ba** write path (tạo, import backup, wishlist → `PURCHASED` — đường thứ ba trước
  đây **lách** được giới hạn). Lỗi `LIMIT_REACHED` nay trả **409** đúng như openapi vẫn hằng ghi (trước là 400).

**Block 0 — ĐÃ XONG (2026-06-05):** working tree đã chốt + commit, chia theo component.
- ✅ **AI receipt OCR** (mới, ngoài plan cũ) — Anthropic vision + tool-use, per-user opt-in
  (migration `0003`, default OFF), 403 gate / 503 khi thiếu key. Wired đủ ở Go + web + iOS + Android.
- ✅ iOS: bỏ Sheet-modal → full-screen forms + shell 5 tab + `DashboardView` + `MoreScreen` + DesignSystem mới
  (`Charts.swift`, `Formatters.swift`). swift build ✅ + chạy được trên simulator.
- ✅ Android: thêm `DashboardScreen` + `Tab.Dashboard` + `ViewModelFactory`, đổi `BASE_URL` 3000 → 4000.
  `assembleDebug` ✅.
- ✅ Go: tối ưu `ListDevices` N+1 → batch query, push dispatch concurrent (errgroup limit 8).
  build/vet/test ✅, sqlc không drift.
- ✅ Web: opt-in Next data cache, bỏ `revalidatePath` (mọi page đã dynamic). lint/tsc/vitest/build ✅.

Commits: `perf(api)…` · `refactor(web)…` · `feat(ios)…` · `feat(android)…` · `docs:…`.

---

## Block 1 — Vá parity mobile (việc chính, backend đã sẵn) (2–3 ngày)

Backend đã có đủ endpoint; đây thuần là UI mobile còn thiếu so với web.

### 1.1 Backup export/import — iOS + Android ✅ XONG (2026-06-05)
- iOS: `SettingsView` Dữ liệu section — export qua `.fileExporter` (JSONBackupDocument),
  import qua `.fileImporter` + confirmationDialog chọn merge/replace. Bỏ row giả iCloud/wipe.
- Android: `SettingsScreen` Dữ liệu section — SAF `CreateDocument`/`OpenDocument`, dialog chọn mode.
- Network: iOS `rawDataRequest` (verbatim body); Android `exportBackup(): ResponseBody` +
  `importBackup(mode, RequestBody)`. Model `ImportResult` cả 2 bên. Build xanh cả 2.

### 1.2 Delete account — iOS + Android ✅ XONG (2026-06-05)
- Server **yêu cầu mật khẩu hiện tại** trong body → cả 2 client thu password trước khi gọi.
- iOS: `AccountView` alert + SecureField → `auth.deleteAccount(password:)` clear keychain → login.
- Android: `SettingsScreen` nút "Xoá tài khoản" + AlertDialog password → `auth.deleteAccount` clear token.

### 1.3 Dismiss/restore reminder UI — cả 3 client ✅ XONG, web + iOS **đã nâng cấp** (2026-10-03)
- Dismissed reminder rời khỏi list "sắp tới", nên ban đầu "restore" = **undo ngay sau dismiss**, nhất quán 3 client.
- iOS: `RemindersStore.restore()` + banner "Đã ẩn — Hoàn tác"; sửa fetch 30→90 ngày cho bucket 60/90.
- Android: `RemindersViewModel.restore()` + Snackbar action "Hoàn tác". **(Vẫn chỉ có vậy — chưa có danh sách "Đã ẩn".)**
- Web: `DismissButton` gọi `router.refresh()` + toast có nút "Hoàn tác".
- **Nâng cấp:** web + iOS nay có **danh sách "Đã ẩn" thật**, đọc từ
  `GET /api/v1/reminders?includeDismissed=true` (API mới, có `omitempty` nên hành vi cũ không đổi).
  Trước đó hai client parse cả `GET /v1/backup/export` chỉ để lấy mấy row đã ẩn — cách đó đã bị bỏ.
  Android vẫn là client duy nhất chưa có danh sách này.

### 1.4 Subscription detail + payment log — mobile ✅ ĐÃ CÓ SẴN (NEXT cũ lỗi thời)
- iOS `SubscriptionDetailView`: `SubLogPaymentSheet` + `paymentsSection` + `renewNow` + biểu đồ — đủ.
- Android `SubscriptionDetailScreen`: `LogPaymentSheet` + payment history + renew dialog — đủ.

### 1.5 Vietnamese label parity ✅ ĐÃ PARITY — và nay có **test khoá** (2026-10-03)
- 6 enum (DeviceStatus, WarrantyType, BillingCycle, SubscriptionStatus, WishlistStatus, WishlistPriority)
  label tiếng Việt **giống hệt** giữa web `types.ts` ↔ iOS `Models.swift` ↔ Android `Models.kt`.
- **Mới:** không còn dựa vào việc đọc bằng mắt. Android khoá cứng label trong
  `ModelsSerializationTest.kt`; 20 code `CATEGORY_LABELS` được mirror ở
  `ios/.../CategoryLabels.swift` + `android/.../ui/components/CategoryLabels.kt` và
  `api/internal/services/category_seed_test.go` **parse cả 4 nguồn** (types.ts, 2 file mobile, migration
  `0004`) → lệch là CI đỏ.

---

## Block 2 — Đồng bộ docs + dọn nốt ✅ XONG (2026-06-05), phần còn lại cũng xong (2026-10-03)

- [x] `privacy/terms/cookies` — viết nội dung thật (mã hoá AES, AI opt-in gửi Anthropic, cookie `wv_session`,
      Resend email, không tracking; quyền export/xoá tài khoản).
- [x] `ios/README.md` + `android/README.md` — sửa "Next.js backend" → Go (`../api`), port 3000 → 4000,
      tên file mới (`DeviceFormView`/`DevicesScreen`), bỏ tham chiếu file đã xoá.
- [x] Xoá TODO trong `health.sql` source + regen sqlc (gen sạch).
- [x] `BACKEND_GO_PLAN.md` / `MOBILE_PLAN.md` — đánh dấu hoàn tất, viết lại thành **lịch sử** (commit `1c1b68f`).
- [x] `docs/FEATURE_ROADMAP.md` — 15 mục kèm trạng thái thật, cập nhật 2026-10-03.
- [x] `deploy/PRODUCTION_CHECKLIST.md` — checklist pre-deploy thật (10 mục), gồm cả ràng buộc DB encoding UTF8.

---

## Block 3 — Siết test + CI ✅ XONG (2026-06-05), số liệu cập nhật 2026-10-03

- [x] `website.yml`: thêm step `npm test`.
- [x] `subscription-types.test.ts` — 12 test cho `monthlyEquivalent` + `nextRenewalDate`.
      **Nay: 24 test**, và cả web là **430 test / 21 file** (chạy `cd website && npm test` để lấy số thật — danh sách file
      đã dài hơn nhiều so với 7 file của bản trước: thêm `action-queue`, `device-paste`, `device-return-window`,
      `device-shares`, `share-links`, `service-directory`, `sessions`, `email-change`, `forecast-rollup`,
      `backup-media`, `subscription-audit`, `search`, …).
      (Bỏ test `toFormState`: import `client.ts` kéo theo `auth-cookie` cần `SESSION_SECRET` → fragile.)
- [x] `android.yml`: thêm step `:app:testDebugUnitTest` + **guard chống "xanh giả"** (fail nếu không sinh
      file test result — trước đây task này từng `NO-SOURCE`). Nay **419 test / 41 class**
      (đếm từ XML trong `app/build/test-results/`; nhớ `--rerun-tasks` nếu Gradle báo `UP-TO-DATE`).
- [x] `ios.yml`: `swift build` + `swift test` — **324 test** (đo ở cây nguồn hiện tại; đang tăng nhanh vì iOS agent còn đang thêm test — tin lần chạy, không tin dòng này).
      (`--disable-sandbox` chỉ cần khi chạy local trên máy này vì `xcode-select` còn trỏ vào CommandLineTools,
      xem `docs/HUMAN_TASKS.md` 0.2.)
- [x] `api/scripts/check_openapi_drift.sh` chạy trong `api.yml` — nay **67 endpoint / 48 path** (con số này đang tăng — tin output script, đừng tin tài liệu).
- [ ] (còn, optional) `ios.yml` mới build **thư viện** `WarrantyVaultKit`, chưa build app Xcode
      (project do người dùng tạo — xem `ios/README.md`). Chưa có workflow deploy push image khi tag.

---

## Block 4 — Pre-deploy (chờ account/server, soạn sẵn được)

Template đã có (`docker-compose.yml`, `deploy/`, kể cả `android/app/google-services.json` stub). Trạng thái:

- [x] `deploy/backup.sh` — dump DB (`pg_dump`) + tar blob qua `docker compose exec`, timestamp + retention prune.
      **Đã sửa 2 lỗi thật (2026-10-03):** bản cũ **im lặng không archive được attachment** (image distroless
      không có `tar`/shell) và timer chạy theo TZ của host thay vì UTC.
- [x] Production checklist — `deploy/PRODUCTION_CHECKLIST.md` (10 mục, có phần restore drill + smoke test).
- [x] Healthcheck thật cho container `api` — `/app/server -healthcheck` → `GET /readyz` (có ping DB);
      `web` chờ `api: service_healthy` thay vì `service_started`.
- [x] Compose forward `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL` — trước đó đặt key trong `.env` vô tác dụng khi chạy Docker.
- [x] `GO_API_URL` của compose đã có hậu tố `/api` (thiếu nó là **mọi** call web → Go 404).
- [ ] `android/app/google-services.json` THẬT — vẫn là **stub** (`project_number: "000"`, `api_key: "placeholder"`).
- [ ] Cảnh báo: compose vẫn publish `3000:3000` và `4000:4000` ra mọi interface (xem `docs/HUMAN_TASKS.md` 2.2).

---

## Block 5 — Việc còn lại thật sự (2026-10-03)

Danh sách này **thay cho** câu "code/feature parity coi như đã đầy đủ" ở bản cũ — câu đó giờ sai.
Chi tiết + bằng chứng nằm ở `docs/FEATURE_ROADMAP.md` §0.

**Code được, không chờ ai:**

| Việc | Nguồn | Ghi chú |
|---|---|---|
| **Nối client đổi email cho Android** | roadmap #10 | API đã xong (`change-email` + `confirm-email-change`, migration `0009`). **Web + iOS đã nối** (web có `/confirm-email/[token]` + form; iOS có `EmailChangeSheet`). Chỉ còn **Android**: `ProfileEditSheet.kt:45` vẫn ghi email change không được contract hỗ trợ — câu đó nay sai. Đây là việc rõ ràng nhất còn lại |
| **UI chia sẻ link cho iOS** | FEATURE_IDEAS #2 | Backend + web + Android đã có. iOS: `Sources/WarrantyVaultKit/ShareLinks.swift` xong, và `ios/App/Features/Devices/ShareCertificatesSection.swift` **đang được viết** — lúc kiểm thì **chưa gắn vào màn hình nào**. Mục này đang di chuyển nhanh, kiểm lại trước khi làm |
| Cache dữ liệu trong `sw.js` để offline xem được | roadmap #6 | Đây mới là "làm thật"; `sw.js` hiện chỉ cache đúng `/offline` |
| Danh sách "Đã ẩn" cho Android | roadmap #5 | Web + iOS đã có; Android mới chỉ có "Hoàn tác" |
| Sửa/xác nhận lại copy backup + trang `/offline` nếu có ai đó viết lại UI | roadmap #2, #6 | Phần "nói thật" đã xong; đừng để nó quay lại |

**Vừa xong trong đợt này — đừng làm lại (bản trước còn nằm trong bảng "còn lại"):**

| Việc | Nguồn | Bằng chứng |
|---|---|---|
| ~~Ghi `includeBlobs` vào `openapi.yaml`~~ | roadmap #2 | ✅ `openapi.yaml` mục `/api/v1/backup/export` nay mô tả cả tham số `includeBlobs` lẫn hai định dạng trả về |
| ~~PDF OCR cho hoá đơn~~ | roadmap #15 | ✅ `ai.IsSupportedReceiptType` nhận `application/pdf`; PDF gửi dạng `document` block, không còn 400 |
| ~~Trang `/confirm-email/<token>` + form đổi email (web)~~ | roadmap #10 | ✅ `website/src/app/(auth)/confirm-email/[token]/page.tsx` + `components/email-change-form.tsx`, gắn trong `settings/page.tsx` |

**Cần người duyệt / quyết định trước khi code:**

| Việc | Nguồn | Chờ gì |
|---|---|---|
| Build `WarrantyClaim` + lịch sử sửa chữa | `docs/SPEC-WARRANTY-CLAIM.md` (#11) | Spec đã viết; cần duyệt schema trước khi đụng migration |
| Lịch bảo trì định kỳ | `docs/SPEC-MAINTENANCE-SCHEDULES.md` (#13) | Spec khuyến nghị **hoãn build**, làm kiểm chứng trước (phỏng vấn người dùng) |
| Email thật (Resend + domain verify) | roadmap §4 B5 | Nay chặn **cả** `/forgot` **lẫn** đổi email — xem `docs/HUMAN_TASKS.md` 1.3 |
| Tên miền thương hiệu, có thu phí hay không | `docs/HUMAN_TASKS.md` 3.1, 3.3 | Quyết định của chủ dự án |

---

## Defer hẳn (chờ tiền/tài khoản)

| Việc | Chờ gì | Trạng thái |
|---|---|---|
| Apple Developer + APNs .p8 | $99/năm | Chưa mua |
| Firebase project + service account JSON + `google-services.json` | Google account | Chưa tạo (file vẫn là stub) |
| VPS + domain + Caddy TLS | Card + DNS | Chưa có |
| TestFlight / Play Console internal | Apple/Google account | Chưa có |
| Upstash (rate-limit) / Resend (email) prod keys | Signup free tier | Chưa có |
| **Diễn tập restore thật** | VPS/DB staging | **Chưa làm** — và là việc quan trọng nhất trong bảng này |

---

## Đề xuất thứ tự

1. ~~**Block 0** — chốt working tree~~ ✅ XONG (2026-06-05).
2. ~~**Block 1.1 + 1.2** — backup + delete account mobile~~ ✅ XONG (2026-06-05).
3. ~~**Block 1.3–1.5** — reminder/payment/label parity~~ ✅ XONG (2026-06-05), nâng cấp tiếp 2026-10-03.
4. ~~**Block 2** — đồng bộ docs~~ ✅ XONG (2026-06-05) + 2026-10-03.
5. ~~**Block 3** — CI test~~ ✅ XONG (2026-06-05) + 2026-10-03.
6. **Block 4** — gần xong; chỉ còn `google-services.json` thật (chờ Firebase).
7. **Block 5** — chọn trong bảng: việc code được thì làm ngay, việc cần duyệt thì hỏi trước.

> **Đường ngắn nhất tới "chạy thật":** mua domain + VPS (`docs/HUMAN_TASKS.md` 2.1 → 2.2), dựng theo
> `deploy/PRODUCTION_CHECKLIST.md`, rồi **diễn tập restore** trước khi tin vào backup. Mọi thứ còn
> lại — Apple, Firebase, Upstash, Resend — đều **không chặn** việc deploy web.
