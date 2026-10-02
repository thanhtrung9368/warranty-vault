# Plan: Tách BE API thành service Go riêng

> ## ⚠️ Trạng thái: ✅ HOÀN TẤT — tài liệu **lịch sử**
>
> Migration Next.js → Go **đã xong sạch Phase A–F**. Commit chốt: **`33c79c4`** — "feat: Phase F
> decommission + cron idempotency fix + vitest" (2026-05-14), tag `phase-f-done`.
>
> - **Trạng thái công việc hiện tại** → xem **[NEXT.md](NEXT.md)**.
> - **Kiến trúc hiện tại (nguồn chân lý)** → xem **[CLAUDE.md](CLAUDE.md)**.
> - File này giữ lại làm **phasing history**: nêu lý do + thứ tự các phase, và đánh dấu cái gì đã ship.
>   **Đừng đọc nó như mô tả hệ thống đang chạy.** Mọi chỗ trong file nhắc tới Prisma,
>   `website/prisma/`, `website/scripts/`, hay API route trong `website/src/app/api/v1/*` đều là
>   **quá khứ** — những thứ đó không còn tồn tại trong repo (đã xoá ở `33c79c4`).
> - Đọc kèm: **[README.md](README.md)** (overview), **[api/README.md](api/README.md)** (vận hành Go service).

Mục tiêu: chuyển toàn bộ business logic, REST API, cron, push fanout, file streaming sang một service Go đứng riêng. Next.js website giữ vai trò pure frontend (RSC + Client Components) gọi Go REST như iOS/Android. Postgres + schema dùng chung; mobile clients chỉ đổi BASE_URL.

> **Decisions đã chốt** (2026-05-07) — giữ nguyên tới lúc ship, không đổi:
> - **Scope**: Full Go cutover — web cũng gọi Go REST, không còn server actions write trực tiếp Postgres. ✅ đã làm: mọi action trong `website/src/app/actions/*` giờ là thin proxy qua `website/src/lib/api/*`.
> - **DB**: `pgx` (driver) + `sqlc` (typed query gen từ SQL). Goose nhận quyền migration thay Prisma. ✅ đã làm: `api/internal/store/queries/*.sql` → `api/internal/store/gen/`; goose ở `api/migrations/`.
> - **Deploy**: thuê server (VPS / single binary). Kế hoạch viết theo single-host trước, có thể move sang Fly.io/Cloud Run sau mà không đổi code. ⏳ template đã có (`deploy/`, `docker-compose.yml`), VPS thật còn chờ tiền — xem NEXT.md.
> - **HTTP**: stdlib `net/http` (Go 1.22+ ServeMux pattern routing) + `chi` chỉ khi muốn middleware ergonomics. Bắt đầu với stdlib. ✅ chốt luôn stdlib — `go.mod` không có `chi`, `api/cmd/server/main.go` dùng `http.NewServeMux()`.
> - **OpenAPI**: `openapi.yaml` ở root vẫn là source of truth — gen Go server stubs bằng `oapi-codegen`, gen iOS/Android client như cũ. 🔁 đổi nhẹ khi làm: **hand-roll handlers**, không dùng `oapi-codegen`; bù lại có `api/scripts/check_openapi_drift.sh` chạy trong CI để route Go không lệch spec.

---

## Repo layout — **thực tế sau migration** (không phải bản dự kiến nữa)

Bản dự kiến ngày 2026-05-07 nằm ở dưới, trong mục "Những chỗ plan nói sai". Đây là cây thật đang có trên đĩa:

```
warranty-vault/
├── api/                              # Go service — backend canonical (port 4000)
│   ├── cmd/
│   │   ├── server/main.go            # HTTP server + toàn bộ route /api/v1/*
│   │   ├── cron/main.go              # warranty-check CLI (systemd timer / k8s cron)
│   │   └── migrate/main.go           # goose migrate up/down/status
│   ├── internal/
│   │   ├── ai/                       # Anthropic vision OCR hoá đơn (thêm sau plan, 2026-06-05)
│   │   ├── auth/                     # bearer issue/verify, bcrypt, session sliding TTL
│   │   ├── config/                   # env loading + validation
│   │   ├── cron/                     # logic warranty/wishlist/subscription + idempotency
│   │   ├── email/                    # Resend REST wrapper
│   │   ├── files/                    # AES-256-GCM + magic-byte + image resize + storage
│   │   ├── handlers/                 # /api/v1/* handlers, JSON envelope
│   │   ├── httpx/                    # response helpers + middleware (auth, ratelimit, recover, logging)
│   │   ├── push/                     # webpush + apns + fcm + dispatch theo platform
│   │   ├── ratelimit/                # in-memory + Upstash REST
│   │   ├── services/                 # business logic thuần
│   │   ├── store/
│   │   │   ├── queries/*.sql         # sqlc input
│   │   │   └── gen/                  # sqlc output — ĐÃ COMMIT (16 file tracked)
│   │   └── validate/                 # go-playground/validator v10 setup
│   ├── migrations/                   # goose .sql — source of truth của schema
│   │   ├── 0001_initial.sql          # dịch tay từ website/prisma/schema.prisma (file đó đã xoá)
│   │   ├── 0002_cron_idempotency.sql # thêm sau plan: chống push trùng khi cron chạy 2 lần/ngày
│   │   └── 0003_user_ai_optin.sql    # thêm sau plan: per-user opt-in cho AI OCR (default OFF)
│   ├── scripts/                      # test_*.sh, check_openapi_drift.sh, seed_dev.sql
│   ├── sqlc.yaml · go.mod · .golangci.yml · Dockerfile · README.md · .env.example
├── website/                          # Next.js 16 web UI — thin proxy sang Go
│   ├── src/app/(app|auth|public)/    # pages + layouts
│   ├── src/app/actions/*.ts          # server actions = thin proxy (auth, devices, …)
│   ├── src/app/api/files/[id]/route.ts  # HTTP route DUY NHẤT còn lại của Next.js
│   └── src/lib/api/*                 # typed Go REST client (GO_API_URL)
├── ios/ · android/                   # native clients — gọi thẳng Go, không qua web
├── mobile/                           # docs cross-platform (Firebase setup, …)
├── openapi.yaml                      # source of truth REST contract (34 path)
├── deploy/                           # Caddyfile + systemd cron timer + backup.sh
├── docker-compose.yml                # postgres + api + cron + website
├── BACKEND_GO_PLAN.md                # file này — historical
├── MOBILE_PLAN.md                    # historical
├── NEXT.md · README.md · CLAUDE.md   # trạng thái + kiến trúc hiện tại
```

### Những chỗ plan nói sai (hoặc đã đổi khi làm thật)

| Plan (2026-05-07) dự kiến | Thực tế |
|---|---|
| `website/src/lib/api.ts` — 1 file typed client | `website/src/lib/api/` — **một folder** (`auth.ts`, `devices.ts`, `client.ts`, `index.ts`, …) |
| `website/src/app/` — "NO /api/*, NO actions/" | Vẫn còn `src/app/actions/*` (12 file) — **cố ý**: đó là thin proxy của Phase E, không phải business logic |
| Xoá sạch API route của web | Còn đúng 1: `website/src/app/api/files/[id]/route.ts` (proxy stream file, xem E.4) |
| `api/internal/services/` mirror `website/src/lib/services/` | `website/src/lib/services/` **đã xoá**; helper thuần còn lại ở web: `warranty.ts`, `subscription-types.ts`, `wishlist-types.ts` (RSC-friendly, không đụng DB) |
| `oapi-codegen` gen server stubs | Không dùng; hand-roll + drift check script |
| `chi` cho middleware | Không dùng; stdlib `net/http` thuần |
| Không nhắc gì tới AI | `api/internal/ai/` + `api/internal/services/ai_extract.go` (2026-06-05, ngoài plan gốc) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` cho Go webpush | Go ưu tiên `VAPID_PUBLIC_KEY`, fallback `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (`api/internal/push/webpush.go`); cần `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` |
| `APNS_PRIVATE_KEY` | ✅ **đúng** — code đọc đúng tên này (`api/internal/push/apns.go`, `api/.env.example`). Lưu ý: `CLAUDE.md` ghi `APNS_KEY_P8` — **không khớp code**, tin theo `api/README.md` / `.env.example` |

---

## Tech stack chốt

| Concern | Choice | Lý do | Kết quả |
|---|---|---|---|
| HTTP routing | stdlib `net/http` (Go 1.22 ServeMux) | Đủ cho ~30 routes, không cần dep ngoài | ✅ đúng, không thêm `chi` |
| DB driver | `github.com/jackc/pgx/v5` | Native Postgres, fastest, tốt cho prepared stmt + listen/notify nếu cần | ✅ |
| Query gen | `sqlc` | Typed query từ `.sql` file, schema-aware | ✅ gen **committed** ở `api/internal/store/gen/` |
| Migrations | `pressly/goose` | Embed migrations vào binary, ergonomic | ✅ `api/migrations/0001..0003` |
| Validation | `go-playground/validator/v10` | Struct tag, parity với Zod | ✅ |
| Auth | `golang.org/x/crypto/bcrypt` + opaque session token (sha256 hash) | Tái dùng pattern `Session` table hiện tại | ✅ + `bcrypt_compat_test.go` verify hash `bcrypt-ts` cũ |
| Web push | `SherClockHolmes/webpush-go` | Maintained, VAPID-aware | ✅ |
| APNs | `sideshow/apns2` | HTTP/2 + JWT cache, prod/sandbox switch | ✅ |
| FCM | hand-roll v1 (giống TS hiện tại) | Tránh thêm Firebase Admin SDK; mint OAuth2 JWT bằng `golang-jwt/jwt/v5` | ✅ |
| File encrypt | stdlib `crypto/aes` + `crypto/cipher` GCM | Same algo như TS — interop được | ✅ + `internal/files/interop_test.go` |
| Image resize | `disintegration/imaging` (pure Go) hoặc gọi `vips` subprocess | Bắt đầu với imaging, đo perf, đổi sau | ✅ imaging là đủ; **không cần** `vips`. HEIC giữ nguyên bytes (pure-Go decode yếu) |
| MIME magic-byte | `gabriel-vasile/mimetype` | Best-in-class detector | ✅ |
| Rate limit | in-memory map + Upstash REST (HTTP) | Match TS impl, fail-open | ✅ `RATE_LIMITER=redis\|upstash` + `UPSTASH_REDIS_REST_*`, thiếu env thì warn + fallback memory |
| Email | Resend REST trực tiếp | Khỏi dùng SDK | ✅ |
| OpenAPI server | `oapi-codegen` (gen interface) hoặc tự write handlers + verify với `kin-openapi` | Bắt đầu hand-roll, nếu route phình thì gen | ✅ hand-roll + `api/scripts/check_openapi_drift.sh` trong CI |
| Config | `github.com/joho/godotenv` + tự parse | Tránh viper | ✅ |
| Logging | stdlib `log/slog` (Go 1.21+) | JSON output, structured | ✅ |
| Test | stdlib `testing` + `testify/assert` | `httptest` cho handler tests | ✅ stdlib `testing` thuần — **không thêm testify** |

**Cố tình KHÔNG dùng**: gin / fiber / echo / gorm / viper / cobra. Stack lean, ít dep, dễ audit. → ✅ giữ đúng.

---

## Phase A — Bootstrap Go service (1 tuần) ✅ XONG

> **Ship ở commit `57938d8`** (2026-05-13, "monorepo restructure + Go API + iOS/Android clients + REST v1 + service layer").
> Lịch sử git bị squash: **A, B, C, D nằm chung một commit** — không có commit/tag riêng cho từng phase A–D.
> Chỉ có **2 tag** cho cả đợt: `phase-e-mid` (→ `40efcb2`) và `phase-f-done` (→ `33c79c4`).

### A.1 Init module ✅
- `cd warranty-vault && mkdir api && cd api`
- `go mod init github.com/<owner>/warranty-vault/api` → thực tế: module `github.com/thanhtrung9368/warranty-vault/api`, Go 1.25.
- Add deps liệt kê trên (`go get`). ✅

### A.2 Skeleton ✅
- `cmd/server/main.go`: load env, mở pgx pool, start `http.Server` với `mux := http.NewServeMux()`, register `GET /healthz` → `200 OK {"ok":true}`. ✅ — thực tế có thêm `GET /readyz` (DB ping) như mục Observability dự kiến.
- `internal/config/config.go`: load DATABASE_URL, SESSION_SECRET (chỉ dùng cho web cookie, server tự dùng sha256 token), CORS_ORIGINS, PORT (default 4000). ✅
- `internal/httpx/`: helpers `WriteJSON(w, status, v)`, `WriteError(w, status, code, message, fieldErrors)` — match envelope hiện tại của TS (`{ error, message?, fieldErrors? }`). ✅ (`httpx/response.go`)

### A.3 Schema migration ✅
- Translate `website/prisma/schema.prisma` → `api/migrations/0001_initial.sql` (manual; Prisma đã chạy `db push` rồi, có thể `prisma migrate diff` rồi clean up). ✅ — header file `0001_initial.sql` ghi rõ "hand-translated from website/prisma/schema.prisma". File Prisma đó **đã bị xoá** ở `33c79c4`.
- Setup `goose` để chạy `up`/`down`/`status`. 🔁 **Đổi khi làm**: plan ghi "Embed via `embed.FS`" nhưng thực tế **không embed** — `cmd/migrate` đọc thẳng thư mục `migrations/` (`const migrationsDir = "migrations"` + `goose.RunContext`), nên `api/Dockerfile` phải `COPY /src/migrations /app/migrations` cạnh binary. Chạy binary ngoài Docker thì phải `cd api` trước.
- `cmd/migrate/main.go`: wrapper CLI: `migrate up`, `migrate down`, `migrate status`. ✅
- Run lần đầu trên `warranty_vault_dev` (đã có data từ Prisma) — verify schema diff = 0 trước khi chạy `up`. ✅ (không còn cách verify lại bằng Prisma vì Prisma đã gỡ — xem Cross-cutting).

### A.4 sqlc ✅
- `api/sqlc.yaml`: ✅ (giữ đúng cấu hình dự kiến: engine postgresql, schema `migrations`, queries `internal/store/queries`, out `internal/store/gen`, `sql_package: pgx/v5`).
- Viết 1 query mẫu `internal/store/queries/devices.sql`: ✅ — có `GetDeviceByID :one` với `AND "userId" = $2`.
- `sqlc generate` → kiểm tra `internal/store/gen/devices.sql.go`. Verify type mapping VND `Int` → Go `int32` ok. ✅
- **Chốt còn treo trong plan** ("gitignored or committed; tao chốt commit") → **đã commit**: 16 file tracked trong `api/internal/store/gen/`.

### A.5 CI hook ✅
- `.github/workflows/api.yml`: run `go vet ./...`, `golangci-lint run`, `go test ./...` khi `api/**` thay đổi. ✅ — thực tế chạy `go vet` → `go test ./... -race` → `go build` → `golangci-lint` → **OpenAPI drift check** (`api/scripts/check_openapi_drift.sh`).

**Exit criteria**: `go run ./cmd/server` chạy, `curl localhost:4000/healthz` trả `{"ok":true}`. `migrate up` idempotent trên dev DB. `sqlc generate` xanh. → ✅ đạt (CI giữ xanh từ đó tới giờ).

---

## Phase B — Auth parity (3-5 ngày) ✅ XONG (cùng commit `57938d8`)

### B.1 Session + bearer ✅
- `internal/auth/auth.go` → thực tế tách thành `token.go` + `session.go` + `middleware.go`:
  - `IssueToken(...)` — `crypto/rand` 32 bytes → base64url; lưu sha256 hash + meta vào `Session` table; TTL 30d. ✅
  - `VerifyBearer(...)` — sha256 lookup, check `expiresAt`, `revokedAt`, sliding `lastSeenAt`. ✅
  - `RevokeToken(...)`, `PruneExpired(...)` (cron-callable). ✅
- `internal/httpx/middleware.go::RequireUser` → thực tế nằm ở `internal/auth/middleware.go`. ✅

### B.2 bcrypt ✅
- `internal/auth/password.go`: wrapper quanh `golang.org/x/crypto/bcrypt`, cost 12 (match `BCRYPT_ROUNDS` của TS). ✅
- Verify hash từ TS (`bcrypt-ts`) đọc được trong Go → **có test thật**: `api/internal/auth/bcrypt_compat_test.go` + fixture `api/internal/auth/testdata/verify.mjs` (thêm ở `449b4f9`).

### B.3 Endpoints ✅
- `POST /api/v1/auth/register` ✅
- `POST /api/v1/auth/login` ✅
- `POST /api/v1/auth/logout` ✅
- `GET /api/v1/auth/me` ✅
- `POST /api/v1/auth/forgot` ✅ (luôn `{ok:true}` chống enumeration; Resend; dev mode log link khi thiếu `RESEND_API_KEY`)
- `POST /api/v1/auth/change-password` ✅
- **Thêm ngoài plan**: `POST /api/v1/auth/reset-password` + `DELETE /api/v1/auth/me` (xoá tài khoản, yêu cầu mật khẩu hiện tại) — ship ở `449b4f9`, dùng ở cả 3 client.
- Đổi so với plan: prefix là `/api/v1/...` chứ không phải `/v1/...` — chốt ở `40efcb2` để khớp `openapi.yaml` + mobile.

### B.4 Rate limit ✅
- Port `website/src/lib/rate-limit-upstash.ts` + in-memory sang Go. ✅ — file TS đó **đã xoá** cùng Phase F.
- `internal/ratelimit/`: `Limiter` interface + `memory.go` (`sync.Map`) + `upstash.go` (POST `/pipeline`, `INCR`/`PEXPIRE`/`PTTL`), fail-open như TS. ✅
- Middleware 🔁 **tên thật khác plan**: `ratelimit.Auth(limiter, action, identifierFromBody)` + `ratelimit.UserWrite(limiter, userIDFromCtx)` (`api/internal/ratelimit/middleware.go`), helper `CheckAuth` / `CheckUserWrite` / `CheckAIExtract` (`helpers.go`). Không có `RateLimitAuth` / `RateLimitUserWrite`.

### B.5 Email ✅
- `internal/email/resend.go`: `SendPasswordResetEmail(to, link)` POST `https://api.resend.com/emails`. No SDK. ✅

### B.6 Parity test ✅
- Adapt `website/scripts/test-change-password.mjs` → `api/scripts/test_change_password.sh` gọi Go service. ✅ (script `.mjs` đã xoá ở `33c79c4`).
- Bộ script parity đầy đủ hiện có: `test_auth.sh`, `test_change_password.sh`, `test_devices.sh`, `test_warranties` (trong `test_devices.sh`), `test_attachments.sh`, `test_subscriptions.sh`, `test_wishlist.sh`, `test_catalog.sh`, `test_stats.sh`, `test_reminders.sh`, `test_push.sh`, `test_cron_flow.sh`.

**Exit criteria**: 6 endpoints auth chạy + parity script pass. Mobile swap BASE_URL sang Go và login được account cũ tạo từ web. ✅ đạt — web `requireUser()` giờ gọi `GET /api/v1/auth/me` trên Go.

---

## Phase C — Resource CRUD (2 tuần) ✅ XONG (cùng commit `57938d8`)

Pattern đã áp đúng như plan cho từng resource: `internal/store/queries/<resource>.sql` → `internal/services/<resource>.go` → `internal/handlers/<resource>.go` → wire vào `cmd/server/main.go`.

### C.1 Devices ✅
- `GET /api/v1/devices?status=&category=` ✅ · `POST /api/v1/devices` ✅ (tạo kèm warranty trong 1 transaction) · `GET /api/v1/devices/{id}` ✅ · `PATCH /api/v1/devices/{id}` ✅ · `DELETE /api/v1/devices/{id}` ✅ (cascade + xoá blob).
- `MAX_DEVICES_PER_USER = 50` enforce trong `api/internal/services/devices.go`. ✅
- Per-row ownership: mọi query có `AND "userId" = $N`. ✅
- **Tối ưu thêm (2026-06-05, `e503c7b`)**: `ListDevices` N+1 → batch query.

### C.2 Warranties ✅
- `MAX_WARRANTIES_PER_DEVICE = 5` ✅
- `POST /api/v1/warranties/{id}/reminder` (dismiss) ✅ · `DELETE /api/v1/warranties/{id}/reminder` (restore) ✅
- UI "undo ngay sau dismiss" nhất quán 3 client (2026-06-05, `8320c7e`).

### C.3 Attachments (encrypted) — **highest risk** ✅ KHÔNG nổ
- `internal/files/encrypt.go`: đúng scheme dự kiến (data key 32B random, AES-256-GCM blob + IV 12B, wrap data key bằng `FILE_MASTER_KEY`, lưu `wrappedKey`/IV/wrapKeyIV). ✅
- `internal/files/mime.go`: `mimetype.Detect()` + whitelist `image/{jpeg,png,webp,gif,heic}` + `application/pdf`; SVG/HTML/JS reject. ✅
- `internal/files/resize.go`: ảnh > 1600px cạnh dài → `imaging.Resize`. ✅ **Quyết định thực tế**: HEIC giữ nguyên bytes (pure-Go decode yếu) — **không cần** `vips` subprocess, đúng như fallback plan cho phép.
- Endpoints ✅: `POST /api/v1/devices/{id}/attachments` · `DELETE /api/v1/attachments/{id}` · `GET /api/files/{id}` (auth-gated, `Cache-Control: private, no-store`, `?download=1`).
- **Migration/interop test**: ✅ `api/internal/files/interop_test.go` + `api/internal/files/testdata/decrypt.mjs` (thêm ở `449b4f9`) — Go decrypt được file do TS encrypt. Đây là risk #1 của plan, đã đóng bằng test thật.

### C.4 Subscriptions ✅
- 5 billingCycle: MONTHLY/QUARTERLY/YEARLY/LIFETIME/CUSTOM (CUSTOM cần `intervalDays`) ✅
- `nextRenewalDate()` + `monthlyEquivalent()` — port từ `website/src/lib/subscription-types.ts`; **bản web vẫn giữ** file đó vì là hàm thuần, RSC dùng lại (không đụng DB), có unit test ở `website/src/lib/__tests__/subscription-types.test.ts`. ✅
- `POST /api/v1/subscriptions/{id}/renew` ✅ · `POST /api/v1/subscriptions/{id}/payments` ✅
- `MAX_SUBS_PER_USER = 100` ✅

### C.5 Wishlist ✅
- Statuses WATCHING/DECIDED/PURCHASED/DROPPED ✅
- `PATCH /api/v1/wishlist/{id}` với `status=PURCHASED` → tạo `Device` trong cùng transaction, set `purchasedDeviceId`. ✅
- `POST /api/v1/wishlist/{id}/prices` ✅ · `MAX_WISHLIST_PER_USER = 200` ✅

### C.6 Catalog ✅
- `GET /api/v1/catalog` ✅ — chốt **cache TTL đơn giản** (không làm LISTEN/NOTIFY). 🔁 Thực tế khác plan một chút: `getDeviceFormCatalog()` **không** bọc `unstable_cache` (endpoint auth-gated, cần bearer token nên không được dùng helper đó — xem comment trong `website/src/app/actions/catalog.ts`); thay vào đó fetch trong `website/src/lib/api/catalog.ts` opt-in Next Data Cache `{ revalidate: 300, tags: ['catalog'] }`, và RSC `cache()` dedupe trong 1 render.

### C.7 Stats + Reminders ✅
- `GET /api/v1/stats` ✅ — port từ `website/src/lib/stats.ts` (file TS đã xoá); web chỉ render.
- `GET /api/v1/reminders` ✅ — port từ `website/src/lib/services/reminders.ts` (đã xoá).

**Exit criteria**: "28 endpoints chạy" → thực tế `openapi.yaml` hiện khai báo **34 path** (gồm cron, backup, AI thêm sau). Toàn bộ script parity cũ đã được port sang `api/scripts/test_*.sh` và chạy xanh. ✅

---

## Phase D — Push fanout & cron (3-5 ngày) ✅ XONG (cùng commit `57938d8`, hardening thêm ở `33c79c4`)

### D.1 Web push ✅
- `internal/push/webpush.go`: `SherClockHolmes/webpush-go`. Init từ env `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` 🔁 (thực tế có fallback: `firstEnv("VAPID_PUBLIC_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY")` — nên biến `NEXT_PUBLIC_*` vẫn dùng được nếu chưa đổi tên). 404/410 → `gone:true`. ✅

### D.2 APNs ✅
- `internal/push/apns.go`: `sideshow/apns2`, env `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_BUNDLE_ID` + `APNS_PRIVATE_KEY` (nội dung `.p8` — tên này **đúng** như plan, verify ở `api/internal/push/apns.go` + `api/.env.example`; `CLAUDE.md` ghi `APNS_KEY_P8` là **sai** so với code). Token JWT cache do lib handle. Production gateway nếu `APNS_PRODUCTION=1`. ✅

### D.3 FCM ✅
- `internal/push/fcm.go`: hand-roll, mint OAuth2 JWT từ service account (`FCM_SERVICE_ACCOUNT_JSON`), cache access token 1h, POST `messages:send`. 404/UNREGISTERED → `gone:true`. ✅

### D.4 Fanout dispatcher ✅
- `internal/push/dispatch.go`: switch theo `sub.platform` ∈ {web, apns, fcm}; `gone:true` → caller xoá row. ✅
- **Tối ưu thêm (2026-06-05, `e503c7b`)**: dispatch concurrent bằng `errgroup` (limit 8).

### D.5 Cron command ✅
- `cmd/cron/main.go` + `internal/cron/run.go`: đủ 4 nhánh như plan (warranty expiry 7d/30d · wishlist target date · wishlist periodic check-in · subscription renewal + auto-bill `SubscriptionPayment`, `autoRenew=false` → `EXPIRED`). ✅
- 2 run mode ✅: CLI `go run ./cmd/cron` và `POST /api/v1/cron/warranty-check` với `Authorization: Bearer $CRON_SECRET`.
- Pruning `Session` hết hạn + `PasswordReset` quá hạn: ✅ trong cùng job.
- **Phát sinh khi chạy thật**: cron chạy 2 lần/ngày sẽ push trùng → **`api/migrations/0002_cron_idempotency.sql`** + `api/internal/cron/run.go` stamp `lastNotifiedAt`, filter `::date < CURRENT_DATE`; có test `api/internal/cron/run_test.go` (`33c79c4`). Đây là bug plan không lường trước.

**Exit criteria**: chạy cron trên dev DB, log đúng số notification, fanout xử lý 3 loại row, auto-bill log đúng `SubscriptionPayment`. ✅ đạt + có test idempotency.

---

## Phase E — Web cutover (1-2 tuần) ✅ XONG

Đây là phase rủi ro cao nhất vì web đang dùng server actions trực tiếp. **Ship phần lớn ở `57938d8` (2026-05-13), đóng hẳn ở `449b4f9` (2026-05-14, "close Phase E").**

### E.1 Web auth bridge ✅
- `website/src/lib/api.ts` → thực tế là folder `website/src/lib/api/` (14 file: `ai.ts`, `attachments.ts`, `auth.ts`, `backup.ts`, `catalog.ts`, `client.ts`, `devices.ts`, `index.ts`, `push.ts`, `reminders.ts`, `stats.ts`, `subscriptions.ts`, `warranties.ts`, `wishlist.ts`). Base `GO_API_URL`, bearer lấy từ cookie. ✅
- `website/src/lib/auth-cookie.ts`: iron-session cookie `wv_session` **chỉ** lưu `{ accessToken, expiresAt }`. ✅ đúng như plan.
- Login flow web: form → server action → `POST /api/v1/auth/login` trên Go → set cookie → redirect `/dashboard`. ✅
- Mỗi RSC page: `requireUser()` trong `(app)/layout.tsx` gọi `GET /api/v1/auth/me` (dedupe bằng React `cache()`). ✅ — không phải mỗi page tự gọi như plan dự kiến, gọn hơn.

### E.2 Tear out server actions ✅
- Làm từng resource một như plan. ✅ Tất cả action trong `website/src/app/actions/` (`auth`, `devices`, `warranties`, `attachments`, `subscriptions`, `wishlist`, `reminders`, `push`, `backup`, `password-reset`, `catalog`, `ai`) giờ chỉ còn: `requireUser()` + parse FormData (Zod) + gọi `api.*` + map qua `toFormState()`. **Không có business logic ở web nữa.**
- `revalidatePath`: từ 2026-06-05 (`6ff2fda`) đã **bỏ** vì mọi page đều dynamic — chỉ còn opt-in Next data cache.

### E.3 Xoá Prisma + DB code khỏi web ✅ (hoàn tất ở `33c79c4`)
- Xoá `website/src/lib/prisma.ts`, `services/*`, `files.ts`, `push*.ts`, `rate-limit*.ts`, `email.ts`, `queries.ts`, `stats.ts`, `api-auth.ts`: ✅ **đã xoá hết**. Danh sách này tồn tại trong `57938d8` và biến mất ở `33c79c4`.
- **Ngoại lệ so với plan**: `website/src/lib/warranty.ts` **được giữ** (plan ghi xoá) — nó là helper thuần `effectiveWarrantyEnd()` cho RSC, không truy cập DB, có unit test. Cùng nhóm: `subscription-types.ts`, `wishlist-types.ts`, `types.ts`, `format.ts`, `session.ts`, `auth.ts`, `auth-cookie.ts`.
- Xoá `website/prisma/`: ✅ — `schema.prisma`, `seed.mjs`, `prisma.config.ts` đều bị xoá ở `33c79c4`. Schema management thuộc `api/migrations/` (goose).
- Xoá `website/scripts/test-*.mjs`: ✅ — cả folder `website/scripts/` biến mất; test chuyển sang `api/scripts/test_*.sh` + Go test files.
- Xoá `website/src/app/api/v1/*` + `website/src/app/api/cron/*`: ✅ — **27 file route** bị xoá ở `33c79c4` (26 route `/api/v1/*` + 1 route cron).
- `package.json`: gỡ `@prisma/client`, `@prisma/adapter-pg`, `prisma`, `pg`, `bcrypt-ts`, `web-push`, `resend`, `sharp` (+ `@types/pg`, `@types/web-push`), bỏ script `prisma generate`/`db:push`/`db:seed`/`db:studio`, thêm `vitest`. ✅ — `iron-session` **được giữ** đúng như plan cho phép. Web giờ chỉ còn UI deps.

### E.4 File serving ✅
- **Chốt đúng như plan**: dùng web-proxy. `website/src/app/api/files/[id]/route.ts` đọc bearer trong cookie → gọi `GET /api/files/{id}` trên Go → stream body, tự gắn lại security header. **Không** port iron-session sang Go. Đây là HTTP route duy nhất còn lại của Next.js.

### E.5 Cookie / CORS ✅
- Mobile gọi Go trực tiếp (Bearer), không cần CORS. ✅
- Web chỉ gọi Go server-to-server → không cần CORS cho browser; `WEB_URL` là allowlist CORS trong Go config. ✅

**Exit criteria**: web build + chạy + click qua mọi flow; không còn import `@prisma/client`. ✅ đạt — CI `website.yml` chạy `npm run lint` + `tsc --noEmit` + `npm test` + `npm run build`.

---

## Phase F — Decommission TS API + cleanup (2-3 ngày) ✅ XONG

**Commit chốt: `33c79c4`** (2026-05-14), tag **`phase-f-done`**.

- Mobile: đổi BASE_URL sang Go. ✅ iOS `WarrantyVaultApp.swift` → `http://localhost:4000`; Android `build.gradle.kts` → `BuildConfig.BASE_URL = "http://10.0.2.2:4000"` (emulator).
- Xoá các code path đã thay (E.3). ✅
- Update `CLAUDE.md`: "Server actions are the API" → "Web gọi Go REST qua thin server actions", bỏ phần Prisma layout, giữ phần encrypted attachments nhưng note implementation ở Go. ✅ (CLAUDE.md hiện tại đúng như vậy).
- Update `MOBILE_PLAN.md`: tick Phase 0 + note "BE migrated to Go". ✅ — chính là bản cập nhật này.
- Update `README.md` root. ✅ (bản `ff904fb` + các lần sau).
- Update `.env.example`: tách `website/.env.example` + `api/.env.example`. ✅
- Update `docker-compose.yml`: thêm service `api`, web `depends_on` api. ✅ — thực tế compose có 4 service: `postgres` + `api` + `cron` + `website`.
- CI: ✅ — không phải 2 mà **4 workflow**: `api.yml`, `website.yml`, `ios.yml`, `android.yml`.

**Exit criteria**: `npm run build` xanh ✅ · `go test ./...` xanh ✅ · không còn dependency/runtime Prisma trong web ✅ · 2 grep literal (`prisma` / `rateLimitUserWrite`) thì **không sạch** — xem đính chính ngay dưới.

⚠️ **Đính chính (verify lại 2026-06-05)**: 2 grep đầu **chưa bao giờ sạch theo nghĩa literal**, kể cả ngay tại `33c79c4`:
- `prisma` còn sót trong **docs/config cũ của web**: `website/README.md` (dòng 9, 136, 207, 218, 221 — vẫn mô tả Prisma 7 + `prisma/schema.prisma`), `website/DEPLOY.md` (dòng 25, 28, 99 — vẫn `npx prisma db push`), `website/.cspell.json`, `website/.dockerignore`, và 1 comment trong `website/src/app/(app)/dashboard/page.tsx`.
- `rateLimitUserWrite` còn trong 1 comment ở `website/src/app/actions/backup.ts`.

Ý nghĩa thật của "sạch": **không còn dependency/runtime Prisma nào** — `website/package.json` không còn `@prisma/*`/`prisma`/`pg`, và không còn file code nào import Prisma. Đó là điều đã đạt. Phần docs cũ của `website/` thì **vẫn stale** (ngoài phạm vi 2 file plan này).

**Phát sinh sau Phase F** (ngoài plan, ghi lại cho đủ lịch sử):
- `4e3b9ce` (2026-05-18) — refactor UI website theo design handoff.
- `e503c7b` + `ea15554` (2026-06-05) — **AI quét hoá đơn**: `api/internal/ai/` (Anthropic vision + tool-use), `api/internal/services/ai_extract.go`, `api/migrations/0003_user_ai_optin.sql` (per-user opt-in, default OFF → 403 `ai_optin_required`; thiếu key → 503). Gated ở cả Go + web + iOS + Android.

---

## Cross-cutting concerns — trạng thái cuối

### Schema migration ownership ✅
- **Goose ở `api/migrations/` là source-of-truth duy nhất.** Prisma schema đã xoá hẳn (`33c79c4`), nên giai đoạn "parallel Prisma `db push` vs goose" chỉ còn là lịch sử — risk #6 không còn áp dụng.
- Cách đổi schema bây giờ: viết migration goose mới → `go run ./cmd/migrate up` → regen `sqlc generate`. Không còn bước "verify bằng `prisma db pull`".
- 3 migration đang có: `0001_initial`, `0002_cron_idempotency`, `0003_user_ai_optin`.

### Encryption key parity ✅
- Plan dự kiến `FILE_MASTER_KEY` phải share giữa Go và web "chỉ khi web còn proxy file". **Thực tế**: web proxy chỉ stream bytes, **không** decrypt — nên sau Phase F **chỉ Go cần `FILE_MASTER_KEY`**.
- Interop test đã có thật: `api/internal/files/interop_test.go` (+ `testdata/decrypt.mjs`).
- Rotate key: re-wrap mọi `Attachment.wrappedKey` server-side — xem `api/README.md`.

### OpenAPI sync ✅
- `openapi.yaml` ở root vẫn là source of truth, hiện 34 path. ✅
- Không dùng `oapi-codegen`; thay bằng **drift check** `api/scripts/check_openapi_drift.sh` (so route đăng ký trong `cmd/server/main.go` + `internal/handlers/` với `openapi.yaml`), chạy trong `api.yml`. ✅

### Observability ✅
- `log/slog` JSON handler ra stdout. ✅
- Middleware logging: method, path, status, bytes, `duration_ms`, `request_id`, `remote` (`api/internal/httpx/middleware.go`) — 🔁 **không log userID** như plan dự kiến, nhưng có `X-Request-ID` propagate (`RequestID` → `Logging` → `Recover`). ✅
- `GET /healthz` (always 200 `{"ok":true}`) + `GET /readyz` (DB ping, 503 `db_unavailable` khi fail). ✅

### Deployment (single-host VPS) ⏳ template xong, chưa lên prod
- ✅ `api/Dockerfile` (multi-stage), `website/Dockerfile`, `docker-compose.yml` (postgres + api + cron + website), `deploy/caddy/Caddyfile`, `deploy/systemd/warranty-vault-cron.{service,timer}`, `deploy/backup.sh` (`04dbcb2`, pg_dump + tar blob + retention prune), `deploy/README.md`.
- ⏳ Chưa thuê VPS/domain — nằm trong bảng "Defer hẳn" của NEXT.md.

### Rollback strategy
- Tag thực tế: `phase-e-mid` (→ `40efcb2`) và `phase-f-done` (→ `33c79c4`). Các tag trung gian `go-bootstrap`/`go-auth`/`go-resources`/`go-push`/`go-web-cutover` **không tồn tại** — do A–D bị squash vào `57938d8`.
- Migration đã xong và ổn định; không cần rollback nữa.

---

## Risks — kết quả thực tế

1. **Encrypted attachment interop** — ✅ đóng. `internal/files/interop_test.go` decrypt được file do TS encrypt; magic-byte whitelist giữ nguyên.
2. **Image processing weaker trong Go** — ✅ không thành vấn đề. `disintegration/imaging` đủ dùng; **không** cần `vips` subprocess. HEIC giữ nguyên bytes.
3. **bcrypt cross-platform compat** — ✅ đóng bằng test thật (`api/internal/auth/bcrypt_compat_test.go`): hash `bcrypt-ts` cũ verify được trong Go → user tạo từ web login được qua Go.
4. **Server actions thêm 1 round trip** — ✅ chấp nhận được; action vẫn `revalidatePath`/`redirect` như cũ (sau này bỏ `revalidatePath` vì page đã dynamic).
5. **Cookie → bearer translation** — ✅ giải đúng bằng web-proxy `/api/files/[id]`; cookie iron-session mã hoá, không leak ra client component.
6. **Prisma `db push` vs goose drift** — ✅ hết rủi ro: Prisma đã xoá hoàn toàn.
7. **iOS/Android testing với Go** — ✅ cả 2 app đã point sang Go (port 4000); web/mobile chạy chung 1 backend từ `33c79c4`.

---

## Effort estimate — thực tế đã ship

| Phase | Effort dự kiến | Trạng thái | Commit chốt | Ngày |
|---|---|---|---|---|
| A — Bootstrap | 5-7 ngày | ✅ XONG | `57938d8` (squash chung A–D) | 2026-05-13 |
| B — Auth | 3-5 ngày | ✅ XONG | `57938d8` | 2026-05-13 |
| C — Resources | 10-14 ngày | ✅ XONG | `57938d8` | 2026-05-13 |
| D — Push + cron | 3-5 ngày | ✅ XONG | `57938d8` (+ idempotency `33c79c4`) | 2026-05-13 · 2026-05-14 |
| E — Web cutover | 7-10 ngày | ✅ XONG | `57938d8` → `40efcb2` → `449b4f9` | 2026-05-13 → 2026-05-14 |
| F — Decommission | 2-3 ngày | ✅ XONG | `33c79c4` (tag `phase-f-done`) | 2026-05-14 |
| **Tổng** | **5-7 tuần** | ✅ | | |

Ghi chú: khoảng thời gian **commit** chỉ là 2 ngày (`55417d6` 2026-04-29 → `57938d8` 2026-05-13 → `33c79c4` 2026-05-14) vì toàn bộ working tree của Phase A–E được gộp vào một commit lớn. **Không thể suy ra thời lượng thật của từng phase từ git log** — plan ghi 5-7 tuần part-time, và không có dữ liệu nào trong repo để xác nhận hay phủ nhận con số đó.

So với 2.5-3 tháng của MOBILE_PLAN — đây là dự án phụ trợ, nhanh hơn vì logic đã chín và đã có service layer separation. → ✅ đúng: backend xong trước mobile, mobile chỉ việc trỏ `BASE_URL`.

---

## Thay cho "Bắt đầu: Phase A.1 ngay bây giờ" — **đã xảy ra thực tế**

Toàn bộ các bước dưới đây **đã chạy xong**; giữ lại để đối chiếu lịch sử, không phải việc cần làm.

```
# 2026-05-13 — 57938d8: dựng api/ (111 file), goose 0001_initial, sqlc, auth, CRUD,
#              push/cron, web thin proxy src/lib/api/*
# 2026-05-14 — 40efcb2: chốt prefix /api/v1, docker-compose, 4 CI workflow  [tag phase-e-mid]
# 2026-05-14 — 449b4f9: đóng Phase E — backup import/export + reset-password sang Go,
#              bcrypt compat test, files interop test, deploy/ templates
# 2026-05-14 — ff904fb: mobile push device UI, openapi drift check
# 2026-05-14 — 33c79c4: Phase F — xoá website/prisma, website/scripts,
#              website/src/app/api/v1/*, gỡ prisma/pg/bcrypt-ts/resend/sharp/web-push,
#              migration 0002 cron idempotency + vitest          [tag phase-f-done]
# 2026-06-05 — e503c7b: perf (batch query, concurrent push) + AI quét hoá đơn (migration 0003)
```

**Còn lại gì?** Không còn gì thuộc phạm vi file này. Việc tiếp theo (deploy thật, Apple/Firebase/VPS accounts, prod keys) nằm ở **[NEXT.md](NEXT.md)** — mục "Block 4" và bảng "Defer hẳn".
