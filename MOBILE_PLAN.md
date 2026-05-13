# Plan: Native iOS + Android cho WarrantyVault

Mục tiêu: ship app native thật trên cả 2 store, share business logic qua HTTP API. Web tiếp tục chạy song song không bị ảnh hưởng.

> **Trạng thái — 2026-05-07**
> - Phase 0 (refactor backend) **xong code**. `Session` model + bearer auth, REST endpoints cho `auth`, `devices`, `warranties`, `attachments`, `subscriptions`, `wishlist`, `push`, `catalog` đã chạy. Service layer (`src/lib/services/*`) đã tách từ server actions. APNs (HTTP/2 + JWT) + FCM v1 (OAuth2 service-account) sender đã wire — chỉ cần env trên prod để bật. Rate-limit Upstash backend đã có, bật bằng `RATE_LIMITER=redis` + `UPSTASH_REDIS_REST_*`.
> - Phase 1 (iOS) — UI MVP xong: Auth, Devices CRUD + detail, Warranties CRUD, Subscriptions, Wishlist, Attachments upload (PhotosPicker + .fileImporter), Catalog autocomplete đầy đủ (brand/store/warranty provider). Còn lại APNs token register chờ Apple Developer account.
> - Phase 2 (Android) — UI MVP xong: Auth, Devices CRUD + detail, Warranties CRUD + dismiss reminder, Subscriptions, Wishlist, Attachments upload (PhotoPicker + DocumentPicker), Catalog autocomplete đầy đủ. FCM service code sẵn, chờ `google-services.json`. Web team chỉ chỉnh sửa trong `website/`.

---

## Phase 0 — Refactor backend thành API thuần

Web hiện tại 100% server actions + iron-session cookie → mobile native không gọi được. Phase 0 mở khóa cả 2 app sau này.

### 0.1 Session model + token auth — DONE

- Thêm `Session` model vào `prisma/schema.prisma`:
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
- Thêm `sessions Session[]` vào `User`.
- `src/lib/api-auth.ts`: `issueToken(userId, deviceLabel, platform)`, `verifyBearer(req)`, `revokeToken(tokenHash)`, `pruneExpiredSessions()`.
  - Token = `crypto.randomBytes(32).toString('base64url')`. DB lưu sha256 hash → leak DB không leak token thật.
  - TTL 30 ngày, sliding (cập nhật `lastSeenAt` mỗi request).
- `src/lib/auth.ts::requireUser()` augment: nếu request có `Authorization: Bearer <token>` → đọc Session; ngược lại đọc iron-session cookie. Web không đổi gì.

### 0.2 REST auth endpoints — DONE

- [x] `POST /api/v1/auth/register` — body: `{ email, password, name? }`
- [x] `POST /api/v1/auth/login` — body: `{ email, password, deviceLabel?, platform? }` → `{ accessToken, expiresAt, user }`
- [x] `POST /api/v1/auth/logout` — Bearer required, revoke session
- [x] `GET /api/v1/auth/me` — Bearer required → `{ user, session }`
- [x] `POST /api/v1/auth/forgot` — email reset link (dùng lại `requestPasswordResetService`)

Reuse Zod schema + bcrypt logic từ `src/app/actions/auth.ts`. Áp `rateLimitAuth` y như web (key `'forgot'` cho reset).

### 0.3 Pilot resource — devices (template) — DONE

- `src/lib/services/devices.ts` — pure function, **không** import `next/cache` hay `next/navigation`:
  - `listDevices(userId, filter?)`
  - `getDevice(userId, id)`
  - `createDevice(userId, input)`
  - `updateDevice(userId, id, input)`
  - `deleteDevice(userId, id)` (cộng cả phần `rm -rf` upload dir)
- `src/app/actions/devices.ts`: thin wrapper — `requireUser()`, `rateLimitUserWrite()`, parse FormData, gọi service, `revalidatePath()`, `redirect()`.
- `src/app/api/v1/devices/route.ts` (GET, POST) + `src/app/api/v1/devices/[id]/route.ts` (GET, PATCH, DELETE):
  - Bearer auth → `requireUser()` (đã augment)
  - `rateLimitUserWrite()`
  - Parse JSON body với cùng Zod schema
  - Trả JSON, không revalidate (mobile tự cache)

### 0.4 Replicate cho các resource còn lại — DONE

Áp đúng pattern 0.3 cho:
- [x] `warranties`, `subscriptions`, `wishlist`, `catalog` — REST + service layer xong
- [ ] `reminders` — service đã tách (`src/lib/services/reminders.ts`); REST endpoint chưa cần thiết vì cron là consumer chính
- [x] `attachments` — `POST /api/v1/devices/:id/attachments` multipart, reuse `src/lib/files.ts`. Download qua `/api/files/:id` chấp nhận cả Bearer.
- [x] `push` — `PushSubscription.platform` + `pushToken` đã thêm vào schema. `POST /api/v1/push/register` body `{ platform: 'apns'|'fcm', token }` đã chạy.

### 0.5 OpenAPI spec + multi-platform cron — DONE (code) / OPS pending

- [x] `openapi.yaml` (root) — source-of-truth. Mới bổ sung `/auth/forgot` + `WishlistDetail` (2026-05-07).
  - iOS: gen với [Swift OpenAPI Generator](https://github.com/apple/swift-openapi-generator).
  - Android: gen với `openapi-generator-cli` (kotlin client).
- [x] `src/lib/push-fanout.ts::sendToSubscription()` chọn provider theo `subscription.platform`. APNs/FCM helpers no-op khi env chưa cấu hình.
- [x] APNs sender — `src/lib/push-apns.ts` HTTP/2 + ES256 JWT (kid/iss/iat), 50-min token cache, 410 → `gone:true`.
- [x] FCM v1 sender — `src/lib/push-fcm.ts` OAuth2 service-account JWT → access token, POST `messages:send`, 404/UNREGISTERED → `gone:true`.
- [ ] **Ops**: set env trên prod để bật. APNs cần `APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_BUNDLE_ID`/`APNS_PRIVATE_KEY` (`.p8` raw); FCM cần `FCM_SERVICE_ACCOUNT_JSON` (1 dòng JSON).

---

## Phase 1 — iOS app (Swift + SwiftUI) — IN PROGRESS

**Stack**: Swift 6, SwiftUI, async/await, URLSession, SwiftData (cache), Keychain Services (token).

**Project layout** (`ios/WarrantyVault/`):
- `App/` — `WarrantyVaultApp.swift`, root navigation
- `Core/Networking/` — `APIClient`, generated OpenAPI types
- `Core/Auth/` — `AuthStore`, `KeychainTokenStore`
- `Core/Push/` — APNs registration + delegate
- `Features/Devices/` — list, detail, form (reuse Zod-equivalent validation client-side)
- `Features/Warranties/`, `Features/Subscriptions/`, `Features/Wishlist/`, `Features/Reminders/`, `Features/Stats/`, `Features/Settings/`
- `Resources/` — assets, localization (vi-VN only)

**Auth flow**: Login screen → POST login → lưu token vào Keychain (`kSecClassGenericPassword`, `kSecAttrAccessibleAfterFirstUnlock`) → đăng ký APNs → POST `/api/v1/push/register`.

**Camera/file**: `PHPickerViewController` cho ảnh, `UIDocumentPickerViewController` cho PDF, multipart upload qua APIClient.

**MVP cutoff**: Auth + Devices CRUD + Warranties + Push warranty expiry. Subscriptions/Wishlist/Stats theo sau.

**Trạng thái 2026-05-07**: `WarrantyVaultKit` Swift package + Models đã tồn tại (xem `ios/Sources/WarrantyVaultKit/`). UI screens đang được build bởi agent iOS song song.

---

## Phase 2 — Android app (Kotlin + Compose) — IN PROGRESS

**Stack**: Kotlin 2.x, Jetpack Compose + Material 3, Retrofit + OkHttp + kotlinx.serialization, DataStore (preferences) + EncryptedSharedPreferences (token), Room (cache), Coil (images), Firebase Cloud Messaging.

**Project layout** (`android/app/src/main/java/com/warrantyvault/`):
- `core/network/` — Retrofit service, AuthInterceptor (Bearer), generated DTOs
- `core/auth/` — `TokenStore` (EncryptedSharedPreferences)
- `core/push/` — `WVMessagingService extends FirebaseMessagingService`
- `feature/devices/`, `feature/warranties/`, ... song song iOS

**MVP cutoff**: Cùng iOS.

**Min SDK**: API 26 (Android 8). Target latest.

**Trạng thái 2026-05-07**: Network DTOs (`android/.../core/network/Models.kt`) đã có. Compose UI đang được build bởi agent Android song song.

---

## Phase 3 — Release infra

- **Apple**: Developer Program ($99/năm). Xcode Cloud hoặc Fastlane + GitHub Actions. TestFlight cho beta. App Store Connect cho metadata (vi-VN screenshots).
- **Google**: Play Console ($25 one-time). Gradle Play Publisher (track `internal` → `beta` → `production`). Play Console listing tiếng Việt.
- **Backend env mới**: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY` (`.p8` content), `FCM_SERVICE_ACCOUNT_JSON`.
- **Rate limit**: in-memory cho dev. Upstash backend đã có (`src/lib/rate-limit-upstash.ts`) — bật bằng `RATE_LIMITER=redis` + `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` trên prod (fail-open khi Redis down).

---

## Repo layout

Monorepo (đã chốt):
```
warranty-vault/
├── website/              # Next.js fullstack — backend (REST + cron) + web UI
│   ├── src/              # Next.js source (app router, services, lib)
│   ├── prisma/           # schema.prisma + seed scripts
│   └── scripts/          # node test/seed/migration scripts
├── ios/                  # Native iOS app (Swift + SwiftUI)
├── android/              # Native Android app (Kotlin + Compose)
├── mobile/               # Cross-platform mobile docs (Firebase setup, ...)
├── openapi.yaml          # Source of truth — both apps codegen from this
├── MOBILE_PLAN.md
└── README.md
```

3 repo riêng cũng được, nhưng monorepo giữ OpenAPI đồng bộ giữa server và 2 client. Web đã được di dời từ root vào `website/` để giảm noise ở root.

---

## Effort estimate (1 mình, part-time)

| Phase | Effort |
|---|---|
| 0.1 Session + token auth | 2-3 ngày |
| 0.2 REST auth | 1-2 ngày |
| 0.3 Pilot devices | 2-3 ngày |
| 0.4 Replicate | 5-7 ngày |
| 0.5 OpenAPI + cron multi-push | 3-4 ngày |
| **Phase 0 total** | **~2 tuần** |
| Phase 1 iOS MVP | 3-4 tuần |
| Phase 2 Android MVP | 3-4 tuần |
| Phase 3 release polish | 2-3 tuần |
| **Tổng** | **~2.5-3 tháng** |

---

## Bắt đầu: Phase 0.1 ngay bây giờ
