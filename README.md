# WarrantyVault — monorepo

Quản lý thiết bị, bảo hành, gói đăng ký phần mềm và wishlist. Vietnamese 100%, multi-user.

```
warranty-vault/
├── website/        Next.js 16 fullstack — server actions cho web + REST /api/v1/* cho mobile
├── ios/            Native iOS app (Swift + SwiftUI)
├── android/        Native Android app (Kotlin + Compose)
├── mobile/         Cross-platform docs (Firebase setup, …)
├── openapi.yaml    REST contract — source of truth, mobile clients codegen từ đây
├── MOBILE_PLAN.md  Phase plan cho native rollout
└── CLAUDE.md       Guidance cho Claude Code
```

## Quick start

| Project | Setup | Doc |
|---|---|---|
| **website** | `cd website && npm install && npm run db:push && npm run dev` | [website/README.md](website/README.md) |
| **iOS** | `cd ios && swift build` rồi mở Xcode (xem README) | [ios/README.md](ios/README.md) |
| **Android** | Mở `android/` trong Android Studio | [android/README.md](android/README.md) |
| **Push (Android)** | Tạo Firebase project, set `FCM_SERVICE_ACCOUNT_JSON` | [mobile/FIREBASE_SETUP.md](mobile/FIREBASE_SETUP.md) |

## Kiến trúc tổng

- **Backend** = Next.js trong `website/`. Web UI dùng server actions; mobile dùng REST `/api/v1/*` cùng codebase, cùng Zod schema, cùng service layer (`src/lib/services/`).
- **Auth** = iron-session cookie cho web; bearer token (table `Session`) cho mobile. `getCurrentUser()` check bearer trước, fallback cookie — không cần biết transport.
- **Push** = web-push + APNs (HTTP/2 JWT) + FCM (HTTP v1) qua `src/lib/push-fanout.ts`. Cron fan-out theo `PushSubscription.platform`.
- **Encrypted attachments** = AES-256-GCM trên đĩa, key wrap bằng `FILE_MASTER_KEY`. Mobile lấy file qua `GET /api/files/<id>` (cùng auth path web đang dùng, đã hỗ trợ Bearer).

## Tài liệu sâu hơn

- Web internals + commands: [website/README.md](website/README.md), [website/DEPLOY.md](website/DEPLOY.md)
- API contract: [openapi.yaml](openapi.yaml)
- Convention + đường dẫn quan trọng cho assistant: [CLAUDE.md](CLAUDE.md)
