# WarrantyVault

Quản lý thiết bị, bảo hành, gói đăng ký phần mềm và wishlist. Vietnamese 100%, multi-user. Có web (Next.js), iOS (Swift), Android (Kotlin) — tất cả nói chuyện với một Go API duy nhất.

## Repo layout

```
warranty-vault/
├── api/                Go backend — canonical API server. Xem api/README.md.
├── website/            Next.js 16 web UI — gọi Go API qua server actions.
├── ios/                Native iOS (Swift + SwiftUI). Xem ios/README.md.
├── android/            Native Android (Kotlin + Compose). Xem android/README.md.
├── mobile/             Docs cross-platform mobile (Firebase setup, …).
├── openapi.yaml        Source of truth cho REST contract.
├── deploy/             Caddy + systemd unit cho VPS deploy. Xem deploy/README.md.
├── docker-compose.yml  Stack đầy đủ: postgres + api + cron + website.
├── BACKEND_GO_PLAN.md  Plan migrate Next.js → Go (kết thúc ở Phase F).
├── MOBILE_PLAN.md      Plan rollout iOS/Android.
├── NEXT.md             Plan công việc kế tiếp.
└── CLAUDE.md           Guidance cho Claude Code agent.
```

## Tech stack

- **Backend chính**: Go (chi router, pgx, goose migrations, web-push + APNs HTTP/2 + FCM HTTP v1).
- **Web UI**: Next.js 16 App Router + React 19 + Server Actions (proxy sang Go).
- **iOS**: Swift + SwiftUI. SPM library `WarrantyVaultKit` chia sẻ model + API client.
- **Android**: Kotlin + Jetpack Compose + Retrofit.
- **DB**: Postgres 17 (production hosted Neon/Supabase/Render/RDS đều OK).
- **Auth**: iron-session cookie cho web; bearer token (table `Session`) cho mobile.
- **Push**: web-push (VAPID), APNs (token .p8), FCM (service account JSON). Cron fan-out theo `PushSubscription.platform`.
- **Attachments**: AES-256-GCM trên đĩa, master key wrap per-file data key (`FILE_MASTER_KEY`). Disk-alone hoặc DB-alone đều không decrypt được.

## Quick start (Docker)

Cần Docker + Docker Compose. Stack gồm postgres + api + cron + website, share volume cho `private-uploads/`.

```bash
# 1) Tạo .env từ template api/ (root compose đọc từ .env).
cp api/.env.example .env
# Bắt buộc điền: SESSION_SECRET (>=32 ký tự), FILE_MASTER_KEY (32 bytes base64),
# CRON_SECRET, VAPID_*. APNs/FCM optional cho dev.

# 2) Build và start.
docker compose up --build

# 3) Migrate DB lần đầu (binary `migrate` nằm sẵn trong image api).
docker compose run --rm --entrypoint /app/migrate api up

# Web:  http://localhost:3000
# API:  http://localhost:4000/healthz
```

## Dev local (không Docker)

Yêu cầu Postgres 17 chạy local. Tạo 2 DB:

```bash
createdb warranty_vault_dev
createdb warranty_vault_test   # chỉ nếu chạy test scripts
```

Chạy 2 service ở 2 terminal khác nhau:

| Service | Lệnh | Hướng dẫn chi tiết |
|---|---|---|
| Go API | `cd api && cp .env.example .env && go run ./cmd/server` | [api/README.md](api/README.md) |
| Next.js web | `cd website && cp .env.example .env && npm install && npm run dev` | [website/README.md](website/README.md) |
| iOS | `cd ios && swift build`, sau đó mở Xcode | [ios/README.md](ios/README.md) |
| Android | Mở `android/` trong Android Studio, sync Gradle | [android/README.md](android/README.md) |

Note: `SESSION_SECRET` và `FILE_MASTER_KEY` phải GIỐNG nhau giữa `website/.env` và `api/.env` trong giai đoạn cùng đọc/ghi.

## Migration status

- **Phase E (xong)** — Go là backend chính. Mobile (iOS + Android) đã point sang Go API. Web server actions proxy qua `GO_API_URL`.
- **Phase F (đang làm)** — Decommission `website/src/app/api/v1/*` + Prisma client trong web. Sau đó web chỉ còn UI + thin proxy.

Chi tiết phase plan: [BACKEND_GO_PLAN.md](BACKEND_GO_PLAN.md). Công việc kế tiếp: [NEXT.md](NEXT.md).

## Deploy

VPS deploy (Caddy reverse proxy + systemd cho api/cron + Next.js standalone) — xem [deploy/README.md](deploy/README.md).

Cron warranty-check expose ở Go: `POST /api/v1/cron/warranty-check` với header `Authorization: Bearer $CRON_SECRET`. Schedule bằng systemd timer, GitHub Actions, hoặc Vercel Cron tuỳ host.

## Tài liệu thêm

- [openapi.yaml](openapi.yaml) — REST contract canonical.
- [CLAUDE.md](CLAUDE.md) — convention + đường dẫn quan trọng cho assistant.
- [mobile/FIREBASE_SETUP.md](mobile/FIREBASE_SETUP.md) — setup FCM cho Android.

## License

Private project.
