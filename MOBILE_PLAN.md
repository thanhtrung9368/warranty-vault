# Plan: Native iOS + Android cho WarrantyVault

> ## ⚠️ Trạng thái: ✅ HOÀN TẤT — tài liệu **lịch sử**
>
> Cả 3 phase đã ship xong phần **code** (Phase 0 refactor backend, Phase 1 iOS, Phase 2 Android).
> Phase 3 (release infra) xong phần template/CI; phần còn lại **chờ tiền + tài khoản**, không phải chờ code.
>
> - **Trạng thái công việc hiện tại** → xem **[NEXT.md](NEXT.md)** (Block 0–3 xong 2026-06-05; Block 4 = pre-deploy).
> - **Kiến trúc hiện tại (nguồn chân lý)** → xem **[CLAUDE.md](CLAUDE.md)**.
> - Backend Go: lịch sử migrate nằm ở **[BACKEND_GO_PLAN.md](BACKEND_GO_PLAN.md)** — đã xong Phase A–F
>   (commit chốt `33c79c4`, tag `phase-f-done`).
> - File này giữ lại làm **phasing history**. Mọi chỗ nhắc `prisma/schema.prisma`, `src/lib/services/*`,
>   `src/lib/api-auth.ts`, `src/lib/push-apns.ts`, hay `/api/v1/*` **trong website** đều là **quá khứ**:
>   những file/route đó đã bị xoá ở `33c79c4`, API giờ nằm hết trong `api/` (Go).
> - Đọc kèm: **[ios/README.md](ios/README.md)**, **[android/README.md](android/README.md)**,
>   **[mobile/FIREBASE_SETUP.md](mobile/FIREBASE_SETUP.md)**.

Mục tiêu: ship app native thật trên cả 2 store, share business logic qua HTTP API. Web tiếp tục chạy song song không bị ảnh hưởng.

> **Trạng thái — 2026-05-07** *(snapshot lịch sử, giữ nguyên văn; đọc kèm phần ✅ bên dưới)*
> - Phase 0 (refactor backend) **xong code**. `Session` model + bearer auth, REST endpoints cho `auth`, `devices`, `warranties`, `attachments`, `subscriptions`, `wishlist`, `push`, `catalog` đã chạy. Service layer (`src/lib/services/*`) đã tách từ server actions. APNs (HTTP/2 + JWT) + FCM v1 (OAuth2 service-account) sender đã wire — chỉ cần env trên prod để bật. Rate-limit Upstash backend đã có, bật bằng `RATE_LIMITER=redis` + `UPSTASH_REDIS_REST_*`.
> - Phase 1 (iOS) — UI MVP xong: Auth, Devices CRUD + detail, Warranties CRUD, Subscriptions, Wishlist, Attachments upload (PhotosPicker + .fileImporter), Catalog autocomplete đầy đủ (brand/store/warranty provider). Còn lại APNs token register chờ Apple Developer account.
> - Phase 2 (Android) — UI MVP xong: Auth, Devices CRUD + detail, Warranties CRUD + dismiss reminder, Subscriptions, Wishlist, Attachments upload (PhotoPicker + DocumentPicker), Catalog autocomplete đầy đủ. FCM service code sẵn, chờ `google-services.json`. Web team chỉ chỉnh sửa trong `website/`.

> **Đính chính so với snapshot trên (2026-06-05)**
> - `src/lib/services/*`, `src/lib/api-auth.ts`, `src/lib/push-*.ts`, `src/lib/rate-limit-upstash.ts` — **đã xoá**; business logic nằm ở `api/internal/{services,push,ratelimit,email,files}/` (Go). Cả 2 app **không** đi qua website nữa.
> - APNs token register: iOS đã có `PushRegistrar` + màn `PushDevicesView` (quản lý thiết bị nhận push); vẫn chờ Apple Developer account để chạy thật.
> - Android: `google-services.json` hiện là **stub placeholder** ở `android/app/google-services.json` — cần thay bằng file thật từ Firebase project (deferred, xem NEXT.md).

---

## Phase 0 — Refactor backend thành API thuần ✅ XONG (rồi bị **supersede** bởi Go)

Web hiện tại 100% server actions + iron-session cookie → mobile native không gọi được. Phase 0 mở khóa cả 2 app sau này.

> **Đọc kỹ chỗ này:** Phase 0 như viết dưới đây được làm **trong thời kỳ Next.js còn là backend** (Session model trong Prisma, REST route trong `website/src/app/api/v1/*`). Sau đó BACKEND_GO_PLAN Phase A–F chuyển toàn bộ phần đó sang Go và **xoá sạch bản Next.js**. Nên: mục tiêu của Phase 0 ✅ đã đạt, nhưng **implementation mô tả bên dưới không còn tồn tại** — chỉ giữ để hiểu lịch sử.

### 0.1 Session model + token auth — ✅ DONE (bản gốc Next.js đã xoá)

- Thêm `Session` model vào `prisma/schema.prisma` — ⚠️ file này **đã bị xoá** ở `33c79c4`; schema tương đương giờ nằm ở `api/migrations/0001_initial.sql` (goose):
  ```
  model Session {
    id           String   @id @default(cuid())
    userId       String
    tokenHash    String   @unique  // sha256 của access token
    deviceLabel  String?           // "iPhone 17 Pro", "Pixel 9", ...
    platform     String?           // ios | android | web
    lastSeenAt   DateTime @default(now())
    expiresAt    DateTime
    revokedAt    DateTime?
    createdAt    DateTime @default(now())

    user User @relation(fields: [userId], references: [id], onDelete: Cascade)

    @@index([userId])
    @@index([tokenHash])
    @@index([expiresAt])
  }
  ```
- Thêm `sessions Session[]` vào `User`. ✅ (trong Prisma cũ; nay là bảng `Session` do goose quản lý)
- `src/lib/api-auth.ts`: `issueToken(...)`, `verifyBearer(req)`, `revokeToken(tokenHash)`, `pruneExpiredSessions()`. ✅ **đã xoá** → port sang `api/internal/auth/{token,session}.go`.
  - Token = `crypto.randomBytes(32).toString('base64url')`. DB lưu sha256 hash → leak DB không leak token thật. ✅ giữ nguyên thiết kế trong Go (`crypto/rand` 32 bytes → base64url, lưu sha256).
  - TTL 30 ngày, sliding (cập nhật `lastSeenAt` mỗi request). ✅
- `src/lib/auth.ts::requireUser()` augment: Bearer → Session, ngược lại iron-session cookie. ✅ bản web vẫn giữ ý tưởng này, nhưng giờ `requireUser()` đọc bearer từ cookie `wv_session` và gọi `GET /api/v1/auth/me` trên Go (dedupe bằng React `cache()`).

### 0.2 REST auth endpoints — ✅ DONE (giờ ở Go)

Các route dưới đây từng nằm trong `website/src/app/api/v1/auth/*`; **đã xoá** và thay bằng Go:

- [x] `POST /api/v1/auth/register` — body: `{ email, password, name? }`
- [x] `POST /api/v1/auth/login` — body: `{ email, password, deviceLabel?, platform? }` → `{ accessToken, expiresAt, user }`
- [x] `POST /api/v1/auth/logout` — Bearer required, revoke session
- [x] `GET /api/v1/auth/me` — Bearer required → `{ user, session }`
- [x] `POST /api/v1/auth/forgot` — email reset link (dùng lại `requestPasswordResetService`)
- **Thêm sau**: `POST /api/v1/auth/reset-password`, `POST /api/v1/auth/change-password`, `DELETE /api/v1/auth/me` (xoá tài khoản, cần mật khẩu hiện tại) — ship ở `449b4f9`; cả 3 client đều dùng.

Reuse Zod schema + bcrypt logic từ `src/app/actions/auth.ts` → ❌ không còn: validate bằng `go-playground/validator/v10`, bcrypt bằng `golang.org/x/crypto/bcrypt` (cost 12, verify được hash `bcrypt-ts` cũ — có test `api/internal/auth/bcrypt_compat_test.go`). Rate limit giờ ở `api/internal/ratelimit/`.

### 0.3 Pilot resource — devices (template) — ✅ DONE

- `src/lib/services/devices.ts` — pure function, **không** import `next/cache` hay `next/navigation`:
  - `listDevices(...)`, `getDevice(...)`, `createDevice(...)`, `updateDevice(...)`, `deleteDevice(...)` (cộng cả phần xoá upload dir). ✅ đã port sang `api/internal/services/devices.go`.
- `src/app/actions/devices.ts`: thin wrapper — ✅ **vẫn đúng như vậy tới hôm nay** (`requireUser()`, parse FormData, gọi Go qua `src/lib/api/devices.ts`). `rateLimitUserWrite()` giờ do Go làm.
- `src/app/api/v1/devices/route.ts` (GET, POST) + `.../devices/[id]/route.ts` → ❌ **đã xoá**; tương đương ở Go: `GET|POST /api/v1/devices`, `GET|PATCH|DELETE /api/v1/devices/{id}`.

### 0.4 Replicate cho các resource còn lại — ✅ DONE

Áp đúng pattern 0.3 cho:
- [x] `warranties`, `subscriptions`, `wishlist`, `catalog` — REST + service layer xong (nay ở `api/internal/{handlers,services}/`)
- [x] `reminders` — **đã có REST** `GET /api/v1/reminders` + dismiss/restore `POST|DELETE /api/v1/warranties/{id}/reminder` (kế hoạch cũ ghi "chưa cần thiết"; thực tế cần cho UI mobile nên đã làm)
- [x] `attachments` — `POST /api/v1/devices/{id}/attachments` multipart. Download qua `GET /api/files/{id}` (Go), **không** còn `/api/files/:id` của Next.js cho mobile — riêng web vẫn giữ route proxy `website/src/app/api/files/[id]/route.ts` để dùng cookie.
- [x] `push` — `PushSubscription.platform` ✅ (nay `api/migrations/0001_initial.sql`). ⚠️ **Đính chính**: plan ghi thêm cả `pushToken` nhưng **chưa bao giờ có cột đó** — schema thật (cả Prisma cũ lẫn goose nay) dùng `endpoint` + `p256dh` + `auth` cho web, còn token native được nhồi vào `endpoint` dạng `<platform>://<token>` (xem `api/internal/store/queries/push_subscriptions.sql`). `POST /api/v1/push/register` ✅ + `GET /api/v1/push`, `POST /api/v1/push/test`, `DELETE /api/v1/push/{id}` (thêm sau).

### 0.5 OpenAPI spec + multi-platform cron — ✅ DONE (code) / ⏳ OPS pending

- [x] `openapi.yaml` (root) — source-of-truth, hiện **34 path**.
  - 🔁 **Đổi so với plan**: iOS và Android **không codegen** từ YAML. Cả 2 viết tay client mirror spec — iOS `ios/Sources/WarrantyVaultKit/{Endpoints,Models}.swift`, Android `android/.../network/{ApiService,Models}.kt`. Bù lại có `api/scripts/check_openapi_drift.sh` trong CI, nhưng script đó chỉ so **Go ↔ YAML**, không cover mobile (muốn chắc thì phải review tay khi sửa spec).
- [x] `src/lib/push-fanout.ts::sendToSubscription()` → nay là `api/internal/push/dispatch.go` (switch theo `platform`), dispatch concurrent bằng errgroup (2026-06-05).
- [x] APNs sender — `src/lib/push-apns.ts` → `api/internal/push/apns.go` (HTTP/2 + ES256 JWT, cache token, 410 → `gone:true`).
- [x] FCM v1 sender — `src/lib/push-fcm.ts` → `api/internal/push/fcm.go` (OAuth2 service-account JWT → access token, POST `messages:send`, 404/UNREGISTERED → `gone:true`).
- [x] Cron multi-platform ✅ — `api/cmd/cron` + `POST /api/v1/cron/warranty-check` (Bearer `CRON_SECRET`), có thêm migration `0002_cron_idempotency.sql` chống push trùng.
- [ ] ⏳ **Ops**: set env trên prod để bật. APNs cần `APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_BUNDLE_ID`/`APNS_PRIVATE_KEY` (nội dung `.p8` — tên này đúng như plan; `CLAUDE.md` ghi `APNS_KEY_P8` nhưng code đọc `APNS_PRIVATE_KEY`); FCM cần `FCM_SERVICE_ACCOUNT_JSON`. Vẫn chờ Apple Developer + Firebase account.

---

## Phase 1 — iOS app (Swift + SwiftUI) ✅ XONG

**Stack** (thực tế): SwiftUI + async/await, URLSession, Keychain (`KeychainStore`). 🔁 `ios/Package.swift` khai báo `swift-tools-version: 5.10`, platform `.iOS(.v16)` / `.macOS(.v13)` — plan ghi "Swift 6" nhưng **không có gì trong repo xác nhận** Swift 6 language mode.
⚠️ **Không dùng SwiftData** như plan dự kiến (không có `import SwiftData` / `@Model` nào trong repo) — state giữ bằng `ObservableObject` store (`ios/App/State/*Store.swift`), không cache offline.

**Project layout — thực tế** (khác bản dự kiến `ios/WarrantyVault/`):

```
ios/
├── Package.swift                       # SwiftPM library "WarrantyVaultKit"
├── Sources/WarrantyVaultKit/           # không phụ thuộc UIKit/SwiftUI
│   ├── APIClient.swift                 # URLSession + Bearer + JSON
│   ├── Endpoints.swift                 # 1 method/route, mirror openapi.yaml
│   ├── Models.swift · Errors.swift · KeychainStore.swift
└── App/                                # SwiftUI app sources
    ├── WarrantyVaultApp.swift · RootView.swift
    ├── DesignSystem/                   # Theme, Components, Charts, Formatters, AutocompleteChips
    ├── State/                          # AuthStore, DevicesStore, SubscriptionsStore, WishlistStore,
    │                                   # RemindersStore, StatsStore, WarrantiesStore, CatalogStore, ThemeStore
    ├── Core/Push/                      # AppDelegate, PushRegistrar (APNs)
    └── Features/                       # shell 5 tab: Dashboard / Devices / Subscriptions / Wishlist / More
        ├── Auth/ (Login, Register, ForgotPassword)
        ├── Dashboard/DashboardView.swift
        ├── Devices/ (DevicesScreen, DeviceFormView, DeviceDetailView, AttachmentsSection)
        ├── Warranties/ · Subscriptions/ · Wishlist/ · Reminders/ · Stats/
        └── Settings/ (SettingsView, AccountView, ChangePasswordSheet, PushDevicesView)
```

**Auth flow**: Login → `POST /api/v1/auth/login` trên **Go** (`http://localhost:4000`, override được trong `WarrantyVaultApp.swift`) → token vào Keychain → đăng ký APNs → `POST /api/v1/push/register`. ✅ đúng như plan (chỉ đổi backend TS → Go).

**Camera/file**: ✅ — PhotosPicker/`.fileImporter` + multipart qua `APIClient`.

**MVP cutoff**: Auth + Devices CRUD + Warranties + Push warranty expiry. Subscriptions/Wishlist/Stats theo sau. → ✅ **vượt cutoff**: Subscriptions, Wishlist, Stats, Reminders, Settings, backup export/import, xoá tài khoản, AI quét hoá đơn đều đã có.

**Mốc ship:**
| Việc | Commit | Ngày |
|---|---|---|
| MVP iOS đầu tiên (`App/Features/*`, `WarrantyVaultKit`) | `57938d8` | 2026-05-13 |
| `RegisterView` + refactor login | `40efcb2` | 2026-05-14 |
| `PushDevicesView` (quản lý thiết bị push) | `ff904fb` | 2026-05-14 |
| Shell 5 tab + `DashboardView` + `MoreScreen` + DesignSystem (`Charts.swift`, `Formatters.swift`), bỏ Sheet-modal → full-screen form | `02a6250` | 2026-06-05 |
| Backup export/import (`.fileExporter`/`.fileImporter`) + xoá tài khoản | `c8c1fa8` | 2026-06-05 |
| Reminder dismiss + hoàn tác | `8320c7e` | 2026-06-05 |
| AI quét hoá đơn | `02a6250` | 2026-06-05 |

---

## Phase 2 — Android app (Kotlin + Compose) ✅ XONG

**Stack** (thực tế): Kotlin **2.0.21**, Jetpack Compose + Material 3 (BOM 2024.10.01), Retrofit 2.11 + OkHttp 4.12 + kotlinx.serialization, `EncryptedSharedPreferences` (`androidx.security:security-crypto`) cho token, Firebase Cloud Messaging (BOM 33.7.0), Coil.
⚠️ **Không dùng Room** và không DataStore cho token (chỉ có `ThemeStore` ghi SharedPreferences đơn giản) — không có cache offline, khác plan dự kiến.

**Project layout — thực tế** (`android/app/src/main/java/com/warrantyvault/app/`):

```
├── App.kt · MainActivity.kt
├── auth/            # AuthStore, TokenStore (EncryptedSharedPreferences)
├── core/push/       # PushRegistrar, WVMessagingService (FirebaseMessagingService)
├── network/         # ApiClient, ApiService, AuthInterceptor, Models, Errors
│                    #  (plan ghi core/network/ — thực tế là network/)
└── ui/
    ├── MainScreen.kt · RootScreen.kt · ViewModelFactory.kt
    ├── components/  # EmptyState, PageHeader, PressScale, SheetGroup, Shimmer, StatusPill
    ├── theme/       # Theme, ThemePreference, ThemeStore
    └── screens/     # dashboard/ devices/ subscriptions/ wishlist/ reminders/ stats/
                     # settings/ login/ common/CatalogAutocomplete
                     #  (plan ghi feature/devices/ — thực tế là ui/screens/devices/)
```

**MVP cutoff**: Cùng iOS. → ✅ **vượt cutoff**: Dashboard, Subscriptions, Wishlist, Stats, Reminders, Settings, backup export/import (SAF), xoá tài khoản, push devices, AI quét hoá đơn.

**Min SDK**: API 26 (Android 8) ✅ · `targetSdk`/`compileSdk` = **34** (plan ghi "target latest" — thực tế ghim 34, AGP 8.7.2, Kotlin 2.0.21, Compose BOM 2024.10.01, Retrofit 2.11 + OkHttp 4.12 + kotlinx.serialization 1.7.3, Coil 2.7, Firebase BOM 33.7.0).

**Mốc ship:**
| Việc | Commit | Ngày |
|---|---|---|
| MVP Android đầu tiên (`network/Models.kt`, `ui/screens/*`) | `57938d8` | 2026-05-13 |
| `PushDevicesScreen` (quản lý thiết bị push) | `ff904fb` | 2026-05-14 |
| `DashboardScreen` + `Tab.Dashboard` + `ViewModelFactory`; `BASE_URL` 3000 → **4000** (Go); AI scan | `2b73550` | 2026-06-05 |
| Backup export/import (SAF `CreateDocument`/`OpenDocument`) + xoá tài khoản | `f9853f5` | 2026-06-05 |
| Reminder dismiss + hoàn tác (Snackbar) | `8320c7e` | 2026-06-05 |

---

## Phase 3 — Release infra ⏳ một nửa xong (phần còn lại chờ tiền/tài khoản)

- **Apple**: Developer Program ($99/năm). Xcode Cloud hoặc Fastlane + GitHub Actions. TestFlight cho beta. App Store Connect cho metadata (vi-VN screenshots). → ⏳ **chưa có account**; đã có `ios.yml` build `WarrantyVaultKit` (`swift build`), **chưa** build cả app Xcode (NEXT.md ghi là optional còn lại).
- **Google**: Play Console ($25 one-time). Gradle Play Publisher (track `internal` → `beta` → `production`). Play Console listing tiếng Việt. → ⏳ **chưa có account**; `android.yml` đã chạy `:app:testDebugUnitTest` + `:app:assembleDebug`.
- **Backend env mới**: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY` (nội dung `.p8` — tên đúng, verify ở `api/internal/push/apns.go` + `api/.env.example`; `CLAUDE.md` ghi `APNS_KEY_P8` là không khớp code), `FCM_SERVICE_ACCOUNT_JSON`. ✅ đã có trong `api/.env.example` + `api/README.md`; ⏳ giá trị thật chờ account.
- **Rate limit**: in-memory cho dev. ~~`src/lib/rate-limit-upstash.ts`~~ → nay ở `api/internal/ratelimit/upstash.go`; bật bằng `RATE_LIMITER=redis` (hoặc `upstash`) + `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (fail-open, thiếu env thì warn + fallback memory). ✅ code xong; ⏳ key prod chờ signup.
- **Đã xong phần hạ tầng (không cần account)**: `deploy/caddy/Caddyfile`, `deploy/systemd/warranty-vault-cron.{service,timer}`, `deploy/backup.sh` (pg_dump + tar blob + retention), `docker-compose.yml` (postgres + api + cron + website), `api/Dockerfile`, `website/Dockerfile`, `mobile/FIREBASE_SETUP.md`, `android/app/google-services.json` **stub**.

---

## Repo layout — **thực tế** (bản dự kiến cũ đã sai)

Bản cũ ghi `website/` là "Next.js fullstack — backend (REST + cron) + web UI" với `prisma/` + `scripts/`. **Không còn đúng.** Cây thật:

```
warranty-vault/
├── website/              # Next.js 16 web UI — thin proxy sang Go (không Prisma, không REST route,
│                         #   không cron; chỉ còn src/app/api/files/[id]/route.ts để stream file)
├── api/                  # Go backend — canonical API server (port 4000) + cmd/cron
│   └── migrations/       # goose .sql — thay cho website/prisma/
├── ios/                  # Native iOS — WarrantyVaultKit (SPM) + App/SwiftUI
├── android/              # Native Android — Kotlin + Compose
├── mobile/               # Docs cross-platform (FIREBASE_SETUP.md)
├── openapi.yaml          # Source of truth — Go + web client + 2 app bind vào đây (34 path)
├── deploy/               # Caddy + systemd cron + backup.sh
├── docker-compose.yml    # postgres + api + cron + website
├── BACKEND_GO_PLAN.md    # Historical — migrate Next.js → Go (Phase F xong)
├── MOBILE_PLAN.md        # File này — historical
├── NEXT.md · README.md · CLAUDE.md
```

Monorepo vẫn giữ đúng lý do cũ: giữ OpenAPI đồng bộ giữa server và 2 client. Web đã dời từ root vào `website/` từ `57938d8` để giảm noise ở root. ✅

---

## Effort estimate — thực tế đã ship

| Phase | Effort dự kiến | Trạng thái | Commit chốt | Ngày |
|---|---|---|---|---|
| 0.1 Session + token auth | 2-3 ngày | ✅ XONG (bản Next.js → đã port sang Go) | `57938d8` | 2026-05-13 |
| 0.2 REST auth | 1-2 ngày | ✅ XONG | `57938d8` | 2026-05-13 |
| 0.3 Pilot devices | 2-3 ngày | ✅ XONG | `57938d8` | 2026-05-13 |
| 0.4 Replicate | 5-7 ngày | ✅ XONG | `57938d8` | 2026-05-13 |
| 0.5 OpenAPI + cron multi-push | 3-4 ngày | ✅ XONG (code) · ⏳ OPS | `57938d8` + `ff904fb` (drift CI) | 2026-05-13 · 2026-05-14 |
| **Phase 0 total** | **~2 tuần** | ✅ | | |
| Phase 1 iOS MVP | 3-4 tuần | ✅ XONG (+ vượt cutoff) | `57938d8` → `02a6250` → `c8c1fa8` | 2026-05-13 → 2026-06-05 |
| Phase 2 Android MVP | 3-4 tuần | ✅ XONG (+ vượt cutoff) | `57938d8` → `2b73550` → `f9853f5` | 2026-05-13 → 2026-06-05 |
| Phase 3 release polish | 2-3 tuần | ⏳ một nửa — chờ account/tiền | `449b4f9`, `ff904fb`, `fd45532`, `04dbcb2` | 2026-05-14 · 2026-06-05 |
| **Tổng** | **~2.5-3 tháng** | ✅ code xong | | |

Ghi chú: lịch sử git bị squash — Phase 0 + MVP của cả 2 app nằm chung commit `57938d8` (2026-05-13), nên **không thể suy ra thời lượng thật từng phase từ git log**. Những gì git xác nhận được chỉ là: `55417d6` (2026-04-29, chỉ có web Next.js) → `57938d8` (2026-05-13, đã có `api/` + `ios/` + `android/`) → tinh chỉnh tới `2026-06-05`.

---

## Thay cho "Bắt đầu: Phase 0.1 ngay bây giờ" — **đã xảy ra thực tế**

Các bước dưới đây đã chạy xong; giữ lại để đối chiếu, không phải việc cần làm:

```
# 2026-05-13 — 57938d8: Phase 0 (Session + REST + service layer) + ios/ + android/ MVP,
#              monorepo restructure (web dời vào website/)
# 2026-05-14 — 40efcb2: chốt /api/v1 trên Go, iOS RegisterView
# 2026-05-14 — ff904fb: PushDevices UI cả 2 app, openapi drift check
# 2026-05-14 — 33c79c4: Phase F — xoá backend Next.js; 2 app chính thức chỉ nói chuyện với Go
# 2026-06-05 — 02a6250 / 2b73550 / c8c1fa8 / f9853f5 / 8320c7e:
#              dashboard + shell 5 tab (iOS), dashboard tab (Android), backup export/import,
#              xoá tài khoản, reminder dismiss undo, AI quét hoá đơn — parity 3 client
```

**Còn lại gì?** Không còn việc code nào trong file này. Tất cả việc còn lại là **chờ tài khoản/tiền**:
Apple Developer + APNs `.p8`, Firebase project + `google-services.json` thật, VPS + domain, Play Console,
Upstash/Resend prod keys — xem **[NEXT.md](NEXT.md)**, mục "Defer hẳn".
