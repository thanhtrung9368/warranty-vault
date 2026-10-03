# WarrantyVault

Quản lý thiết bị, bảo hành, gói đăng ký phần mềm và wishlist. Vietnamese 100%, multi-user. Có web (Next.js), iOS (Swift), Android (Kotlin) — tất cả nói chuyện với một Go API duy nhất.

Tính năng chính: nhắc hết hạn bảo hành/subscription/wishlist qua push đa nền tảng, ảnh hoá đơn mã hoá AES-256-GCM, OCR hoá đơn bằng AI (opt-in, trả draft, đọc cả serial/IMEI + số tháng bảo hành, **nhận cả ảnh lẫn PDF**), sửa hồ sơ + **đổi email 2 bước** (web + iOS đã nối; Android chưa), **bán lại thiết bị (lãi/lỗ)**, **hạn đổi trả "1 đổi 1"**, **link chia sẻ hồ sơ bảo hành chỉ-đọc**, **hàng đợi "Việc cần xử lý" có nút hoãn**, **danh bạ bảo hành theo hãng**, **export CSV**, **tìm kiếm tiếng Việt không dấu** (theo thiết bị, hoặc xuyên thiết bị/subscription/wishlist qua `GET /api/v1/search`), xuất/nhập backup **JSON hoặc .zip kèm ảnh**, xoá tài khoản.

> Trạng thái đổi email: **API xong**; web có trang `/confirm-email/<token>` + form, iOS có `EmailChangeSheet`, **Android chưa nối**. Chi tiết ở [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md) §0.

## Repo layout

```
warranty-vault/
├── api/                Go backend — canonical API server. Xem api/README.md.
├── website/            Next.js 16 web UI — gọi Go API qua server actions.
├── ios/                Native iOS (Swift + SwiftUI). Xem ios/README.md.
├── android/            Native Android (Kotlin + Compose). Xem android/README.md.
├── mobile/             Docs cross-platform mobile (Firebase setup, …).
├── docs/               FEATURE_ROADMAP.md (15 mục + trạng thái), HUMAN_TASKS.md (việc của chủ dự án),
│                       SPEC-WARRANTY-CLAIM.md, SPEC-MAINTENANCE-SCHEDULES.md.
├── deploy/             Caddy + systemd unit + backup.sh + PRODUCTION_CHECKLIST.md. Xem deploy/README.md.
├── openapi.yaml        Source of truth cho REST contract (48 path / 67 endpoint — luôn tin output check_openapi_drift.sh).
├── docker-compose.yml  Stack đầy đủ: postgres + api + cron + website.
├── BACKEND_GO_PLAN.md  Lịch sử phasing Next.js → Go (Phase F xong, tài liệu lịch sử).
├── MOBILE_PLAN.md      Lịch sử rollout iOS/Android (tài liệu lịch sử).
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
# 1) Tạo .env ở REPO ROOT (compose không có env_file:, nên api/.env và website/.env
#    KHÔNG có tác dụng khi chạy docker compose).
cp api/.env.example .env
cat website/.env.example >> .env
# Rồi sửa .env — BẮT BUỘC có:
#   POSTGRES_PASSWORD   (compose hard-require; KHÔNG có sẵn trong file example nào — tự thêm dòng)
#   SESSION_SECRET      (>=32 ký tự)
#   FILE_MASTER_KEY     (32 bytes base64)
#   CRON_SECRET
# VAPID_* / APNS_* / FCM_* / RESEND_* / ANTHROPIC_* là optional cho dev.

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

Note: sau Phase F web **không** cần `FILE_MASTER_KEY` — chỉ Go giữ key này (web proxy file chỉ stream bytes, không decrypt). `SESSION_SECRET` cũng độc lập giữa 2 service: web dùng nó để mã hoá cookie `wv_session`, còn Go chỉ kiểm tra độ dài ≥32 ký tự chứ không đọc cookie đó.

## Migration status

**13 goose migration** trong `api/migrations/`:

| # | Nội dung |
|---|---|
| `0001_initial` | 17 bảng (User, Device, Warranty, Attachment, Subscription, Wishlist*, Reminder, Session, catalog…) |
| `0002_cron_idempotency` | chống cron gửi trùng |
| `0003_user_ai_optin` | cờ opt-in OCR theo user (default OFF) |
| `0004_seed_category_catalog` | seed 20 category — **thiếu nó thì DB mới không tạo được thiết bị nào** |
| `0005_device_search_unaccent` | extension `unaccent` + `pg_trgm`, wrapper `IMMUTABLE`, 4 index GIN trigram |
| `0006_device_resale` | `Device.soldAt` + `soldPrice` |
| `0007_locale_safe_unaccent` | đảo biểu thức index thành `lower(wv_unaccent(x))` để không phụ thuộc collation |
| `0008_seed_brand_store_warranty_provider` | seed Brand/Store/WarrantyProvider — để picker trên DB mới không rỗng |
| `0009_email_change` | cột `PasswordReset.pendingEmail` cho luồng đổi email 2 bước |
| `0010_return_window` | `Device.returnWindowDays` / `receivedAt` / `returnWindowNotifiedAt` — hạn đổi trả "1 đổi 1" |
| `0011_decision_snooze` | bảng `DecisionSnooze` — hoãn theo từng việc, dùng chung mọi thiết bị |
| `0012_brand_service_info` | bảng `BrandServiceInfo` — link trang tiếp nhận bảo hành của hãng (không bịa hotline/địa chỉ) |
| `0013_device_share` | bảng `DeviceShare` — link chia sẻ chỉ-đọc, khoá bằng `tokenHash` |

DB **phải** có encoding UTF8 — nếu không, tìm kiếm tiếng Việt trả rỗng trong im lặng (collation thì không còn ảnh hưởng,
`0007` đã sửa). Chi tiết: [deploy/PRODUCTION_CHECKLIST.md](deploy/PRODUCTION_CHECKLIST.md) §2 — checklist này liệt kê
đủ 13 migration, nhưng **`ls api/migrations/` vẫn là nguồn đúng**; thêm migration thì cập nhật cả hai.

**Phase E (xong)** — Go là backend chính. Mobile (iOS + Android) đã point sang Go API. Web server actions proxy qua `GO_API_URL`.
**Phase F (xong)** — đã decommission `website/src/app/api/v1/*` + Prisma client trong web; web giờ chỉ còn UI + thin proxy (`website/src/lib/api/*` + `/api/files/[id]`). Commit chốt: `33c79c4`.

Chi tiết phase plan: [BACKEND_GO_PLAN.md](BACKEND_GO_PLAN.md). Công việc kế tiếp: [NEXT.md](NEXT.md).

## Kiểm chứng (chạy được, không cần server)

```bash
bash api/scripts/check_openapi_drift.sh    # Go routes ↔ openapi.yaml → "in sync (67 endpoints)"; 48 path
cd website && npm test                      # 430 test / 21 file (vitest)
cd ios && DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  swift test --disable-sandbox              # 324 test (WarrantyVaultKit; đang tăng nhanh)
cd android && ./gradlew :app:testDebugUnitTest --no-daemon   # 419 test / 41 class
```

Bốn con số này trôi theo từng đợt — **chạy lại lệnh, đừng tin tài liệu**. Android đếm từ JUnit XML trong
`app/build/test-results/`; nếu task báo `UP-TO-DATE` mà bạn muốn con số chắc chắn, thêm `--rerun-tasks`.

Cả 4 bước đều chạy trong CI (`.github/workflows/{api,website,ios,android}.yml`).
`check_openapi_drift.sh` **fail CI khi Go và openapi.yaml lệch nhau** — thêm route thì phải thêm cả entry openapi trong cùng commit.

## Deploy

VPS deploy (Caddy reverse proxy + systemd cho api/cron + Next.js standalone) — xem [deploy/README.md](deploy/README.md)
và checklist đầy đủ ở [deploy/PRODUCTION_CHECKLIST.md](deploy/PRODUCTION_CHECKLIST.md).

Cron warranty-check expose ở Go: `POST /api/v1/cron/warranty-check` với header `Authorization: Bearer $CRON_SECRET`. Schedule bằng systemd timer, GitHub Actions, hoặc Vercel Cron tuỳ host.

⚠️ **Có 2 định dạng backup, đừng nhầm:**
`GET /api/v1/backup/export` (mặc định) trả JSON **không** chứa bytes ảnh — payload tự khai báo qua
`includesAttachmentBytes: false` + `attachmentBytesNote`. Thêm `?includeBlobs=true` thì trả **.zip có kèm
blob đã mã hoá** (envelope version 6, `includesAttachmentBytes: true`). Blob là ciphertext AES-256-GCM, nên
restore sang máy khác khoá thì file vẫn về nhưng **không mở được** — phải giữ đúng `FILE_MASTER_KEY`.
Import chấp nhận **cả hai** định dạng trên cùng endpoint (tự nhận bằng ZIP magic). Và phải **diễn tập restore**
trước khi tin vào bất kỳ bản backup nào — xem [docs/HUMAN_TASKS.md](docs/HUMAN_TASKS.md) mục 2.5.

## Tài liệu thêm

- [openapi.yaml](openapi.yaml) — REST contract canonical.
- [CLAUDE.md](CLAUDE.md) — convention + đường dẫn quan trọng cho assistant.
- [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md) — 15 hạng mục còn thiếu, kèm trạng thái thật từng mục.
- [docs/HUMAN_TASKS.md](docs/HUMAN_TASKS.md) — việc chỉ chủ dự án làm được (tài khoản, thẻ, quyết định).
- [mobile/FIREBASE_SETUP.md](mobile/FIREBASE_SETUP.md) — setup FCM cho Android.

## License

Private project.
