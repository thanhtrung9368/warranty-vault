# Plan: Tách BE API thành service Go riêng

Mục tiêu: chuyển toàn bộ business logic, REST API, cron, push fanout, file streaming sang một service Go đứng riêng. Next.js website giữ vai trò pure frontend (RSC + Client Components) gọi Go REST như iOS/Android. Postgres + schema dùng chung; mobile clients chỉ đổi BASE_URL.

> **Decisions đã chốt** (2026-05-07)
> - **Scope**: Full Go cutover — web cũng gọi Go REST, không còn server actions write trực tiếp Postgres.
> - **DB**: `pgx` (driver) + `sqlc` (typed query gen từ SQL). Goose nhận quyền migration thay Prisma.
> - **Deploy**: thuê server (VPS / single binary). Kế hoạch viết theo single-host trước, có thể move sang Fly.io/Cloud Run sau mà không đổi code.
> - **HTTP**: stdlib `net/http` (Go 1.22+ ServeMux pattern routing) + `chi` chỉ khi muốn middleware ergonomics. Bắt đầu với stdlib.
> - **OpenAPI**: `openapi.yaml` ở root vẫn là source of truth — gen Go server stubs bằng `oapi-codegen`, gen iOS/Android client như cũ.

---

## Repo layout (sau migration)

```
warranty-vault/
├── api/                              ← NEW: Go service
│   ├── cmd/
│   │   ├── server/main.go            ← HTTP server (port 4000)
│   │   ├── cron/main.go              ← warranty-check CLI (gọi từ systemd timer / k8s cron)
│   │   └── migrate/main.go           ← goose migrate up/down wrapper
│   ├── internal/
│   │   ├── auth/                     ← bearer issue/verify, bcrypt, session sliding TTL
│   │   ├── handlers/                 ← /v1/* HTTP handlers, JSON envelope
│   │   ├── services/                 ← pure business logic (mirror website/src/lib/services/)
│   │   │   ├── devices.go
│   │   │   ├── warranties.go
│   │   │   ├── attachments.go
│   │   │   ├── subscriptions.go
│   │   │   ├── wishlist.go
│   │   │   ├── reminders.go
│   │   │   ├── stats.go
│   │   │   └── catalog.go
│   │   ├── store/                    ← pgx pool + sqlc-generated queries
│   │   │   ├── queries/*.sql         ← sqlc input
│   │   │   └── gen/                  ← sqlc output (gitignored or committed; tao chốt commit)
│   │   ├── files/                    ← AES-256-GCM encrypt/decrypt + magic-byte verify + image downscale
│   │   ├── push/                     ← webpush + apns + fcm dispatch (1 file mỗi loại)
│   │   ├── ratelimit/                ← in-memory + upstash REST
│   │   ├── email/                    ← Resend REST wrapper
│   │   ├── config/                   ← env loading + validation
│   │   ├── httpx/                    ← shared response helpers, middleware (auth, ratelimit, recover)
│   │   └── validate/                 ← go-playground/validator v10 setup
│   ├── migrations/                   ← goose .sql (translated from prisma/schema.prisma)
│   │   ├── 0001_initial.sql
│   │   ├── 0002_session_table.sql
│   │   └── ...
│   ├── scripts/
│   │   ├── test_change_password.sh   ← parity tests vs current TS scripts
│   │   ├── test_stats.sh
│   │   └── ...
│   ├── sqlc.yaml
│   ├── go.mod
│   ├── Dockerfile                    ← multi-stage, distroless, ~20MB
│   └── README.md
├── website/                          ← Next.js → pure frontend
│   ├── src/app/                      ← pages, layouts, NO /api/*, NO actions/
│   ├── src/components/, lib/         ← UI + client-side helpers
│   ├── src/lib/api.ts                ← NEW: typed Go REST client (gen từ openapi)
│   ├── src/lib/auth-cookie.ts        ← iron-session cookie store cho bearer token
│   └── ...
├── ios/, android/                    ← chỉ đổi BASE_URL khi cutover
├── openapi.yaml                      ← source of truth, không đổi
├── BACKEND_GO_PLAN.md                ← file này
└── ...
```

---

## Tech stack chốt

| Concern | Choice | Lý do |
|---|---|---|
| HTTP routing | stdlib `net/http` (Go 1.22 ServeMux) | Đủ cho ~30 routes, không cần dep ngoài |
| DB driver | `github.com/jackc/pgx/v5` | Native Postgres, fastest, tốt cho prepared stmt + listen/notify nếu cần |
| Query gen | `sqlc` | Typed query từ `.sql` file, schema-aware |
| Migrations | `pressly/goose` | Embed migrations vào binary, ergonomic |
| Validation | `go-playground/validator/v10` | Struct tag, parity với Zod |
| Auth | `golang.org/x/crypto/bcrypt` + opaque session token (sha256 hash) | Tái dùng pattern `Session` table hiện tại |
| Web push | `SherClockHolmes/webpush-go` | Maintained, VAPID-aware |
| APNs | `sideshow/apns2` | HTTP/2 + JWT cache, prod/sandbox switch |
| FCM | hand-roll v1 (giống TS hiện tại) | Tránh thêm Firebase Admin SDK; mint OAuth2 JWT bằng `golang-jwt/jwt/v5` |
| File encrypt | stdlib `crypto/aes` + `crypto/cipher` GCM | Same algo như TS — interop được |
| Image resize | `disintegration/imaging` (pure Go) hoặc gọi `vips` subprocess | Bắt đầu với imaging, đo perf, đổi sau |
| MIME magic-byte | `gabriel-vasile/mimetype` | Best-in-class detector |
| Rate limit | in-memory map + Upstash REST (HTTP) | Match TS impl, fail-open |
| Email | Resend REST trực tiếp | Khỏi dùng SDK |
| OpenAPI server | `oapi-codegen` (gen interface) hoặc tự write handlers + verify với `kin-openapi` | Bắt đầu hand-roll, nếu route phình thì gen |
| Config | `github.com/joho/godotenv` + tự parse | Tránh viper |
| Logging | stdlib `log/slog` (Go 1.21+) | JSON output, structured |
| Test | stdlib `testing` + `testify/assert` | `httptest` cho handler tests |

**Cố tình KHÔNG dùng**: gin / fiber / echo / gorm / viper / cobra. Stack lean, ít dep, dễ audit.

---

## Phase A — Bootstrap Go service (1 tuần)

### A.1 Init module
- `cd warranty-vault && mkdir api && cd api`
- `go mod init github.com/<owner>/warranty-vault/api`
- Add deps liệt kê trên (`go get`).

### A.2 Skeleton
- `cmd/server/main.go`: load env, mở pgx pool, start `http.Server` với `mux := http.NewServeMux()`, register `GET /healthz` → `200 OK {"ok":true}`.
- `internal/config/config.go`: load DATABASE_URL, SESSION_SECRET (chỉ dùng cho web cookie, server tự dùng sha256 token), CORS_ORIGINS, PORT (default 4000).
- `internal/httpx/`: helpers `WriteJSON(w, status, v)`, `WriteError(w, status, code, message, fieldErrors)` — match envelope hiện tại của TS (`{ error, message?, fieldErrors? }`).

### A.3 Schema migration
- Translate `website/prisma/schema.prisma` → `api/migrations/0001_initial.sql` (manual; Prisma đã chạy `db push` rồi, có thể `prisma migrate diff` rồi clean up).
- Setup `goose` để chạy `up`/`down`/`status`. Embed via `embed.FS`.
- `cmd/migrate/main.go`: wrapper CLI: `migrate up`, `migrate down`, `migrate status`.
- Run lần đầu trên `warranty_vault_dev` (đã có data từ Prisma) — verify schema diff = 0 trước khi chạy `up`.

### A.4 sqlc
- `api/sqlc.yaml`:
  ```yaml
  version: "2"
  sql:
    - engine: postgresql
      schema: migrations
      queries: internal/store/queries
      gen:
        go:
          package: store
          out: internal/store/gen
          sql_package: pgx/v5
  ```
- Viết 1 query mẫu `internal/store/queries/devices.sql`:
  ```sql
  -- name: GetDeviceByID :one
  SELECT * FROM "Device" WHERE id = $1 AND "userId" = $2 LIMIT 1;
  ```
- `sqlc generate` → kiểm tra `internal/store/gen/devices.sql.go`. Verify type mapping VND `Int` → Go `int32` ok.

### A.5 CI hook
- `.github/workflows/api.yml`: run `go vet ./...`, `golangci-lint run`, `go test ./...` khi `api/**` thay đổi.

**Exit criteria**: `go run ./cmd/server` chạy, `curl localhost:4000/healthz` trả `{"ok":true}`. `migrate up` idempotent trên dev DB. `sqlc generate` xanh.

---

## Phase B — Auth parity (3-5 ngày)

### B.1 Session + bearer
- `internal/auth/auth.go`:
  - `IssueToken(ctx, userID, deviceLabel, platform) (token string, expiresAt time.Time, err error)` — `crypto/rand` 32 bytes → base64url; lưu sha256 hash + meta vào `Session` table; TTL 30d.
  - `VerifyBearer(ctx, raw string) (*UserSession, error)` — sha256 lookup, check `expiresAt`, `revokedAt`, sliding `lastSeenAt`.
  - `RevokeToken(ctx, raw)`, `PruneExpired(ctx)` (cron-callable).
- `internal/httpx/middleware.go`:
  - `RequireUser(next)`: parse `Authorization: Bearer <token>` → set `r.Context()` user; 401 nếu sai.

### B.2 bcrypt
- `internal/auth/password.go`: thin wrapper quanh `golang.org/x/crypto/bcrypt`. Cost = 12 (match TS `BCRYPT_ROUNDS`). Kiểm tra rằng bcrypt hash từ TS (`bcrypt-ts`) verify OK trong Go (cùng prefix `$2a$/$2b$`).

### B.3 Endpoints
- `POST /v1/auth/register` — body `{email, password, name?}`. Validate, hash, insert `User`, issue token. Return `{accessToken, expiresAt, user}`.
- `POST /v1/auth/login` — body `{email, password, deviceLabel?, platform?}`. Bcrypt compare, issue token.
- `POST /v1/auth/logout` — Bearer required, revoke.
- `GET /v1/auth/me` — Bearer required.
- `POST /v1/auth/forgot` — luôn return `{ok:true}` để chống enumeration. Sinh `PasswordReset` row, gửi email qua Resend (dev mode log link to stdout nếu RESEND_API_KEY trống).
- `POST /v1/auth/change-password` — Bearer required.

### B.4 Rate limit
- Port `website/src/lib/rate-limit-upstash.ts` + in-memory sang Go.
- `internal/ratelimit/`: interface `Check(ctx, key, max, window) (RateLimiterResult, error)`. In-mem dùng `sync.Map` + `time.Now()`. Upstash dùng `net/http` POST `/pipeline` body `[["INCR",...],["PEXPIRE",...,"NX"],["PTTL",...]]`. Fail-open như TS.
- Middleware `RateLimitAuth(action, identifierFromBody)`, `RateLimitUserWrite()`.

### B.5 Email
- `internal/email/resend.go`: `SendPasswordResetEmail(to, link)` POST `https://api.resend.com/emails`. No SDK.

### B.6 Parity test
- Adapt `website/scripts/test-change-password.mjs` → gọi Go service (`WV_BASE_URL=http://localhost:4000`). Phải pass tất cả 12 assertion.
- Run side-by-side: TS service trên `:3000`, Go trên `:4000`. Mỗi user tạo trong dev DB phải login được ở cả 2 (vì DB share + bcrypt format giống).

**Exit criteria**: 6 endpoints auth chạy + parity script pass. Mobile có thể swap BASE_URL sang Go cho auth flow và vẫn login được account cũ tạo từ web.

---

## Phase C — Resource CRUD (2 tuần)

Apply pattern cho từng resource:
1. `internal/store/queries/<resource>.sql` — sqlc queries
2. `internal/services/<resource>.go` — pure logic, return domain types + `error` (không touch HTTP)
3. `internal/handlers/<resource>.go` — parse JSON body với validator, gọi service, marshal response
4. Wire vào `cmd/server/main.go` mux

### C.1 Devices (template)
Endpoints:
- `GET /v1/devices?status=&category=` — list
- `POST /v1/devices` — create với inline warranty (transactional)
- `GET /v1/devices/{id}` — read with warranties + attachments
- `PATCH /v1/devices/{id}` — update
- `DELETE /v1/devices/{id}` — cascade attachments + warranties + remove encrypted blobs từ disk

Limits (from `CLAUDE.md`):
- `MAX_DEVICES_PER_USER = 50` — kiểm tra trong service trước khi insert
- Per-row ownership: mọi query include `AND "userId" = $userID`

### C.2 Warranties
- Limit `MAX_WARRANTIES_PER_DEVICE = 5`
- `POST /v1/warranties/{id}/reminder` (dismiss), `DELETE /v1/warranties/{id}/reminder` (restore)

### C.3 Attachments (encrypted) — **highest risk**
Files đang được TS encrypt. Go phải decrypt 100% identical.

- `internal/files/encrypt.go`:
  - Re-implement scheme từ `website/src/lib/files.ts`:
    - Random data key 32 bytes
    - AES-256-GCM encrypt blob với data key + 12-byte IV (random)
    - Wrap data key bằng AES-256-GCM với `FILE_MASTER_KEY` (env, 32 bytes base64/hex)
    - Lưu wrappedKey + IV + wrapKeyIV trên `Attachment` row
  - Decrypt: ngược lại
- `internal/files/mime.go`: dùng `mimetype.Detect()` để verify magic-byte. Whitelist y hệt: `image/{jpeg,png,webp,gif,heic}`, `application/pdf`. SVG/HTML/JS reject.
- `internal/files/resize.go`: nếu image > 1600px ở chiều dài nhất → downscale bằng `imaging.Resize`. Test on real iPhone HEIC → JPG conversion (HEIC decode trong pure Go yếu — có thể cần `vips` subprocess; fallback: chấp nhận HEIC nguyên trạng nếu < limit, hoặc reject HEIC trên Go phase và bật lại sau).

Endpoints:
- `POST /v1/devices/{id}/attachments` — multipart upload, ownership check, MIME verify, encrypt, write to `PRIVATE_UPLOAD_ROOT/<userID>/<deviceID>/<attachmentID>.bin`
- `DELETE /v1/attachments/{id}` — remove blob + DB row
- `GET /v1/files/{id}` — auth-gated stream. Hỗ trợ Bearer (mobile) hoặc cookie (web). Set `Cache-Control: private, no-store` + sandboxing CSP. `?download=1` flips `Content-Disposition`.

**Migration test**: `node scripts/migrate-attachments-to-encrypted.mjs` đã chạy, nên `private-uploads/` chứa file encrypted bằng TS. Viết Go test load 1 file đó, decrypt, so sánh hash plaintext với expected → must match.

### C.4 Subscriptions
- 5 billingCycle: MONTHLY/QUARTERLY/YEARLY/LIFETIME/CUSTOM (CUSTOM cần `intervalDays`)
- `nextRenewalDate(date, cycle, intervalDays)` + `monthlyEquivalent(price, cycle)` — port từ `website/src/lib/subscription-types.ts`
- `POST /v1/subscriptions/{id}/renew` — log payment + advance renewalDate
- `POST /v1/subscriptions/{id}/payments` — manual payment log
- Limit `MAX_SUBS_PER_USER = 100`

### C.5 Wishlist
- Statuses: WATCHING/DECIDED/PURCHASED/DROPPED
- `PATCH /v1/wishlist/{id}` với `status=PURCHASED` → tạo `Device` row trong cùng transaction, set `purchasedDeviceId`
- `POST /v1/wishlist/{id}/prices` — append `WishlistPrice` (price history)
- Limit `MAX_WISHLIST_PER_USER = 200`

### C.6 Catalog
- `GET /v1/catalog` — list categories/brands/stores/warrantyProviders
- Cache layer: `sync.Map` + 60s TTL, hoặc Postgres `LISTEN/NOTIFY` trên `Brand/Store/...` để invalidate (nâng cao). Bắt đầu với simple TTL cache.

### C.7 Stats + Reminders
- `GET /v1/stats` — port logic từ `website/src/lib/stats.ts` thành 1 query SQL lớn (CTE) hoặc nhiều query parallel với `errgroup`. Đo perf trên dev DB.
- `GET /v1/reminders` — port `website/src/lib/services/reminders.ts`.

**Exit criteria**: 28 endpoints (so với danh sách hiện tại) chạy. Adapt `scripts/test-warranty-refactor.mjs`, `test-backup-restore.mjs`, `test-stats.mjs`, `test-change-password.mjs` để chạy chéo Go service. Tất cả pass.

---

## Phase D — Push fanout & cron (3-5 ngày)

### D.1 Web push
- `internal/push/webpush.go`: `SherClockHolmes/webpush-go`. Init từ env `NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT`. Send → 404/410 → return `gone:true`.

### D.2 APNs
- `internal/push/apns.go`: `sideshow/apns2`. Init từ `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_BUNDLE_ID` + `APNS_PRIVATE_KEY` (.p8). Token JWT cache 50 phút (lib tự handle). Production gateway nếu `APNS_PRODUCTION=1`.

### D.3 FCM
- `internal/push/fcm.go`: hand-roll giống TS. Mint OAuth2 JWT từ service account, cache access token 1h, POST `messages:send`. 404/UNREGISTERED → `gone:true`.

### D.4 Fanout dispatcher
- `internal/push/dispatch.go`: `SendToSubscription(sub, payload)` switch theo `sub.platform` ∈ {web, apns, fcm}. Nếu `gone:true` → caller xoá `PushSubscription` row.

### D.5 Cron command
- `cmd/cron/main.go`: load config, mở DB pool, run warranty-check logic:
  1. Warranty expiry — `ACTIVE` device, warranty endDate cách hôm nay 7d/30d, skip nếu `Reminder.isDismissed`
  2. Wishlist target date — `WATCHING|DECIDED`, targetDate today/+7/+30, stamp `lastNotifiedAt`
  3. Wishlist periodic check-in — `reminderIntervalDays` set, elapsed since `lastNotifiedAt ?? createdAt`. Push down vào SQL: `WHERE now() - COALESCE("lastNotifiedAt", "createdAt") >= reminderIntervalDays * interval '1 day'` (TS hiện check client-side, leftover từ SQLite era)
  4. Subscription renewal — `ACTIVE` non-LIFETIME, `renewalDate` today/+1/+3. Subs đã quá hạn: trong transaction append `SubscriptionPayment` + advance via `nextRenewalDate()`; `autoRenew=false` → flip status `EXPIRED`.
- Exit code 0 ok / 1 lỗi. Log JSON.
- Run modes:
  - HTTP endpoint `POST /v1/cron/warranty-check` với `Authorization: Bearer ${CRON_SECRET}` cho Vercel Cron / external scheduler
  - CLI: `go run ./cmd/cron` cho local dev / systemd timer
- Pruning: cùng job xoá `Session` đã expire + `PasswordReset` quá hạn.

**Exit criteria**: chạy `go run ./cmd/cron` trên dev DB, log thấy số notification gửi đi đúng (so với manual sanity check). Fanout xử lý web/apns/fcm row khác nhau. Subscription auto-bill log `SubscriptionPayment` đúng số.

---

## Phase E — Web cutover (1-2 tuần)

Đây là phase rủi ro cao nhất vì web đang dùng server actions trực tiếp.

### E.1 Web auth bridge
- `website/src/lib/api.ts`: typed Go REST client. Mỗi function gọi `fetch()` với base `process.env.GO_API_URL ?? 'http://localhost:4000'` và bearer từ cookie.
- `website/src/lib/auth-cookie.ts`: iron-session cookie store **chỉ** lưu `{ accessToken, expiresAt }` (không lưu userID/email — re-fetch qua `GET /v1/auth/me` mỗi RSC nếu cần).
- Login flow web:
  1. Form post → server action `loginAction()` 
  2. Action fetch `POST /v1/auth/login` → nhận bearer
  3. Set iron-session cookie → redirect `/dashboard`
- Mỗi RSC page top-level: `const user = await api.getMe(cookie.accessToken)` thay cho `requireUser()`.

### E.2 Tear out server actions
Plan từng resource một, không nhồi cả lượt:

1. **devices** trước (template). Mọi server action trong `website/src/app/actions/devices.ts` thay bằng `useFormState` + 1 server action mỏng gọi Go API:
   ```ts
   'use server';
   export async function createDevice(prev, formData) {
     const cookie = await getAuthCookie();
     const res = await api.createDevice(cookie.accessToken, formDataToJSON(formData));
     if (!res.ok) return { ok: false, errors: res.fieldErrors };
     revalidatePath('/devices');
     redirect(`/devices/${res.data.id}`);
   }
   ```
2. Tương tự cho warranties, attachments, subscriptions, wishlist, push, password-reset, backup, catalog.
3. Sau mỗi resource: chạy `npm run lint`, `npx tsc --noEmit`, click qua web flow.

### E.3 Xoá Prisma + DB code khỏi web
Khi tất cả server action đã thin-proxy:
- Xoá `website/src/lib/prisma.ts`, `website/src/lib/services/*`, `website/src/lib/files.ts`, `website/src/lib/push*.ts`, `website/src/lib/rate-limit*.ts`, `website/src/lib/email.ts`, `website/src/lib/queries.ts`, `website/src/lib/stats.ts`, `website/src/lib/warranty.ts`, `website/src/lib/auth.ts`, `website/src/lib/api-auth.ts`, `website/src/lib/session.ts` (giữ session.ts mỏng cho auth cookie thôi).
- Xoá `website/prisma/`. Schema management chuyển sang `api/migrations/`.
- Xoá `website/scripts/test-*.mjs`. Tests chuyển sang `api/scripts/test_*.sh` hoặc Go test files.
- Xoá `website/src/app/api/v1/*`, `website/src/app/api/cron/*`, `website/src/app/api/files/*`. Web không còn API route nào (trừ webhook nếu có sau).
- `package.json`: remove `@prisma/*`, `pg`, `bcrypt-ts`, `web-push`, `iron-session` (giữ nếu auth cookie vẫn iron-session), `resend`, `sharp`. `npm install` lại — bundle web nhỏ hẳn.

### E.4 File serving
- Web cần cookie-auth pass qua → Go cần accept cookie hoặc web proxy `/api/files/{id}` → Go.
- Lựa chọn đơn giản: thêm `internal/auth/cookie.go` ở Go, decrypt iron-session cookie cùng `SESSION_SECRET` (Go có lib compat? Không sẵn — phải tự port). 
- Lựa chọn đơn giản hơn: web giữ 1 route `/api/files/[id]` proxy qua Go bằng bearer trong cookie. Không expose Go endpoint trực tiếp ra browser.
- **Chốt**: dùng web-proxy. Web vẫn có 1 file route duy nhất, đọc cookie, gọi Go với bearer, stream response. Đơn giản, không phải port iron-session sang Go.

### E.5 Cookie / CORS
- Mobile gọi Go trực tiếp (Bearer), không cần CORS.
- Web (browser) chỉ gọi Go từ server actions (server-to-server) → không cần CORS. Nếu có client-side `fetch` (rare, nhưng có), thêm CORS middleware allow origin = `WEB_URL` env.

**Exit criteria**: web build + chạy + click qua tất cả flow (auth, devices CRUD, warranties, subs, wishlist, attachments upload + view, settings change password, reminders dismiss, stats). Không còn import từ `@prisma/client` ở web.

---

## Phase F — Decommission TS API + cleanup (2-3 ngày)

- Mobile: đổi `BASE_URL` trong iOS `Endpoints.swift` (`http://localhost:4000`) + Android `app/build.gradle.kts`. Smoke test full flow.
- Xoá các code path đã thay (Phase E.3).
- Update `CLAUDE.md`: phần "Server actions are the API" → giờ "Web gọi Go REST qua thin server actions". Bỏ phần Prisma layout. Giữ phần encrypted attachments nhưng note implementation đã ở Go.
- Update `MOBILE_PLAN.md`: tick Phase 0 đã xong (mobile-ready), thêm note "BE migrated to Go" với link sang file này.
- Update `README.md` root.
- Update `.env.example`: tách thành `website/.env.example` (chỉ web concern) + `api/.env.example` (DB, push, files, ratelimit).
- Update `docker-compose.yml`: thêm `api` service, web depends_on api.
- CI: 2 workflow — `web.yml` (lint + tsc) + `api.yml` (vet + golangci + go test).

**Exit criteria**: `git grep -E "prisma|@prisma" website/` empty. `git grep "rateLimitAuth\|rateLimitUserWrite" website/` empty. `npm run build` ở website xanh + bundle size giảm rõ. `go test ./...` ở api xanh.

---

## Cross-cutting concerns

### Schema migration ownership
- Sau cutover, **goose** ở `api/migrations/` là source-of-truth. Prisma schema xoá luôn.
- Trong giai đoạn parallel (Phase A-D), Prisma vẫn chạy `db push` cho dev DB; goose chỉ verify state, không tự apply. Tránh 2 tools fight nhau.
- Khi schema cần đổi: viết goose migration mới, áp lên dev DB, dùng `prisma db pull` (nếu vẫn còn) để verify Prisma model match. Sau Phase F thì khỏi care Prisma.

### Encryption key parity
- `FILE_MASTER_KEY` phải share giữa Go service và web (chỉ khi web còn proxy file). Sau Phase F, chỉ Go cần.
- Test interop: Go decrypt file đã encrypt từ TS, và ngược lại. Viết test `internal/files/interop_test.go` load fixture file từ `private-uploads/` rồi assert plaintext hash.

### OpenAPI sync
- `openapi.yaml` không đổi structure. Mỗi khi thêm endpoint Go: update YAML đồng thời.
- Tùy chọn: gen Go server interface bằng `oapi-codegen -generate types,server,spec`. Bắt đầu hand-roll, gen sau khi route stable.

### Observability
- `log/slog` JSON handler ra stdout.
- `internal/httpx/middleware.go::Logging` log mỗi request: method, path, status, duration, userID (nếu có). Trace ID (`X-Request-ID` header) để correlate.
- Healthcheck `/healthz` (200 always) + `/readyz` (check DB ping + Upstash if configured). Cho LB.

### Deployment (single-host VPS)
- Build: `docker build -t warranty-vault-api ./api` — multi-stage, distroless final, ~20MB.
- Run: 
  ```
  docker run -d --name wv-api \
    --env-file /etc/wv/api.env \
    -v /var/wv/private-uploads:/data/private-uploads \
    -p 4000:4000 \
    --restart unless-stopped \
    warranty-vault-api
  ```
- Cron: systemd timer hoặc 1 cron entry chạy `docker exec wv-api /app/cron`.
- Reverse proxy: Caddy / Nginx terminate TLS, proxy `:4000` ra public. CORS chỉ allow `WEB_URL`.
- Backup: pg_dump cron + tar gzip `/var/wv/private-uploads` (đã encrypted nên storage backup OK).
- Sau ổn định → có thể move sang Fly.io / Cloud Run mà không đổi code (chỉ đổi build pipeline + persistent volume).

### Rollback strategy
- Mỗi phase có git tag riêng (`go-bootstrap`, `go-auth`, `go-resources`, `go-push`, `go-web-cutover`). Nếu phase E rollback: revert web về server actions, mobile vẫn dùng Go API (vì độc lập).
- Khi Phase F xong + chạy 2 tuần ổn → xoá tag intermediate, kết thúc migration.

---

## Risks

1. **Encrypted attachment interop** — TS và Go phải dùng AES-256-GCM identical (algo, key derivation, IV format). Mitigation: integration test trên fixture file thật.
2. **Image processing weaker trong Go** — `disintegration/imaging` không bằng `sharp`. Worst case fallback: spawn `vips` subprocess (Docker image cài libvips, ~5MB extra).
3. **bcrypt cross-platform compat** — `bcrypt-ts` (TS) và `golang.org/x/crypto/bcrypt` đều dùng prefix `$2a$/$2b$`. Verified theoretically, cần test thực tế: tạo user trên TS, login từ Go, expect ok.
4. **Server actions có UX shortcut** (revalidatePath, redirect) → khi proxy qua Go, mỗi mutation thành 1 round trip thêm. Mitigation: web action `await fetch(...)` rồi `revalidatePath` + `redirect` như cũ. Latency tăng ~10-30ms.
5. **Cookie → bearer translation** trên web — cần đảm bảo cookie không bị leak qua client component. Iron-session đã encrypt nên ok.
6. **Prisma `db push` vs goose** trong giai đoạn parallel — risk drift schema. Mitigation: lock schema trong Phase B-D, chỉ thay đổi trong Phase F.
7. **iOS/Android testing với Go service** — mobile dev đổi `BASE_URL` → app build mới. Chạy parallel: 2 build, 1 trỏ TS, 1 trỏ Go, smoke test toàn flow trước khi cutover.

---

## Effort estimate (1 mình, part-time)

| Phase | Effort |
|---|---|
| A — Bootstrap | 5-7 ngày |
| B — Auth | 3-5 ngày |
| C — Resources | 10-14 ngày |
| D — Push + cron | 3-5 ngày |
| E — Web cutover | 7-10 ngày |
| F — Decommission | 2-3 ngày |
| **Tổng** | **5-7 tuần** |

So với 2.5-3 tháng của MOBILE_PLAN — đây là dự án phụ trợ, nhanh hơn vì logic đã chín và đã có service layer separation.

---

## Bắt đầu: Phase A.1 ngay bây giờ

```
mkdir api && cd api
go mod init github.com/<owner>/warranty-vault/api
go get github.com/jackc/pgx/v5 github.com/pressly/goose/v3 \
       github.com/go-playground/validator/v10 \
       golang.org/x/crypto/bcrypt
```

Sau đó tạo `cmd/server/main.go` healthcheck → là bước nhỏ nhất ship được.
